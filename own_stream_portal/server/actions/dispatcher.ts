/*
 * Action registry. Each action type gets a handler at startup; a press
 * dispatches to the handler for its button's action. Throwing (or a
 * rejected promise) turns into an ack error shown on the phone.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { Action } from '../schema.js';

type HandlerFor<T extends Action['type']> = (
    action: Extract<Action, { type: T }>,
    context: PressContext
) => Promise<void>;

export interface PressContext {
    buttonId: string;
}

export class Dispatcher {
    private readonly handlers = new Map<
        Action['type'],
        (action: Action, context: PressContext) => Promise<void>
    >();

    register<T extends Action['type']>(type: T, handler: HandlerFor<T>): void {
        this.handlers.set(type, handler as (action: Action, context: PressContext) => Promise<void>);
    }

    async dispatch(action: Action, context: PressContext): Promise<void> {
        const handler = this.handlers.get(action.type);
        if (!handler) {
            throw new Error(`accion "${action.type}" no disponible todavia`);
        }
        await handler(action, context);
    }
}

/*
 * Macro = sequence of simple actions with optional delays. A per-button
 * lock rejects re-entry, so a double-tap cannot interleave two runs of
 * the same macro (schema already forbids nested macros).
 */
export function registerMacroHandler(dispatcher: Dispatcher): void {
    const running = new Set<string>();

    dispatcher.register('macro', async (action, context) => {
        if (running.has(context.buttonId)) {
            throw new Error('macro ya en ejecucion');
        }
        running.add(context.buttonId);
        try {
            for (const step of action.steps) {
                if (step.action) await dispatcher.dispatch(step.action, context);
                if (step.delayMs) await sleep(step.delayMs);
            }
        } finally {
            running.delete(context.buttonId);
        }
    });
}
