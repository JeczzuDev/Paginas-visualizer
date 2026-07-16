/*
 * Composition root. Loads .env + deck.config.json, wires the modules and
 * prints the startup banner with the LAN URL(s), QR code and token.
 */

import { randomInt } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { ConfigStore, formatConfigError } from './config.js';
import { createHttpServer } from './http.js';
import { StateStore } from './state.js';
import { WsHub } from './ws-hub.js';
import { Dispatcher } from './actions/dispatcher.js';
import { launchApp, openUrl } from './actions/launch.js';
import { isButton, type Button } from './schema.js';
import { log } from './log.js';

const VERSION = '1.0.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
    process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
    /* .env es opcional */
}

const token = (process.env.DECK_TOKEN ?? '').trim() || String(randomInt(100000, 1000000));
const tokenIsPersistent = Boolean((process.env.DECK_TOKEN ?? '').trim());

let store: ConfigStore;
try {
    store = new ConfigStore(path.join(ROOT, 'deck.config.json'));
} catch (err) {
    log.error('config', `deck.config.json invalido, no puedo arrancar:\n${formatConfigError(err)}`);
    process.exit(1);
}
store.watch();

const { port, host } = store.current.server;
const httpServer = createHttpServer({ uiDir: path.join(ROOT, 'ui'), token });

const stateStore = new StateStore();

const dispatcher = new Dispatcher();
dispatcher.register('launch.app', (action) => launchApp(action.path, action.args, action.cwd));
dispatcher.register('launch.url', (action) => openUrl(action.url));

function findButton(buttonId: string): Button {
    for (const page of store.current.pages) {
        for (const cell of page.buttons) {
            if (isButton(cell) && cell.id === buttonId) return cell;
        }
    }
    throw new Error(`boton desconocido: "${buttonId}"`);
}

const hub = new WsHub({
    server: httpServer,
    token,
    version: VERSION,
    getPages: () => store.current.pages,
    getState: () => stateStore.state,
    onPress: async (buttonId) => {
        const button = findButton(buttonId);
        await dispatcher.dispatch(button.action, { buttonId });
    }
});

store.on('layout-changed', () => hub.broadcastLayout(store.current.pages));
stateStore.on('changed', () => hub.broadcastState(stateStore.state));

httpServer.listen(port, host, () => printBanner());

/* Home LANs are almost always 192.168.x.x; virtual adapters (Hyper-V,
 * VirtualBox, WSL) tend to sit on 172.x/10.x. Sort so the QR encodes
 * the address the phone can actually reach. */
function lanAddresses(): string[] {
    const out: string[] = [];
    for (const [, addrs] of Object.entries(os.networkInterfaces())) {
        for (const addr of addrs ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
        }
    }
    const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
}

function printBanner(): void {
    const addresses = lanAddresses();
    const primary = addresses[0] ?? '127.0.0.1';
    const primaryUrl = `http://${primary}:${port}/?token=${token}`;

    console.log('');
    console.log('  Own Stream Portal listo');
    console.log('');
    for (const addr of addresses) {
        console.log(`  http://${addr}:${port}/?token=${token}`);
    }
    if (addresses.length === 0) {
        console.log(`  http://127.0.0.1:${port}/?token=${token} (sin red detectada)`);
    }
    if (addresses.length > 1) {
        console.log('  (varias interfaces de red: usa la IP de tu Wi-Fi/LAN real)');
    }
    console.log('');
    qrcode.generate(primaryUrl, { small: true }, (qr) => console.log(indent(qr, 2)));
    console.log(
        tokenIsPersistent
            ? `  Token: ${token} (fijo, desde .env)`
            : `  Token: ${token} (aleatorio en cada arranque; fijalo en .env -> DECK_TOKEN)`
    );
    console.log('');
}

function indent(block: string, spaces: number): string {
    const pad = ' '.repeat(spaces);
    return block
        .split('\n')
        .map((line) => pad + line)
        .join('\n');
}
