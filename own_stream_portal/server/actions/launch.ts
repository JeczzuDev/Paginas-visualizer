/*
 * Launch programs and URLs. Children are detached and unref'd so they
 * outlive (and never block) the deck server.
 */

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export function launchApp(appPath: string, args: string[], cwd?: string): Promise<void> {
    const lower = appPath.toLowerCase();
    const isBatch = lower.endsWith('.bat') || lower.endsWith('.cmd');
    return new Promise((resolve, reject) => {
        let child;
        if (isBatch) {
            /* Node 20+ refuses to spawn .bat/.cmd as an image. Open it in its
             * own console window via cmd `start`; cmd returns immediately and
             * the batch keeps running detached (good for a server script). */
            const workdir = cwd || dirname(appPath);
            const quoted = [`"${appPath}"`, ...args.map((a) => `"${a}"`)].join(' ');
            const line = `start "" /d "${workdir}" ${quoted}`;
            child = spawn('cmd', ['/d', '/s', '/c', line], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false,
                windowsVerbatimArguments: true
            });
        } else {
            child = spawn(appPath, args, {
                cwd,
                detached: true,
                stdio: 'ignore',
                windowsHide: false
            });
        }
        child.once('error', (err) => {
            reject(new Error(`no se pudo abrir "${appPath}": ${err.message}`));
        });
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

export function openUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        /* 'start' is a cmd builtin; the empty "" is the window title and
         * the quotes keep &-containing URLs intact. */
        const child = spawn('cmd', ['/d', '/s', '/c', `start "" "${url}"`], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            windowsVerbatimArguments: true
        });
        child.once('error', (err) => {
            reject(new Error(`no se pudo abrir la URL: ${err.message}`));
        });
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}
