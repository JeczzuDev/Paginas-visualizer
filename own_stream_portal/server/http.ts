/*
 * Plain node:http static server + token gate.
 *
 * Auth model (LAN threat model, but must stay safe behind a public
 * Cloudflare quick tunnel):
 *   - First visit arrives as /?token=XXXX (QR-encoded URL); if the token
 *     is valid we set a cookie so asset requests and reloads pass.
 *   - Every request must carry a valid token via query or cookie.
 *   - The WebSocket 'hello' message re-validates the token from
 *     localStorage as the authoritative check (PWA cookie-jar quirks).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webm': 'video/webm'
};

/* The deck must always load the latest UI — never cache app files. */
const NO_CACHE = new Set(['.html', '.js', '.css', '.webmanifest', '.json']);

export function tokenMatches(candidate: string | null | undefined, token: string): boolean {
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return out;
}

export function isAuthorized(req: http.IncomingMessage, token: string): boolean {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (tokenMatches(url.searchParams.get('token'), token)) return true;
    return tokenMatches(parseCookies(req.headers.cookie)['deck_token'], token);
}

export interface HttpOptions {
    uiDir: string;
    token: string;
}

export function createHttpServer(opts: HttpOptions): http.Server {
    const uiDir = path.resolve(opts.uiDir);

    return http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://internal');

        if (!isAuthorized(req, opts.token)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('403 - token invalido o ausente. Abre el enlace con ?token=... (QR en consola).');
            return;
        }

        const headers: http.OutgoingHttpHeaders = {};
        if (tokenMatches(url.searchParams.get('token'), opts.token)) {
            headers['Set-Cookie'] = `deck_token=${url.searchParams.get('token')}; Path=/; SameSite=Lax; Max-Age=31536000`;
        }

        const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const filePath = path.resolve(uiDir, rel);
        if (filePath !== uiDir && !filePath.startsWith(uiDir + path.sep)) {
            res.writeHead(404, headers);
            res.end();
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            headers['Content-Type'] = MIME[ext] ?? 'application/octet-stream';
            headers['Cache-Control'] = NO_CACHE.has(ext) ? 'no-cache' : 'public, max-age=86400';
            res.writeHead(200, headers);
            res.end(data);
        });
    });
}
