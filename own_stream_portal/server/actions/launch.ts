/*
 * Launch programs and URLs. Children are detached and unref'd so they
 * outlive (and never block) the deck server.
 */

import { spawn } from 'node:child_process';

export function launchApp(path: string, args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(path, args, {
            cwd,
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        });
        child.once('error', (err) => {
            reject(new Error(`no se pudo abrir "${path}": ${err.message}`));
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
