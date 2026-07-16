/*
 * deck.config.json loader + watcher.
 *
 * Watches the *directory* (editors on Windows save via atomic rename,
 * which breaks watching the file itself), debounces bursts of events and
 * ignores saves whose content did not change. An invalid save never
 * crashes the server: the last good config stays active and a precise
 * error is logged so the user can fix the typo mid-stream.
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError, type ZodIssue } from 'zod';
import { deckConfigSchema, type DeckConfig } from './schema.js';
import { log } from './log.js';

const DEBOUNCE_MS = 300;

/*
 * Union failures (spacer-vs-button cells, action variants) report a
 * useless "Invalid input" at the union node; the real cause lives in the
 * branch errors. Recurse into the branch whose issues are deepest —
 * that is the variant the user was actually writing.
 */
function flattenIssues(issues: ZodIssue[]): { path: (string | number)[]; message: string }[] {
    const out: { path: (string | number)[]; message: string }[] = [];
    for (const issue of issues) {
        if (issue.code === 'invalid_union') {
            let best: { path: (string | number)[]; message: string }[] = [];
            let bestDepth = -1;
            for (const branch of issue.unionErrors) {
                const flat = flattenIssues(branch.issues);
                const depth = Math.max(...flat.map((i) => i.path.length), 0);
                if (depth > bestDepth) {
                    bestDepth = depth;
                    best = flat;
                }
            }
            out.push(...best);
        } else {
            out.push({ path: [...issue.path], message: issue.message });
        }
    }
    return out;
}

export function formatConfigError(err: unknown): string {
    if (err instanceof ZodError) {
        return flattenIssues(err.issues)
            .map(({ path, message }) => {
                const where = path.length
                    ? path
                          .map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`))
                          .join('')
                          .replace(/^\./, '')
                    : '(raiz)';
                return `  ${where}: ${message}`;
            })
            .join('\n');
    }
    if (err instanceof SyntaxError) {
        return `  JSON invalido: ${err.message}`;
    }
    return `  ${String(err)}`;
}

function parseConfig(raw: string): DeckConfig {
    return deckConfigSchema.parse(JSON.parse(raw));
}

export class ConfigStore extends EventEmitter {
    readonly filePath: string;
    private config: DeckConfig;
    private lastHash: string;
    private debounceTimer: NodeJS.Timeout | null = null;
    private watcher: fs.FSWatcher | null = null;

    /* Throws if the file is missing or invalid: at startup there is no
     * last-good config to fall back to. */
    constructor(filePath: string) {
        super();
        this.filePath = path.resolve(filePath);
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.config = parseConfig(raw);
        this.lastHash = hash(raw);
    }

    get current(): DeckConfig {
        return this.config;
    }

    watch(): void {
        const dir = path.dirname(this.filePath);
        const base = path.basename(this.filePath);
        this.watcher = fs.watch(dir, (_event, filename) => {
            if (filename !== base) return;
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.reload(), DEBOUNCE_MS);
        });
        log.info('config', `vigilando ${base} (recarga en caliente activa)`);
    }

    close(): void {
        this.watcher?.close();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

    private reload(): void {
        let raw: string;
        try {
            raw = fs.readFileSync(this.filePath, 'utf8');
        } catch {
            /* Editor mid-rename; the next event will pick the file up. */
            return;
        }
        const newHash = hash(raw);
        if (newHash === this.lastHash) return;

        let next: DeckConfig;
        try {
            next = parseConfig(raw);
        } catch (err) {
            log.error(
                'config',
                `deck.config.json invalido, se mantiene el layout anterior:\n${formatConfigError(err)}`
            );
            return;
        }

        const prev = this.config;
        this.config = next;
        this.lastHash = newHash;

        if (
            next.server.port !== prev.server.port ||
            next.server.host !== prev.server.host ||
            next.obs.url !== prev.obs.url
        ) {
            log.warn(
                'config',
                'cambios en "server"/"obs" requieren reiniciar el servidor (no se aplican en caliente)'
            );
        }

        log.info('config', 'layout recargado, avisando a los clientes conectados');
        this.emit('layout-changed', next);
    }
}

function hash(raw: string): string {
    return createHash('sha1').update(raw).digest('hex');
}
