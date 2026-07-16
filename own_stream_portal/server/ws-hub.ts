/*
 * WebSocket hub for browser clients.
 *
 * Auth: the upgrade request must already carry a valid token (query or
 * cookie, same as HTTP), and the first message must be a 'hello' with
 * the token again (authoritative — covers PWA cookie-jar quirks).
 * Clients that do not hello within 5 s are dropped (close 4000); a bad
 * token gets 'hello-error' + close 4001.
 */

import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
    clientMessageSchema,
    type DeckState,
    type Page,
    type ServerMessage
} from './schema.js';
import { isAuthorized, tokenMatches } from './http.js';
import { log } from './log.js';

const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 30000;

export interface HubOptions {
    server: http.Server;
    token: string;
    version: string;
    getPages: () => Page[];
    getState: () => DeckState;
    /* Throwing rejects the press; the message becomes the ack error. */
    onPress: (buttonId: string) => Promise<void>;
}

interface ClientInfo {
    authed: boolean;
    alive: boolean;
    helloTimer: NodeJS.Timeout;
}

export class WsHub {
    private readonly wss: WebSocketServer;
    private readonly clients = new Map<WebSocket, ClientInfo>();
    private readonly heartbeat: NodeJS.Timeout;

    constructor(private readonly opts: HubOptions) {
        this.wss = new WebSocketServer({ noServer: true });

        opts.server.on('upgrade', (req, socket, head) => {
            if (!isAuthorized(req, opts.token)) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.wss.emit('connection', ws, req);
            });
        });

        this.wss.on('connection', (ws) => this.onConnection(ws));

        this.heartbeat = setInterval(() => {
            for (const [ws, info] of this.clients) {
                if (!info.alive) {
                    ws.terminate();
                    continue;
                }
                info.alive = false;
                ws.ping();
            }
        }, HEARTBEAT_MS);
    }

    close(): void {
        clearInterval(this.heartbeat);
        this.wss.close();
    }

    get clientCount(): number {
        let n = 0;
        for (const info of this.clients.values()) if (info.authed) n++;
        return n;
    }

    broadcastLayout(pages: Page[]): void {
        this.broadcast({ type: 'layout', pages });
    }

    broadcastState(state: DeckState): void {
        this.broadcast({ type: 'state', state });
    }

    private broadcast(msg: ServerMessage): void {
        const raw = JSON.stringify(msg);
        for (const [ws, info] of this.clients) {
            if (info.authed && ws.readyState === WebSocket.OPEN) ws.send(raw);
        }
    }

    private send(ws: WebSocket, msg: ServerMessage): void {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }

    private onConnection(ws: WebSocket): void {
        const info: ClientInfo = {
            authed: false,
            alive: true,
            helloTimer: setTimeout(() => ws.close(4000, 'hello timeout'), HELLO_TIMEOUT_MS)
        };
        this.clients.set(ws, info);

        ws.on('pong', () => {
            info.alive = true;
        });

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = clientMessageSchema.parse(JSON.parse(String(raw)));
            } catch {
                ws.close(4002, 'mensaje invalido');
                return;
            }

            if (msg.type === 'hello') {
                clearTimeout(info.helloTimer);
                if (!tokenMatches(msg.token, this.opts.token)) {
                    this.send(ws, { type: 'hello-error', reason: 'bad-token' });
                    ws.close(4001, 'bad token');
                    return;
                }
                info.authed = true;
                log.info('hub', `cliente conectado (${msg.client}), total: ${this.clientCount}`);
                this.send(ws, {
                    type: 'hello-ok',
                    version: this.opts.version,
                    layout: { pages: this.opts.getPages() },
                    state: this.opts.getState()
                });
                return;
            }

            if (!info.authed) {
                ws.close(4001, 'hello primero');
                return;
            }

            if (msg.type === 'ping') {
                this.send(ws, { type: 'pong' });
                return;
            }

            /* press */
            const { pressId, buttonId } = msg;
            this.opts
                .onPress(buttonId)
                .then(() => this.send(ws, { type: 'ack', pressId, ok: true }))
                .catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    log.warn('hub', `press "${buttonId}" fallo: ${message}`);
                    this.send(ws, { type: 'ack', pressId, ok: false, error: message });
                });
        });

        ws.on('close', () => {
            clearTimeout(info.helloTimer);
            const wasAuthed = info.authed;
            this.clients.delete(ws);
            if (wasAuthed) log.info('hub', `cliente desconectado, total: ${this.clientCount}`);
        });

        ws.on('error', () => ws.terminate());
    }
}
