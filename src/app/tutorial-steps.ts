/**
 * First-run guidance for the overworld. Kept free of DOM access so the step
 * roster and navigation stay unit-testable under the node test environment.
 */

export interface TutorialStep {
    readonly id: string;
    /** Element to spotlight, or null to centre the card with no pointer line. */
    readonly anchorSelector: string | null;
    readonly title: string;
    readonly body: string;
}

/** Campaign flag recording that the player has already been shown the tour. */
export const OVERWORLD_TUTORIAL_FLAG = 'tutorial-overworld-seen';

export const OVERWORLD_TUTORIAL_STEPS: readonly TutorialStep[] = [
    {
        id: 'welcome',
        anchorSelector: null,
        title: 'Welcome to the maze',
        body: 'Eight levels stand between you and the horse. Every level hides a ' +
            'roster of minigames; clear enough of them and the way out opens. ' +
            'This tour takes about thirty seconds.'
    },
    {
        id: 'move',
        anchorSelector: '#move-pad',
        title: 'Move and fight',
        body: 'Drag the pad, or use the arrow keys and WASD. Walking into a monster ' +
            'attacks it. Walking into a soft wall mines through it, if you are ' +
            'carrying a pick.'
    },
    {
        id: 'objective',
        anchorSelector: '.hud-stat[data-stat="objective"]',
        title: 'What you are hunting',
        body: 'This names the minigame you are currently tracking and points you at ' +
            'it. Press the arrow beside it to track a different one instead.'
    },
    {
        id: 'exit',
        anchorSelector: '.hud-stat[data-stat="exit"]',
        title: 'Opening the exit',
        body: 'Finish the number of objectives shown here and the exit unlocks. ' +
            'Level 1 asks for one. Level 8 asks for all eight, and then you have won.'
    },
    {
        id: 'health',
        anchorSelector: '.hud-stat[data-stat="health"]',
        title: 'Staying alive',
        body: 'Monsters keep arriving while you explore, and beating them pays. ' +
            'Run out of health and you lose progress, not the campaign.'
    },
    {
        id: 'actions',
        anchorSelector: '#control-interact',
        title: 'Interact with everything',
        body: 'Interact opens objectives, chests, shops and casino tables, and ' +
            'disarms any trap you have spotted. Attack switches to ranged aiming ' +
            'once you are carrying a bow.'
    },
    {
        id: 'items',
        anchorSelector: '#control-inventory',
        title: 'Your backpack',
        body: 'Items lists what you are carrying, plus your money, your salvage and ' +
            'your free slots. Salvage is scrap stripped from gear you do not want, ' +
            'and shops pay cash for it.'
    },
    {
        id: 'legend',
        anchorSelector: '#maze-help',
        title: 'Everything else',
        body: 'The question mark opens the full legend: items, monsters, wall ' +
            'materials and traps. This tour lives in there too, whenever you want ' +
            'it again.'
    }
];

/** Moves by `delta` steps, stopping at either end rather than wrapping. */
export function advanceTutorialStep(index: number, delta: number, total: number): number {
    if (total <= 0) return 0;
    const next = index + delta;
    if (next < 0) return 0;
    if (next > total - 1) return total - 1;
    return next;
}
