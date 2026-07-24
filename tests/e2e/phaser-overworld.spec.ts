import {expect, test, type Page} from '@playwright/test';
import {PNG} from 'pngjs';

import type {CampaignState} from '../../src/domain/campaign/campaign-state';
import {
    createItemInstance,
    type ItemTypeId
} from '../../src/domain/entities/item-types';
import {CAMPAIGN_VICTORY_FLAG} from '../../src/domain/campaign/level-progression';
import {initializeLevelContent} from '../../src/domain/overworld/level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getCurrentObjective,
    getObjectiveStatus,
    OBJECTIVE_BY_ID,
    type ObjectiveId
} from '../../src/domain/overworld/level-objectives';
import {
    generateMaze,
    MAZE_GENERATOR_ID
} from '../../src/domain/overworld/maze-generator';
import {PASSAGE_CELL, type Coordinate} from '../../src/domain/overworld/maze-types';
import {Mulberry32Random} from '../../src/domain/random/random-source';
import {deriveSeed} from '../../src/domain/random/seed-derivation';
import {createInitialCampaignState} from '../../src/domain/campaign/campaign-state';
import {createLockPuzzleForFamily} from '../../src/minigames/lock/lock-model';
import {SAVE_FORMAT_VERSION} from '../../src/save/local-save-repository';
import type {ServiceSiteKind} from '../../src/domain/overworld/level-service-sites';

const SAVE_KEY = 'maze:campaign:slot-1';
const E2E_CAMPAIGN_SEED = 0x5eed_2026;
const COMPLETION_FLAGS = {
    pipe: 'coolant-routing-restored',
    lock: 'archive-lock-opened',
    space: 'orbital-corridor-cleared',
    platformer: 'sublevel-nine-stabilized',
    circuit: 'circuit-crush-completed',
    horsemaster: 'ultra-horse-gym-reached',
    zapper: 'zapper-shift-completed',
    'casino-heist': 'casino-heist-completed'
} as const;

function analyzeScreenshot(screenshot: Buffer): {opaquePixels: number; distinctColors: number} {
    const image = PNG.sync.read(screenshot);
    const colors = new Set<string>();
    let opaquePixels = 0;
    for (let index = 0; index < image.data.length; index += 4) {
        if (image.data[index + 3] === 0) continue;
        opaquePixels++;
        colors.add(`${image.data[index]},${image.data[index + 1]},${image.data[index + 2]}`);
    }
    return {opaquePixels, distinctColors: colors.size};
}

function createGeneratedCampaign(levelNumber = 1): CampaignState {
    const levelSeed = deriveSeed(
        E2E_CAMPAIGN_SEED,
        `level:${MAZE_GENERATOR_ID}`,
        levelNumber
    );
    const maze = generateMaze({
        size: Math.min(21 + (levelNumber - 1) * 4, 99),
        topologyRandom: new Mulberry32Random(deriveSeed(levelSeed, 'maze-topology')),
        materialRandom: new Mulberry32Random(deriveSeed(levelSeed, 'wall-materials'))
    });
    return initializeLevelContent(createInitialCampaignState({
        campaignSeed: E2E_CAMPAIGN_SEED,
        overworldSeed: levelSeed,
        levelId: `level-${levelNumber}`,
        maze
    }));
}

function withFlags(state: CampaignState, flags: readonly string[]): CampaignState {
    const shortcut = state.overworld.pipeShortcutWall;
    if (!flags.includes(COMPLETION_FLAGS.pipe) || shortcut === null) {
        return {...state, flags};
    }
    const row = [...state.overworld.maze[shortcut.y]!];
    row[shortcut.x] = PASSAGE_CELL;
    const maze = [...state.overworld.maze];
    maze[shortcut.y] = row;
    return {
        ...state,
        flags,
        overworld: {...state.overworld, maze, pipeShortcutWall: null}
    };
}

function withSelectedObjective(
    state: CampaignState,
    objectiveId: ObjectiveId
): {
    readonly state: CampaignState;
    readonly placement: CampaignState['overworld']['objectives'][number];
} {
    const existing = state.overworld.objectives.find(candidate =>
        candidate.objectiveId === objectiveId
    );
    if (existing) return {state, placement: existing};
    const replaced = state.overworld.objectives[0];
    if (!replaced) throw new Error('Generated level has no objective to replace.');
    const definition = OBJECTIVE_BY_ID[objectiveId];
    const placement = {
        objectiveId,
        triggerId: definition.triggerId,
        position: replaced.position
    };
    let pipeShortcutWall = state.overworld.pipeShortcutWall;
    if (objectiveId === 'pipe' && pipeShortcutWall === null) {
        for (let y = 1; y < state.overworld.maze.length - 1 && !pipeShortcutWall; y++) {
            for (let x = 1; x < state.overworld.maze.length - 1; x++) {
                const mixedParity = x % 2 !== y % 2;
                const horizontal =
                    state.overworld.maze[y]?.[x - 1]?.kind === 'passage' &&
                    state.overworld.maze[y]?.[x + 1]?.kind === 'passage';
                const vertical =
                    state.overworld.maze[y - 1]?.[x]?.kind === 'passage' &&
                    state.overworld.maze[y + 1]?.[x]?.kind === 'passage';
                if (
                    mixedParity &&
                    state.overworld.maze[y]?.[x]?.kind === 'wall' &&
                    (horizontal || vertical)
                ) {
                    pipeShortcutWall = {x, y};
                    break;
                }
            }
        }
        if (!pipeShortcutWall) throw new Error('Generated maze has no Pipe connector.');
    }
    return {
        placement,
        state: {
            ...state,
            overworld: {
                ...state.overworld,
                objectives: [placement, ...state.overworld.objectives.slice(1)],
                pipeShortcutWall
            }
        }
    };
}

function createObjectiveSave(
    objectiveId: ObjectiveId,
    levelNumber = 1,
    flags: readonly string[] = []
): string {
    const generatedState = withFlags(createGeneratedCampaign(levelNumber), flags);
    const selected = withSelectedObjective(generatedState, objectiveId);
    const {state, placement} = selected;
    const definition = OBJECTIVE_BY_ID[objectiveId];
    const attemptOrdinal = 0;
    const encounterSeed = deriveSeed(
        state.overworld.seed,
        objectiveId === 'space' ? 'space-attempt' : `${objectiveId}-attempt`,
        attemptOrdinal
    );
    const prepared: CampaignState = {
        ...state,
        overworld: {
            ...state.overworld,
            playerPosition: placement.position,
            items: [],
            monsters: [],
            traps: [],
            pendingHazards: []
        },
        activeEncounter: {
            levelId: state.overworld.levelId,
            objectiveId,
            triggerId: definition.triggerId,
            encounterKind: definition.kind,
            attemptOrdinal,
            runId: `${state.overworld.levelId}/${definition.triggerId}/${attemptOrdinal}`,
            seed: encounterSeed
        }
    };
    return serialize(prepared);
}

function createItemBonusObjectiveSave(
    objectiveId: ObjectiveId,
    itemTypeId: ItemTypeId
): string {
    const envelope = JSON.parse(createObjectiveSave(objectiveId)) as {
        formatVersion: number;
        savedAt: string;
        state: CampaignState;
    };
    return JSON.stringify({
        ...envelope,
        state: {
            ...envelope.state,
            player: {
                ...envelope.state.player,
                backpack: [
                    ...envelope.state.player.backpack,
                    createItemInstance(
                        `e2e/minigame-bonus/${itemTypeId}`,
                        itemTypeId
                    )
                ]
            }
        }
    });
}

function createSpaceSkipSave(money = 100): string {
    const selected = withSelectedObjective(
        withFlags(createGeneratedCampaign(), []),
        'space'
    );
    const {state, placement} = selected;
    return serialize({
        ...state,
        player: {...state.player, money},
        overworld: {
            ...state.overworld,
            playerPosition: placement.position,
            items: [],
            monsters: [],
            traps: [],
            pendingHazards: []
        },
        activeEncounter: null
    });
}

function createReinforcementSave(): string {
    const state = createGeneratedCampaign();
    return serialize({
        ...state,
        overworld: {
            ...state.overworld,
            monsters: [],
            traps: [],
            pendingHazards: [],
            reinforcementCountdownMs: 50,
            reinforcementOrdinal: 0
        }
    });
}

function createServiceSave(kind: ServiceSiteKind): string {
    const state = createGeneratedCampaign();
    let site = state.overworld.serviceSites.find(candidate => candidate.kind === kind);
    let serviceSites = state.overworld.serviceSites;
    if (!site) {
        const occupied = new Set([
            '1,1',
            `${state.overworld.maze.length - 2},${state.overworld.maze.length - 2}`,
            ...state.overworld.objectives.map(objective =>
                `${objective.position.x},${objective.position.y}`
            ),
            ...serviceSites.map(candidate =>
                `${candidate.position.x},${candidate.position.y}`
            )
        ]);
        let position: Coordinate | null = null;
        for (let y = 1; y < state.overworld.maze.length - 1 && !position; y++) {
            for (let x = 1; x < state.overworld.maze.length - 1; x++) {
                if (
                    state.overworld.maze[y]?.[x]?.kind === 'passage' &&
                    !occupied.has(`${x},${y}`)
                ) {
                    position = {x, y};
                    break;
                }
            }
        }
        if (!position) throw new Error(`No passage available for ${kind} service.`);
        site = {
            id: `${state.overworld.levelId}/service/${kind}`,
            kind,
            position
        };
        serviceSites = [...serviceSites, site];
    }
    return serialize({
        ...state,
        overworld: {
            ...state.overworld,
            playerPosition: site.position,
            serviceSites,
            items: [],
            monsters: [],
            traps: [],
            pendingHazards: []
        }
    });
}

function createCarShopSave(): string {
    const envelope = JSON.parse(createServiceSave('shop')) as {
        formatVersion: number;
        savedAt: string;
        state: CampaignState;
    };
    return JSON.stringify({
        ...envelope,
        state: {
            ...envelope.state,
            player: {...envelope.state.player, money: 100}
        }
    });
}

function createLockedHeistMarkerSave(): {
    readonly serialized: string;
    readonly screenPosition: Coordinate;
} {
    const state = createGeneratedCampaign(8);
    const placement = state.overworld.objectives.find(objective =>
        objective.objectiveId === 'casino-heist'
    );
    if (!placement) throw new Error('Level 8 must contain Casino Heist.');
    return {
        serialized: serialize({
            ...state,
            overworld: {
                ...state.overworld,
                playerPosition: placement.position,
                items: [],
                monsters: [],
                traps: [],
                pendingHazards: []
            }
        }),
        screenPosition: {
            x: 336,
            y: 336
        }
    };
}

function directionKey(from: Coordinate, to: Coordinate): string {
    if (to.x === from.x + 1 && to.y === from.y) return 'ArrowRight';
    if (to.x === from.x - 1 && to.y === from.y) return 'ArrowLeft';
    if (to.y === from.y + 1 && to.x === from.x) return 'ArrowDown';
    if (to.y === from.y - 1 && to.x === from.x) return 'ArrowUp';
    throw new Error('Expected adjacent coordinates.');
}

function createChargedWardExpirySave(): {
    readonly serialized: string;
    readonly outwardMoveKey: string;
    readonly returnMoveKey: string;
    readonly start: Coordinate;
    readonly destination: Coordinate;
} {
    const state = createGeneratedCampaign();
    const start = state.overworld.playerPosition;
    const destination = [
        {x: start.x, y: start.y + 1},
        {x: start.x + 1, y: start.y},
        {x: start.x, y: start.y - 1},
        {x: start.x - 1, y: start.y}
    ].find(position => state.overworld.maze[position.y]?.[position.x]?.kind === 'passage');
    if (!destination) throw new Error('Spawn has no passage neighbor.');
    return {
        serialized: serialize({
            ...state,
            player: {
                ...state.player,
                statuses: [{
                    kind: 'fire-ward',
                    remainingTurns: 1,
                    charges: 2
                }]
            },
            overworld: {
                ...state.overworld,
                items: [],
                monsters: [],
                traps: [],
                pendingHazards: []
            }
        }),
        outwardMoveKey: directionKey(start, destination),
        returnMoveKey: directionKey(destination, start),
        start,
        destination
    };
}

function createExitSave(): {readonly serialized: string; readonly moveKey: string} {
    const flags = Object.values(COMPLETION_FLAGS);
    const state = withFlags(createGeneratedCampaign(), flags);
    const exit = {
        x: state.overworld.maze.length - 2,
        y: state.overworld.maze.length - 2
    };
    const approach = [
        {x: exit.x - 1, y: exit.y},
        {x: exit.x, y: exit.y - 1}
    ].find(position => state.overworld.maze[position.y]?.[position.x]?.kind === 'passage');
    if (!approach) throw new Error('Generated exit has no passage approach.');
    return {
        serialized: serialize({
            ...state,
            overworld: {
                ...state.overworld,
                playerPosition: approach,
                items: [],
                monsters: [],
                traps: [],
                pendingHazards: []
            }
        }),
        moveKey: directionKey(approach, exit)
    };
}

function createFinalVictorySave(): {readonly serialized: string; readonly moveKey: string} {
    const state = withFlags(createGeneratedCampaign(8), Object.values(COMPLETION_FLAGS));
    if (state.overworld.objectives.length !== 8) {
        throw new Error('Level 8 must contain all eight minigames.');
    }
    const exit = {
        x: state.overworld.maze.length - 2,
        y: state.overworld.maze.length - 2
    };
    const approach = [
        {x: exit.x - 1, y: exit.y},
        {x: exit.x, y: exit.y - 1}
    ].find(position => state.overworld.maze[position.y]?.[position.x]?.kind === 'passage');
    if (!approach) throw new Error('Generated level-8 exit has no passage approach.');
    return {
        serialized: serialize({
            ...state,
            overworld: {
                ...state.overworld,
                playerPosition: approach,
                items: [],
                monsters: [],
                traps: [],
                pendingHazards: []
            }
        }),
        moveKey: directionKey(approach, exit)
    };
}

function serialize(state: CampaignState): string {
    return JSON.stringify({
        formatVersion: SAVE_FORMAT_VERSION,
        savedAt: '2026-07-23T20:26:00.000Z',
        state
    });
}

async function installSave(page: Page, serialized: string): Promise<void> {
    await page.addInitScript(({key, value}) => {
        window.localStorage.setItem(key, value);
    }, {key: SAVE_KEY, value: serialized});
}

async function startPhaser(page: Page, expectedLevelId = 'level-1'): Promise<void> {
    await page.goto('/');
    const startButton = page.getByRole('button', {name: /Start Game|Retry/});
    await expect(startButton).toHaveAttribute('data-app-ready', 'true');
    await startButton.click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await expect(page.locator('#game-main')).toHaveAttribute(
        'data-level-id',
        expectedLevelId
    );
    await expect.poll(() => page.evaluate(key =>
        window.localStorage.getItem(key) !== null, SAVE_KEY
    )).toBe(true);
    const interruptedAttempt = await page.evaluate(key => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        return Boolean((JSON.parse(raw) as {state?: CampaignState}).state?.activeEncounter);
    }, SAVE_KEY);
    if (interruptedAttempt) {
        await expect(page.locator('canvas[data-runtime="phaser"]'))
            .toHaveAttribute('data-encounter-overlay', 'interrupted');
        await tapGamePoint(page, 231, 384);
    }
}

async function readSavedState(page: Page): Promise<CampaignState> {
    return page.evaluate(key => {
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error('Expected campaign autosave.');
        return JSON.parse(raw).state as CampaignState;
    }, SAVE_KEY);
}

async function gamePointOnScreen(
    page: Page,
    gameX: number,
    gameY: number
): Promise<{readonly x: number; readonly y: number}> {
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Expected a visible Phaser canvas.');
    return {
        x: bounds.x + (gameX / 672) * bounds.width,
        y: bounds.y + (gameY / 672) * bounds.height
    };
}

async function usesTouchInput(page: Page): Promise<boolean> {
    return (await page.context().browser()?.browserType().name()) === 'chromium' &&
        (await page.evaluate(() => navigator.maxTouchPoints)) > 0;
}

async function tapGamePoint(page: Page, gameX: number, gameY: number): Promise<void> {
    const point = await gamePointOnScreen(page, gameX, gameY);
    if ((await page.context().browser()?.browserType().name()) === 'chromium' &&
        (await page.evaluate(() => navigator.maxTouchPoints)) > 0) {
        await page.touchscreen.tap(point.x, point.y);
    } else {
        await page.mouse.click(point.x, point.y);
    }
}

async function holdGamePoint(
    page: Page,
    gameX: number,
    gameY: number,
    durationMs: number
): Promise<void> {
    const point = await gamePointOnScreen(page, gameX, gameY);
    if (await usesTouchInput(page)) {
        const session = await page.context().newCDPSession(page);
        try {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{x: point.x, y: point.y, id: 1}]
            });
            await page.waitForTimeout(durationMs);
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchEnd',
                touchPoints: []
            });
        } finally {
            await session.detach();
        }
    } else {
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.waitForTimeout(durationMs);
        await page.mouse.up();
    }
}

async function dragGamePoint(
    page: Page,
    fromGameX: number,
    fromGameY: number,
    toGameX: number,
    toGameY: number,
    durationMs: number
): Promise<void> {
    const from = await gamePointOnScreen(page, fromGameX, fromGameY);
    const to = await gamePointOnScreen(page, toGameX, toGameY);
    if (await usesTouchInput(page)) {
        const session = await page.context().newCDPSession(page);
        try {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{x: from.x, y: from.y, id: 1}]
            });
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{x: to.x, y: to.y, id: 1}]
            });
            await page.waitForTimeout(durationMs);
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchEnd',
                touchPoints: []
            });
        } finally {
            await session.detach();
        }
    } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, {steps: 5});
        await page.waitForTimeout(durationMs);
        await page.mouse.up();
    }
}

async function tapCircuitCell(page: Page, index: number): Promise<void> {
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const originX = Number(await canvas.getAttribute('data-circuit-board-origin-x'));
    const originY = Number(await canvas.getAttribute('data-circuit-board-origin-y'));
    const tileSize = Number(await canvas.getAttribute('data-circuit-tile-size'));
    const width = Number(await canvas.getAttribute('data-circuit-board-width'));
    expect(Number.isFinite(originX) && Number.isFinite(originY)).toBe(true);
    expect(tileSize).toBeGreaterThan(0);
    expect(width).toBeGreaterThan(0);
    await tapGamePoint(
        page,
        originX + (index % width + 0.5) * tileSize,
        originY + (Math.floor(index / width) + 0.5) * tileSize
    );
}

test('generates, autosaves, resumes, and renders a distributed roguelike maze', async ({
    page
}, testInfo) => {
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    await expect(gameMain).toHaveAttribute('data-item-count', /^(?:[6-9]|1[0-6])$/);
    await expect(gameMain).toHaveAttribute('data-monster-count', /^[3-9]|1[0-8]$/);
    await expect(gameMain).toHaveAttribute('data-trap-count', /^[1-9]|1[0-2]$/);
    const beforeMove = await readSavedState(page);
    expect(beforeMove.overworld.objectives).toHaveLength(4);
    expect(new Set(beforeMove.overworld.objectives.map(objective =>
        objective.objectiveId
    )).size).toBe(4);
    const expectedStatuses = beforeMove.overworld.objectives.map(objective =>
        `${objective.objectiveId}:${getObjectiveStatus(
            beforeMove.flags,
            objective.objectiveId
        )}`
    ).join(',');
    await expect(gameMain).toHaveAttribute(
        'data-objective-statuses',
        expectedStatuses
    );
    await expect(gameMain).toHaveAttribute('data-money', '40');
    await expect(page.locator('#money')).toHaveText('$40');
    await expect(page.locator('canvas[data-runtime="phaser"]'))
        .toHaveAttribute('data-service-sites', /blackjack@.*holdem@/);
    const currentObjective = getCurrentObjective(beforeMove);
    if (!currentObjective) throw new Error('Expected a current objective.');
    await expect(page.locator('#objective')).toHaveText(currentObjective.label);
    await expect(page.locator('#exit-status')).toHaveText('Locked 0 / 1');

    const start = beforeMove.overworld.playerPosition;
    const destination = [
        {x: start.x, y: start.y + 1},
        {x: start.x + 1, y: start.y},
        {x: start.x, y: start.y - 1},
        {x: start.x - 1, y: start.y}
    ].find(position => beforeMove.overworld.maze[position.y]?.[position.x]?.kind === 'passage');
    if (!destination) throw new Error('Spawn has no passage neighbor.');
    await page.keyboard.press(directionKey(start, destination));
    await expect(gameMain).toHaveAttribute('data-turn', '1');

    const afterMove = await readSavedState(page);
    expect(afterMove.overworld.playerPosition).toEqual(destination);
    expect(afterMove.overworld.objectives).toEqual(beforeMove.overworld.objectives);
    expect(afterMove.overworld.maze).toEqual(beforeMove.overworld.maze);

    const screenshot = await page.locator('canvas[data-runtime="phaser"]')
        .screenshot({path: testInfo.outputPath('generated-overworld.png')});
    const sample = analyzeScreenshot(screenshot);
    expect(sample.opaquePixels).toBeGreaterThan(5_000);
    expect(sample.distinctColors).toBeGreaterThan(16);

    await page.reload();
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(gameMain).toHaveAttribute('data-player-x', String(destination.x));
    await expect(gameMain).toHaveAttribute('data-player-y', String(destination.y));
});

test('keeps movement and autosave valid when a charged Ward timer reaches zero', async ({
    page
}) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    const save = createChargedWardExpirySave();
    await installSave(page, save.serialized);
    await startPhaser(page);
    const gameMain = page.locator('#game-main');

    await page.keyboard.press(save.outwardMoveKey);
    await expect(gameMain).toHaveAttribute('data-turn', '1');
    await expect.poll(async () => (await readSavedState(page)).overworld.turn).toBe(1);
    const atZero = await readSavedState(page);
    expect(atZero.overworld.playerPosition).toEqual(save.destination);
    expect(atZero.player.statuses).toContainEqual({
        kind: 'fire-ward',
        remainingTurns: 0,
        charges: 2
    });

    await page.keyboard.press(save.returnMoveKey);
    await expect(gameMain).toHaveAttribute('data-turn', '2');
    await expect.poll(async () => (await readSavedState(page)).overworld.turn).toBe(2);
    const continued = await readSavedState(page);
    expect(continued.overworld.playerPosition).toEqual(save.start);
    expect(continued.player.statuses).toContainEqual({
        kind: 'fire-ward',
        remainingTurns: 0,
        charges: 2
    });
    expect(runtimeErrors).toEqual([]);
});

test('keeps the HUD, maze, controls, and messages playable across viewports', async ({
    page
}, testInfo) => {
    test.skip(!testInfo.project.name.includes('desktop'));
    await startPhaser(page);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#message')).not.toHaveText('');

    const viewports = [
        {name: 'desktop', width: 1366, height: 768},
        {name: 'tablet', width: 1024, height: 768},
        {name: 'phone', width: 390, height: 844},
        {name: 'small phone', width: 320, height: 568},
        {name: 'landscape phone', width: 844, height: 390}
    ] as const;
    const requiredSelectors = [
        '#game-main',
        '#hud',
        '#level',
        '#health',
        '#objective',
        '#player-status',
        '#exit-status',
        '#menu-toggle-btn',
        '#canvas-stage',
        'canvas[data-runtime="phaser"]',
        '#message'
    ];

    for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expect.poll(async () => {
            const canvas = await page.locator('canvas[data-runtime="phaser"]')
                .boundingBox();
            return canvas === null ? 0 : Math.round(canvas.width);
        }).toBeGreaterThan(Math.floor(Math.min(viewport.width, viewport.height) * 0.78));

        const layout = await page.evaluate(selectors => {
            const elements = selectors.map(selector => {
                const element = document.querySelector<HTMLElement>(selector);
                if (!element) throw new Error(`Missing responsive element: ${selector}`);
                const rect = element.getBoundingClientRect();
                return {
                    selector,
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                    clientHeight: element.clientHeight,
                    scrollHeight: element.scrollHeight
                };
            });
            return {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
                elements
            };
        }, requiredSelectors);

        expect(layout.scrollWidth, `${viewport.name} horizontal page overflow`)
            .toBeLessThanOrEqual(layout.innerWidth + 1);
        expect(layout.scrollHeight, `${viewport.name} vertical page overflow`)
            .toBeLessThanOrEqual(layout.innerHeight + 1);
        expect(layout.scrollX, `${viewport.name} horizontal scroll position`).toBe(0);
        expect(layout.scrollY, `${viewport.name} vertical scroll position`).toBe(0);

        for (const element of layout.elements) {
            expect(element.width, `${viewport.name} ${element.selector} width`)
                .toBeGreaterThan(0);
            expect(element.height, `${viewport.name} ${element.selector} height`)
                .toBeGreaterThan(0);
            expect(element.left, `${viewport.name} ${element.selector} left edge`)
                .toBeGreaterThanOrEqual(-1);
            expect(element.top, `${viewport.name} ${element.selector} top edge`)
                .toBeGreaterThanOrEqual(-1);
            expect(element.right, `${viewport.name} ${element.selector} right edge`)
                .toBeLessThanOrEqual(layout.innerWidth + 1);
            expect(element.bottom, `${viewport.name} ${element.selector} bottom edge`)
                .toBeLessThanOrEqual(layout.innerHeight + 1);
        }

        const bySelector = new Map(layout.elements.map(element =>
            [element.selector, element]
        ));
        const canvas = bySelector.get('canvas[data-runtime="phaser"]');
        const gameMain = bySelector.get('#game-main');
        const message = bySelector.get('#message');
        const menu = bySelector.get('#menu-toggle-btn');
        expect(canvas).toBeDefined();
        expect(gameMain).toBeDefined();
        expect(message).toBeDefined();
        expect(menu).toBeDefined();
        if (!canvas || !gameMain || !message || !menu) continue;

        expect(
            Math.abs(canvas.width - canvas.height),
            `${viewport.name} square game canvas`
        ).toBeLessThanOrEqual(2);
        expect(
            canvas.width,
            `${viewport.name} canvas uses the viewport's limiting dimension`
        ).toBeGreaterThanOrEqual(Math.min(viewport.width, viewport.height) * 0.78);
        expect(
            gameMain.height,
            `${viewport.name} game shell uses the available viewport height`
        ).toBeGreaterThanOrEqual(viewport.height * 0.97);
        expect(
            message.scrollHeight,
            `${viewport.name} current message is not clipped`
        ).toBeLessThanOrEqual(message.clientHeight + 1);
        if (viewport.width <= 620) {
            expect(menu.width, `${viewport.name} menu touch width`).toBeGreaterThanOrEqual(44);
            expect(menu.height, `${viewport.name} menu touch height`).toBeGreaterThanOrEqual(44);
        }
    }
});

test('shows large mobile controls without page scrolling', async ({page}, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'));
    await startPhaser(page);
    expect(await page.evaluate(() =>
        document.documentElement.scrollHeight <= window.innerHeight + 1
    )).toBe(true);

    const before = await readSavedState(page);
    const start = before.overworld.playerPosition;
    const directions = [
        {position: {x: start.x, y: start.y - 1}, point: {x: 80, y: 518}},
        {position: {x: start.x - 1, y: start.y}, point: {x: 28, y: 570}},
        {position: {x: start.x, y: start.y + 1}, point: {x: 80, y: 570}},
        {position: {x: start.x + 1, y: start.y}, point: {x: 132, y: 570}}
    ];
    const usable = directions.find(candidate =>
        before.overworld.maze[candidate.position.y]?.[candidate.position.x]?.kind === 'passage'
    );
    if (!usable) throw new Error('Spawn has no touch-reachable passage.');
    await tapGamePoint(page, usable.point.x, usable.point.y);
    await expect(page.locator('#game-main')).toHaveAttribute('data-turn', '1');
});

test('overworld touch action bar opens inventory, attacks, and waits', async ({page}) => {
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const startingTurn = Number(await gameMain.getAttribute('data-turn'));

    await tapGamePoint(page, 612, 630);
    await expect(canvas).toHaveAttribute('data-overworld-modal-open', 'true');
    await tapGamePoint(page, 336, 521);
    await expect(canvas).not.toHaveAttribute('data-overworld-modal-open');

    await tapGamePoint(page, 612, 522);
    await expect(page.locator('#message')).toHaveText('Choose an attack direction.');
    await tapGamePoint(page, 612, 522);
    await expect(page.locator('#message')).toHaveText('Attack cancelled.');

    await tapGamePoint(page, 498, 522);
    await expect(gameMain).toHaveAttribute('data-turn', String(startingTurn + 1));
});

test('keeps the maze player centered clear of the corner controls', async ({page}) => {
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(canvas).toHaveAttribute('data-overworld-camera-mode', 'player-centered');
    await expect(canvas).toHaveAttribute('data-overworld-camera-padding-x', '288');
    await expect(canvas).toHaveAttribute('data-overworld-camera-padding-y', '288');
    await expect(canvas).toHaveAttribute('data-overworld-player-screen-x', '336.0');
    await expect(canvas).toHaveAttribute('data-overworld-player-screen-y', '336.0');

    const before = await readSavedState(page);
    const start = before.overworld.playerPosition;
    const destination = [
        {x: start.x, y: start.y + 1},
        {x: start.x + 1, y: start.y},
        {x: start.x, y: start.y - 1},
        {x: start.x - 1, y: start.y}
    ].find(position => before.overworld.maze[position.y]?.[position.x]?.kind === 'passage');
    if (!destination) throw new Error('Spawn has no passage neighbor.');

    await page.keyboard.press(directionKey(start, destination));
    await expect(page.locator('#game-main')).toHaveAttribute('data-turn', '1');
    await expect(canvas).toHaveAttribute('data-overworld-player-screen-x', '336.0');
    await expect(canvas).toHaveAttribute('data-overworld-player-screen-y', '336.0');
});

test('Blackjack supports wagering, player choices, repeat hands, and wallet saves', async ({
    page
}) => {
    await installSave(page, createServiceSave('blackjack'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await tapGamePoint(page, 498, 576);
    await expect(gameMain).toHaveAttribute('data-encounter', 'blackjack');
    await expect(canvas).toHaveAttribute('data-casino-game', 'blackjack');
    await expect(canvas).toHaveAttribute('data-casino-phase', 'betting');

    await tapGamePoint(page, 336, 526);
    await expect(canvas).toHaveAttribute('data-casino-hand', '1');
    const firstPhase = await canvas.getAttribute('data-casino-phase');
    if (firstPhase === 'player-turn') await tapGamePoint(page, 336, 526);
    await expect(canvas).toHaveAttribute('data-casino-phase', 'settled');
    await expect.poll(async () => (await readSavedState(page)).player.money)
        .toBe(Number(await canvas.getAttribute('data-casino-bankroll')));

    await tapGamePoint(page, 336, 526);
    await expect(canvas).toHaveAttribute('data-casino-hand', '2');
    await tapGamePoint(page, 603, 43);
    await expect(gameMain).not.toHaveAttribute('data-encounter');
    await expect(canvas).not.toHaveAttribute('data-casino-game');
});

test('Texas Hold’em deals four streets against the computer and allows repeat play', async ({
    page
}) => {
    await installSave(page, createServiceSave('holdem'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await tapGamePoint(page, 498, 576);
    await expect(gameMain).toHaveAttribute('data-encounter', 'holdem');
    await expect(canvas).toHaveAttribute('data-casino-game', 'holdem');
    await tapGamePoint(page, 336, 548);
    await expect(canvas).toHaveAttribute('data-casino-hand', '1');

    for (let guard = 0; guard < 6; guard++) {
        const phase = await canvas.getAttribute('data-casino-phase');
        if (phase === 'settled') break;
        const legal = (await canvas.getAttribute('data-casino-legal-actions'))?.split(',') ?? [];
        const action = legal.includes('check')
            ? 'check'
            : legal.includes('call') ? 'call' : 'fold';
        const actionIndex = legal.indexOf(action);
        expect(actionIndex).toBeGreaterThanOrEqual(0);
        const spacing = Math.min(170, 520 / Math.max(1, legal.length));
        const startX = 336 - spacing * (legal.length - 1) / 2;
        await tapGamePoint(page, startX + spacing * actionIndex, 548);
    }
    await expect(canvas).toHaveAttribute('data-casino-phase', 'settled');
    await expect.poll(async () => (await readSavedState(page)).player.money)
        .toBe(Number(await canvas.getAttribute('data-casino-bankroll')));

    await tapGamePoint(page, 336, 548);
    await expect(canvas).toHaveAttribute('data-casino-hand', '2');
    await tapGamePoint(page, 603, 42);
    await expect(gameMain).not.toHaveAttribute('data-encounter');
});

test('optional shops spend persistent money on useful equipment and upgrades', async ({
    page
}) => {
    await installSave(page, createServiceSave('shop'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-money', '40');
    await tapGamePoint(page, 498, 576);
    await expect(canvas).toHaveAttribute('data-shop-open', 'true');
    await tapGamePoint(page, 336, 166);
    await expect(gameMain).toHaveAttribute('data-money', '30');
    await expect(page.locator('#money')).toHaveText('$30');
    const saved = await readSavedState(page);
    expect(saved.player.backpack.find(item => item.baseTypeId === 'health-potion')?.quantity)
        .toBe(2);
    await tapGamePoint(page, 336, 606);
    await expect(canvas).not.toHaveAttribute('data-shop-open');
});

test('shop touch paging can buy the car and shows its durable owned state', async ({
    page
}) => {
    await installSave(page, createCarShopSave());
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await tapGamePoint(page, 498, 576);
    await expect(canvas).toHaveAttribute('data-shop-page', '0');
    await tapGamePoint(page, 521, 606);
    await expect(canvas).toHaveAttribute('data-shop-page', '1');
    await tapGamePoint(page, 151, 606);
    await expect(canvas).toHaveAttribute('data-shop-page', '0');
    await tapGamePoint(page, 521, 606);
    await expect(canvas).toHaveAttribute('data-shop-page', '1');
    await tapGamePoint(page, 336, 268);
    await expect(canvas).toHaveAttribute('data-shop-car-owned', 'true');
    const saved = await readSavedState(page);
    expect(saved.player.money).toBe(0);
    expect(saved.player.backpack.some(item => item.baseTypeId === 'car')).toBe(true);
    expect(saved.flags).toContain(CASINO_HEIST_UNLOCK_FLAG);
    await tapGamePoint(page, 336, 268);
    await expect(page.locator('#message')).toHaveText(
        'Getaway Car already owned. Casino Heist is unlocked.'
    );
});

test('clicking a locked Casino Heist marker explains the exact car requirement', async ({
    page
}) => {
    const save = createLockedHeistMarkerSave();
    await installSave(page, save.serialized);
    await startPhaser(page, 'level-8');
    await tapGamePoint(page, save.screenPosition.x, save.screenPosition.y);
    await expect(page.locator('#message')).toHaveText(
        'Casino Heist is locked. Find a Getaway Car in the maze or buy one at the shop for $100.'
    );
});

test('pays $100 to skip Space and clicks the deliberate success result card', async ({
    page
}) => {
    await installSave(page, createSpaceSkipSave());
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await tapGamePoint(page, 498, 576);
    await expect(canvas).toHaveAttribute('data-space-options-open', 'true');
    await expect(canvas).toHaveAttribute('data-space-skip-affordable', 'true');

    await tapGamePoint(page, 336, 479);
    await expect(canvas).not.toHaveAttribute('data-space-options-open');
    await tapGamePoint(page, 498, 576);
    await expect(canvas).toHaveAttribute('data-space-options-open', 'true');
    await tapGamePoint(page, 336, 422);
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'success');
    await expect(gameMain).toHaveAttribute('data-money', '0');
    await expect(page.locator('#objective')).toHaveText('Exit');
    const skipped = await readSavedState(page);
    expect(skipped.flags).toContain(COMPLETION_FLAGS.space);
    expect(skipped.encounterHistory.some(entry => entry.kind === 'shooter')).toBe(false);

    for (let repeat = 0; repeat < 6; repeat++) await page.keyboard.press('Space');
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'success');
    expect((await readSavedState(page)).flags).toContain(COMPLETION_FLAGS.space);
    await tapGamePoint(page, 336, 381);
    await expect(canvas).not.toHaveAttribute('data-encounter-overlay');
});

test('Space menu launches the mission from its touch button', async ({page}) => {
    await installSave(page, createSpaceSkipSave(0));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await tapGamePoint(page, 498, 576);
    await expect(canvas).toHaveAttribute('data-space-options-open', 'true');
    await tapGamePoint(page, 336, 361);
    await expect(gameMain).toHaveAttribute('data-encounter', 'shooter');
    await expect(canvas).toHaveAttribute('data-shooter-phase', 'approach');
    await expect(canvas).not.toHaveAttribute('data-space-options-open');
});

test('shell menu and resume overlay remain clickable during touch play', async ({page}) => {
    await installSave(page, createObjectiveSave('space'));
    await startPhaser(page);
    const menu = page.locator('#menu-toggle-btn');
    const pausePanel = page.locator('#pause-panel');
    const resume = page.getByRole('button', {name: 'Resume'});
    const backdrop = page.locator('#overlay-backdrop-pause');
    const touch = await usesTouchInput(page);

    if (touch) await menu.tap();
    else await menu.click();
    await expect(pausePanel).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');

    if (touch) await resume.tap();
    else await resume.click();
    await expect(pausePanel).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    if (touch) await menu.tap();
    else await menu.click();
    await expect(pausePanel).toBeVisible();
    if (touch) await backdrop.tap({position: {x: 5, y: 5}});
    else await backdrop.click({position: {x: 5, y: 5}});
    await expect(pausePanel).toBeHidden();
});

test('spawns a saved, money-bearing reinforcement when its active timer expires', async ({
    page
}) => {
    await installSave(page, createReinforcementSave());
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    await expect(gameMain).toHaveAttribute('data-monster-count', '0');
    await expect.poll(async () =>
        Number(await gameMain.getAttribute('data-monster-count')), {timeout: 4_000}
    ).toBe(1);
    await expect(gameMain).toHaveAttribute('data-reinforcement-ordinal', '1');
    const spawned = await readSavedState(page);
    expect(spawned.overworld.monsters[0]?.id).toBe('level-1/reinforcement-1');
    expect(spawned.overworld.reinforcementCountdownMs).toBeGreaterThanOrEqual(30_000);
    expect(spawned.overworld.reinforcementCountdownMs).toBeLessThanOrEqual(60_000);
    await expect(page.locator('#message')).toContainText('Reinforcement arrived');
});

test('Pipe can lock a placed route and visibly accelerate its liquid flow', async ({page}) => {
    await installSave(page, createObjectiveSave('pipe'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'pipe');
    await expect(canvas).toHaveAttribute('data-pipe-status', 'active');
    await expect(canvas).toHaveAttribute('data-pipe-queue-index', '0');
    await expect(canvas).toHaveAttribute('data-pipe-step-ms', '8000');
    await expect(canvas).toHaveAttribute('data-pipe-flow-multiplier', '1');
    const startingClock = Number(await canvas.getAttribute('data-pipe-flow-clock'));
    expect(startingClock).toBe(0);
    for (let guard = 0; guard < 4; guard++) {
        const helpPage = Number(await canvas.getAttribute('data-pipe-help-page'));
        if (helpPage < 0) break;
        await tapGamePoint(page, 336, 333);
    }
    await expect(canvas).toHaveAttribute('data-pipe-help-page', '-1');
    await expect(canvas).toHaveAttribute('data-pipe-finish-ready', 'false');
    if (await canvas.getAttribute('data-pipe-queue-index') === '0') {
        const selectedTile = Number(await canvas.getAttribute('data-pipe-selected-tile'));
        await tapGamePoint(
            page,
            46 + (selectedTile % 5 + 0.5) * 72,
            142 + (Math.floor(selectedTile / 5) + 0.5) * 72
        );
    }
    await expect(canvas).toHaveAttribute('data-pipe-queue-index', /^[1-9]\d*$/);
    await expect(canvas).toHaveAttribute('data-pipe-finish-ready', 'true');
    await expect.poll(async () =>
        Number(await canvas.getAttribute('data-pipe-flow-clock'))
    ).toBeGreaterThan(startingClock);
    await tapGamePoint(page, 558, 542);
    await expect(canvas).toHaveAttribute('data-pipe-placement-finished', 'true');
    await expect(canvas).toHaveAttribute('data-pipe-flow-multiplier', '4');
    await expect(canvas).toHaveAttribute('data-pipe-finish-ready', 'false');
});

test('Lock guides each distinct pin and opens from a TURN tap', async ({page}) => {
    const serialized = createObjectiveSave('lock');
    const campaign = (JSON.parse(serialized) as {state: CampaignState}).state;
    const encounterSeed = campaign.activeEncounter?.seed;
    if (encounterSeed === undefined) throw new Error('Expected a prepared Lock encounter.');
    const expectedLock = createLockPuzzleForFamily(
        new Mulberry32Random(encounterSeed),
        'pin-tension',
        {difficulty: 'standard', levelTier: 0}
    );

    await installSave(page, serialized);
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'lock');
    await expect(canvas).toHaveAttribute('data-lock-status', 'active');
    await expect(canvas).toHaveAttribute('data-lock-help-open', 'true');
    await tapGamePoint(page, 176, 494);
    await expect(canvas).toHaveAttribute('data-lock-help-open', 'false');

    for (let rank = 0; rank < expectedLock.bindingOrder.length; rank++) {
        const pinIndex = expectedLock.bindingOrder[rank]!;
        const pin = expectedLock.pins[pinIndex]!;
        const band = expectedLock.tensionBands[rank]!;
        await expect(canvas).toHaveAttribute('data-lock-binding-pin', String(pinIndex));
        await tapGamePoint(page, 192 + band.center * (480 - 192), 478);
        let pinY = 410 - pin.targetHeight * 244;
        for (let attempt = 0; attempt < 3; attempt++) {
            await tapGamePoint(page, 160 + pinIndex * 88, pinY);
            await page.waitForTimeout(50);
            if (await canvas.getAttribute('data-lock-set-count') === String(rank + 1)) break;
            const releasedHeight = Number(
                await canvas.getAttribute('data-lock-last-release-height')
            );
            if (!Number.isFinite(releasedHeight)) break;
            // Phaser's FIT canvas can settle by a few CSS pixels during a loaded
            // parallel browser run. Adjust the next tap the same way a player
            // follows the visible seam toward the gold line.
            pinY += (releasedHeight - pin.targetHeight) * 244;
        }
        await expect(canvas).toHaveAttribute('data-lock-set-count', String(rank + 1));
    }

    await expect(canvas).toHaveAttribute('data-lock-feedback', 'turn-ready');
    await expect(canvas).toHaveAttribute('data-lock-binding-pin', 'none');
    await expect(canvas).toHaveAttribute('data-lock-turn-enabled', 'true');
    await tapGamePoint(page, 550, 478);
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'success');
    await expect.poll(async () =>
        (await readSavedState(page)).flags.includes(COMPLETION_FLAGS.lock)
    ).toBe(true);
});

test('Space has continuous movement, manual fire, bombs, and a visible 5:00 mission timer', async ({
    page
}) => {
    await installSave(page, createObjectiveSave('space'));
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'shooter');
    await expect(canvas).toHaveAttribute('data-shooter-phase', 'approach');
    await expect(canvas).toHaveAttribute('data-shooter-asset-status', 'ready');
    await expect(canvas).toHaveAttribute('data-shooter-player-hull', '3');
    await expect(canvas).toHaveAttribute('data-shooter-terminal-reason', '');
    await expect(canvas).toHaveAttribute('data-shooter-mission-limit-ms', '300000');
    await expect(canvas).toHaveAttribute('data-shooter-mission-timed-out', 'false');
    await expect.poll(async () =>
        Number(await canvas.getAttribute('data-shooter-mission-remaining-ms'))
    ).toBeGreaterThan(295_000);
    const startingX = Number(await canvas.getAttribute('data-shooter-x'));
    const startingY = Number(await canvas.getAttribute('data-shooter-y'));
    await dragGamePoint(page, 86, 578, 126, 618, 180);
    await expect.poll(async () => Number(await canvas.getAttribute('data-shooter-x')))
        .toBeGreaterThan(startingX);
    await expect.poll(async () => Number(await canvas.getAttribute('data-shooter-y')))
        .toBeGreaterThan(startingY);
    await holdGamePoint(page, 602, 568, 120);
    await tapGamePoint(page, 502, 592);
    await expect(canvas).toHaveAttribute('data-shooter-terminal', '');
});

test('Space accepts joystick, fire, and bomb touches at the same time', async ({
    page
}, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'));
    await installSave(page, createObjectiveSave('space'));
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const joystickStart = await gamePointOnScreen(page, 86, 578);
    const joystickMoved = await gamePointOnScreen(page, 131, 578);
    const fire = await gamePointOnScreen(page, 602, 568);
    const bomb = await gamePointOnScreen(page, 502, 592);
    const startingX = Number(await canvas.getAttribute('data-shooter-x'));
    const startingBombs = Number(await canvas.getAttribute('data-shooter-bombs'));
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{x: joystickStart.x, y: joystickStart.y, id: 1}]
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{x: joystickMoved.x, y: joystickMoved.y, id: 1}]
        });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                {x: joystickMoved.x, y: joystickMoved.y, id: 1},
                {x: fire.x, y: fire.y, id: 2}
            ]
        });
        await expect(canvas).toHaveAttribute('data-shooter-joystick-active', 'true');
        await expect(canvas).toHaveAttribute('data-shooter-touch-fire', 'true');
        await expect.poll(async () =>
            Number(await canvas.getAttribute('data-shooter-x'))
        ).toBeGreaterThan(startingX);

        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [
                {x: joystickMoved.x, y: joystickMoved.y, id: 1},
                {x: fire.x, y: fire.y, id: 2},
                {x: bomb.x, y: bomb.y, id: 3}
            ]
        });
        await expect.poll(async () =>
            Number(await canvas.getAttribute('data-shooter-bombs'))
        ).toBeLessThan(startingBombs);
    } finally {
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: []
        }).catch(() => undefined);
        await session.detach();
    }
    await expect(canvas).toHaveAttribute('data-shooter-joystick-active', 'false');
    await expect(canvas).toHaveAttribute('data-shooter-touch-fire', 'false');
});

test('Space increases its visible mission limit at higher level tiers', async ({page}) => {
    await installSave(page, createObjectiveSave('space', 11));
    await startPhaser(page, 'level-11');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'shooter');
    await expect(canvas).toHaveAttribute('data-shooter-mission-limit-ms', '450000');
    await expect.poll(async () =>
        Number(await canvas.getAttribute('data-shooter-mission-remaining-ms'))
    ).toBeGreaterThan(445_000);
});

test('Platformer generation produces a movable, jumpable combat level', async ({page}) => {
    await installSave(page, createObjectiveSave('platformer'));
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'platformer');
    await expect(canvas).toHaveAttribute('data-platformer-status', 'active');
    const startingX = Number(await canvas.getAttribute('data-platformer-x'));
    await holdGamePoint(page, 136, 610, 220);
    await tapGamePoint(page, 522, 610);
    await page.waitForTimeout(80);
    await expect.poll(async () => Number(await canvas.getAttribute('data-platformer-x')))
        .toBeGreaterThan(startingX);
    await expect.poll(async () => Number(await canvas.getAttribute('data-platformer-velocity-y')))
        .toBeLessThan(0);
    await tapGamePoint(page, 612, 610);
    expect(Number(await canvas.getAttribute('data-platformer-health'))).toBeGreaterThan(0);
});

test('Circuit Crush rerolls retries and its certified touch route clears every short', async ({
    page
}) => {
    await installSave(page, createObjectiveSave('circuit'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'circuit');
    await expect(canvas).toHaveAttribute('data-circuit-status', 'active');
    await expect(canvas).toHaveAttribute('data-circuit-help-open', 'true');
    await expect(canvas).toHaveAttribute('data-circuit-witness-valid', 'true');
    await expect(canvas).toHaveAttribute('data-circuit-moves', '18');
    expect(Number(await canvas.getAttribute('data-circuit-legal-moves'))).toBeGreaterThan(0);
    await tapGamePoint(page, 336, 548);
    await expect(canvas).toHaveAttribute('data-circuit-help-open', 'false');

    const firstSignature = await canvas.getAttribute('data-circuit-board-signature');
    const firstSeed = await canvas.getAttribute('data-circuit-seed');
    await tapGamePoint(page, 558, 31);
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'retry');
    await tapGamePoint(page, 218, 384);
    await expect(canvas).toHaveAttribute('data-circuit-status', 'active');
    await expect(canvas).toHaveAttribute('data-circuit-help-open', 'false');
    await expect(canvas).toHaveAttribute('data-circuit-witness-valid', 'true');
    expect(await canvas.getAttribute('data-circuit-board-signature')).not.toBe(firstSignature);
    expect(await canvas.getAttribute('data-circuit-seed')).not.toBe(firstSeed);

    await page.keyboard.press('2');
    await expect(canvas).not.toHaveAttribute('data-circuit-hint-from', '');
    await page.keyboard.press('3');
    await expect(canvas).toHaveAttribute('data-circuit-pulse-targeting', 'true');
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-circuit-pulse-targeting', 'false');

    const witness = (await canvas.getAttribute('data-circuit-witness'))?.split(',') ?? [];
    expect(witness).toHaveLength(6);
    for (const encodedSwap of witness) {
        const [fromText, toText] = encodedSwap.split('-');
        const fromIndex = Number(fromText);
        const toIndex = Number(toText);
        expect(Number.isSafeInteger(fromIndex)).toBe(true);
        expect(Number.isSafeInteger(toIndex)).toBe(true);
        await tapCircuitCell(page, fromIndex);
        await tapCircuitCell(page, toIndex);
    }

    await expect(canvas).toHaveAttribute('data-circuit-status', 'success');
    await expect(canvas).toHaveAttribute('data-circuit-blockers', '0');
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'success');
    await expect.poll(async () =>
        (await readSavedState(page)).flags.includes(COMPLETION_FLAGS.circuit)
    ).toBe(true);
});

test('maze items pass a visible mechanical bonus into a minigame without being consumed', async ({
    page
}) => {
    await installSave(page, createItemBonusObjectiveSave('circuit', 'compass'));
    await startPhaser(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(canvas).toHaveAttribute('data-item-bonus', /Compass/);
    await expect(canvas).toHaveAttribute('data-circuit-booster-hints', '5');
    const during = await readSavedState(page);
    expect(during.player.backpack.some(item => item.baseTypeId === 'compass')).toBe(true);
});

test('Horsemaster generates a fresh traffic course and accepts touch alignment and jumps', async ({
    page
}) => {
    await installSave(page, createObjectiveSave('horsemaster'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'horsemaster');
    await expect(canvas).toHaveAttribute('data-horsemaster-status', 'active');
    await expect(canvas).toHaveAttribute('data-horsemaster-help-open', 'true');
    expect(Number(await canvas.getAttribute('data-horsemaster-lane-count')))
        .toBeGreaterThanOrEqual(5);
    expect(Number(await canvas.getAttribute('data-horsemaster-vehicle-count')))
        .toBeGreaterThanOrEqual(10);
    await tapGamePoint(page, 336, 484);
    await expect(canvas).toHaveAttribute('data-horsemaster-help-open', 'false');

    const firstSignature = await canvas.getAttribute('data-horsemaster-course-signature');
    await tapGamePoint(page, 42, 20);
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'retry');
    await tapGamePoint(page, 218, 384);
    await expect(canvas).toHaveAttribute('data-horsemaster-status', 'active');
    await expect(canvas).toHaveAttribute('data-horsemaster-help-open', 'false');
    expect(await canvas.getAttribute('data-horsemaster-course-signature'))
        .not.toBe(firstSignature);

    const startingX = Number(await canvas.getAttribute('data-horsemaster-x'));
    await tapGamePoint(page, 170, 627);
    await expect.poll(async () => Number(
        await canvas.getAttribute('data-horsemaster-x')
    )).not.toBe(startingX);
    const startingLane = Number(await canvas.getAttribute('data-horsemaster-lane'));
    const startingLives = Number(await canvas.getAttribute('data-horsemaster-lives'));
    await tapGamePoint(page, 556, 619);
    await expect.poll(async () => {
        const lane = Number(await canvas.getAttribute('data-horsemaster-lane'));
        const lives = Number(await canvas.getAttribute('data-horsemaster-lives'));
        return lane !== startingLane || lives !== startingLives;
    }, {timeout: 2_000}).toBe(true);
});

test('Zapper rerolls its alien shift and supports touch lanes, filling, sliding, and returns', async ({
    page
}) => {
    await installSave(page, createObjectiveSave('zapper'));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'zapper');
    await expect(canvas).toHaveAttribute('data-zapper-status', 'active');
    await expect(canvas).toHaveAttribute('data-zapper-help-open', 'true');
    await tapGamePoint(page, 336, 511);
    await expect(canvas).toHaveAttribute('data-zapper-help-open', 'false');
    expect(Number(await canvas.getAttribute('data-zapper-quota'))).toBeGreaterThanOrEqual(10);

    await tapGamePoint(page, 143, 610);
    await expect(canvas).toHaveAttribute('data-zapper-lane', '1');

    await holdGamePoint(page, 307, 610, 1_600);
    await expect(canvas).toHaveAttribute('data-zapper-ready', 'true');
    await tapGamePoint(page, 548, 610);
    await expect(canvas).toHaveAttribute('data-zapper-ready', 'false');

    const firstSignature = await canvas.getAttribute('data-zapper-course-signature');
    await tapGamePoint(page, 42, 20);
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'retry');
    await tapGamePoint(page, 218, 384);
    await expect(canvas).toHaveAttribute('data-zapper-status', 'active');
    await expect(canvas).toHaveAttribute('data-zapper-help-open', 'false');
    expect(await canvas.getAttribute('data-zapper-course-signature'))
        .not.toBe(firstSignature);
});

test('Casino Heist starts unarmed, drives continuously, and rerolls its getaway road', async ({
    page
}) => {
    await installSave(page, createObjectiveSave(
        'casino-heist',
        1,
        [CASINO_HEIST_UNLOCK_FLAG]
    ));
    await startPhaser(page);
    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'casino-heist');
    await expect(canvas).toHaveAttribute('data-heist-status', 'active');
    await expect(canvas).toHaveAttribute('data-heist-help-open', 'true');
    await expect(canvas).toHaveAttribute('data-heist-weapon', 'none');
    await expect(canvas).toHaveAttribute('data-heist-ammo', '0');
    await tapGamePoint(page, 336, 510);
    await expect(canvas).toHaveAttribute('data-heist-help-open', 'false');

    const startingX = Number(await canvas.getAttribute('data-heist-x'));
    await holdGamePoint(page, 224, 616, 220);
    await expect.poll(async () =>
        Number(await canvas.getAttribute('data-heist-x'))
    ).toBeGreaterThan(startingX);
    await expect.poll(async () =>
        Number(await canvas.getAttribute('data-heist-distance'))
    ).toBeGreaterThan(0);
    expect(Number(await canvas.getAttribute('data-heist-max-health')))
        .toBeGreaterThanOrEqual(3);

    const firstSignature = await canvas.getAttribute('data-heist-course-signature');
    await tapGamePoint(page, 42, 20);
    await expect(canvas).toHaveAttribute('data-encounter-overlay', 'retry');
    await tapGamePoint(page, 218, 384);
    await expect(canvas).toHaveAttribute('data-heist-status', 'active');
    await expect(canvas).toHaveAttribute('data-heist-help-open', 'false');
    expect(await canvas.getAttribute('data-heist-course-signature'))
        .not.toBe(firstSignature);
});

test('keeps the exit locked in the registry and offers a persistent level reward when ready', async ({
    page
}) => {
    const exitSave = createExitSave();
    await installSave(page, exitSave.serialized);
    await startPhaser(page);
    await expect(page.locator('#exit-status')).toHaveText('Ready 1 / 1');
    await page.keyboard.press(exitSave.moveKey);
    await expect.poll(async () => (await readSavedState(page)).pendingLevelReward)
        .not.toBeNull();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await tapGamePoint(page, 336, 291);
    await expect(page.locator('#level')).toHaveText('2');
    await expect(page.locator('#exit-status')).toHaveText('Locked 0 / 2');
    await expect(page.locator('#game-main')).toHaveAttribute('data-maze-size', '25');
});

test('level 8 requires all eight games and ends with persistent music and a dancing horse', async ({
    page
}, testInfo) => {
    const victorySave = createFinalVictorySave();
    await installSave(page, victorySave.serialized);
    await startPhaser(page, 'level-8');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(page.locator('#exit-status')).toHaveText('Ready 8 / 8');
    await page.keyboard.press(victorySave.moveKey);
    await expect(canvas).toHaveAttribute('data-campaign-victory', 'true');
    await expect(canvas).toHaveAttribute('data-victory-overlay', 'open');
    await expect(canvas).toHaveAttribute('data-victory-horse', 'dancing');
    await expect(canvas).toHaveAttribute(
        'data-victory-fanfare',
        /^(?:attempted|playing|played|blocked|unavailable)$/
    );
    const won = await readSavedState(page);
    expect(won.overworld.levelId).toBe('level-8');
    expect(won.flags).toContain(CAMPAIGN_VICTORY_FLAG);
    expect(won.pendingLevelReward).toBeNull();

    const screenshot = await canvas.screenshot({
        path: testInfo.outputPath('level-eight-victory.png')
    });
    expect(analyzeScreenshot(screenshot).distinctColors).toBeGreaterThan(14);
    await tapGamePoint(page, 468, 530);
    await expect(canvas).not.toHaveAttribute('data-victory-overlay');
    await expect(canvas).toHaveAttribute('data-campaign-victory', 'true');
    expect((await readSavedState(page)).flags).toContain(CAMPAIGN_VICTORY_FLAG);
    const persistedVictory = await page.evaluate(key =>
        window.localStorage.getItem(key), SAVE_KEY
    );
    expect(persistedVictory).not.toBeNull();

    await page.reload();
    await page.evaluate(({key, value}) => {
        if (value) window.localStorage.setItem(key, value);
    }, {key: SAVE_KEY, value: persistedVictory});
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(canvas).toHaveAttribute('data-victory-overlay', 'open');
    await expect(page.locator('#level')).toHaveText('8');
});
