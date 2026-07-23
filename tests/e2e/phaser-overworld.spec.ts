import {expect, test} from '@playwright/test';
import {PNG} from 'pngjs';

import {PHASER_MIGRATION_SEED} from '../../src/app/game-constants';
import {createInitialCampaignState} from '../../src/domain/campaign/campaign-state';
import {generateMaze} from '../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../src/domain/random/random-source';
import {placeIntroTrigger} from '../../src/encounters/place-intro-trigger';
import {createPinTensionLock} from '../../src/minigames/lock/lock-model';
import {
    createIntroPipeBoard,
    PIPE_TILE_KINDS,
    type PipeRotation
} from '../../src/minigames/pipe/pipe-model';

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

async function startPhaserRuntime(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await expect(page.locator('#game-main')).toHaveAttribute('data-player-x', '1');
    await expect(page.locator('#game-main')).toHaveAttribute('data-player-y', '1');
    await expect(page.locator('#game-main')).toHaveAttribute('data-item-count', '4');
    await expect(page.locator('#game-main')).toHaveAttribute('data-monster-count', '5');
    await expect(page.locator('#exit-status')).toHaveText('Locked 0 / 4');
    await expect(page.getByRole('button', {name: 'Open menu'})).toBeVisible();
}

async function tapGamePoint(
    page: import('@playwright/test').Page,
    projectName: string,
    gameX: number,
    gameY: number
): Promise<void> {
    const bounds = await page.locator('canvas[data-runtime="phaser"]').boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    const screenX = bounds.x + 2 + (gameX / 672) * (bounds.width - 4);
    const screenY = bounds.y + 2 + (gameY / 672) * (bounds.height - 4);
    if (projectName.includes('mobile')) await page.touchscreen.tap(screenX, screenY);
    else await page.mouse.click(screenX, screenY);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

async function solvePipeWithPointer(
    page: import('@playwright/test').Page,
    projectName: string
): Promise<void> {
    await page.keyboard.press('ArrowDown');
    if (await page.locator('#game-main').getAttribute('data-encounter') !== 'pipe') {
        await page.keyboard.press('ArrowRight');
    }
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'pipe');
    await expect(page.locator('canvas[data-runtime="phaser"]')).toHaveAttribute(
        'data-pipe-turns',
        '0'
    );

    const board = createIntroPipeBoard(new Mulberry32Random(PHASER_MIGRATION_SEED + 1));
    const solvedRotations = new Map<number, PipeRotation>([[5, 1], [6, 2], [10, 0]]);
    const bounds = await page.locator('canvas[data-runtime="phaser"]').boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    for (const [tileIndex, solvedRotation] of solvedRotations) {
        const tile = board.tiles[tileIndex]!;
        const rotations = (solvedRotation - tile.rotation + 4) % 4;
        const tileX = tileIndex % board.width;
        const tileY = Math.floor(tileIndex / board.width);
        for (let rotation = 0; rotation < rotations; rotation++) {
            const canvas = page.locator('canvas[data-runtime="phaser"]');
            const previousTurns = Number(await canvas.getAttribute('data-pipe-turns'));
            const gameX = 144 + tileX * 96 + 48;
            const gameY = 154 + tileY * 96 + 48;
            const screenX = bounds.x + 2 + (gameX / 672) * (bounds.width - 4);
            const screenY = bounds.y + 2 + (gameY / 672) * (bounds.height - 4);
            if (projectName.includes('mobile')) await page.touchscreen.tap(screenX, screenY);
            else await page.mouse.click(screenX, screenY);
            await expect(canvas).toHaveAttribute('data-pipe-turns', String(previousTurns + 1));
        }
    }
    await expect(page.locator('#game-main')).not.toHaveAttribute('data-encounter', 'pipe');
}

function directionKey(
    from: {readonly x: number; readonly y: number},
    to: {readonly x: number; readonly y: number}
): string {
    if (to.x === from.x + 1 && to.y === from.y) return 'ArrowRight';
    if (to.x === from.x - 1 && to.y === from.y) return 'ArrowLeft';
    if (to.y === from.y + 1 && to.x === from.x) return 'ArrowDown';
    if (to.y === from.y - 1 && to.x === from.x) return 'ArrowUp';
    throw new Error('Expected adjacent overworld positions.');
}

function getIntroPlacement() {
    const pristineMaze = generateMaze({
        size: 21,
        random: new Mulberry32Random(PHASER_MIGRATION_SEED)
    });
    return placeIntroTrigger(pristineMaze, {x: 1, y: 1});
}

function createExitSave(
    flags: readonly string[],
    alreadyAtExit = false
): {serialized: string; moveKey: string} {
    const maze = generateMaze({
        size: 21,
        random: new Mulberry32Random(PHASER_MIGRATION_SEED)
    });
    const approach = [
        {position: {x: 18, y: 19}, moveKey: 'ArrowRight'},
        {position: {x: 19, y: 18}, moveKey: 'ArrowDown'}
    ].find(candidate => maze[candidate.position.y]?.[candidate.position.x]?.kind === 'passage');
    if (!approach) throw new Error('Expected a passage beside the seeded exit.');

    const initial = createInitialCampaignState({
        campaignSeed: PHASER_MIGRATION_SEED,
        maze,
        levelId: 'phaser-migration-zone'
    });
    const state = {
        ...initial,
        flags,
        overworld: {
            ...initial.overworld,
            playerPosition: alreadyAtExit ? {x: 19, y: 19} : approach.position,
            itemsInitialized: true,
            items: [],
            monstersInitialized: true,
            monsters: []
        }
    };
    return {
        serialized: JSON.stringify({
            formatVersion: 1,
            savedAt: '2026-07-23T15:00:00.000Z',
            state
        }),
        moveKey: approach.moveKey
    };
}

async function startAtExit(
    page: import('@playwright/test').Page,
    flags: readonly string[],
    alreadyAtExit = false
): Promise<string> {
    const save = createExitSave(flags, alreadyAtExit);
    await page.addInitScript(serialized => {
        window.localStorage.setItem('maze:campaign:slot-1', serialized);
    }, save.serialized);
    await page.goto('/');
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    return save.moveKey;
}

async function completePipeAndLock(
    page: import('@playwright/test').Page,
    projectName: string
): Promise<ReturnType<typeof getIntroPlacement>> {
    await solvePipeWithPointer(page, projectName);
    const placement = getIntroPlacement();
    await page.keyboard.press(directionKey(placement.position, placement.benefitWallPosition));
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'lock');

    const lock = createPinTensionLock(
        new Mulberry32Random(PHASER_MIGRATION_SEED + 0x1000 + 1)
    );
    await tapGamePoint(
        page,
        projectName,
        240 + (lock.requiredTension - 1) * 96,
        536
    );
    for (let pinIndex = 0; pinIndex < lock.pins.length; pinIndex++) {
        const pin = lock.pins[pinIndex]!;
        for (let height = 0; height < pin.targetHeight; height++) {
            await tapGamePoint(page, projectName, 156 + pinIndex * 120, 300);
        }
    }
    await expect(page.locator('#game-main')).not.toHaveAttribute('data-encounter', 'lock');
    return placement;
}

async function completeShooter(
    page: import('@playwright/test').Page,
    projectName: string
): Promise<ReturnType<typeof getIntroPlacement>> {
    const placement = await completePipeAndLock(page, projectName);
    const retreatKey = directionKey(placement.benefitWallPosition, placement.position);
    const returnKey = directionKey(placement.position, placement.benefitWallPosition);
    await page.keyboard.press(retreatKey);
    await page.keyboard.press(returnKey);

    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'shooter');
    await expect(canvas).toHaveAttribute('data-shooter-target', '6');
    for (let expectedWaveIndex = 0; expectedWaveIndex < 10; expectedWaveIndex++) {
        if (await gameMain.getAttribute('data-encounter') !== 'shooter') break;
        const nextLane = Number(await canvas.getAttribute('data-shooter-next-lane'));
        expect(nextLane).toBeGreaterThanOrEqual(0);
        expect(nextLane).toBeLessThan(5);
        await tapGamePoint(page, projectName, 136 + nextLane * 100, 560);
        await expect(canvas).toHaveAttribute('data-shooter-player-lane', String(nextLane));
        await page.keyboard.press('Space');
        await expect.poll(async () => {
            if (await gameMain.getAttribute('data-encounter') !== 'shooter') return true;
            return Number(await canvas.getAttribute('data-shooter-wave-index')) > expectedWaveIndex;
        }, {timeout: 3_000}).toBe(true);
    }
    await expect(gameMain).not.toHaveAttribute('data-encounter', 'shooter', {timeout: 12_000});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    return placement;
}

test('renders a nonblank Phaser overworld and accepts keyboard movement', async ({page}, testInfo) => {
    await startPhaserRuntime(page);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const screenshot = await canvas.screenshot({path: testInfo.outputPath('phaser-overworld.png')});
    const pixelSample = analyzeScreenshot(screenshot);

    expect(screenshot.byteLength).toBeGreaterThan(1_000);
    expect(pixelSample.opaquePixels).toBeGreaterThan(5_000);
    expect(pixelSample.distinctColors).toBeGreaterThan(10);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    const position = await page.locator('#game-main').evaluate(element => ({
        x: element.getAttribute('data-player-x'),
        y: element.getAttribute('data-player-y')
    }));
    expect(position).not.toEqual({x: '1', y: '1'});
});

test('renders touch controls that move the player on mobile', async ({page}, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'));
    await startPhaserRuntime(page);

    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const tapControl = async (gameX: number, gameY: number): Promise<void> => {
        const bounds = await canvas.boundingBox();
        expect(bounds).not.toBeNull();
        if (!bounds) return;
        await page.touchscreen.tap(
            bounds.x + (gameX / 672) * bounds.width,
            bounds.y + (gameY / 672) * bounds.height
        );
    };
    await tapControl(78, 574);
    const gameMain = page.locator('#game-main');
    const movedDown = await gameMain.evaluate(element =>
        element.getAttribute('data-player-x') !== '1' ||
        element.getAttribute('data-player-y') !== '1'
    );
    if (!movedDown) await tapControl(122, 574);

    await expect.poll(() => gameMain.evaluate(element =>
        element.getAttribute('data-player-x') !== '1' ||
        element.getAttribute('data-player-y') !== '1'
    )).toBe(true);
    const screenshot = await page.screenshot({path: testInfo.outputPath('phaser-mobile.png')});
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test('solves a Pipe encounter and commits its overworld consequences', async ({page}, testInfo) => {
    await startPhaserRuntime(page);
    await page.keyboard.press('ArrowDown');
    if (await page.locator('#game-main').getAttribute('data-encounter') !== 'pipe') {
        await page.keyboard.press('ArrowRight');
    }
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'pipe');
    await expect(page.locator('canvas[data-runtime="phaser"]')).toHaveAttribute(
        'data-pipe-turns',
        '0'
    );

    const board = createIntroPipeBoard(new Mulberry32Random(PHASER_MIGRATION_SEED + 1));
    const solvedRotations = new Map<number, PipeRotation>([
        [5, 1],
        [6, 2],
        [10, 0]
    ]);
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    for (const [tileIndex, solvedRotation] of solvedRotations) {
        const tile = board.tiles[tileIndex];
        expect(tile).toBeDefined();
        expect(PIPE_TILE_KINDS).toContain(tile?.kind);
        if (!tile) continue;
        const clickCount = (solvedRotation - tile.rotation + 4) % 4;
        const tileX = tileIndex % board.width;
        const tileY = Math.floor(tileIndex / board.width);
        const gameX = 144 + tileX * 96 + 48;
        const gameY = 154 + tileY * 96 + 48;
        for (let click = 0; click < clickCount; click++) {
            const previousTurns = Number(await canvas.getAttribute('data-pipe-turns'));
            const screenX = bounds.x + 2 + (gameX / 672) * (bounds.width - 4);
            const screenY = bounds.y + 2 + (gameY / 672) * (bounds.height - 4);
            if (testInfo.project.name.includes('mobile')) {
                await page.touchscreen.tap(screenX, screenY);
            } else {
                await page.mouse.click(screenX, screenY);
            }
            await expect(canvas).toHaveAttribute('data-pipe-turns', String(previousTurns + 1));
        }
    }

    await expect(page.locator('#game-main')).not.toHaveAttribute('data-encounter', 'pipe');
    await expect(page.locator('#game-main')).toHaveAttribute('data-power-routing', '65');
    await expect(page.locator('#game-main')).toHaveAttribute('data-scrap', '5');
    await expect(page.locator('#game-main')).toHaveAttribute(
        'data-campaign-flags',
        /coolant-routing-restored/
    );
    await expect(page.locator('#message')).toContainText('powered shortcut opens nearby');

    await page.reload();
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await expect(page.locator('#game-main')).toHaveAttribute('data-power-routing', '65');
    await expect(page.locator('#game-main')).toHaveAttribute('data-scrap', '5');
    await expect(page.locator('#game-main')).toHaveAttribute(
        'data-campaign-flags',
        /coolant-routing-restored/
    );
    await expect(page.locator('#game-main')).not.toHaveAttribute('data-encounter', 'pipe');
});

test('abandons a Pipe encounter with a consequence and allows a retry', async ({page}) => {
    await startPhaserRuntime(page);
    await page.keyboard.press('ArrowDown');
    if (await page.locator('#game-main').getAttribute('data-encounter') !== 'pipe') {
        await page.keyboard.press('ArrowRight');
    }
    await expect(page.locator('#game-main')).toHaveAttribute('data-encounter', 'pipe');
    await expect(page.locator('canvas[data-runtime="phaser"]')).toHaveAttribute(
        'data-pipe-turns',
        '0'
    );

    await page.keyboard.press('Escape');
    await expect(page.locator('#game-main')).not.toHaveAttribute('data-encounter', 'pipe');
    await expect(page.locator('#game-main')).toHaveAttribute('data-security-alert', '5');
    await expect(page.locator('#game-main')).toHaveAttribute(
        'data-campaign-flags',
        /coolant-terminal-filed-a-complaint/
    );
    await expect(page.locator('#message')).toContainText('lockout is temporary');

    const gameMain = page.locator('#game-main');
    const playerX = await gameMain.getAttribute('data-player-x');
    const playerY = await gameMain.getAttribute('data-player-y');
    const retreatKey = playerX === '2' ? 'ArrowLeft' : 'ArrowUp';
    const returnKey = playerX === '2' ? 'ArrowRight' : 'ArrowDown';
    expect(playerX === '2' || playerY === '2').toBe(true);
    await page.keyboard.press(retreatKey);
    await page.keyboard.press(returnKey);

    await expect(gameMain).toHaveAttribute('data-encounter', 'pipe');
});

test('pauses and resumes the active Phaser scene from the shared game shell', async ({page}) => {
    await startPhaserRuntime(page);
    const gameMain = page.locator('#game-main');
    const initialTurn = await gameMain.getAttribute('data-turn');

    await page.getByRole('button', {name: 'Open menu'}).click();
    await expect(page.getByRole('dialog', {name: 'Paused'})).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(gameMain).toHaveAttribute('data-turn', initialTurn ?? '0');

    await page.getByRole('button', {name: 'Resume'}).click();
    await expect(page.getByRole('dialog', {name: 'Paused'})).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(gameMain).not.toHaveAttribute('data-turn', initialTurn ?? '0');
});

test('uses the Pipe shortcut to reach and solve the archive lock', async ({page}, testInfo) => {
    await startPhaserRuntime(page);
    await completePipeAndLock(page, testInfo.project.name);

    const gameMain = page.locator('#game-main');
    await expect(page.locator('#mining')).toHaveText('2 (6)');
    await expect(gameMain).toHaveAttribute('data-scrap', '8');
    await expect(gameMain).toHaveAttribute('data-campaign-flags', /coolant-routing-restored/);
    await expect(gameMain).toHaveAttribute('data-campaign-flags', /archive-lock-opened/);

    await page.reload();
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await expect(page.locator('#mining')).toHaveText('2 (6)');
    await expect(page.locator('#game-main')).toHaveAttribute('data-scrap', '8');
});

test('uses Pipe power and lock intel to clear the orbital corridor', async ({page}, testInfo) => {
    await startPhaserRuntime(page);
    await completeShooter(page, testInfo.project.name);

    const gameMain = page.locator('#game-main');
    await expect(gameMain).toHaveAttribute('data-scrap', '13');
    await expect(gameMain).toHaveAttribute('data-campaign-flags', /orbital-corridor-cleared/);
    await expect(page.locator('#message')).toContainText('Supply drones can reach the ruins again');

    await page.reload();
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await expect(page.locator('#game-main')).toHaveAttribute('data-scrap', '13');
    await expect(page.locator('#game-main')).toHaveAttribute(
        'data-campaign-flags',
        /orbital-corridor-cleared/
    );
});

test('completes the integrated four-genre Act I route', async ({page}, testInfo) => {
    test.setTimeout(45_000);
    await startPhaserRuntime(page);
    const placement = await completeShooter(page, testInfo.project.name);
    await page.keyboard.press(directionKey(placement.benefitWallPosition, placement.position));

    const gameMain = page.locator('#game-main');
    const canvas = page.locator('canvas[data-runtime="phaser"]');
    await expect(gameMain).toHaveAttribute('data-encounter', 'platformer');
    await expect(canvas).toHaveAttribute('data-platformer-x', '70');

    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-runtime="phaser"]');
        return Number(canvas?.dataset.platformerX) > 915;
    }, undefined, {polling: 'raf', timeout: 8_000});
    await page.keyboard.down('Space');
    await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-runtime="phaser"]');
        return Number(canvas?.dataset.platformerVelocityY) < 0;
    }, undefined, {polling: 'raf', timeout: 1_000});
    await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-runtime="phaser"]');
        return Number(canvas?.dataset.platformerX) > 1080;
    }, undefined, {polling: 'raf', timeout: 4_000});
    await page.keyboard.up('Space');
    await expect(gameMain).not.toHaveAttribute('data-encounter', 'platformer', {timeout: 8_000});
    await page.keyboard.up('ArrowRight');

    await expect(gameMain).toHaveAttribute('data-scrap', '17');
    await expect(gameMain).toHaveAttribute('data-structural-stability', '70');
    await expect(gameMain).toHaveAttribute('data-campaign-flags', /sublevel-nine-stabilized/);
    await expect(page.locator('#exit-status')).toHaveText('Ready 4 / 4');
    await expect(page.locator('#message')).toContainText('oldest cabinet still remembers your initials');

    await page.reload();
    await page.getByRole('button', {name: 'Start Game'}).click();
    await expect(page.locator('canvas[data-runtime="phaser"]')).toBeVisible();
    await expect(page.locator('#game-main')).toHaveAttribute('data-scrap', '17');
    await expect(page.locator('#game-main')).toHaveAttribute('data-structural-stability', '70');
});

test('keeps the red exit locked until all four minigames are complete', async ({page}) => {
    const moveKey = await startAtExit(page, []);
    await page.keyboard.press(moveKey);

    const gameMain = page.locator('#game-main');
    await expect(page.locator('#level')).toHaveText('1');
    await expect(page.locator('#exit-status')).toHaveText('Locked 0 / 4');
    await expect(page.locator('#message')).toHaveText('Exit locked 0/4. Next: Pipe.');
    await expect(gameMain).toHaveAttribute('data-maze-size', '21');
});

test('moves directly to a larger next level when the exit is ready', async ({page}) => {
    await startAtExit(page, [
        'coolant-routing-restored',
        'archive-lock-opened',
        'orbital-corridor-cleared',
        'sublevel-nine-stabilized'
    ], true);

    const gameMain = page.locator('#game-main');
    await expect(page.locator('#level')).toHaveText('2');
    await expect(page.locator('#exit-status')).toHaveText('Locked 0 / 4');
    await expect(page.locator('#message')).toHaveText('Entered level 2.');
    await expect(gameMain).toHaveAttribute('data-maze-size', '25');
    await expect(gameMain).toHaveAttribute('data-player-x', '1');
    await expect(gameMain).toHaveAttribute('data-player-y', '1');
});