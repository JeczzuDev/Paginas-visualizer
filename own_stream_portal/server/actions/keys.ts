/*
 * Key-name -> Windows virtual-key-code table and the 'ctrl+shift+f1'
 * parser. Pure module (no Windows APIs) so it stays testable anywhere.
 */

const VK: Record<string, number> = {
    /* modifiers */
    ctrl: 0x11,
    control: 0x11,
    shift: 0x10,
    alt: 0x12,
    altgr: 0xa5,
    win: 0x5b,
    windows: 0x5b,

    /* navigation / editing */
    enter: 0x0d,
    esc: 0x1b,
    escape: 0x1b,
    space: 0x20,
    tab: 0x09,
    backspace: 0x08,
    delete: 0x2e,
    del: 0x2e,
    insert: 0x2d,
    home: 0x24,
    end: 0x23,
    pageup: 0x21,
    pagedown: 0x22,
    up: 0x26,
    down: 0x28,
    left: 0x25,
    right: 0x27,
    printscreen: 0x2c,
    scrolllock: 0x91,
    pause: 0x13,
    capslock: 0x14,
    numlock: 0x90,

    /* punctuation (US layout OEM codes) */
    plus: 0xbb,
    minus: 0xbd,
    comma: 0xbc,
    period: 0xbe,

    /* media / volume */
    playpause: 0xb3,
    next: 0xb0,
    prev: 0xb1,
    stop: 0xb2,
    volumeup: 0xaf,
    volumedown: 0xae,
    volumemute: 0xad
};

/* a-z */
for (let i = 0; i < 26; i++) VK[String.fromCharCode(97 + i)] = 0x41 + i;
/* 0-9 */
for (let i = 0; i <= 9; i++) VK[String(i)] = 0x30 + i;
/* f1-f24 */
for (let i = 1; i <= 24; i++) VK[`f${i}`] = 0x70 + (i - 1);
/* numpad0-numpad9 */
for (let i = 0; i <= 9; i++) VK[`numpad${i}`] = 0x60 + i;

/* Keys that need KEYEVENTF_EXTENDEDKEY for correct scan codes. */
const EXTENDED = new Set<number>([
    0x2e, 0x2d, 0x24, 0x23, 0x21, 0x22, // del ins home end pgup pgdn
    0x26, 0x28, 0x25, 0x27, // arrows
    0x90, 0x2c, // numlock printscreen
    0xa5, // altgr (right alt)
    0xb3, 0xb0, 0xb1, 0xb2, 0xaf, 0xae, 0xad // media + volume
]);

export function isExtendedKey(vk: number): boolean {
    return EXTENDED.has(vk);
}

export function vkFor(name: string): number {
    const vk = VK[name.trim().toLowerCase()];
    if (vk === undefined) {
        throw new Error(`tecla desconocida: "${name}" (ej. validos: ctrl, shift, alt, win, a-z, 0-9, f1-f24, enter, space, up...)`);
    }
    return vk;
}

/* 'ctrl+shift+f10' -> [0x11, 0x10, 0x79]; pressed in order, released in
 * reverse, so plain single keys also work. */
export function parseHotkey(keys: string): number[] {
    const parts = keys.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) throw new Error('atajo vacio');
    return parts.map(vkFor);
}

export const MEDIA_VK: Record<'playpause' | 'next' | 'prev' | 'stop', number> = {
    playpause: 0xb3,
    next: 0xb0,
    prev: 0xb1,
    stop: 0xb2
};

export const VOLUME_VK: Record<'up' | 'down' | 'mute', number> = {
    up: 0xaf,
    down: 0xae,
    mute: 0xad
};
