/*
 * App bootstrap: token handling, WebSocket client with reconnect,
 * message routing. Rendering lives in deck.js.
 */

'use strict';

import * as deck from './deck.js';

const $status = document.querySelector('[data-role="status"]');
const $statusText = document.querySelector('[data-role="status-text"]');

/* ---------------- token ---------------- */

const TOKEN_KEY = 'deck_token';

function resolveToken() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('token');
    if (fromUrl) {
        localStorage.setItem(TOKEN_KEY, fromUrl);
        /* keep the address bar clean; the token lives in localStorage */
        params.delete('token');
        const query = params.toString();
        history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
    }
    return localStorage.getItem(TOKEN_KEY) || '';
}

const token = resolveToken();

/* ---------------- status banner ---------------- */

function setStatus(kind, text) {
    $status.className = `status is-${kind}`;
    $statusText.textContent = text;
}

/* ---------------- WebSocket client ---------------- */

const PING_INTERVAL_MS = 25000;
const STALE_MS = 60000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

let ws = null;
let attempts = 0;
let fatal = false;
let lastMessageAt = 0;
let reconnectTimer = null;

function connect() {
    if (fatal) return;
    clearTimeout(reconnectTimer);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/?token=${encodeURIComponent(token)}`);

    ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', token, client: navigator.userAgent.includes('Mobile') ? 'movil' : 'escritorio' }));
    });

    ws.addEventListener('message', (event) => {
        lastMessageAt = Date.now();
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }
        handleMessage(msg);
    });

    ws.addEventListener('close', (event) => {
        ws = null;
        if (fatal) return;
        if (event.code === 4001) {
            fatal = true;
            setStatus('error', 'Token inválido — vuelve a escanear el QR');
            return;
        }
        setStatus('connecting', 'Reconectando…');
        scheduleReconnect();
    });

    ws.addEventListener('error', () => {
        /* close fires right after; reconnect happens there */
    });
}

function scheduleReconnect() {
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    attempts++;
    reconnectTimer = setTimeout(connect, delay);
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'hello-ok':
            attempts = 0;
            setStatus('ok', 'Conectado');
            deck.renderLayout(msg.layout.pages);
            deck.renderState(msg.state);
            break;
        case 'hello-error':
            /* close 4001 handles the fatal path */
            break;
        case 'layout':
            deck.renderLayout(msg.pages);
            break;
        case 'state':
            deck.renderState(msg.state);
            break;
        case 'ack':
            deck.handleAck(msg.pressId, msg.ok, msg.error);
            break;
        case 'pong':
            break;
    }
}

/* App-level keepalive: Wi-Fi doze can leave half-open sockets that
 * never emit 'close'. If nothing arrived for a while, force a reconnect. */
setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastMessageAt > STALE_MS) {
        ws.close();
        return;
    }
    ws.send(JSON.stringify({ type: 'ping' }));
}, PING_INTERVAL_MS);

/* Phones suspend tabs aggressively; retry the instant we are visible. */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !fatal) {
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            attempts = 0;
            connect();
        }
    }
});

/* ---------------- boot ---------------- */

deck.init((pressId, buttonId) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'press', pressId, buttonId }));
    } else {
        deck.handleAck(pressId, false, 'Sin conexión con el servidor');
    }
});

if (!token) {
    setStatus('error', 'Falta el token — abre el enlace del QR de la consola');
} else {
    setStatus('connecting', 'Conectando…');
    connect();
}
