import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {
    advanceTutorialStep,
    OVERWORLD_TUTORIAL_FLAG,
    OVERWORLD_TUTORIAL_STEPS
} from '../../../src/app/tutorial-steps';
import {OVERWORLD_CONTROL_SCHEME} from '../../../src/app/control-scheme';

const markup = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

describe('overworld tutorial steps', () => {
    it('gives every step a unique id and non-empty copy', () => {
        const ids = new Set(OVERWORLD_TUTORIAL_STEPS.map(step => step.id));
        expect(ids.size).toBe(OVERWORLD_TUTORIAL_STEPS.length);
        for (const step of OVERWORLD_TUTORIAL_STEPS) {
            expect(step.title.length).toBeGreaterThan(0);
            expect(step.body.length).toBeGreaterThan(0);
        }
    });

    it('opens on a centred step so the tour introduces itself before pointing', () => {
        expect(OVERWORLD_TUTORIAL_STEPS[0]?.anchorSelector).toBeNull();
    });

    it('anchors every remaining step to an element the shell really renders', () => {
        for (const step of OVERWORLD_TUTORIAL_STEPS.slice(1)) {
            const selector = step.anchorSelector;
            expect(selector, `${step.id} must point at something`).not.toBeNull();
            const deckButtonId = selector!.startsWith('#control-')
                ? selector!.slice('#control-'.length)
                : null;
            if (deckButtonId !== null) {
                // Deck buttons are built at runtime as `control-<spec.id>`.
                expect(
                    OVERWORLD_CONTROL_SCHEME.buttons.map(button => button.id)
                ).toContain(deckButtonId);
                continue;
            }
            const staticId = selector!.startsWith('#') ? selector!.slice(1) : null;
            if (staticId !== null) {
                expect(markup, `${step.id} anchor`).toContain(`id="${staticId}"`);
                continue;
            }
            const statMatch = /^\.hud-stat\[data-stat="(?<stat>[a-z]+)"\]$/.exec(selector!);
            expect(statMatch, `${step.id} uses an unrecognised anchor`).not.toBeNull();
            expect(markup, `${step.id} anchor`)
                .toContain(`data-stat="${statMatch!.groups!['stat']}"`);
        }
    });

    it('reserves the overlay markup the tour drives', () => {
        for (const id of [
            'tutorial-overlay',
            'tutorial-spotlight',
            'tutorial-line',
            'tutorial-card',
            'tutorial-progress',
            'tutorial-title',
            'tutorial-body',
            'tutorial-back',
            'tutorial-next',
            'tutorial-skip'
        ]) {
            expect(markup).toContain(`id="${id}"`);
        }
    });

    it('stops at both ends instead of wrapping', () => {
        const total = OVERWORLD_TUTORIAL_STEPS.length;
        expect(advanceTutorialStep(0, -1, total)).toBe(0);
        expect(advanceTutorialStep(0, 1, total)).toBe(1);
        expect(advanceTutorialStep(total - 1, 1, total)).toBe(total - 1);
        expect(advanceTutorialStep(total - 1, -1, total)).toBe(total - 2);
        expect(advanceTutorialStep(0, 99, total)).toBe(total - 1);
        expect(advanceTutorialStep(0, 0, 0)).toBe(0);
    });

    it('names the flag the save file already accepts', () => {
        expect(OVERWORLD_TUTORIAL_FLAG).toBe('tutorial-overworld-seen');
    });
});
