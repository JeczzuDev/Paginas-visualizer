/*
 * Keeps the phone screen on while the deck is open.
 *
 * Secure contexts (the https tunnel URL): Screen Wake Lock API.
 * Plain http on the LAN: the API does not exist, so we fall back to a
 * hidden 1 fps canvas-stream video (the NoSleep technique) started on
 * the first touch — autoplay policies require a user gesture.
 */

'use strict';

let sentinel = null;
let fallbackStarted = false;

async function requestApiLock() {
    try {
        sentinel = await navigator.wakeLock.request('screen');
        sentinel.addEventListener('release', () => {
            sentinel = null;
        });
    } catch {
        /* denied (battery saver, etc.) — nothing else to do */
    }
}

function startFallback() {
    if (fallbackStarted) return;
    fallbackStarted = true;

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 32, 32);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.srcObject = canvas.captureStream(1);
    video.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);

    /* redraw keeps the stream (and the video) considered live */
    setInterval(() => ctx.fillRect(0, 0, 32, 32), 1000);
    video.play().catch(() => {
        fallbackStarted = false;
        video.remove();
    });
}

export function enableWakeLock() {
    if ('wakeLock' in navigator && window.isSecureContext) {
        void requestApiLock();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !sentinel) void requestApiLock();
        });
    } else {
        document.addEventListener('pointerdown', startFallback, { once: true });
    }
}
