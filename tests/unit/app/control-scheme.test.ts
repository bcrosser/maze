import {describe, expect, it} from 'vitest';

import {
    CONTROL_SCHEMES,
    MAX_CONTROL_BUTTONS,
    OVERWORLD_CONTROL_SCHEME,
    stickRepeatsWhileHeld,
    stickSupportsDirection,
    type ControlStickMode
} from '../../../src/app/control-scheme';
import type {DirectionId} from '../../../src/domain/overworld/move-player';

const DIRECTIONS: readonly DirectionId[] = ['up', 'down', 'left', 'right'];

describe('shared control schemes', () => {
    it('covers the overworld, every minigame, and both card tables', () => {
        expect(CONTROL_SCHEMES.map(scheme => scheme.id)).toEqual([
            'overworld',
            'pipe',
            'lockpick',
            'safe-dial',
            'tumbler-relay',
            'circuit',
            'shooter',
            'platformer',
            'horsemaster',
            'zapper',
            'casino-heist',
            'blackjack',
            'holdem'
        ]);
    });

    it('gives every scheme a unique id', () => {
        const ids = new Set(CONTROL_SCHEMES.map(scheme => scheme.id));
        expect(ids.size).toBe(CONTROL_SCHEMES.length);
    });

    it('keeps every action pad within the tappable button budget', () => {
        for (const scheme of CONTROL_SCHEMES) {
            expect(scheme.buttons.length, `${scheme.id} button count`)
                .toBeGreaterThanOrEqual(1);
            expect(scheme.buttons.length, `${scheme.id} button count`)
                .toBeLessThanOrEqual(MAX_CONTROL_BUTTONS);
        }
    });

    it('labels every button and gives it a unique id within its scheme', () => {
        for (const scheme of CONTROL_SCHEMES) {
            const ids = new Set(scheme.buttons.map(button => button.id));
            expect(ids.size, `${scheme.id} duplicate button ids`)
                .toBe(scheme.buttons.length);
            for (const button of scheme.buttons) {
                expect(button.label.length, `${scheme.id}/${button.id} label`)
                    .toBeGreaterThan(0);
                expect(button.icon.length, `${scheme.id}/${button.id} icon`)
                    .toBeGreaterThan(0);
            }
            expect(scheme.stick.label.length, `${scheme.id} pad label`).toBeGreaterThan(0);
        }
    });

    it('keeps the overworld ids the shell and acceptance tests depend on', () => {
        expect(OVERWORLD_CONTROL_SCHEME.quickSlots).toBe(true);
        expect(OVERWORLD_CONTROL_SCHEME.buttons.map(button => button.id)).toEqual([
            'attack',
            'interact',
            'wait',
            'inventory',
            'menu'
        ]);
        expect(
            OVERWORLD_CONTROL_SCHEME.buttons.find(button => button.id === 'attack')?.behavior
        ).toBe('toggle');
    });

    it('only offers quick slots in the maze, where the backpack exists', () => {
        const withQuickSlots = CONTROL_SCHEMES.filter(scheme => scheme.quickSlots === true);
        expect(withQuickSlots.map(scheme => scheme.id)).toEqual(['overworld']);
    });

    it('declares a repeat cadence for every stepped pad', () => {
        for (const scheme of CONTROL_SCHEMES) {
            if (!stickRepeatsWhileHeld(scheme.stick.mode)) continue;
            expect(scheme.stick.repeatMs, `${scheme.id} repeat cadence`)
                .toBeGreaterThan(0);
        }
    });
});

describe('stick narrowing', () => {
    it('reports every direction for the four-way and analogue pads', () => {
        for (const mode of ['four-way-step', 'analog'] as const) {
            for (const direction of DIRECTIONS) {
                expect(stickSupportsDirection(mode, direction)).toBe(true);
            }
        }
    });

    it('drops the unused axis for narrowed pads', () => {
        expect(stickSupportsDirection('vertical', 'up')).toBe(true);
        expect(stickSupportsDirection('vertical', 'down')).toBe(true);
        expect(stickSupportsDirection('vertical', 'left')).toBe(false);
        expect(stickSupportsDirection('vertical', 'right')).toBe(false);
        expect(stickSupportsDirection('horizontal', 'left')).toBe(true);
        expect(stickSupportsDirection('horizontal', 'right')).toBe(true);
        expect(stickSupportsDirection('horizontal', 'up')).toBe(false);
        expect(stickSupportsDirection('horizontal', 'down')).toBe(false);
    });

    it('reports no direction at all when a scheme hides the pad', () => {
        for (const direction of DIRECTIONS) {
            expect(stickSupportsDirection('none', direction)).toBe(false);
        }
    });

    it('repeats only for the stepped modes so held input cannot double-fire', () => {
        const repeating: readonly ControlStickMode[] = ['four-way-step', 'vertical'];
        const edgeOnly: readonly ControlStickMode[] = ['analog', 'horizontal', 'none'];
        for (const mode of repeating) expect(stickRepeatsWhileHeld(mode)).toBe(true);
        for (const mode of edgeOnly) expect(stickRepeatsWhileHeld(mode)).toBe(false);
    });
});
