import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {createItemInstance} from '../../../src/domain/entities/item-types';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {generateMaze, MAZE_GENERATOR_ID} from '../../../src/domain/overworld/maze-generator';
import {PASSAGE_CELL} from '../../../src/domain/overworld/maze-types';
import {OBJECTIVE_BY_ID} from '../../../src/domain/overworld/level-objectives';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {deriveSeed} from '../../../src/domain/random/seed-derivation';
import {
    updatePhaserHud,
    type GameShell
} from '../../../src/app/game-shell';

function elementStub<T extends HTMLElement>(): T {
    return {
        dataset: {},
        textContent: '',
        querySelector: () => null
    } as unknown as T;
}

function shellStub(): GameShell {
    return {
        canvas: elementStub<HTMLCanvasElement>(),
        gameMain: elementStub<HTMLElement>(),
        startPanel: elementStub<HTMLElement>(),
        startBackdrop: elementStub<HTMLElement>(),
        startButton: elementStub<HTMLButtonElement>(),
        menuButton: elementStub<HTMLButtonElement>(),
        pausePanel: elementStub<HTMLElement>(),
        pauseBackdrop: elementStub<HTMLElement>(),
        resumeButton: elementStub<HTMLButtonElement>(),
        restartButton: elementStub<HTMLButtonElement>(),
        level: elementStub<HTMLElement>(),
        health: elementStub<HTMLElement>(),
        mining: elementStub<HTMLElement>(),
        weapon: elementStub<HTMLElement>(),
        backpack: elementStub<HTMLElement>(),
        money: elementStub<HTMLElement>(),
        reinforcement: elementStub<HTMLElement>(),
        objective: elementStub<HTMLElement>(),
        playerStatus: elementStub<HTMLElement>(),
        exitStatus: elementStub<HTMLElement>(),
        message: elementStub<HTMLElement>()
    };
}

function lockedRequiredHeistState(withCompass: boolean): CampaignState {
    const campaignSeed = 0x5eed_2026;
    const levelNumber = 8;
    const levelSeed = deriveSeed(
        campaignSeed,
        `level:${MAZE_GENERATOR_ID}`,
        levelNumber
    );
    const maze = generateMaze({
        size: 49,
        topologyRandom: new Mulberry32Random(deriveSeed(levelSeed, 'maze-topology')),
        materialRandom: new Mulberry32Random(deriveSeed(levelSeed, 'wall-materials'))
    });
    const generated = initializeLevelContent(createInitialCampaignState({
        campaignSeed,
        overworldSeed: levelSeed,
        levelId: 'level-8',
        maze
    }));
    const shop = generated.overworld.serviceSites.find(site => site.kind === 'shop');
    if (!shop) throw new Error('Locked Casino Heist should force a shop.');
    const flags = generated.overworld.objectives
        .filter(objective => objective.objectiveId !== 'casino-heist')
        .map(objective => OBJECTIVE_BY_ID[objective.objectiveId].completionFlag);
    const shortcut = generated.overworld.pipeShortcutWall;
    if (!shortcut) throw new Error('Generated level should retain the Pipe shortcut.');
    const openedRow = [...generated.overworld.maze[shortcut.y]!];
    openedRow[shortcut.x] = PASSAGE_CELL;
    const openedMaze = [...generated.overworld.maze];
    openedMaze[shortcut.y] = openedRow;
    return {
        ...generated,
        flags,
        player: {
            ...generated.player,
            equippedUtility: withCompass
                ? createItemInstance('test/heist-shop-compass', 'compass')
                : null
        },
        overworld: {
            ...generated.overworld,
            maze: openedMaze,
            pipeShortcutWall: null,
            playerPosition: shop.position
        }
    };
}

describe('Phaser HUD objective guidance', () => {
    it('names the forced shop instead of Exit when locked Casino Heist is required', () => {
        const shell = shellStub();
        updatePhaserHud(shell, lockedRequiredHeistState(false));

        expect(shell.objective.textContent).toBe('Getaway Car · Shop');
        expect(shell.exitStatus.textContent).toBe('Locked 7 / 8');
    });

    it('points a Compass at the forced shop when locked Casino Heist is required', () => {
        const shell = shellStub();
        updatePhaserHud(shell, lockedRequiredHeistState(true));

        expect(shell.objective.textContent).toMatch(/^Getaway Car · Shop .+ 0$/);
        expect(shell.objective.textContent).not.toMatch(/^Exit/);
    });
});
