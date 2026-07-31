/*
 * REST endpoints for the config editor (/api/*). All requests are already
 * token-checked by http.ts before reaching here.
 *
 *   GET  /api/config          current deck.config.json (raw text)
 *   GET  /api/obs             live OBS inventory (scenes, inputs, sources)
 *   GET  /api/obs/filters     ?source=NAME -> that source's filter names
 *   POST /api/config          validate a new config with the zod schema
 *                             and, if valid, write it (the file watcher then
 *                             hot-reloads it to every connected device)
 */

import type http from 'node:http';
import fs from 'node:fs';
import { deckConfigSchema } from './schema.js';
import { formatConfigError } from './config.js';
import type { ObsClient } from './actions/obs.js';
import { log } from './log.js';

const MAX_BODY = 2 * 1024 * 1024; // 2 MB is plenty for a config

export interface ApiDeps {
    configPath: string;
    obsClient: ObsClient;
}

export type ApiHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
) => Promise<void>;

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('cuerpo demasiado grande'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

export function createApiHandler(deps: ApiDeps): ApiHandler {
    return async (req, res, url) => {
        const { method } = req;

        if (method === 'GET' && url.pathname === '/api/config') {
            const raw = fs.readFileSync(deps.configPath, 'utf8');
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache'
            });
            res.end(raw);
            return;
        }

        if (method === 'GET' && url.pathname === '/api/obs') {
            try {
                sendJson(res, 200, await deps.obsClient.getEntities());
            } catch (err) {
                sendJson(res, 200, {
                    connected: false,
                    scenes: [],
                    inputs: [],
                    sceneSources: {},
                    error: String(err)
                });
            }
            return;
        }

        if (method === 'GET' && url.pathname === '/api/obs/filters') {
            const source = url.searchParams.get('source') ?? '';
            sendJson(res, 200, { filters: await deps.obsClient.getFilters(source) });
            return;
        }

        if (method === 'POST' && url.pathname === '/api/config') {
            let raw: string;
            try {
                raw = await readBody(req);
            } catch (err) {
                sendJson(res, 413, { ok: false, error: String(err) });
                return;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch (err) {
                sendJson(res, 400, { ok: false, error: `JSON invalido: ${(err as Error).message}` });
                return;
            }
            try {
                deckConfigSchema.parse(parsed);
            } catch (err) {
                sendJson(res, 400, { ok: false, error: formatConfigError(err) });
                return;
            }
            /* Write the editor's object as-is (not the zod-defaulted copy) so
             * the file stays close to what the user built. The watcher picks
             * up the change and broadcasts the new layout. */
            fs.writeFileSync(deps.configPath, JSON.stringify(parsed, null, 4) + '\n', 'utf8');
            log.info('api', 'deck.config.json guardado desde el editor');
            sendJson(res, 200, { ok: true });
            return;
        }

        sendJson(res, 404, { ok: false, error: 'ruta no encontrada' });
    };
}
