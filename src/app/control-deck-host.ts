import type Phaser from 'phaser';

import type {ControlDeckHost} from './control-deck';

/** Registry key the shell uses to publish the shared on-screen control deck. */
export const CONTROL_DECK_REGISTRY_KEY = 'control-deck';

export function provideControlDeck(game: Phaser.Game, host: ControlDeckHost): void {
    game.registry.set(CONTROL_DECK_REGISTRY_KEY, host);
}

/**
 * Scenes read the deck through the registry so none of them needs constructor
 * plumbing. Unit tests and any headless scene get `null` and simply run without
 * on-screen controls.
 */
export function getControlDeck(scene: Phaser.Scene): ControlDeckHost | null {
    const host: unknown = scene.game?.registry?.get(CONTROL_DECK_REGISTRY_KEY);
    return isControlDeckHost(host) ? host : null;
}

function isControlDeckHost(value: unknown): value is ControlDeckHost {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as ControlDeckHost).setScheme === 'function' &&
        typeof (value as ControlDeckHost).clearScheme === 'function';
}
