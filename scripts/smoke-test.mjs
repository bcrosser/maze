import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(rootDirectory, 'index.html'), 'utf8');
const generatorSource = readFileSync(join(rootDirectory, 'scripts', 'generate-sprites.mjs'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'Expected one inline game script in index.html.');

function getGeneratedSpriteNames(variableName) {
    const block = generatorSource.match(new RegExp(`const ${variableName} = \\[(.*?)\\n\\];`, 's'));
    assert.ok(block, `Expected ${variableName} in the sprite generator.`);
    return [...block[1].matchAll(/\{name: '([^']+)'/g)].map(match => match[1]);
}

const animationFrames = [];
let drawImageCalls = 0;

const context2d = {
    imageSmoothingEnabled: true,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    drawImage() {
        drawImageCalls++;
    }
};

function createElement(...initialClasses) {
    const classes = new Set(initialClasses);
    const listeners = new Map();
    const attributes = new Map();

    return {
        textContent: '',
        style: {},
        classList: {
            add(...names) {
                for (const name of names) classes.add(name);
            },
            remove(...names) {
                for (const name of names) classes.delete(name);
            },
            toggle(name, force) {
                const shouldAdd = force === undefined ? !classes.has(name) : force;
                if (shouldAdd) classes.add(name);
                else classes.delete(name);
                return shouldAdd;
            },
            contains(name) {
                return classes.has(name);
            }
        },
        addEventListener(type, listener) {
            const typeListeners = listeners.get(type) ?? [];
            typeListeners.push(listener);
            listeners.set(type, typeListeners);
        },
        dispatch(type, properties = {}) {
            const event = {
                ...properties,
                defaultPrevented: false,
                propagationStopped: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
                stopPropagation() {
                    this.propagationStopped = true;
                }
            };
            for (const listener of listeners.get(type) ?? []) listener(event);
            return event;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute(name) {
            return attributes.get(name) ?? null;
        },
        focus() {
            this.focused = true;
        }
    };
}

const elements = {
    canvas: Object.assign(createElement(), {
        width: 0,
        height: 0,
        getContext: () => context2d
    }),
    level: createElement(),
    health: createElement(),
    mining: createElement(),
    message: createElement(),
    'overlay-backdrop': createElement(),
    'start-panel': createElement(),
    'start-btn': createElement(),
    'overlay-backdrop-pause': createElement('hidden'),
    'pause-panel': createElement('hidden'),
    'resume-btn': createElement(),
    'restart-btn': createElement(),
    'overlay-backdrop-win': createElement('hidden'),
    'win-panel': createElement('hidden'),
    'play-again-btn': createElement(),
    'menu-toggle-btn': createElement('hidden'),
    'game-main': createElement('hidden')
};

const windowListeners = new Map();
const fakeWindow = {
    addEventListener(type, listener) {
        const typeListeners = windowListeners.get(type) ?? [];
        typeListeners.push(listener);
        windowListeners.set(type, typeListeners);
    },
    dispatch(type, properties = {}) {
        const event = {
            ...properties,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            }
        };
        for (const listener of windowListeners.get(type) ?? []) listener(event);
        return event;
    }
};

class FakeImage {
    constructor() {
        this.naturalWidth = 320;
        this.naturalHeight = 160;
        this.onload = null;
        this.onerror = null;
    }

    set src(value) {
        this.source = value;
        queueMicrotask(() => this.onload?.());
    }
}

const browserContext = vm.createContext({
    console,
    document: {
        getElementById(id) {
            return elements[id];
        }
    },
    window: fakeWindow,
    Image: FakeImage,
    performance,
    queueMicrotask,
    requestAnimationFrame(callback) {
        animationFrames.push(callback);
        return animationFrames.length;
    }
});

const testBridge = `
globalThis.__mazeTest = {
    uiSnapshot() {
        return {
            gameState,
            startVisible: !startPanel.classList.contains('hidden'),
            gameVisible: !gameMain.classList.contains('hidden'),
            pauseVisible: !pausePanel.classList.contains('hidden'),
            pauseBackdropVisible: !pauseBackdrop.classList.contains('hidden'),
            winVisible: !winPanel.classList.contains('hidden'),
            menuButtonVisible: !menuToggleBtn.classList.contains('hidden'),
            menuExpanded: menuToggleBtn.getAttribute('aria-expanded'),
            level,
            size,
            health: player.health
        };
    },

    snapshot() {
        const materialIds = new Set();
        for (const row of maze) {
            for (const cell of row) {
                if (cell.kind === 'wall') materialIds.add(cell.materialId);
            }
        }

        const entityPositions = [...items, ...monsters]
            .map(entity => coordinateKey(entity.x, entity.y));

        return {
            gameState,
            materialCount: MATERIAL_IDS.length,
            usedMaterialCount: materialIds.size,
            itemCatalogSize: ITEM_SPRITE_IDS.length,
            monsterCatalogSize: MONSTER_SPRITE_IDS.length,
            itemSpriteIds: [...ITEM_SPRITE_IDS],
            monsterSpriteIds: [...MONSTER_SPRITE_IDS],
            itemSheetReady: spriteSheets.item.ready,
            monsterSheetReady: spriteSheets.monster.ready,
            itemCount: items.length,
            monsterCount: monsters.length,
            attachedItemStrategies: items.every(item => Boolean(item.strategy)),
            attachedMonsterStrategies: monsters.every(monster => Boolean(monster.strategy)),
            uniqueEntityPositions: new Set(entityPositions).size === entityPositions.length,
            activeItemTypes: new Set(items.map(item => item.typeId)).size,
            activeMonsterTypes: new Set(monsters.map(monster => monster.typeId)).size,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            level,
            size
        };
    },

    completeMaxLevel() {
        size = MAX_SIZE;
        player.x = size - 2;
        player.y = size - 2;
        return checkLevelCompletion();
    },

    runBehaviorChecks() {
        const healingItem = items.find(item => item.typeId === 'healthPotion');
        const miningItem = items.find(item => item.typeId === 'miningPick');
        player.health = 5;
        player.x = healingItem.x;
        player.y = healingItem.y;
        collectItemsAtPlayer();
        const healingWorked = player.health === 9 && !items.includes(healingItem);

        player.x = miningItem.x;
        player.y = miningItem.y;
        collectItemsAtPlayer();
        const miningPickupWorked = player.miningPower === 2 && player.miningCharges === 6 &&
            !items.includes(miningItem);

        let miningWorked = false;
        for (let wallY = 1; wallY < size - 1 && !miningWorked; wallY++) {
            for (let wallX = 1; wallX < size - 1 && !miningWorked; wallX++) {
                const material = getWallMaterial(wallX, wallY);
                if (!material || !material.tags.includes('mineral') || material.hardness > 2) continue;

                for (const direction of DIRECTIONS) {
                    const passageX = wallX - direction.x;
                    const passageY = wallY - direction.y;
                    if (!isPassable(passageX, passageY)) continue;
                    player.x = passageX;
                    player.y = passageY;
                    const chargesBefore = player.miningCharges;
                    miningWorked = tryMovePlayer(direction) &&
                        isPassable(wallX, wallY) &&
                        player.miningCharges === chargesBefore - 1;
                    break;
                }
            }
        }

        const fireHunter = monsters.find(monster => monster.typeId === 'emberHound');
        let hotAttackWorked = false;
        for (let passageY = 1; passageY < size - 1 && !hotAttackWorked; passageY++) {
            for (let passageX = 1; passageX < size - 1 && !hotAttackWorked; passageX++) {
                if (!isPassable(passageX, passageY)) continue;
                const wallDirection = DIRECTIONS.find(direction =>
                    getCell(passageX + direction.x, passageY + direction.y)?.kind === 'wall'
                );
                if (!wallDirection) continue;

                const wallX = passageX + wallDirection.x;
                const wallY = passageY + wallDirection.y;
                maze[wallY][wallX] = Object.freeze({kind: 'wall', materialId: 'fire'});
                monsters = [fireHunter];
                fireHunter.x = passageX;
                fireHunter.y = passageY;
                fireHunter.lastAttackAt = -Infinity;
                player.x = passageX;
                player.y = passageY;
                player.health = player.maxHealth;
                player.invulnerableUntil = 0;
                resolveMonsterContacts(performance.now() + 1000);
                hotAttackWorked = player.health === player.maxHealth - 3;
            }
        }

        const chargesBeforeAdvance = player.miningCharges;
        const previousLevel = level;
        const previousSize = size;
        player.x = size - 2;
        player.y = size - 2;
        const levelAdvanced = checkLevelCompletion() &&
            level === previousLevel + 1 &&
            size > previousSize &&
            player.miningCharges === chargesBeforeAdvance;

        restartCurrentLevelAfterDeath();
        const deathResetWorked = player.health === 10 &&
            player.miningPower === 0 &&
            player.miningCharges === 0 &&
            level === previousLevel + 1;

        return {
            healingWorked,
            miningPickupWorked,
            miningWorked,
            hotAttackWorked,
            levelAdvanced,
            deathResetWorked
        };
    }
};
`;

vm.runInContext(`${scriptMatch[1]}\n${testBridge}`, browserContext, {filename: 'index.html'});

let uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'menu');
assert.equal(uiSnapshot.startVisible, true);
assert.equal(uiSnapshot.gameVisible, false);
assert.equal(uiSnapshot.menuButtonVisible, false);

elements['start-btn'].dispatch('click');
await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

const snapshot = vm.runInContext('__mazeTest.snapshot()', browserContext);
assert.equal(snapshot.gameState, 'playing');
assert.equal(snapshot.materialCount, 24);
assert.equal(snapshot.usedMaterialCount, 24);
assert.equal(snapshot.itemCatalogSize, 50);
assert.equal(snapshot.monsterCatalogSize, 50);
assert.deepEqual(Array.from(snapshot.itemSpriteIds), getGeneratedSpriteNames('itemSprites'));
assert.deepEqual(Array.from(snapshot.monsterSpriteIds), getGeneratedSpriteNames('monsterSprites'));
assert.equal(snapshot.itemSheetReady, true);
assert.equal(snapshot.monsterSheetReady, true);
assert.ok(snapshot.itemCount >= 2);
assert.ok(snapshot.monsterCount >= 2);
assert.equal(snapshot.attachedItemStrategies, true);
assert.equal(snapshot.attachedMonsterStrategies, true);
assert.equal(snapshot.uniqueEntityPositions, true);
assert.equal(snapshot.activeItemTypes, 2);
assert.equal(snapshot.activeMonsterTypes, 2);
assert.equal(snapshot.canvasWidth, 21 * 32);
assert.equal(snapshot.canvasHeight, 21 * 32);

const frame = animationFrames.shift();
assert.equal(typeof frame, 'function');
frame(performance.now() + 1000);
assert.ok(drawImageCalls >= snapshot.itemCount + snapshot.monsterCount);

const behaviorChecks = vm.runInContext('__mazeTest.runBehaviorChecks()', browserContext);
for (const [check, passed] of Object.entries(behaviorChecks)) {
    assert.equal(passed, true, `${check} failed`);
}

elements['menu-toggle-btn'].dispatch('click');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'paused');
assert.equal(uiSnapshot.pauseVisible, true);
assert.equal(uiSnapshot.pauseBackdropVisible, true);
assert.equal(uiSnapshot.menuButtonVisible, false);
assert.equal(uiSnapshot.menuExpanded, 'true');

elements['overlay-backdrop-pause'].dispatch('click');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'playing');
assert.equal(uiSnapshot.pauseVisible, false);
assert.equal(uiSnapshot.menuButtonVisible, true);

fakeWindow.dispatch('blur');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'paused');
fakeWindow.dispatch('focus');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'playing');

elements['menu-toggle-btn'].dispatch('click');
fakeWindow.dispatch('blur');
fakeWindow.dispatch('focus');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'paused', 'Manual pause should survive window focus changes.');
const escapeEvent = fakeWindow.dispatch('keydown', {key: 'Escape'});
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'playing');
assert.equal(escapeEvent.defaultPrevented, true);

elements['menu-toggle-btn'].dispatch('click');
elements['restart-btn'].dispatch('click');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'playing');
assert.equal(uiSnapshot.level, 1);
assert.equal(uiSnapshot.size, 21);
assert.equal(uiSnapshot.health, 10);
assert.equal(uiSnapshot.pauseVisible, false);

assert.equal(vm.runInContext('__mazeTest.completeMaxLevel()', browserContext), true);
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'won');
assert.equal(uiSnapshot.winVisible, true);
elements['play-again-btn'].dispatch('click');
uiSnapshot = vm.runInContext('__mazeTest.uiSnapshot()', browserContext);
assert.equal(uiSnapshot.gameState, 'playing');
assert.equal(uiSnapshot.level, 1);
assert.equal(uiSnapshot.size, 21);
assert.equal(uiSnapshot.winVisible, false);

console.log('Smoke test passed:', {
    materials: snapshot.usedMaterialCount,
    itemSprites: snapshot.itemCatalogSize,
    monsterSprites: snapshot.monsterCatalogSize,
    initialItems: snapshot.itemCount,
    initialMonsters: snapshot.monsterCount,
    ...behaviorChecks
});