/*
 * Deck rendering: layout -> DOM grid, state -> visual classes.
 * Pure DOM module; networking lives in app.js and reaches us through
 * the onPress callback given to init().
 */

'use strict';

const $grid = document.querySelector('[data-role="grid"]');
const $tabs = document.querySelector('[data-role="tabs"]');
const $toast = document.querySelector('[data-role="toast"]');

let pages = [];
let activePageId = null;
let onPressCallback = null;
/* pressId -> buttonId, so acks can flash the right button */
const pendingPresses = new Map();
/* buttonId -> { el, action } for state rendering */
const buttonIndex = new Map();
let lastState = null;
let toastTimer = null;

export function init(onPress) {
    onPressCallback = onPress;
}

export function renderLayout(newPages) {
    pages = newPages;
    if (!pages.some((p) => p.id === activePageId)) {
        activePageId = pages.length ? pages[0].id : null;
    }
    renderTabs();
    renderGrid();
    if (lastState) renderState(lastState);
}

export function renderState(state) {
    lastState = state;
    for (const { el, action } of buttonIndex.values()) {
        el.classList.toggle('is-disabled', isObsAction(action) && !state.obsConnected);
        el.classList.toggle('is-active', isActionActive(action, state));
        el.classList.toggle(
            'is-muted',
            action.type === 'obs.mute' && state.mutes[action.input] === true
        );
    }
}

export function handleAck(pressId, ok, error) {
    const buttonId = pendingPresses.get(pressId);
    pendingPresses.delete(pressId);
    if (!buttonId) return;
    const entry = buttonIndex.get(buttonId);
    if (!entry) return;
    flash(entry.el, ok ? 'flash-ok' : 'flash-error');
    if (!ok && error) showToast(error);
}

export function showToast(text) {
    $toast.textContent = text;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        $toast.hidden = true;
    }, 4000);
}

/* ------------------------------------------------------------------ */

function isObsAction(action) {
    if (action.type.startsWith('obs.')) return true;
    if (action.type === 'macro') {
        return action.steps.some((s) => s.action && s.action.type.startsWith('obs.'));
    }
    return false;
}

function isActionActive(action, state) {
    switch (action.type) {
        case 'obs.scene':
            return action.scene === state.currentScene;
        case 'obs.stream':
            return state.streaming;
        case 'obs.record':
            return state.recording;
        case 'obs.sourceVisibility':
            return state.sourceVisibility[`${action.scene}/${action.source}`] === true;
        case 'obs.filter':
            return state.filters[`${action.source}/${action.filter}`] === true;
        default:
            return false;
    }
}

function renderTabs() {
    $tabs.innerHTML = '';
    $tabs.hidden = pages.length <= 1;
    for (const page of pages) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tab';
        tab.textContent = page.label;
        tab.classList.toggle('is-current', page.id === activePageId);
        tab.addEventListener('click', () => {
            activePageId = page.id;
            renderTabs();
            renderGrid();
            if (lastState) renderState(lastState);
        });
        $tabs.appendChild(tab);
    }
}

function renderGrid() {
    $grid.innerHTML = '';
    buttonIndex.clear();
    const page = pages.find((p) => p.id === activePageId);
    if (!page) return;

    $grid.style.gridTemplateColumns = `repeat(${page.grid.cols}, 1fr)`;
    $grid.style.gridTemplateRows = `repeat(${page.grid.rows}, 1fr)`;

    for (const cell of page.buttons) {
        if (!('id' in cell)) {
            const spacer = document.createElement('div');
            spacer.className = 'spacer';
            $grid.appendChild(spacer);
            continue;
        }
        $grid.appendChild(createButton(cell));
    }
}

function createButton(btn) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'deck-btn';
    el.dataset.buttonId = btn.id;
    if (btn.color) el.style.setProperty('--btn-color', btn.color);
    if (btn.position) {
        el.style.gridColumn = String(btn.position.col);
        el.style.gridRow = String(btn.position.row);
    }

    const icon = document.createElement('span');
    icon.className = 'deck-btn-icon';
    icon.textContent = btn.icon || '';
    const label = document.createElement('span');
    label.className = 'deck-btn-label';
    label.textContent = btn.label;
    el.append(icon, label);

    el.addEventListener('pointerdown', () => {
        el.classList.add('pressed');
        if (navigator.vibrate) navigator.vibrate(15);
    });
    const release = () => el.classList.remove('pressed');
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);

    el.addEventListener('click', () => {
        if (el.classList.contains('is-disabled')) {
            showToast('OBS desconectado');
            return;
        }
        const pressId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingPresses.set(pressId, btn.id);
        if (onPressCallback) onPressCallback(pressId, btn.id);
    });

    buttonIndex.set(btn.id, { el, action: btn.action });
    return el;
}

function flash(el, className) {
    el.classList.remove('flash-ok', 'flash-error');
    /* restart the animation even on repeated flashes */
    void el.offsetWidth;
    el.classList.add(className);
    el.addEventListener(
        'animationend',
        () => el.classList.remove('flash-ok', 'flash-error'),
        { once: true }
    );
}
