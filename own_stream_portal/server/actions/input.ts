/*
 * Keystroke injection via user32.SendInput through koffi FFI.
 *
 * The x64 INPUT struct is the classic pitfall here: 4-byte type field,
 * 4 bytes padding, then a 32-byte union (MOUSEINPUT is the largest
 * member). koffi models the union directly so the layout matches.
 *
 * Limits: SendInput goes to the *focused* window and cannot reach
 * processes running elevated (UIPI) unless this server is elevated too.
 */

import { createRequire } from 'node:module';
import { isExtendedKey } from './keys.js';
import { log } from '../log.js';

/* koffi is CJS and only needed on Windows; requiring it lazily keeps the
 * rest of the server importable anywhere. */
const require = createRequire(import.meta.url);

export interface KeyInjector {
    /* Chord: down in order, up in reverse (e.g. ctrl+shift+f10). */
    tapKeys(vks: number[]): void;
    /* Single key pressed `times` times (volume steps). */
    tapKey(vk: number, times?: number): void;
    /* Types arbitrary text into the focused window (KEYEVENTF_UNICODE). */
    typeText(text: string): void;
}

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;

interface KeyEvent {
    wVk: number;
    wScan: number;
    dwFlags: number;
}

export class KoffiInjector implements KeyInjector {
    private readonly sendInput: (n: number, inputs: unknown[], size: number) => number;
    private readonly inputSize: number;

    constructor() {
        const koffi = require('koffi') as typeof import('koffi');
        const user32 = koffi.load('user32.dll');

        const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
            wVk: 'uint16',
            wScan: 'uint16',
            dwFlags: 'uint32',
            time: 'uint32',
            dwExtraInfo: 'uintptr_t'
        });
        const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
            dx: 'long',
            dy: 'long',
            mouseData: 'uint32',
            dwFlags: 'uint32',
            time: 'uint32',
            dwExtraInfo: 'uintptr_t'
        });
        const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
            uMsg: 'uint32',
            wParamL: 'uint16',
            wParamH: 'uint16'
        });
        const INPUT_UNION = koffi.union('INPUT_UNION', {
            mi: MOUSEINPUT,
            ki: KEYBDINPUT,
            hi: HARDWAREINPUT
        });
        const INPUT = koffi.struct('INPUT', {
            type: 'uint32',
            u: INPUT_UNION
        });

        this.inputSize = koffi.sizeof(INPUT);
        const fn = user32.func('unsigned int SendInput(unsigned int cInputs, INPUT *pInputs, int cbSize)');
        this.sendInput = (n, inputs, size) => fn(n, inputs, size) as number;
    }

    tapKeys(vks: number[]): void {
        const events: KeyEvent[] = [];
        for (const vk of vks) {
            events.push({ wVk: vk, wScan: 0, dwFlags: isExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0 });
        }
        for (const vk of [...vks].reverse()) {
            events.push({
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP | (isExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0)
            });
        }
        this.send(events);
    }

    tapKey(vk: number, times = 1): void {
        const events: KeyEvent[] = [];
        for (let i = 0; i < times; i++) {
            events.push({ wVk: vk, wScan: 0, dwFlags: isExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0 });
            events.push({
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP | (isExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0)
            });
        }
        this.send(events);
    }

    typeText(text: string): void {
        const events: KeyEvent[] = [];
        for (const unit of text) {
            for (let i = 0; i < unit.length; i++) {
                const scan = unit.charCodeAt(i);
                events.push({ wVk: 0, wScan: scan, dwFlags: KEYEVENTF_UNICODE });
                events.push({ wVk: 0, wScan: scan, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP });
            }
        }
        this.send(events);
    }

    private send(events: KeyEvent[]): void {
        if (events.length === 0) return;
        const inputs = events.map((ev) => ({
            type: INPUT_KEYBOARD,
            u: { ki: { wVk: ev.wVk, wScan: ev.wScan, dwFlags: ev.dwFlags, time: 0, dwExtraInfo: 0 } }
        }));
        const sent = this.sendInput(inputs.length, inputs, this.inputSize);
        if (sent !== inputs.length) {
            throw new Error(
                `SendInput inyecto ${sent}/${inputs.length} eventos (ventana elevada? ejecuta el servidor como administrador)`
            );
        }
    }
}

/* Logs instead of injecting; used on non-Windows and in tests. */
export class NullInjector implements KeyInjector {
    tapKeys(vks: number[]): void {
        log.info('input', `(null) tapKeys ${vks.map((v) => `0x${v.toString(16)}`).join('+')}`);
    }

    tapKey(vk: number, times = 1): void {
        log.info('input', `(null) tapKey 0x${vk.toString(16)} x${times}`);
    }

    typeText(text: string): void {
        log.info('input', `(null) typeText "${text}"`);
    }
}

export function createInjector(): KeyInjector {
    if (process.platform !== 'win32') {
        log.warn('input', 'plataforma no Windows: los atajos de teclado quedan en modo simulado');
        return new NullInjector();
    }
    try {
        return new KoffiInjector();
    } catch (err) {
        log.error('input', `koffi no disponible (${String(err)}); atajos en modo simulado`);
        return new NullInjector();
    }
}
