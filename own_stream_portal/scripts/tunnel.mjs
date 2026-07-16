/*
 * Opens a Cloudflare quick tunnel to the local deck server and prints
 * the public URL (with token and QR). The URL changes on every run —
 * for a permanent one you need a domain on Cloudflare + a named tunnel.
 *
 * Requires the server running (npm start) and cloudflared on PATH.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let port = 8420;
try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'deck.config.json'), 'utf8'));
    if (config.server && config.server.port) port = config.server.port;
} catch {
    console.warn('aviso: no pude leer deck.config.json, asumo puerto 8420');
}

let token = '';
try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^\s*DECK_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) token = m[1].trim();
} catch {
    /* sin .env */
}

console.log(`Abriendo tunel rapido hacia http://127.0.0.1:${port} ...`);

const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe']
});

child.on('error', (err) => {
    if (err.code === 'ENOENT') {
        console.error('');
        console.error('cloudflared no esta instalado. Instalalo con:');
        console.error('  winget install Cloudflare.cloudflared');
        console.error('y vuelve a ejecutar: npm run tunnel');
        process.exit(1);
    }
    throw err;
});

let announced = false;
let logBuffer = '';

function onData(buf) {
    const text = String(buf);
    logBuffer += text;
    if (announced) return;
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
        announced = true;
        announce(m[0]);
    }
}

function announce(url) {
    const full = token ? `${url}/?token=${token}` : url;
    console.log('');
    console.log('  Tunel activo — deck accesible desde cualquier red:');
    console.log('');
    console.log(`  ${full}`);
    console.log('');
    qrcode.generate(full, { small: true }, (qr) => {
        console.log(qr.split('\n').map((l) => '  ' + l).join('\n'));
        console.log('');
        if (!token) {
            console.log('  AVISO: DECK_TOKEN no esta fijado en .env; añade ?token=XXXXXX');
            console.log('  a la URL usando el token que imprimio el servidor al arrancar.');
            console.log('');
        }
        console.log('  Esta URL cambia en cada arranque del tunel. Ctrl+C para cerrar.');
        console.log('');
    });
}

child.stdout.on('data', onData);
child.stderr.on('data', onData);

child.on('exit', (code) => {
    if (!announced) {
        console.error('el tunel termino sin publicar URL. Salida de cloudflared:');
        console.error(logBuffer.slice(-2000));
    }
    process.exit(code ?? 0);
});
