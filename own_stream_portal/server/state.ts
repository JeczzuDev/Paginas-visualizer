/*
 * Deck state snapshot. Single writer (the OBS wrapper), single reader
 * (the WS hub, which broadcasts the full snapshot on every change —
 * it is tiny, so no diff protocol).
 */

import { EventEmitter } from 'node:events';
import type { DeckState } from './schema.js';

export function createInitialState(): DeckState {
    return {
        obsConnected: false,
        currentScene: null,
        streaming: false,
        recording: false,
        mutes: {},
        sourceVisibility: {},
        filters: {}
    };
}

export class StateStore extends EventEmitter {
    readonly state: DeckState = createInitialState();

    update(mutate: (state: DeckState) => void): void {
        mutate(this.state);
        this.emit('changed', this.state);
    }
}
