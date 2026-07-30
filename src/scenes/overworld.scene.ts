import Phaser from 'phaser';

import {getControlDeck} from '../app/control-deck-host';
import {drawHorse} from '../content/horse-art';
import {
    OVERWORLD_CONTROL_SCHEME,
    type ControlEvent
} from '../app/control-scheme';
import {
    createInitialCampaignState,
    type ActiveEncounterRecord,
    type CampaignState,
    type EncounterKind
} from '../domain/campaign/campaign-state';
import {
    CAMPAIGN_VICTORY_FLAG,
    getCampaignLevelNumber,
    getLevelExitStatus,
    getLevelTier,
    MAX_CAMPAIGN_LEVEL
} from '../domain/campaign/level-progression';
import {
    getItemGlyph,
    ITEM_DEFINITIONS,
    ITEM_SPRITES,
    ITEM_TYPE_IDS,
    type ItemChoiceId
} from '../domain/entities/item-types';
import {
    describeWeaponComparison,
    describeWeaponStats,
    getItemWeaponStats,
    getWeaponStats
} from '../domain/entities/weapon-stats';
import {
    getItemSaleValue,
    getLevelPriceMultiplier,
    getScrapSaleValue,
    getShopOfferPrice,
    purchaseShopOffer,
    purchaseSpaceObjectiveSkip,
    sellBackpackItem,
    sellScrap,
    SHOP_CATALOG,
    SPACE_OBJECTIVE_SKIP_COST,
    type ShopPurchaseFailureReason,
    type SpaceObjectiveSkipFailureReason
} from '../domain/economy/economy';
import {
    MONSTER_DEFINITIONS,
    MONSTER_TYPE_IDS,
    type MonsterStrategyId
} from '../domain/entities/monster-types';
import {
    getMaterialHardness,
    getWallMaterial,
    MATERIAL_IDS,
    MATERIALS,
    type MaterialId,
    type MaterialTag,
    type WallMaterialView
} from '../domain/materials/materials';
import {getMinigameItemBonus} from '../domain/minigame/minigame-item-bonuses';
import {initializeLevelContent} from '../domain/overworld/level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getCurrentObjective,
    getObjectivePlacement,
    getObjectiveStatus,
    OBJECTIVE_BY_ID,
    OBJECTIVE_DEFINITIONS,
    type LevelObjectivePlacement,
    type ObjectiveDefinition,
    type ObjectiveId
} from '../domain/overworld/level-objectives';
import type {LevelServicePlacement} from '../domain/overworld/level-service-sites';
import {SERVICE_SITE_DEFINITIONS} from '../domain/overworld/service-site-placement';
import {generateMaze, MAZE_GENERATOR_ID} from '../domain/overworld/maze-generator';
import {
    DIRECTION_VECTORS,
    type DirectionId
} from '../domain/overworld/move-player';
import {
    resolveCampaignDefeat,
    resolveOverworldAction,
    type OverworldAction,
    type OverworldEvent
} from '../domain/overworld/resolve-overworld-action';
import {advanceOverworldReinforcements} from '../domain/overworld/reinforcements';
import {Mulberry32Random} from '../domain/random/random-source';
import {deriveSeed} from '../domain/random/seed-derivation';
import {applyEncounterResult} from '../encounters/apply-encounter-result';
import type {EncounterContext, EncounterResult} from '../encounters/contracts';
import {
    BLACKJACK_SCENE_KEY,
    type BlackjackLaunchData
} from '../minigames/casino/blackjack.scene';
import {
    HOLDEM_SCENE_KEY,
    type HoldemLaunchData
} from '../minigames/casino/holdem.scene';
import {
    CIRCUIT_CRASH_SCENE_KEY,
    type CircuitCrashLaunchData
} from '../minigames/circuit/circuit.scene';
import {
    HORSEMASTER_SCENE_KEY,
    type HorsemasterLaunchData
} from '../minigames/horsemaster/horsemaster.scene';
import {
    CASINO_HEIST_SCENE_KEY,
    type CasinoHeistLaunchData
} from '../minigames/heist/casino-heist.scene';
import {selectLockFamily, type LockFamily} from '../minigames/lock/lock-model';
import {LOCKPICK_SCENE_KEY, type LockpickLaunchData} from '../minigames/lock/lockpick.scene';
import {SAFE_DIAL_SCENE_KEY} from '../minigames/lock/safe-dial.scene';
import {TUMBLER_RELAY_SCENE_KEY} from '../minigames/lock/tumbler-relay.scene';
import {PLATFORMER_SCENE_KEY, type PlatformerLaunchData} from '../minigames/platformer/platformer.scene';
import {PIPE_DREAM_SCENE_KEY, type PipeDreamLaunchData} from '../minigames/pipe/pipe-dream.scene';
import {SHOOTER_SCENE_KEY, type ShooterLaunchData} from '../minigames/shooter/shooter.scene';
import {ZAPPER_SCENE_KEY, type ZapperLaunchData} from '../minigames/zapper/zapper.scene';
import {getEncounterResultPresentation} from './encounter-result-presentation';
import {encounterResultKeyAction} from './encounter-result-input';
import {commitObjectiveResult} from './commit-objective-result';

export const OVERWORLD_SCENE_KEY = 'overworld';
export const CELL_SIZE = 32;
export const INITIAL_MAZE_SIZE = 21;
export const GAME_VIEW_SIZE = INITIAL_MAZE_SIZE * CELL_SIZE;
const WALKABLE_EDGE_CELL_CENTER = CELL_SIZE * 1.5;
/** Smallest comfortable on-screen maze cell, in CSS pixels. */
const MINIMUM_READABLE_CELL_PX = 26;
const MAXIMUM_CAMERA_ZOOM = 2;

/**
 * Overworld actions the surrounding shell can drive from its own on-screen
 * controls, so touch players are not limited to keyboard input.
 */
export type OverworldControl =
    | {readonly kind: 'move'; readonly direction: DirectionId}
    | {readonly kind: 'attack-toggle'}
    | {readonly kind: 'use'}
    | {readonly kind: 'quick-slot'; readonly slot: 0 | 1 | 2}
    | {readonly kind: 'interact'}
    | {readonly kind: 'wait'}
    | {readonly kind: 'inventory'}
    | {readonly kind: 'menu'}
    | {readonly kind: 'cycle-objective'};

export interface OverworldSceneOptions {
    readonly seed: number;
    readonly itemSpriteSheetUrl: string;
    readonly monsterSpriteSheetUrl: string;
    readonly objectiveSpriteSheetUrl: string;
    readonly initialCampaign?: CampaignState;
    readonly onStateChanged: (state: CampaignState, event?: OverworldEvent) => void;
    readonly onEncounterChanged: (
        kind: EncounterKind | 'blackjack' | 'holdem' | null
    ) => void;
    /** Opens the shell's pause menu from the shared control deck. */
    readonly onMenuRequested?: () => void;
}

interface ObjectiveVisual {
    readonly sprite: Phaser.GameObjects.Sprite;
    readonly badge: Phaser.GameObjects.Text;
    readonly label: Phaser.GameObjects.Text;
}

interface ServiceSiteVisual {
    readonly container: Phaser.GameObjects.Container;
}

type ScrollFactorGameObject = Phaser.GameObjects.GameObject & {
    setScrollFactor(x: number, y?: number): unknown;
};

function colorToNumber(color: `#${string}`): number {
    return Number.parseInt(color.slice(1), 16);
}

function directionForKey(key: string): DirectionId | null {
    switch (key.toLowerCase()) {
        case 'arrowup':
        case 'w':
            return 'up';
        case 'arrowdown':
        case 's':
            return 'down';
        case 'arrowleft':
        case 'a':
            return 'left';
        case 'arrowright':
        case 'd':
            return 'right';
        default:
            return null;
    }
}

function samePosition(
    left: {readonly x: number; readonly y: number},
    right: {readonly x: number; readonly y: number}
): boolean {
    return left.x === right.x && left.y === right.y;
}

function objectiveLockedMessage(objectiveId: ObjectiveId): string {
    const definition = OBJECTIVE_BY_ID[objectiveId];
    if (objectiveId === 'casino-heist') {
        return `${definition.label} is locked. Find a Getaway Car in the maze or buy one at the shop for $100.`;
    }
    const prerequisite = definition.prerequisiteId
        ? OBJECTIVE_BY_ID[definition.prerequisiteId].label
        : 'the prerequisite';
    return `${definition.label} is locked. Complete ${prerequisite}.`;
}

function messageEvent(message: string): OverworldEvent {
    return {kind: 'blocked', message};
}

/**
 * Plain-language wall inspection: what it is, whether the player's pick can get
 * through it right now, and what breaking it pays out.
 */
function describeWallForPlayer(
    material: WallMaterialView,
    player: CampaignState['player'],
    position: {readonly x: number; readonly y: number},
    overworld: CampaignState['overworld']
): string {
    const size = overworld.maze.length;
    const parts = [`${material.definition.name} wall`];
    if (material.definition.tags.length > 0) {
        parts.push(material.definition.tags.join(', '));
    }
    const perimeter = position.x === 0 ||
        position.y === 0 ||
        position.x === size - 1 ||
        position.y === size - 1;
    const protectedShortcut = overworld.pipeShortcutWall !== null &&
        samePosition(position, overworld.pipeShortcutWall);
    if (perimeter) {
        parts.push('Outer wall — it can never be mined');
    } else if (protectedShortcut) {
        parts.push('Sealed by the coolant route until Pipe is finished');
    } else if (material.hardness === undefined) {
        parts.push('No mining tool cuts this material');
    } else if (player.miningPower < material.hardness) {
        parts.push(
            `Hardness ${material.hardness} — needs mining power ` +
            `${material.hardness}, you have ${player.miningPower}`
        );
    } else if (player.toolCharge <= 0) {
        parts.push(`Hardness ${material.hardness} — your pick is out of charges`);
    } else {
        const yielded = material.hardness >= 4 ? 2 : 1;
        const bonus = material.id === 'gold' ? 1 : 0;
        parts.push(
            `Hardness ${material.hardness} — you can mine it for ` +
            `${yielded + bonus} salvage (${player.toolCharge} charges left)`
        );
    }
    return parts.join(' · ');
}

/** Plain-language summary of what each monster strategy does to the player. */
const MONSTER_BEHAVIOR_HINTS: Readonly<Record<MonsterStrategyId, string>> = Object.freeze({
    wander: 'drifts until you are close',
    pursue: 'hunts you across the level',
    bat: 'moves every turn in an erratic line',
    sentry: 'never moves but strikes at range',
    mimic: 'waits disguised until you are adjacent',
    golem: 'slow, armored, and very heavy hitting',
    ambusher: 'closes the gap in sudden leaps',
    caster: 'attacks down open corridors from a distance'
});

interface MazeHelpPage {
    readonly title: string;
    readonly body: string;
}

/**
 * Builds the legend from the live registries, so a newly added item, monster, or
 * material documents itself instead of drifting out of date.
 */
function buildMazeHelpPages(state: CampaignState): readonly MazeHelpPage[] {
    const itemsByCategory = new Map<string, string[]>();
    for (const typeId of ITEM_TYPE_IDS) {
        const definition = ITEM_DEFINITIONS[typeId];
        const list = itemsByCategory.get(definition.category) ?? [];
        list.push(`${getItemGlyph(typeId)} ${definition.label}`);
        itemsByCategory.set(definition.category, list);
    }
    const itemLines = [...itemsByCategory.entries()].map(([category, labels]) =>
        `${category.toUpperCase()}: ${labels.join(', ')}`
    );

    const monsterLines = MONSTER_TYPE_IDS.map(typeId => {
        const definition = MONSTER_DEFINITIONS[typeId];
        return `${definition.label} — ${definition.maxHealth} HP, ` +
            `${definition.baseDamage} dmg, armor ${definition.armor}, ` +
            `${MONSTER_BEHAVIOR_HINTS[definition.strategyId]}`;
    });

    const mineable = MATERIAL_IDS
        .map(id => ({id, hardness: getMaterialHardness(id)}))
        .filter(entry => entry.hardness !== undefined)
        .sort((left, right) => (left.hardness ?? 0) - (right.hardness ?? 0))
        .map(entry => `${MATERIALS[entry.id].name} ${entry.hardness}`);
    const solid = MATERIAL_IDS
        .filter(id => getMaterialHardness(id) === undefined)
        .map(id => MATERIALS[id].name);

    return [
        {
            title: 'MAZE LEGEND',
            body: [
                'Tap anything to inspect it: a wall reports its material and',
                'whether your pick can cut it; monsters report health, armor, and',
                'intent; items report quality and affixes.',
                '',
                'The blue rolling ball is you. Little stairs going down are the',
                'level exit — reach them once the required objectives are done.',
                'Diamond markers are objectives, and the ↻ button beside the',
                'Objective readout retargets the one you are tracking.',
                '',
                `Salvage sells at shops for $2 each. Prices rise 30% per level,`,
                `so level ${getCampaignLevelNumber(state)} charges` +
                ` ${Math.round(getLevelPriceMultiplier(getCampaignLevelNumber(state)) * 100)}%` +
                ' of base.',
                'Shops also buy carried loot and sell Expedition Packs that',
                'permanently widen your backpack.'
            ].join('\n')
        },
        {
            title: 'CONTROLS',
            body: [
                'Stick or arrows/WASD: move, and bump a monster to attack it.',
                'ATTACK then a direction: fire a ranged weapon.',
                'Quick slots 1-3: use the assigned item; assign them in Items.',
                'INTERACT (E): pick up, disarm, shop, or start an objective.',
                'WAIT (. or Space): spend a turn in place.',
                'ITEMS (I): open the turn-frozen backpack.',
                'Escape or MENU: pause.',
                '',
                'Mining is automatic: walk into a mineable wall while carrying',
                'pick charges. The HUD shows mining power and charges left, and',
                'each cut plays a short pick animation.',
                '',
                'Every minigame uses this same stick and button deck; only the',
                'button labels change.'
            ].join('\n')
        },
        {
            title: 'ITEMS',
            body: itemLines.join('\n\n')
        },
        {
            title: 'MONSTERS',
            body: [
                ...monsterLines,
                '',
                'Elite monsters glow gold and hit harder; a red tint means the',
                'monster has already committed to an attack next turn.',
                'Floating numbers show damage dealt and taken.'
            ].join('\n')
        },
        {
            title: 'WALLS',
            body: [
                'Mining power must meet or beat a wall hardness to cut it:',
                mineable.join(', '),
                '',
                'These never yield to any tool:',
                solid.join(', '),
                '',
                'Wall texture follows the material tags: blocks and cracks for',
                'minerals, fibres for organics, ripples for wet, embers for hot,',
                'flakes for cold, and sparkles for magical.',
                'The outer wall of the maze can never be mined.'
            ].join('\n')
        }
    ];
}

/** The cell a mining action just opened, if any, for its short animation. */
function findMinedWall(
    before: CampaignState,
    after: CampaignState
): {readonly x: number; readonly y: number} | null {
    const previousMaze = before.overworld.maze;
    const nextMaze = after.overworld.maze;
    if (previousMaze === nextMaze || previousMaze.length !== nextMaze.length) return null;
    for (let y = 0; y < nextMaze.length; y++) {
        const previousRow = previousMaze[y]!;
        const nextRow = nextMaze[y]!;
        if (previousRow === nextRow) continue;
        for (let x = 0; x < nextRow.length; x++) {
            if (previousRow[x]!.kind === 'wall' && nextRow[x]!.kind === 'passage') {
                return {x, y};
            }
        }
    }
    return null;
}

function shadeColor(color: number, amount: number): number {
    const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
    const red = clamp(((color >> 16) & 0xff) * (1 + amount));
    const green = clamp(((color >> 8) & 0xff) * (1 + amount));
    const blue = clamp((color & 0xff) * (1 + amount));
    return (red << 16) | (green << 8) | blue;
}

/**
 * A deliberately faint ground speckle. The floor has to read as a floor without
 * competing with the items, monsters, and traps standing on it.
 */
function drawFloorTexture(
    graphics: Phaser.GameObjects.Graphics,
    originX: number,
    originY: number
): void {
    graphics.fillStyle(0xdfd9c6, 0.5);
    graphics.fillRect(originX + 6, originY + 7, 2, 2);
    graphics.fillRect(originX + 20, originY + 18, 2, 2);
    graphics.fillRect(originX + 13, originY + 26, 1, 1);
    graphics.lineStyle(1, 0xe6e0cd, 0.45);
    graphics.strokeRect(originX + 0.5, originY + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
}

/**
 * Paints a tag-driven texture onto one 32x32 wall cell: cracked blocks for
 * minerals, fibres for organics, ripples for wet, embers for hot, flakes for
 * cold, and sparkles for magical. Materials with several tags stack patterns, so
 * a wall's make-up is readable without relying on its colour.
 */
function drawMaterialPattern(
    graphics: Phaser.GameObjects.Graphics,
    tags: readonly MaterialTag[],
    base: number,
    originX: number,
    originY: number
): void {
    const light = shadeColor(base, 0.26);
    const dark = shadeColor(base, -0.32);
    const tagSet = new Set(tags);

    if (tagSet.has('mineral') || tagSet.has('earth')) {
        graphics.fillStyle(dark, 0.55);
        graphics.fillRect(originX, originY + 10, CELL_SIZE, 2);
        graphics.fillRect(originX, originY + 22, CELL_SIZE, 2);
        graphics.fillRect(originX + 14, originY, 2, 10);
        graphics.fillRect(originX + 6, originY + 12, 2, 10);
        graphics.fillStyle(light, 0.4);
        graphics.fillRect(originX + 2, originY + 2, 10, 6);
        graphics.fillRect(originX + 18, originY + 14, 9, 6);
    }
    if (tagSet.has('organic')) {
        graphics.lineStyle(1, dark, 0.65);
        for (let offset = 3; offset < CELL_SIZE; offset += 8) {
            graphics.lineBetween(
                originX + offset,
                originY,
                originX + offset + 3,
                originY + CELL_SIZE
            );
        }
        graphics.lineStyle(1, light, 0.45);
        graphics.lineBetween(originX, originY + 9, originX + CELL_SIZE, originY + 13);
    }
    if (tagSet.has('sharp')) {
        graphics.fillStyle(light, 0.8);
        for (let offset = 4; offset < CELL_SIZE - 6; offset += 11) {
            graphics.fillTriangle(
                originX + offset,
                originY + 26,
                originX + offset + 4,
                originY + 14,
                originX + offset + 8,
                originY + 26
            );
        }
    }
    if (tagSet.has('wet')) {
        graphics.lineStyle(2, light, 0.5);
        for (let offset = 6; offset < CELL_SIZE; offset += 10) {
            graphics.beginPath();
            graphics.moveTo(originX, originY + offset);
            graphics.lineTo(originX + 10, originY + offset - 3);
            graphics.lineTo(originX + 21, originY + offset);
            graphics.lineTo(originX + CELL_SIZE, originY + offset - 3);
            graphics.strokePath();
        }
    }
    if (tagSet.has('hot')) {
        graphics.fillStyle(light, 0.85);
        graphics.fillCircle(originX + 8, originY + 9, 2.5);
        graphics.fillCircle(originX + 21, originY + 17, 2);
        graphics.fillStyle(0xffe9a8, 0.55);
        graphics.fillCircle(originX + 8, originY + 9, 1);
        graphics.fillCircle(originX + 13, originY + 26, 1.4);
    }
    if (tagSet.has('cold')) {
        graphics.lineStyle(1, 0xffffff, 0.6);
        graphics.lineBetween(originX + 6, originY + 6, originX + 14, originY + 14);
        graphics.lineBetween(originX + 14, originY + 6, originX + 6, originY + 14);
        graphics.lineBetween(originX + 19, originY + 19, originX + 27, originY + 27);
        graphics.lineBetween(originX + 27, originY + 19, originX + 19, originY + 27);
    }
    if (tagSet.has('conductive')) {
        graphics.lineStyle(1, light, 0.85);
        graphics.beginPath();
        graphics.moveTo(originX + 4, originY + 28);
        graphics.lineTo(originX + 12, originY + 17);
        graphics.lineTo(originX + 8, originY + 15);
        graphics.lineTo(originX + 18, originY + 4);
        graphics.strokePath();
    }
    if (tagSet.has('magical')) {
        graphics.fillStyle(0xffffff, 0.62);
        graphics.fillRect(originX + 9, originY + 4, 2, 2);
        graphics.fillRect(originX + 24, originY + 11, 2, 2);
        graphics.fillRect(originX + 5, originY + 20, 2, 2);
        graphics.fillRect(originX + 17, originY + 27, 2, 2);
    }
    if (tagSet.has('poisonous')) {
        graphics.fillStyle(light, 0.7);
        graphics.fillCircle(originX + 10, originY + 12, 3.2);
        graphics.fillCircle(originX + 22, originY + 22, 2.6);
        graphics.fillStyle(dark, 0.75);
        graphics.fillCircle(originX + 10, originY + 12, 1.2);
    }
    if (tagSet.has('flammable') && !tagSet.has('organic')) {
        graphics.fillStyle(dark, 0.5);
        graphics.fillRect(originX, originY + 6, CELL_SIZE, 1);
        graphics.fillRect(originX, originY + 18, CELL_SIZE, 1);
    }
}

export class OverworldScene extends Phaser.Scene {
    private readonly options: OverworldSceneOptions;
    private campaign!: CampaignState;
    private mazeGraphics!: Phaser.GameObjects.Graphics;
    private playerMarker!: Phaser.GameObjects.Container;
    private playerBallArt!: Phaser.GameObjects.Graphics;
    private playerRollAngle = 0;
    private reducedMotion = false;
    private readonly objectiveVisuals = new Map<ObjectiveId, ObjectiveVisual>();
    private readonly serviceSiteVisuals = new Map<string, ServiceSiteVisual>();
    private readonly itemSprites = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly monsterSprites = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly trapGraphics = new Map<string, Phaser.GameObjects.Rectangle>();
    private attackTargeting = false;
    private itemTargetingId: string | null = null;
    private encounterOpen = false;
    private restartCampaign: CampaignState | undefined;
    private restartAnnouncement: string | undefined;
    private modalContainer: Phaser.GameObjects.Container | null = null;
    private modalConfirmAction: (() => void) | null = null;
    private modalCancelAction: (() => void) | null = null;
    private spaceSkipAction: (() => void) | null = null;
    private shopPreviousPageAction: (() => void) | null = null;
    private shopNextPageAction: (() => void) | null = null;
    private shopOfferActions: readonly (() => void)[] = [];
    private lastShopNavigationKey: string | null = null;
    private lastShopNavigationTimestamp = Number.NEGATIVE_INFINITY;
    private encounterResultModalOpen = false;
    private armoryRewardChoiceOpen = false;
    private casinoSessionOrdinal = 0;
    private reinforcementFrameAccumulatorMs = 0;
    private reinforcementSaveAccumulatorMs = 0;
    private victoryHorse: Phaser.GameObjects.Container | null = null;
    private playerCameraConfigured = false;

    constructor(options: OverworldSceneOptions) {
        super({key: OVERWORLD_SCENE_KEY});
        this.options = options;
    }

    preload(): void {
        this.load.spritesheet('item-sprites', this.options.itemSpriteSheetUrl, {
            frameWidth: CELL_SIZE,
            frameHeight: CELL_SIZE
        });
        this.load.spritesheet('monster-sprites', this.options.monsterSpriteSheetUrl, {
            frameWidth: CELL_SIZE,
            frameHeight: CELL_SIZE
        });
        this.load.spritesheet('objective-sprites', this.options.objectiveSpriteSheetUrl, {
            frameWidth: CELL_SIZE,
            frameHeight: CELL_SIZE
        });
    }

    create(): void {
        this.itemSprites.clear();
        this.monsterSprites.clear();
        this.objectiveVisuals.clear();
        this.serviceSiteVisuals.clear();
        this.trapGraphics.clear();
        this.attackTargeting = false;
        this.itemTargetingId = null;
        this.encounterOpen = false;
        this.modalContainer = null;
        this.spaceSkipAction = null;
        this.encounterResultModalOpen = false;
        this.armoryRewardChoiceOpen = false;
        this.casinoSessionOrdinal = 0;
        this.lastShopNavigationKey = null;
        this.lastShopNavigationTimestamp = Number.NEGATIVE_INFINITY;
        this.reinforcementFrameAccumulatorMs = 0;
        this.reinforcementSaveAccumulatorMs = 0;
        this.victoryHorse = null;
        this.playerCameraConfigured = false;
        this.playerRollAngle = 0;
        this.reducedMotion = globalThis.matchMedia?.(
            '(prefers-reduced-motion: reduce)'
        ).matches ?? false;

        const provided = this.restartCampaign ?? this.options.initialCampaign;
        this.restartCampaign = undefined;
        if (provided) {
            // Initialization is idempotent and also backfills newly introduced
            // optional services into older in-progress campaign saves.
            this.campaign = initializeLevelContent(provided);
        } else {
            const levelSeed = deriveSeed(
                this.options.seed,
                `level:${MAZE_GENERATOR_ID}`,
                1
            );
            const maze = generateMaze({
                size: INITIAL_MAZE_SIZE,
                topologyRandom: new Mulberry32Random(deriveSeed(levelSeed, 'maze-topology')),
                materialRandom: new Mulberry32Random(deriveSeed(levelSeed, 'wall-materials'))
            });
            this.campaign = initializeLevelContent(createInitialCampaignState({
                campaignSeed: this.options.seed,
                overworldSeed: levelSeed,
                maze,
                levelId: 'level-1'
            }));
        }

        this.mazeGraphics = this.add.graphics().setDepth(0);
        this.drawMaze();
        this.createWallInspector();
        this.drawLandmarks();
        this.createObjectiveVisuals();
        this.createServiceSiteVisuals();
        this.syncWorldVisuals();
        this.playerMarker = this.createPlayerBall();
        this.syncPlayerMarker();

        this.configurePlayerCamera();

        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.scale.on('resize', this.handleScaleResize, this);
        this.applyControlScheme();
        // A finished minigame resumes this scene, which is when the deck has to
        // go back to meaning maze actions.
        this.events.on(Phaser.Scenes.Events.RESUME, this.applyControlScheme, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.scale.off('resize', this.handleScaleResize, this);
            this.events.off(Phaser.Scenes.Events.RESUME, this.applyControlScheme, this);
            getControlDeck(this)?.clearScheme(OVERWORLD_CONTROL_SCHEME.id);
            this.destroyModal();
            delete this.game.canvas.dataset.campaignVictory;
            delete this.game.canvas.dataset.victoryFanfare;
            delete this.game.canvas.dataset.overworldCameraMode;
            delete this.game.canvas.dataset.overworldCameraZoom;
            delete this.game.canvas.dataset.overworldCameraPaddingX;
            delete this.game.canvas.dataset.overworldCameraPaddingY;
            delete this.game.canvas.dataset.overworldPlayerScreenX;
            delete this.game.canvas.dataset.overworldPlayerScreenY;
        });

        const announcement = this.restartAnnouncement;
        this.restartAnnouncement = undefined;
        this.options.onStateChanged(
            this.campaign,
            messageEvent(announcement ?? `Explore the maze. Find ${this.currentObjectiveLabel()}.`)
        );
        this.game.canvas.dataset.campaignVictory = String(
            this.campaign.flags.includes(CAMPAIGN_VICTORY_FLAG)
        );

        if (this.campaign.overworld.pendingDefeatChoice) {
            this.showDefeatChoice();
        } else if (this.campaign.flags.includes(CAMPAIGN_VICTORY_FLAG)) {
            this.showCampaignVictory(false);
        } else if (this.campaign.pendingLevelReward) {
            this.showLevelReward();
        } else if (this.campaign.activeEncounter) {
            this.time.delayedCall(0, () => this.showInterruptedEncounter());
        }
    }

    override update(_time: number, delta: number): void {
        if (
            this.encounterOpen ||
            this.modalContainer ||
            !this.input.enabled ||
            this.campaign.pendingLevelReward ||
            this.campaign.overworld.pendingDefeatChoice
        ) {
            return;
        }
        this.reinforcementFrameAccumulatorMs += Math.max(0, delta);
        if (this.reinforcementFrameAccumulatorMs < 1_000) return;

        const activeElapsedMs = this.reinforcementFrameAccumulatorMs;
        this.reinforcementFrameAccumulatorMs = 0;
        const result = advanceOverworldReinforcements(this.campaign, activeElapsedMs);
        if (result.state === this.campaign) return;

        this.campaign = result.state;
        this.reinforcementSaveAccumulatorMs += activeElapsedMs;
        if (result.spawnedMonsters.length > 0) {
            this.reinforcementSaveAccumulatorMs = 0;
            this.syncWorldVisuals();
            const labels = result.spawnedMonsters.map(monster =>
                MONSTER_DEFINITIONS[monster.typeId].label
            );
            this.emitState(messageEvent(
                labels.length === 1
                    ? `Reinforcement arrived: ${labels[0]}. Defeat it for money.`
                    : `${labels.length} reinforcements entered the maze.`
            ));
            return;
        }
        if (this.reinforcementSaveAccumulatorMs >= 5_000) {
            this.reinforcementSaveAccumulatorMs = 0;
            // Persist the countdown without replacing the player's current
            // live-region message every few frames.
            this.options.onStateChanged(this.campaign);
        }
    }

    /** Points the shared on-screen deck at maze actions. */
    private readonly applyControlScheme = (): void => {
        const deck = getControlDeck(this);
        if (!deck) return;
        deck.setScheme(OVERWORLD_CONTROL_SCHEME, this.handleControlEvent);
        deck.setButtonState('attack', {pressed: this.attackTargeting});
    };

    private readonly handleControlEvent = (event: ControlEvent): void => {
        switch (event.kind) {
            case 'direction':
                if (event.phase === 'press') {
                    this.performControl({kind: 'move', direction: event.direction});
                }
                break;
            case 'quick-slot':
                this.performControl({kind: 'quick-slot', slot: event.slot});
                break;
            case 'button':
                if (event.phase !== 'press') break;
                switch (event.id) {
                    case 'attack':
                        this.performControl({kind: 'attack-toggle'});
                        break;
                    case 'interact':
                        this.performControl({kind: 'interact'});
                        break;
                    case 'wait':
                        this.performControl({kind: 'wait'});
                        break;
                    case 'inventory':
                        this.performControl({kind: 'inventory'});
                        break;
                    case 'menu':
                        this.performControl({kind: 'menu'});
                        break;
                }
                break;
        }
    };

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (this.campaign.overworld.pendingDefeatChoice) {
            if (event.key.toLowerCase() === 'f') this.resolveDefeat('feather');
            if (event.key.toLowerCase() === 'r') this.resolveDefeat('retreat');
            return;
        }
        if (this.campaign.pendingLevelReward) {
            if (this.armoryRewardChoiceOpen) {
                if (event.key === '1') this.chooseLevelReward('armory-equip');
                if (event.key === '2') this.chooseLevelReward('armory-salvage');
                if (event.key === '3') this.chooseLevelReward('armory-leave');
            } else {
                if (event.key === '1') this.chooseLevelReward('repair');
                if (event.key === '2') this.chooseLevelReward('supply');
                if (event.key === '3') this.showArmoryRewardChoices();
            }
            return;
        }
        if (this.modalContainer) {
            if (this.spaceSkipAction && event.key === '2') {
                event.preventDefault();
                this.spaceSkipAction();
            } else if (this.spaceSkipAction && event.key === '1') {
                event.preventDefault();
                this.modalConfirmAction?.();
            } else if (this.encounterResultModalOpen) {
                const action = encounterResultKeyAction(event.key, event.repeat);
                if (action === 'confirm') {
                    event.preventDefault();
                    this.modalConfirmAction?.();
                } else if (action === 'cancel') {
                    event.preventDefault();
                    this.modalCancelAction?.();
                } else if (action === 'consume') {
                    event.preventDefault();
                }
            } else if (
                this.shopPreviousPageAction &&
                (event.key === 'ArrowLeft' || event.key === 'PageUp')
            ) {
                this.handleShopPageNavigation(event, this.shopPreviousPageAction);
            } else if (
                this.shopNextPageAction &&
                (event.key === 'ArrowRight' || event.key === 'PageDown')
            ) {
                this.handleShopPageNavigation(event, this.shopNextPageAction);
            } else if (
                /^[1-4]$/.test(event.key) &&
                this.shopOfferActions[Number(event.key) - 1]
            ) {
                event.preventDefault();
                this.shopOfferActions[Number(event.key) - 1]!();
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.modalConfirmAction?.();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.modalCancelAction?.();
            }
            return;
        }
        if (this.encounterOpen) return;

        const direction = directionForKey(event.key);
        if (direction) {
            event.preventDefault();
            if (this.itemTargetingId) {
                const itemId = this.itemTargetingId;
                this.itemTargetingId = null;
                this.perform({kind: 'use-item', itemId, direction});
            } else if (this.attackTargeting) {
                this.attackTargeting = false;
                this.perform({kind: 'ranged', direction});
            } else {
                this.perform({kind: 'move', direction});
            }
            return;
        }
        switch (event.key.toLowerCase()) {
            case 'f':
                if (this.itemTargetingId) {
                    this.itemTargetingId = null;
                    this.emitState(messageEvent('Item targeting cancelled.'));
                    break;
                }
                this.attackTargeting = !this.attackTargeting;
                this.emitState(messageEvent(this.attackTargeting
                    ? 'Attack targeting: choose a direction. F cancels.'
                    : 'Attack targeting cancelled.'));
                break;
            case 'q':
                this.useQuickSlot();
                break;
            case '1':
            case '2':
            case '3':
                this.useQuickSlot(Number(event.key) - 1);
                break;
            case 'e':
                this.interact();
                break;
            case 'i':
                this.showInventory();
                break;
            case 'h':
                this.showMazeHelp();
                break;
            case '.':
            case ' ':
                event.preventDefault();
                this.perform({kind: 'wait'});
                break;
        }
    };

    private handleShopPageNavigation(event: KeyboardEvent, action: () => void): void {
        event.preventDefault();
        const duplicate = event.repeat || (
            this.lastShopNavigationKey === event.key &&
            event.timeStamp - this.lastShopNavigationTimestamp < 75
        );
        this.lastShopNavigationKey = event.key;
        this.lastShopNavigationTimestamp = event.timeStamp;
        if (!duplicate) action();
    }

    private perform(action: OverworldAction): void {
        const previous = this.campaign;
        const result = resolveOverworldAction(this.campaign, action, {difficulty: 'standard'});
        if (!result.consumedTurn && result.state === this.campaign) {
            const event = result.events.at(-1);
            if (event?.kind === 'choice-required' && action.kind === 'move') {
                this.showPickupChoice(action, event);
            } else {
                this.emitState(event);
            }
            return;
        }
        this.campaign = result.state;
        const minedWall = findMinedWall(previous, result.state);
        this.drawMaze();
        this.syncWorldVisuals();
        this.syncPlayerMarker(
            action.kind === 'move' && !samePosition(
                previous.overworld.playerPosition,
                result.state.overworld.playerPosition
            )
                ? action.direction
                : undefined
        );
        if (minedWall) this.playMiningAnimation(minedWall);
        if (action.kind === 'ranged') {
            this.playProjectileAnimation(
                previous.overworld.playerPosition,
                action.direction,
                result.events
            );
        }
        this.playCombatNumbers(result.events);
        this.emitState(result.events.at(-1));
        if (this.campaign.overworld.pendingDefeatChoice) {
            this.showDefeatChoice();
            return;
        }
        this.checkCurrentCell();
    }

    private cellCenter(position: {readonly x: number; readonly y: number}): {
        readonly x: number;
        readonly y: number;
    } {
        return {
            x: position.x * CELL_SIZE + CELL_SIZE / 2,
            y: position.y * CELL_SIZE + CELL_SIZE / 2
        };
    }

    /**
     * A short pick swing with flying chips, so breaking a wall never looks like
     * walking through it.
     */
    private playMiningAnimation(position: {readonly x: number; readonly y: number}): void {
        const center = this.cellCenter(position);
        const pick = this.add.graphics().setDepth(34);
        pick.lineStyle(3, 0x8d6b45, 1).lineBetween(-9, 9, 6, -6);
        pick.lineStyle(3, 0xd9d7cf, 1).lineBetween(1, -8, 11, -2);
        pick.setPosition(center.x + 6, center.y - 6).setAngle(-40);
        this.tweens.add({
            targets: pick,
            angle: 18,
            duration: 130,
            yoyo: true,
            repeat: 1,
            ease: 'Sine.InOut',
            onComplete: () => pick.destroy()
        });
        for (let index = 0; index < 5; index++) {
            const chip = this.add.rectangle(
                center.x,
                center.y,
                3,
                3,
                0xbdb5a1
            ).setDepth(33);
            const angle = (index / 5) * Math.PI * 2;
            this.tweens.add({
                targets: chip,
                x: center.x + Math.cos(angle) * 16,
                y: center.y + Math.sin(angle) * 16,
                alpha: 0,
                duration: 260,
                ease: 'Quad.Out',
                onComplete: () => chip.destroy()
            });
        }
    }

    /** Flies an arrow from the player to whatever the shot reached. */
    private playProjectileAnimation(
        origin: {readonly x: number; readonly y: number},
        direction: DirectionId,
        events: readonly OverworldEvent[]
    ): void {
        const hit = events.find(event =>
            event.kind === 'monster-damaged' || event.kind === 'monster-defeated'
        );
        const vector = DIRECTION_VECTORS[direction];
        const target = hit && 'position' in hit
            ? hit.position
            : {
                x: origin.x + vector.x * this.rangedTravelCells(origin, direction),
                y: origin.y + vector.y * this.rangedTravelCells(origin, direction)
            };
        const from = this.cellCenter(origin);
        const to = this.cellCenter(target);
        const arrow = this.add.sprite(from.x, from.y, 'item-sprites', ITEM_SPRITES['arrow-bundle'])
            .setDepth(35)
            .setDisplaySize(18, 18)
            .setRotation(Math.atan2(vector.y, vector.x));
        this.tweens.add({
            targets: arrow,
            x: to.x,
            y: to.y,
            duration: Math.max(90, Math.hypot(to.x - from.x, to.y - from.y) * 2.2),
            ease: 'Linear',
            onComplete: () => arrow.destroy()
        });
    }

    /** How far a fired shot visibly travels when it hits nothing. */
    private rangedTravelCells(
        origin: {readonly x: number; readonly y: number},
        direction: DirectionId
    ): number {
        const vector = DIRECTION_VECTORS[direction];
        const limit = getWeaponStats(this.campaign.player).range;
        let travelled = 0;
        for (let step = 1; step <= limit; step++) {
            const cell = this.campaign.overworld.maze[origin.y + vector.y * step]
                ?.[origin.x + vector.x * step];
            if (cell?.kind !== 'passage') break;
            travelled = step;
        }
        return Math.max(1, travelled);
    }

    /**
     * Floating damage numbers in both directions, so the danger of a given
     * monster is legible from one exchange rather than inferred over a run.
     */
    private playCombatNumbers(events: readonly OverworldEvent[]): void {
        for (const event of events) {
            if (
                event.kind !== 'monster-damaged' &&
                event.kind !== 'player-damaged' &&
                event.kind !== 'monster-defeated'
            ) {
                continue;
            }
            const dealtToMonster = event.kind !== 'player-damaged';
            const amount = event.kind === 'monster-defeated'
                ? `$${event.moneyDropped}`
                : `-${event.amount}`;
            const center = this.cellCenter(event.position);
            const label = this.add.text(center.x, center.y - 6, amount, {
                color: event.kind === 'monster-defeated'
                    ? '#efc75e'
                    : dealtToMonster ? '#f5f0df' : '#ff8a80',
                backgroundColor: 'rgba(23,25,24,0.72)',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                fontStyle: 'bold',
                padding: {x: 3, y: 1}
            }).setOrigin(0.5).setDepth(40);
            this.tweens.add({
                targets: label,
                y: center.y - 24,
                alpha: 0,
                duration: 700,
                ease: 'Quad.Out',
                onComplete: () => label.destroy()
            });
        }
    }

    private showPickupChoice(
        move: Extract<OverworldAction, {kind: 'move'}>,
        event: Extract<OverworldEvent, {kind: 'choice-required'}>
    ): void {
        this.destroyModal();
        this.emitState(event);
        const height = Math.min(430, 160 + event.options.length * 52);
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 540, height, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -height / 2 + 36, 'LOOT CHOICE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -height / 2 + 72, event.message, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            align: 'center',
            wordWrap: {width: 475}
        }).setOrigin(0.5));

        const choose = (optionId: string): void => {
            const replacementChoice = optionId.startsWith('equip-')
                ? optionId.slice('equip-'.length) as 'store' | 'salvage' | 'leave'
                : undefined;
            const choice = optionId === 'equip' || replacementChoice
                ? 'equip'
                : optionId as 'salvage' | 'leave' | ItemChoiceId;
            this.destroyModal();
            this.perform({
                ...move,
                pickup: {
                    itemId: event.itemId,
                    choice,
                    ...(replacementChoice ? {replacementChoice} : {})
                }
            });
        };
        event.options.forEach((option, index) => {
            const y = -height / 2 + 118 + index * 48;
            const button = this.add.text(0, y, option.label, {
                color: '#f5f0df',
                backgroundColor: option.id === 'leave' ? '#806b4f' : '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                align: 'center',
                padding: {x: 14, y: 9},
                fixedWidth: 450
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', () => choose(option.id));
            container.add(button);
        });
        this.activateModal(container);
        this.modalConfirmAction = event.options[0]
            ? () => choose(event.options[0]!.id)
            : null;
        const leave = event.options.find(option => option.id === 'leave');
        this.modalCancelAction = leave ? () => choose(leave.id) : () => this.destroyModal();
    }

    private useQuickSlot(slot = 0): void {
        const itemId = this.campaign.player.quickSlotItemIds[slot] ??
            this.campaign.player.backpack.find(item =>
                ['health-potion', 'antidote'].includes(item.baseTypeId)
            )?.id;
        if (!itemId) {
            this.emitState(messageEvent(`No item is assigned to quick slot ${slot + 1}.`));
            return;
        }
        this.perform({kind: 'use-item', itemId});
    }

    private interact(): void {
        const objective = this.objectiveAtPlayer();
        if (objective) {
            const status = getObjectiveStatus(this.campaign.flags, objective.objectiveId);
            if (status === 'locked') {
                this.emitState(messageEvent(objectiveLockedMessage(objective.objectiveId)));
                return;
            }
            if (status === 'available') {
                if (objective.objectiveId === 'space') this.showSpaceOptions(objective);
                else this.openEncounter(objective);
                return;
            }
            this.showSanctuaryService(objective.objectiveId);
            return;
        }

        const serviceSite = this.serviceSiteAtPlayer();
        if (serviceSite) {
            if (serviceSite.kind === 'shop') {
                this.showShop();
            } else {
                this.openCasino(serviceSite);
            }
            return;
        }

        const adjacentTrap = this.campaign.overworld.traps.find(trap => {
            const distance = Math.abs(trap.position.x - this.campaign.overworld.playerPosition.x) +
                Math.abs(trap.position.y - this.campaign.overworld.playerPosition.y);
            return distance === 1 && trap.revealed && !trap.disabled;
        });
        if (adjacentTrap) {
            const direction = Object.entries(DIRECTION_VECTORS).find(([, vector]) =>
                this.campaign.overworld.playerPosition.x + vector.x === adjacentTrap.position.x &&
                this.campaign.overworld.playerPosition.y + vector.y === adjacentTrap.position.y
            )?.[0] as DirectionId | undefined;
            if (direction) this.perform({kind: 'disarm', direction});
            return;
        }
        this.emitState(messageEvent('Nothing here needs interaction.'));
    }

    private showSanctuaryService(objectiveId: ObjectiveId): void {
        const claims = this.campaign.overworld.sanctuaryServiceClaims;
        const unclaimed = this.campaign.overworld.objectives.find(placement => {
            const definition = OBJECTIVE_BY_ID[placement.objectiveId];
            return this.campaign.flags.includes(definition.completionFlag) &&
                !claims.includes(definition.id);
        })?.objectiveId;
        if (!unclaimed) {
            this.emitState(messageEvent('This sanctuary has no unused service.'));
            return;
        }
        this.destroyModal();
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, 270, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -92, 'SANCTUARY SERVICE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -52,
            `Spend the ${OBJECTIVE_BY_ID[unclaimed].label} entitlement.`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '16px'
            }
        ).setOrigin(0.5));
        const choose = (service: 'heal' | 'recharge'): void => {
            this.destroyModal();
            this.perform({kind: 'claim-sanctuary-service', objectiveId, service});
        };
        const heal = this.add.text(0, 0, 'RESTORE 2 HEALTH · 2 SCRAP', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            padding: {x: 16, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const recharge = this.add.text(0, 55, 'RESTORE 1 UTILITY CHARGE · 3 SCRAP', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            padding: {x: 16, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const close = this.add.text(0, 103, 'CANCEL', {
            color: '#f5f0df',
            backgroundColor: '#806b4f',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            padding: {x: 14, y: 8}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        heal.on('pointerdown', () => choose('heal'));
        recharge.on('pointerdown', () => choose('recharge'));
        close.on('pointerdown', () => this.destroyModal());
        container.add([heal, recharge, close]);
        this.activateModal(container);
        this.modalConfirmAction = () => choose('heal');
        this.modalCancelAction = () => this.destroyModal();
    }

    private spaceSkipFailureMessage(reason: SpaceObjectiveSkipFailureReason): string {
        switch (reason) {
            case 'objective-locked':
                return 'Space clearance cannot be purchased until Pipe and Lock are complete.';
            case 'objective-already-completed':
                return 'The Orbital Corridor is already cleared.';
            case 'insufficient-funds':
                return `Space clearance costs $${SPACE_OBJECTIVE_SKIP_COST}. ` +
                    'Defeat reinforcements or play a card table to earn more.';
        }
    }

    private showSpaceOptions(placement: LevelObjectivePlacement): void {
        this.destroyModal();
        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(500);
        container.add(this.add.rectangle(0, 0, 540, 350, 0x101b2b, 0.98)
            .setStrokeStyle(3, 0x69e4ff));
        container.add(this.add.text(0, -132, 'ORBITAL CORRIDOR', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -89,
            `Wallet $${this.campaign.player.money}`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '18px'
            }
        ).setOrigin(0.5));
        container.add(this.add.text(0, -51,
            'Fly the mission, or purchase a one-level flight clearance.\n' +
            'Either choice completes Space toward this level’s exit requirement.',
            {
                color: '#d8e9f2',
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                align: 'center',
                lineSpacing: 5
            }
        ).setOrigin(0.5));

        const play = (): void => {
            this.destroyModal();
            this.openEncounter(placement);
        };
        const skip = (): void => {
            const result = purchaseSpaceObjectiveSkip(this.campaign);
            if (!result.ok) {
                this.emitState(messageEvent(this.spaceSkipFailureMessage(result.reason)));
                return;
            }
            this.campaign = {
                ...result.state,
                overworld: {
                    ...result.state.overworld,
                    sanctuaryPosition: placement.position,
                    resumeGraceTurns: 1
                }
            };
            this.destroyModal();
            this.syncWorldVisuals();
            this.syncPlayerMarker();
            this.emitState(messageEvent(
                `Space clearance purchased for $${SPACE_OBJECTIVE_SKIP_COST}. ` +
                'Space is complete for this level.'
            ));
            this.showEncounterResult(placement, {status: 'success'});
        };
        const addOption = (
            y: number,
            label: string,
            color: string,
            action: () => void
        ): void => {
            const button = this.add.text(0, y, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                padding: {x: 16, y: 11},
                fixedWidth: 430
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
        };
        addOption(25, '1 · FLY THE SPACE MISSION', '#382f54', play);
        addOption(
            86,
            `2 · PAY $${SPACE_OBJECTIVE_SKIP_COST} TO SKIP`,
            this.campaign.player.money >= SPACE_OBJECTIVE_SKIP_COST ? '#3b654a' : '#66343a',
            skip
        );
        addOption(143, 'ESC · NOT YET', '#806b4f', () => this.destroyModal());

        this.activateModal(container);
        this.modalConfirmAction = play;
        this.modalCancelAction = () => this.destroyModal();
        this.spaceSkipAction = skip;
        this.game.canvas.dataset.spaceOptionsOpen = 'true';
        this.game.canvas.dataset.spaceSkipAffordable = String(
            this.campaign.player.money >= SPACE_OBJECTIVE_SKIP_COST
        );
    }

    private shopFailureMessage(
        reason: ShopPurchaseFailureReason,
        offerId: string | null
    ): string {
        switch (reason) {
            case 'unknown-offer':
                return 'That offer is no longer available.';
            case 'insufficient-funds':
                return 'Not enough money. Monsters and card tables can replenish your wallet.';
            case 'inventory-full':
                return 'Your backpack is full. Salvage or use something before buying.';
            case 'already-owned':
                return offerId === 'getaway-car'
                    ? 'Getaway Car already owned. Casino Heist is unlocked.'
                    : 'That permanent upgrade is already installed.';
            case 'upgrade-at-cap':
                return 'That upgrade is already at its maximum.';
        }
    }

    private showShop(page = 0): void {
        this.destroyModal();
        const pageSize = 4;
        const pageCount = Math.ceil(SHOP_CATALOG.length / pageSize);
        const boundedPage = Phaser.Math.Clamp(page, 0, pageCount - 1);
        const offers = SHOP_CATALOG.slice(
            boundedPage * pageSize,
            boundedPage * pageSize + pageSize
        );
        const carOwned = this.campaign.flags.includes(CASINO_HEIST_UNLOCK_FLAG);
        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(500);
        container.add(this.add.rectangle(0, 0, 574, 618, 0x171918, 0.98)
            .setStrokeStyle(3, 0xd7a64a));
        container.add(this.add.text(0, -274, 'WANDERING SHOP', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -238,
            `Wallet $${this.campaign.player.money}  ·  Page ${boundedPage + 1}/${pageCount}`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                wordWrap: {width: 440}
            }
        ).setOrigin(0.5));

        const buy = (offerId: string): void => {
            const price = getShopOfferPrice(this.campaign, offerId);
            const result = purchaseShopOffer(this.campaign, offerId);
            if (!result.ok) {
                this.emitState(messageEvent(
                    this.shopFailureMessage(result.reason, result.offer?.id ?? null)
                ));
                return;
            }
            this.campaign = result.state;
            this.emitState(messageEvent(
                `${result.offer.label} purchased for $${price ?? result.offer.price}.`
            ));
            this.showShop(boundedPage);
        };

        offers.forEach((offer, index) => {
            const y = -170 + index * 102;
            const owned = offer.kind === 'upgrade'
                ? this.campaign.player.installedModuleIds.includes(offer.upgradeId)
                : offer.id === 'getaway-car' && carOwned;
            const price = getShopOfferPrice(this.campaign, offer.id) ?? offer.price;
            const affordable = this.campaign.player.money >= price;
            const button = this.add.text(0, y,
                `${index + 1} · ${offer.label}  ·  ${owned ? 'OWNED' : `$${price}`}`,
                {
                    color: owned ? '#b6bac2' : '#f5f0df',
                    backgroundColor: owned
                        ? '#424646'
                        : affordable ? '#382f54' : '#66343a',
                    fontFamily: 'Georgia, serif',
                    fontSize: '17px',
                    align: 'center',
                    padding: {x: 14, y: 9},
                    fixedWidth: 500
                }
            ).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            const description = this.add.text(0, y + 37, offer.description, {
                color: '#d8d2c4',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                align: 'center',
                wordWrap: {width: 500}
            }).setOrigin(0.5);
            button.on('pointerdown', () => buy(offer.id));
            container.add([button, description]);
        });

        const sellButton = this.add.text(215, -274, 'SELL ▸', {
            color: '#f5f0df',
            backgroundColor: '#3f5b3a',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            padding: {x: 12, y: 8}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        sellButton.on('pointerdown', () => this.showShopSelling());
        container.add(sellButton);

        const addFooterButton = (
            x: number,
            label: string,
            action: () => void,
            color = '#382f54'
        ): Phaser.GameObjects.Text => {
            const button = this.add.text(x, 270, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                padding: {x: 14, y: 9}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
            return button;
        };
        const previousPage = () =>
            this.showShop((boundedPage - 1 + pageCount) % pageCount);
        const nextPage = () =>
            this.showShop((boundedPage + 1) % pageCount);
        addFooterButton(-185, '◀ PREV', previousPage);
        addFooterButton(185, 'NEXT ▶', nextPage);
        addFooterButton(0, 'CLOSE', () => this.destroyModal(), '#806b4f');

        this.activateModal(container);
        this.modalConfirmAction = offers[0] ? () => buy(offers[0]!.id) : null;
        this.modalCancelAction = () => this.destroyModal();
        this.shopPreviousPageAction = previousPage;
        this.shopNextPageAction = nextPage;
        this.shopOfferActions = offers.map(offer => () => buy(offer.id));
        this.game.canvas.dataset.shopOpen = 'true';
        this.game.canvas.dataset.shopMode = 'buy';
        this.game.canvas.dataset.shopPage = String(boundedPage);
        this.game.canvas.dataset.shopCarOwned = String(carOwned);
    }

    /**
     * The shop's sell counter. Salvage finally has a purpose here, and carried
     * loot can be turned into money instead of being abandoned on the floor.
     */
    private showShopSelling(page = 0): void {
        this.destroyModal();
        const player = this.campaign.player;
        const sellable = player.backpack.filter(item =>
            !player.quickSlotItemIds.includes(item.id)
        );
        const pageSize = 4;
        const pageCount = Math.max(1, Math.ceil(sellable.length / pageSize));
        const boundedPage = Phaser.Math.Clamp(page, 0, pageCount - 1);
        const rows = sellable.slice(
            boundedPage * pageSize,
            boundedPage * pageSize + pageSize
        );
        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(500);
        container.add(this.add.rectangle(0, 0, 574, 618, 0x171918, 0.98)
            .setStrokeStyle(3, 0x6fae63));
        container.add(this.add.text(0, -274, 'SELL COUNTER', {
            color: '#a9e39a',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -238,
            `Wallet $${player.money}  ·  Salvage ${player.scrap}  ·  ` +
            `Page ${boundedPage + 1}/${pageCount}`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                wordWrap: {width: 440}
            }
        ).setOrigin(0.5));

        const actions: (() => void)[] = [];
        const addRow = (
            index: number,
            label: string,
            detail: string,
            enabled: boolean,
            action: () => void
        ): void => {
            const y = -186 + index * 84;
            const button = this.add.text(0, y, label, {
                color: enabled ? '#f5f0df' : '#b6bac2',
                backgroundColor: enabled ? '#3f5b3a' : '#424646',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                padding: {x: 14, y: 9},
                fixedWidth: 500
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            const description = this.add.text(0, y + 33, detail, {
                color: '#d8d2c4',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                align: 'center',
                wordWrap: {width: 500}
            }).setOrigin(0.5);
            if (enabled) button.on('pointerdown', action);
            container.add([button, description]);
            actions.push(enabled ? action : () => undefined);
        };

        const sellAllScrap = (): void => {
            const result = sellScrap(this.campaign, this.campaign.player.scrap);
            if (!result.ok) {
                this.emitState(messageEvent('You are carrying no salvage to sell.'));
                return;
            }
            this.campaign = result.state;
            this.emitState(messageEvent(`Sold salvage for $${result.paid}.`));
            this.showShopSelling(boundedPage);
        };
        addRow(
            0,
            `1 · SELL ALL SALVAGE  ·  $${getScrapSaleValue(player.scrap)}`,
            player.scrap > 0
                ? `${player.scrap} salvage at $2 each.`
                : 'Mine walls and break down loot to earn salvage.',
            player.scrap > 0,
            sellAllScrap
        );

        rows.slice(0, 3).forEach((item, index) => {
            const definition = ITEM_DEFINITIONS[item.baseTypeId];
            const value = getItemSaleValue(item);
            addRow(
                index + 1,
                `${index + 2} · ${definition.label}` +
                `${item.quantity > 1 ? ` ×${item.quantity}` : ''}  ·  $${value}`,
                `${item.quality}${item.affixIds.length ? ` · ${item.affixIds.join(', ')}` : ''}`,
                true,
                () => {
                    const result = sellBackpackItem(this.campaign, item.id);
                    if (!result.ok) {
                        this.emitState(messageEvent(
                            result.reason === 'quick-slot-item'
                                ? 'Clear that quick slot before selling the item.'
                                : 'That item is no longer in your pack.'
                        ));
                        return;
                    }
                    this.campaign = result.state;
                    this.emitState(messageEvent(
                        `Sold ${definition.label} for $${result.paid}.`
                    ));
                    this.showShopSelling(boundedPage);
                }
            );
        });
        if (sellable.length === 0) {
            container.add(this.add.text(0, 20,
                'Nothing else in your pack can be sold.\n' +
                'Quick-slotted items stay with you.',
                {
                    color: '#d8d2c4',
                    fontFamily: 'Georgia, serif',
                    fontSize: '15px',
                    align: 'center'
                }
            ).setOrigin(0.5));
        }

        const addFooterButton = (
            x: number,
            label: string,
            action: () => void,
            color = '#382f54'
        ): void => {
            const button = this.add.text(x, 270, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                padding: {x: 14, y: 9}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
        };
        const previousPage = () =>
            this.showShopSelling((boundedPage - 1 + pageCount) % pageCount);
        const nextPage = () =>
            this.showShopSelling((boundedPage + 1) % pageCount);
        addFooterButton(-185, '◀ PREV', previousPage);
        addFooterButton(185, 'NEXT ▶', nextPage);
        addFooterButton(0, 'CLOSE', () => this.destroyModal(), '#806b4f');
        const buyButton = this.add.text(-215, -274, '◂ BUY', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            padding: {x: 12, y: 8}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        buyButton.on('pointerdown', () => this.showShop());
        container.add(buyButton);

        this.activateModal(container);
        this.modalConfirmAction = actions[0] ?? null;
        this.modalCancelAction = () => this.destroyModal();
        this.shopPreviousPageAction = previousPage;
        this.shopNextPageAction = nextPage;
        this.shopOfferActions = actions;
        this.game.canvas.dataset.shopOpen = 'true';
        this.game.canvas.dataset.shopMode = 'sell';
        this.game.canvas.dataset.shopPage = String(boundedPage);
    }

    private openCasino(site: LevelServicePlacement): void {
        if (this.encounterOpen || site.kind === 'shop') return;
        const definition = SERVICE_SITE_DEFINITIONS[site.kind];
        const sessionSeed = deriveSeed(
            this.campaign.overworld.seed,
            `${site.id}:session:${this.campaign.overworld.turn}:${this.campaign.player.money}`,
            this.casinoSessionOrdinal++
        );
        const onBankrollChanged = (bankroll: number, message: string): void => {
            if (!Number.isSafeInteger(bankroll) || bankroll < 0) {
                throw new Error('Casino bankroll must remain a non-negative safe integer.');
            }
            this.campaign = {
                ...this.campaign,
                player: {...this.campaign.player, money: bankroll}
            };
            this.emitState(messageEvent(message));
        };
        const onExit = (): void => {
            this.encounterOpen = false;
            this.input.enabled = true;
            this.options.onEncounterChanged(null);
            this.scene.resume();
            this.emitState(messageEvent(
                `${definition.label} closed. Wallet $${this.campaign.player.money}.`
            ));
        };

        this.encounterOpen = true;
        this.input.enabled = false;
        this.options.onEncounterChanged(site.kind);
        if (site.kind === 'blackjack') {
            const launch: BlackjackLaunchData = {
                seed: sessionSeed,
                bankroll: this.campaign.player.money,
                onBankrollChanged,
                onExit
            };
            this.scene.launch(BLACKJACK_SCENE_KEY, launch);
        } else {
            const launch: HoldemLaunchData = {
                seed: sessionSeed,
                bankroll: this.campaign.player.money,
                onBankrollChanged,
                onExit
            };
            this.scene.launch(HOLDEM_SCENE_KEY, launch);
        }
        this.scene.pause();
    }

    private checkCurrentCell(): void {
        const objective = this.objectiveAtPlayer();
        if (objective) {
            const status = getObjectiveStatus(this.campaign.flags, objective.objectiveId);
            if (status === 'available') {
                if (objective.objectiveId === 'space') this.showSpaceOptions(objective);
                else this.openEncounter(objective);
            }
            else if (status === 'locked') {
                this.emitState(messageEvent(objectiveLockedMessage(objective.objectiveId)));
            }
            return;
        }
        const serviceSite = this.serviceSiteAtPlayer();
        if (serviceSite) {
            const definition = SERVICE_SITE_DEFINITIONS[serviceSite.kind];
            this.emitState(messageEvent(
                `${definition.label}. Press E or tap E to ${
                    serviceSite.kind === 'shop' ? 'browse' : 'play'
                }. Optional — the exit does not require it.`
            ));
            return;
        }
        if (this.hasReachedExit()) this.handleExit();
    }

    private objectiveAtPlayer(): LevelObjectivePlacement | null {
        return this.campaign.overworld.objectives.find(objective =>
            samePosition(objective.position, this.campaign.overworld.playerPosition)
        ) ?? null;
    }

    private serviceSiteAtPlayer(): LevelServicePlacement | null {
        return this.campaign.overworld.serviceSites.find(site =>
            samePosition(site.position, this.campaign.overworld.playerPosition)
        ) ?? null;
    }

    private currentObjectiveLabel(): string {
        return getCurrentObjective(this.campaign)?.label ?? 'the exit';
    }

    private attemptOrdinal(triggerId: string): number {
        return this.campaign.encounterHistory.filter(entry => entry.triggerId === triggerId).length;
    }

    private encounterSeed(definition: ObjectiveDefinition, ordinal: number): number {
        const namespace = definition.id === 'space'
            ? 'space-attempt'
            : `${definition.id}-attempt`;
        return deriveSeed(this.campaign.overworld.seed, namespace, ordinal);
    }

    private nearbyMaterials(position: {readonly x: number; readonly y: number}): {
        readonly ids: readonly MaterialId[];
        readonly tags: readonly MaterialTag[];
    } {
        const ids = new Set<MaterialId>();
        for (let y = position.y - 2; y <= position.y + 2; y++) {
            for (let x = position.x - 2; x <= position.x + 2; x++) {
                const cell = this.campaign.overworld.maze[y]?.[x];
                if (cell?.kind === 'wall') ids.add(cell.materialId);
            }
        }
        const tags = new Set<MaterialTag>();
        for (const id of ids) for (const tag of MATERIALS[id].tags) tags.add(tag);
        return {ids: [...ids], tags: [...tags]};
    }

    private buildEncounterContext(
        placement: LevelObjectivePlacement,
        record: ActiveEncounterRecord
    ): EncounterContext {
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        const nearby = this.nearbyMaterials(placement.position);
        const baseModifiers: Record<string, string | number | boolean> = {
            levelTier: getLevelTier(this.campaign)
        };
        const bonusTarget = placement.objectiveId === 'space'
            ? 'shooter'
            : placement.objectiveId;
        Object.assign(
            baseModifiers,
            getMinigameItemBonus(this.campaign.player, bonusTarget).modifiers
        );
        if (placement.objectiveId === 'pipe' && this.campaign.overworld.pipeShortcutWall) {
            baseModifiers.benefitX = this.campaign.overworld.pipeShortcutWall.x;
            baseModifiers.benefitY = this.campaign.overworld.pipeShortcutWall.y;
        }
        if (placement.objectiveId === 'lock') {
            baseModifiers.lockFamily = selectLockFamily(
                getCampaignLevelNumber(this.campaign),
                record.attemptOrdinal
            );
        }
        if (placement.objectiveId === 'space') {
            baseModifiers.poweredShield = this.campaign.flags.includes('coolant-routing-restored');
            baseModifiers.archiveIntel = this.campaign.flags.includes('archive-lock-opened');
            baseModifiers.securityAlert = this.campaign.worldSystems.securityAlert;
        }
        if (placement.objectiveId === 'platformer') {
            baseModifiers.toolBridge = this.campaign.player.miningPower >= 2;
            baseModifiers.supplyBridge = this.campaign.worldSystems.airspaceControl >= 60;
            baseModifiers.poweredLift = this.campaign.worldSystems.powerRouting >= 60;
        }
        return {
            runId: record.runId,
            definitionId: definition.definitionId,
            kind: definition.kind,
            act: this.campaign.act,
            seed: record.seed,
            difficulty: 'standard',
            campaignSnapshot: this.campaign,
            trigger: {
                triggerId: definition.triggerId,
                position: placement.position,
                nearbyMaterialIds: nearby.ids,
                nearbyMaterialTags: nearby.tags
            },
            modifiers: baseModifiers
        };
    }

    private openEncounter(
        placement: LevelObjectivePlacement,
        existingRecord?: ActiveEncounterRecord
    ): void {
        if (this.encounterOpen) return;
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        if (getObjectiveStatus(this.campaign.flags, placement.objectiveId) !== 'available') return;
        const ordinal = existingRecord?.attemptOrdinal ?? this.attemptOrdinal(definition.triggerId);
        const record: ActiveEncounterRecord = existingRecord ?? {
            levelId: this.campaign.overworld.levelId,
            objectiveId: placement.objectiveId,
            triggerId: definition.triggerId,
            encounterKind: definition.kind,
            attemptOrdinal: ordinal,
            runId: `${this.campaign.overworld.levelId}/${definition.triggerId}/${ordinal}`,
            seed: this.encounterSeed(definition, ordinal)
        };
        this.campaign = {...this.campaign, activeEncounter: record};
        this.emitState(messageEvent(`${definition.label} started.`));
        this.encounterOpen = true;
        this.input.enabled = false;
        this.options.onEncounterChanged(definition.kind);
        const context = this.buildEncounterContext(placement, record);
        const complete = (result: EncounterResult) =>
            this.completeEncounter(placement.objectiveId, result);

        switch (placement.objectiveId) {
            case 'pipe': {
                const launch: PipeDreamLaunchData = {context, onComplete: complete};
                this.scene.launch(PIPE_DREAM_SCENE_KEY, launch);
                break;
            }
            case 'lock': {
                const family = context.modifiers['lockFamily'] as LockFamily;
                const tutorialFlag = family === 'safe-dial'
                    ? 'tutorial-lock-dial-seen'
                    : family === 'tumbler-relay'
                        ? 'tutorial-lock-tumbler-seen'
                        : 'tutorial-lock-seen';
                const launch: LockpickLaunchData = {
                    context,
                    onComplete: complete,
                    onTutorialSeen: () => {
                        if (this.campaign.flags.includes(tutorialFlag)) return;
                        this.campaign = {
                            ...this.campaign,
                            flags: [...this.campaign.flags, tutorialFlag]
                        };
                        this.emitState(messageEvent('Lock tutorial recorded.'));
                    }
                };
                const sceneKey = family === 'safe-dial'
                    ? SAFE_DIAL_SCENE_KEY
                    : family === 'tumbler-relay'
                        ? TUMBLER_RELAY_SCENE_KEY
                        : LOCKPICK_SCENE_KEY;
                this.scene.launch(sceneKey, launch);
                break;
            }
            case 'space': {
                const launch: ShooterLaunchData = {context, onComplete: complete};
                this.scene.launch(SHOOTER_SCENE_KEY, launch);
                break;
            }
            case 'platformer': {
                const launch: PlatformerLaunchData = {context, onComplete: complete};
                this.scene.launch(PLATFORMER_SCENE_KEY, launch);
                break;
            }
            case 'circuit': {
                const launch: CircuitCrashLaunchData = {context, onComplete: complete};
                this.scene.launch(CIRCUIT_CRASH_SCENE_KEY, launch);
                break;
            }
            case 'horsemaster': {
                const launch: HorsemasterLaunchData = {context, onComplete: complete};
                this.scene.launch(HORSEMASTER_SCENE_KEY, launch);
                break;
            }
            case 'zapper': {
                const launch: ZapperLaunchData = {context, onComplete: complete};
                this.scene.launch(ZAPPER_SCENE_KEY, launch);
                break;
            }
            case 'casino-heist': {
                const launch: CasinoHeistLaunchData = {context, onComplete: complete};
                this.scene.launch(CASINO_HEIST_SCENE_KEY, launch);
                break;
            }
        }
        this.scene.pause();
    }

    private resumeInterruptedEncounter(): void {
        const record = this.campaign.activeEncounter;
        if (!record) return;
        const placement = this.campaign.overworld.objectives.find(objective =>
            objective.objectiveId === record.objectiveId &&
            samePosition(objective.position, this.campaign.overworld.playerPosition)
        );
        if (!placement) {
            this.campaign = {...this.campaign, activeEncounter: null};
            this.emitState(messageEvent('Interrupted attempt was invalid and has been cleared.'));
            return;
        }
        this.openEncounter(placement, record);
    }

    private showInterruptedEncounter(): void {
        const record = this.campaign.activeEncounter;
        if (!record) return;
        const definition = OBJECTIVE_BY_ID[record.objectiveId];
        const placement = this.campaign.overworld.objectives.find(objective =>
            objective.objectiveId === record.objectiveId &&
            samePosition(objective.position, this.campaign.overworld.playerPosition)
        );
        if (!placement || definition.triggerId !== record.triggerId) {
            this.campaign = {...this.campaign, activeEncounter: null};
            this.emitState(messageEvent('Interrupted attempt was invalid and has been cleared.'));
            return;
        }

        this.destroyModal();
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, 250, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -78, 'ATTEMPT INTERRUPTED', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '26px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -34,
            `${definition.label} can resume from the same saved seed.`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px'
            }
        ).setOrigin(0.5));
        const retry = this.add.text(-105, 48, 'ENTER · RETRY', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const back = this.add.text(115, 48, 'ESC · RETURN', {
            color: '#f5f0df',
            backgroundColor: '#806b4f',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const retryAttempt = (): void => {
            this.destroyModal();
            this.resumeInterruptedEncounter();
        };
        const returnToMaze = (): void => {
            this.destroyModal();
            const abandoned = applyEncounterResult(this.campaign, {
                runId: record.runId,
                definitionId: definition.definitionId,
                triggerId: record.triggerId,
                kind: record.encounterKind,
                status: 'abandoned',
                grade: 'none',
                score: 0,
                elapsedMs: 0,
                effects: []
            });
            this.campaign = {...abandoned, activeEncounter: null};
            this.emitState(messageEvent(`${definition.label} attempt returned to the maze.`));
        };
        retry.on('pointerdown', retryAttempt);
        back.on('pointerdown', returnToMaze);
        container.add([retry, back]);
        this.activateModal(container);
        this.modalConfirmAction = retryAttempt;
        this.modalCancelAction = returnToMaze;
        this.game.canvas.dataset.encounterOverlay = 'interrupted';
    }

    private showEncounterResult(
        placement: LevelObjectivePlacement,
        result: Pick<EncounterResult, 'status' | 'failureReason'>
    ): void {
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        this.destroyModal();
        const successful = result.status === 'success';
        const presentation = getEncounterResultPresentation(
            definition.label,
            result,
            getLevelExitStatus(this.campaign).ready
        );
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, successful ? 215 : 260, 0x171918, 0.97)
            .setStrokeStyle(3, successful ? 0x5bbf72 : 0xd83847));
        container.add(this.add.text(0, successful ? -60 : -82,
            presentation.title,
            {
                color: successful ? '#76d58b' : '#efc75e',
                fontFamily: 'Georgia, serif',
                fontSize: '27px'
            }
        ).setOrigin(0.5));
        const detailIsMultiline = presentation.detail.includes('\n');
        container.add(this.add.text(0, successful ? -18 : detailIsMultiline ? -35 : -39,
            presentation.detail,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                lineSpacing: 3,
                wordWrap: {width: 430, useAdvancedWrap: true}
            }
        ).setOrigin(0.5));

        const returnToMaze = (): void => {
            this.destroyModal();
            this.emitState(messageEvent(presentation.returnMessage));
        };
        const continueButton = this.add.text(successful ? 0 : 118, successful ? 45 : 48,
            successful ? 'ENTER · CONTINUE' : 'ESC · RETURN',
            {
                color: '#f5f0df',
                backgroundColor: '#806b4f',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                padding: {x: 16, y: 12}
            }
        ).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        continueButton.on('pointerdown', returnToMaze);
        container.add(continueButton);

        this.modalConfirmAction = returnToMaze;
        this.modalCancelAction = returnToMaze;
        if (!successful) {
            const retryAttempt = (): void => {
                this.destroyModal();
                this.openEncounter(placement);
            };
            const retry = this.add.text(-118, 48, 'ENTER · RETRY', {
                color: '#f5f0df',
                backgroundColor: '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                padding: {x: 16, y: 12}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            retry.on('pointerdown', retryAttempt);
            container.add(retry);
            this.modalConfirmAction = retryAttempt;
        }
        this.activateModal(container);
        this.encounterResultModalOpen = true;
        this.game.canvas.dataset.encounterOverlay = successful ? 'success' : 'retry';
    }

    private completeEncounter(objectiveId: ObjectiveId, result: EncounterResult): void {
        const record = this.campaign.activeEncounter;
        const definition = OBJECTIVE_BY_ID[objectiveId];
        if (
            !record ||
            record.runId !== result.runId ||
            record.objectiveId !== objectiveId ||
            record.triggerId !== result.triggerId ||
            record.encounterKind !== result.kind ||
            definition.definitionId !== result.definitionId
        ) {
            return;
        }
        let next = commitObjectiveResult(this.campaign, objectiveId, result);
        next = {...next, activeEncounter: null};
        if (result.status === 'success') {
            const placement = getObjectivePlacement(next.overworld.objectives, objectiveId);
            next = {
                ...next,
                overworld: {
                    ...next.overworld,
                    sanctuaryPosition: placement.position,
                    resumeGraceTurns: 1,
                    ...(objectiveId === 'pipe' ? {pipeShortcutWall: null} : {})
                }
            };
        } else {
            next = {
                ...next,
                overworld: {...next.overworld, resumeGraceTurns: 1}
            };
        }
        if (next.player.health === 0) {
            next = resolveCampaignDefeat(next, 'encounter').state;
        }
        this.campaign = next;
        this.encounterOpen = false;
        this.input.enabled = true;
        this.options.onEncounterChanged(null);
        this.drawMaze();
        this.syncWorldVisuals();
        this.syncPlayerMarker();
        this.emitState(messageEvent(
            result.status === 'success'
                ? `${OBJECTIVE_BY_ID[objectiveId].label} complete. Sanctuary activated.`
                : `${OBJECTIVE_BY_ID[objectiveId].label} attempt ended. You may retry.`
        ));
        this.scene.resume();
        if (this.campaign.overworld.pendingDefeatChoice) this.showDefeatChoice();
        else this.showEncounterResult(
            getObjectivePlacement(this.campaign.overworld.objectives, objectiveId),
            result
        );
    }

    private handleExit(): void {
        const status = getLevelExitStatus(this.campaign);
        if (!status.ready) {
            this.emitState(messageEvent(
                `Exit locked ${status.completed}/${status.total}. Next: ${status.nextLabel}.`
            ));
            return;
        }
        if (getCampaignLevelNumber(this.campaign) >= MAX_CAMPAIGN_LEVEL) {
            if (!this.campaign.flags.includes(CAMPAIGN_VICTORY_FLAG)) {
                this.campaign = {
                    ...this.campaign,
                    flags: [...this.campaign.flags, CAMPAIGN_VICTORY_FLAG],
                    pendingLevelReward: null
                };
                this.emitState(messageEvent(
                    'All eight trials are complete. The Ultra Horse Gym celebrates your victory!'
                ));
            }
            this.showCampaignVictory(true);
            return;
        }
        if (!this.campaign.pendingLevelReward) {
            this.perform({kind: 'wait'});
            return;
        }
        this.showLevelReward();
    }

    private showCampaignVictory(playFanfare: boolean): void {
        this.destroyModal();
        this.armoryRewardChoiceOpen = false;
        const canvas = this.game.canvas;
        canvas.dataset.campaignVictory = 'true';
        canvas.dataset.victoryOverlay = 'open';
        canvas.dataset.victoryHorse = 'dancing';

        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(600);
        container.add(this.add.rectangle(0, 0, 570, 510, 0x111714, 0.98)
            .setStrokeStyle(4, 0xefc75e));
        container.add(this.add.text(0, -218, 'MAZE MASTERED!', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '34px',
            fontStyle: 'bold'
        }).setOrigin(0.5));
        container.add(this.add.text(
            0,
            -170,
            `LEVEL ${MAX_CAMPAIGN_LEVEL} COMPLETE\nALL EIGHT MINIGAMES CLEARED`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '18px',
                fontStyle: 'bold',
                align: 'center',
                lineSpacing: 5
            }
        ).setOrigin(0.5));

        const gymSign = this.add.rectangle(0, 86, 310, 94, 0x51358f)
            .setStrokeStyle(3, 0xc59cff);
        const gymLabel = this.add.text(0, 86, 'ULTRA HORSE GYM', {
            color: '#fff7df',
            fontFamily: 'Georgia, serif',
            fontSize: '24px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        container.add([gymSign, gymLabel]);
        this.victoryHorse = this.createDancingVictoryHorse();
        container.add(this.victoryHorse);

        const fanfare = this.add.text(-128, 194, '♪ PLAY FANFARE', {
            color: '#171918',
            backgroundColor: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            fontStyle: 'bold',
            padding: {x: 15, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        fanfare.on('pointerdown', () => this.playVictoryFanfare());

        const explore = this.add.text(132, 194, 'ENTER · KEEP EXPLORING', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            padding: {x: 15, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        explore.on('pointerdown', () => this.destroyModal());
        container.add([fanfare, explore]);

        this.activateModal(container);
        this.modalConfirmAction = () => this.destroyModal();
        this.modalCancelAction = () => this.destroyModal();
        if (playFanfare) this.playVictoryFanfare();
    }

    /**
     * The victory horse is the Horsemaster horse at triple scale, drawn from the
     * shared art module, with an animated dance step instead of a static pose.
     */
    private createDancingVictoryHorse(): Phaser.GameObjects.Container {
        const horse = this.add.container(0, -20);
        const art = this.add.graphics();
        const pose = {phase: 0};
        const redraw = (): void => {
            art.clear();
            const swing = Math.sin(pose.phase) * 6;
            drawHorse(art, 0, 0, {
                scale: 3,
                bob: Math.sin(pose.phase * 2) * 1.6,
                headDip: Math.sin(pose.phase) * -2,
                tailSway: swing,
                legOffsets: [swing, -swing, -swing, swing],
                shadow: true
            });
        };
        redraw();
        if (!this.reducedMotion) {
            this.tweens.add({
                targets: pose,
                phase: Math.PI * 2,
                duration: 900,
                repeat: -1,
                ease: 'Linear',
                onUpdate: redraw
            });
        }
        const leftNote = this.add.text(-116, -46, '♪', {
            color: '#67d5e8',
            fontSize: '34px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const rightNote = this.add.text(112, -27, '♫', {
            color: '#ef6f9d',
            fontSize: '34px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        horse.add([art, leftNote, rightNote]);
        this.tweens.add({
            targets: horse,
            y: -35,
            angle: 5,
            duration: 310,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
        this.tweens.add({
            targets: [leftNote, rightNote],
            y: '-=12',
            scale: 1.2,
            alpha: 0.45,
            duration: 440,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
        return horse;
    }

    private playVictoryFanfare(): void {
        const canvas = this.game.canvas;
        canvas.dataset.victoryFanfare = 'attempted';
        type AudioContextConstructor = new (
            contextOptions?: AudioContextOptions
        ) => AudioContext;
        const browserWindow = window as typeof window & {
            readonly webkitAudioContext?: AudioContextConstructor;
        };
        const AudioContextClass: AudioContextConstructor | undefined =
            window.AudioContext ?? browserWindow.webkitAudioContext;
        if (!AudioContextClass) {
            canvas.dataset.victoryFanfare = 'unavailable';
            return;
        }
        try {
            const audio = new AudioContextClass();
            const schedule = (): void => {
                const start = audio.currentTime + 0.03;
                const notes = [
                    {frequency: 523.25, offset: 0, duration: 0.2},
                    {frequency: 659.25, offset: 0.2, duration: 0.2},
                    {frequency: 783.99, offset: 0.4, duration: 0.2},
                    {frequency: 1046.5, offset: 0.6, duration: 0.55},
                    {frequency: 783.99, offset: 1.15, duration: 0.18},
                    {frequency: 987.77, offset: 1.33, duration: 0.18},
                    {frequency: 1318.51, offset: 1.51, duration: 0.72}
                ] as const;
                const master = audio.createGain();
                master.gain.setValueAtTime(0.24, start);
                master.connect(audio.destination);
                let finalOscillator: OscillatorNode | null = null;
                for (const note of notes) {
                    const oscillator = audio.createOscillator();
                    const envelope = audio.createGain();
                    const noteStart = start + note.offset;
                    oscillator.type = 'triangle';
                    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
                    envelope.gain.setValueAtTime(0.0001, noteStart);
                    envelope.gain.exponentialRampToValueAtTime(0.34, noteStart + 0.025);
                    envelope.gain.exponentialRampToValueAtTime(
                        0.0001,
                        noteStart + note.duration
                    );
                    oscillator.connect(envelope);
                    envelope.connect(master);
                    oscillator.start(noteStart);
                    oscillator.stop(noteStart + note.duration + 0.03);
                    finalOscillator = oscillator;
                }
                canvas.dataset.victoryFanfare = 'playing';
                if (finalOscillator) {
                    finalOscillator.addEventListener('ended', () => {
                        canvas.dataset.victoryFanfare = 'played';
                        void audio.close();
                    }, {once: true});
                }
            };
            if (audio.state === 'suspended') {
                void audio.resume().then(schedule).catch(() => {
                    canvas.dataset.victoryFanfare = 'blocked';
                    void audio.close();
                });
            } else {
                schedule();
            }
        } catch {
            canvas.dataset.victoryFanfare = 'unavailable';
        }
    }

    private showLevelReward(): void {
        this.destroyModal();
        this.armoryRewardChoiceOpen = false;
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, 300, 0x171918, 0.96)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -110, 'LEVEL COMPLETE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '28px'
        }).setOrigin(0.5));
        const choices = [
            {id: 'repair' as const, label: '1 · REPAIR  +5 health and Potion'},
            {id: 'supply' as const, label: '2 · SUPPLY  tools, arrows, utility'},
            {id: 'armory' as const, label: '3 · ARMORY  inspect rolled equipment'}
        ];
        choices.forEach((choice, index) => {
            const button = this.add.text(0, -45 + index * 62, choice.label, {
                color: '#f5f0df',
                backgroundColor: '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '18px',
                padding: {x: 16, y: 12}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', () => {
                if (choice.id === 'armory') this.showArmoryRewardChoices();
                else this.chooseLevelReward(choice.id);
            });
            container.add(button);
        });
        this.activateModal(container);
    }

    private showArmoryRewardChoices(): void {
        const reward = this.campaign.pendingLevelReward;
        if (!reward) return;
        this.destroyModal();
        this.armoryRewardChoiceOpen = true;
        const offer = reward.armoryOffer;
        const definition = ITEM_DEFINITIONS[offer.baseTypeId];
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 520, 315, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -112, 'ARMORY OFFER', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        const offerStats = getItemWeaponStats(offer);
        const equippedStats = getWeaponStats(this.campaign.player);
        const weaponLine = ITEM_DEFINITIONS[offer.baseTypeId].category === 'weapon'
            ? `\n${describeWeaponStats(offerStats)}` +
                `\nvs ${equippedStats.label}: ` +
                `${describeWeaponComparison(equippedStats, offerStats)}`
            : '';
        container.add(this.add.text(0, -70,
            `${definition.label} · ${offer.quality.toUpperCase()}\n` +
            `${offer.affixIds.length ? offer.affixIds.join(', ') : 'No affixes'}` +
            weaponLine,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                align: 'center'
            }
        ).setOrigin(0.5));
        const choices = [
            {id: 'armory-equip' as const, label: '1 · EQUIP'},
            {id: 'armory-salvage' as const, label: '2 · SALVAGE'},
            {id: 'armory-leave' as const, label: '3 · LEAVE'}
        ];
        choices.forEach((choice, index) => {
            const button = this.add.text(0, -10 + index * 58, choice.label, {
                color: '#f5f0df',
                backgroundColor: choice.id === 'armory-leave' ? '#806b4f' : '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                padding: {x: 18, y: 11},
                fixedWidth: 330,
                align: 'center'
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', () => this.chooseLevelReward(choice.id));
            container.add(button);
        });
        this.activateModal(container);
    }

    private chooseLevelReward(
        choice:
            | 'repair'
            | 'supply'
            | 'armory-equip'
            | 'armory-salvage'
            | 'armory-leave'
    ): void {
        const result = resolveOverworldAction(this.campaign, {
            kind: 'choose-level-reward',
            choice
        });
        if (result.state === this.campaign) {
            this.emitState(result.events.at(-1));
            return;
        }
        const next = result.state;
        this.restartCampaign = next;
        this.restartAnnouncement =
            `Entered level ${getCampaignLevelNumber(next)} with ${choice.replaceAll('-', ' ')}.`;
        this.armoryRewardChoiceOpen = false;
        this.destroyModal();
        this.options.onStateChanged(next, result.events.at(-1));
        this.scene.restart();
    }

    private showDefeatChoice(): void {
        this.destroyModal();
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 460, 220, 0x171918, 0.96)
            .setStrokeStyle(3, 0xd83847));
        container.add(this.add.text(0, -70, 'DEFEATED', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '28px'
        }).setOrigin(0.5));
        const feather = this.add.text(0, -5, 'F · Use Revival Feather', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontSize: '18px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const retreat = this.add.text(0, 55, 'R · Retreat to sanctuary', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontSize: '18px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        feather.on('pointerdown', () => this.resolveDefeat('feather'));
        retreat.on('pointerdown', () => this.resolveDefeat('retreat'));
        container.add([feather, retreat]);
        this.activateModal(container);
    }

    private resolveDefeat(choice: 'feather' | 'retreat'): void {
        const result = resolveOverworldAction(this.campaign, {kind: 'resolve-defeat', choice});
        this.campaign = result.state;
        this.destroyModal();
        this.input.enabled = true;
        this.syncWorldVisuals();
        this.syncPlayerMarker();
        this.emitState(result.events.at(-1));
    }

    private showInventory(selectedIndex = 0): void {
        this.destroyModal();
        const items = this.campaign.player.backpack;
        const boundedIndex = items.length === 0
            ? 0
            : Phaser.Math.Clamp(selectedIndex, 0, items.length - 1);
        const selected = items[boundedIndex] ?? null;
        const utility = this.campaign.player.equippedUtility;
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 520, 430, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        const equippedStats = getWeaponStats(this.campaign.player);
        const selectedIsWeapon = selected !== null &&
            ITEM_DEFINITIONS[selected.baseTypeId].category === 'weapon';
        const selectedStats = selectedIsWeapon ? getItemWeaponStats(selected) : null;
        container.add(this.add.text(-225, -188,
            [
                'INVENTORY',
                // Spelling out damage and reach here is what makes swapping
                // weapons a decision rather than a guess.
                `Weapon: ${describeWeaponStats(equippedStats, {
                    ammo: this.campaign.player.bowAmmo
                })}`,
                `Utility: ${utility ? ITEM_DEFINITIONS[utility.baseTypeId].label : 'None'}`,
                `Money $${this.campaign.player.money}  ·  Arrows ${this.campaign.player.bowAmmo}` +
                    `  ·  Slots ${items.length}/${this.campaign.player.backpackCapacity}`,
                '',
                selected
                    ? `${boundedIndex + 1}/${items.length}  ${ITEM_DEFINITIONS[selected.baseTypeId].label}`
                    : 'No item selected',
                selected
                    ? `${selected.quality.toUpperCase()}  ×${selected.quantity}` +
                        `${selected.charges === null ? '' : `  ·  ${selected.charges} charges`}`
                    : 'Backpack empty',
                selectedStats
                    ? `${describeWeaponStats(selectedStats)}  ·  vs equipped: ` +
                        `${describeWeaponComparison(equippedStats, selectedStats)}`
                    : '',
                selected?.affixIds.length
                    ? `Affixes: ${selected.affixIds.join(', ')}`
                    : selected ? 'Affixes: none' : '',
                selected?.baseTypeId === 'mystery-orb'
                    ? `Orb choices: ${selected.rolledChoiceIds.join(', ')}`
                    : ''
            ].filter((line, index) => line !== '' || index === 4).join('\n'),
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '16px',
                lineSpacing: 5,
                wordWrap: {width: 450}
            }
        ));

        const addButton = (
            x: number,
            y: number,
            label: string,
            action: () => void,
            color = '#382f54'
        ): void => {
            const button = this.add.text(x, y, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                padding: {x: 12, y: 10}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
        };

        if (items.length > 1) {
            addButton(-175, 45, '◀ PREV', () =>
                this.showInventory((boundedIndex - 1 + items.length) % items.length));
            addButton(175, 45, 'NEXT ▶', () =>
                this.showInventory((boundedIndex + 1) % items.length));
        }
        if (selected) {
            const definition = ITEM_DEFINITIONS[selected.baseTypeId];
            if (definition.category === 'weapon' || definition.category === 'utility') {
                addButton(-155, 105, 'EQUIP', () => {
                    this.destroyModal();
                    this.perform({kind: 'equip', itemId: selected.id});
                });
            } else if (selected.baseTypeId !== 'mystery-orb') {
                addButton(-155, 105, 'USE', () => {
                    this.destroyModal();
                    if (selected.baseTypeId === 'bomb' || selected.baseTypeId === 'snare-kit') {
                        this.itemTargetingId = selected.id;
                        this.emitState(messageEvent(
                            `Choose a direction for ${definition.label}. F cancels.`
                        ));
                    } else {
                        this.perform({kind: 'use-item', itemId: selected.id});
                    }
                });
            }
            addButton(155, 105, 'SALVAGE', () => {
                this.destroyModal();
                this.perform({kind: 'salvage', itemId: selected.id});
            });
            const quickUsable = [
                'health-potion',
                'antidote',
                'fire-ward',
                'ice-ward',
                'lightning-ward',
                'map-scroll',
                'mining-pick',
                'ammo-bundle'
            ].includes(selected.baseTypeId);
            if (quickUsable) {
                for (let slot = 0; slot < 3; slot++) {
                    addButton(-100 + slot * 100, 150, `QUICK ${slot + 1}`, () => {
                        const slots = [...this.campaign.player.quickSlotItemIds] as [
                            string | null,
                            string | null,
                            string | null
                        ];
                        slots[slot] = selected.id;
                        this.campaign = {
                            ...this.campaign,
                            player: {...this.campaign.player, quickSlotItemIds: slots}
                        };
                        this.destroyModal();
                        this.emitState(messageEvent(
                            `${definition.label} assigned to quick slot ${slot + 1}.`
                        ));
                    });
                }
            }
            if (selected.baseTypeId === 'mystery-orb') {
                selected.rolledChoiceIds.forEach((choiceId, index) => {
                    addButton(-145 + index * 145, 150, choiceId.toUpperCase(), () => {
                        this.destroyModal();
                        this.perform({kind: 'use-item', itemId: selected.id, choiceId});
                    });
                });
            }
        }
        addButton(0, 185, 'CLOSE', () => this.destroyModal(), '#806b4f');
        this.activateModal(container);
        this.modalCancelAction = () => this.destroyModal();
    }

    /**
     * An unobtrusive legend: it is never shown unprompted, but one tap explains
     * every marker, item category, monster, and wall rule in the maze.
     */
    showMazeHelp(page = 0): void {
        if (this.encounterOpen) return;
        this.destroyModal();
        const pages = buildMazeHelpPages(this.campaign);
        const boundedPage = Phaser.Math.Clamp(page, 0, pages.length - 1);
        const helpPage = pages[boundedPage]!;
        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(500);
        container.add(this.add.rectangle(0, 0, 590, 560, 0x171918, 0.98)
            .setStrokeStyle(3, 0x67d5e8));
        container.add(this.add.text(0, -244, helpPage.title, {
            color: '#7fe0f5',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -206,
            `Page ${boundedPage + 1}/${pages.length}`,
            {color: '#b6b09f', fontFamily: 'Georgia, serif', fontSize: '14px'}
        ).setOrigin(0.5));
        container.add(this.add.text(-262, -178, helpPage.body, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            lineSpacing: 6,
            wordWrap: {width: 524}
        }));

        const addFooterButton = (x: number, label: string, action: () => void): void => {
            const button = this.add.text(x, 244, label, {
                color: '#f5f0df',
                backgroundColor: label === 'CLOSE' ? '#806b4f' : '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                padding: {x: 14, y: 9}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
        };
        const previousPage = (): void =>
            this.showMazeHelp((boundedPage - 1 + pages.length) % pages.length);
        const nextPage = (): void =>
            this.showMazeHelp((boundedPage + 1) % pages.length);
        addFooterButton(-190, '◀ PREV', previousPage);
        addFooterButton(190, 'NEXT ▶', nextPage);
        addFooterButton(0, 'CLOSE', () => this.destroyModal());

        this.activateModal(container);
        this.modalConfirmAction = nextPage;
        this.modalCancelAction = () => this.destroyModal();
        this.shopPreviousPageAction = previousPage;
        this.shopNextPageAction = nextPage;
        this.game.canvas.dataset.mazeHelpOpen = 'true';
        this.game.canvas.dataset.mazeHelpPage = String(boundedPage);
    }

    private activateModal(container: Phaser.GameObjects.Container): void {
        // Modals are laid out in game pixels, so the world zoom used to keep
        // maze cells readable is cancelled here to stop panels overflowing.
        container.setScale(1 / this.cameras.main.zoom);
        for (const child of container.list) {
            if (
                child.input !== null &&
                'setScrollFactor' in child &&
                typeof child.setScrollFactor === 'function'
            ) {
                (child as ScrollFactorGameObject).setScrollFactor(0);
            }
        }
        this.modalContainer = container;
        this.game.canvas.dataset.overworldModalOpen = 'true';
    }

    private destroyModal(): void {
        if (this.victoryHorse) {
            this.tweens.killTweensOf(this.victoryHorse);
            for (const child of this.victoryHorse.list) this.tweens.killTweensOf(child);
            this.victoryHorse = null;
        }
        this.modalContainer?.destroy(true);
        this.modalContainer = null;
        this.modalConfirmAction = null;
        this.modalCancelAction = null;
        this.spaceSkipAction = null;
        this.shopPreviousPageAction = null;
        this.shopNextPageAction = null;
        this.shopOfferActions = [];
        this.encounterResultModalOpen = false;
        delete this.game.canvas.dataset.encounterOverlay;
        delete this.game.canvas.dataset.mazeHelpOpen;
        delete this.game.canvas.dataset.mazeHelpPage;
        delete this.game.canvas.dataset.shopOpen;
        delete this.game.canvas.dataset.shopMode;
        delete this.game.canvas.dataset.shopPage;
        delete this.game.canvas.dataset.shopCarOwned;
        delete this.game.canvas.dataset.spaceOptionsOpen;
        delete this.game.canvas.dataset.spaceSkipAffordable;
        delete this.game.canvas.dataset.victoryOverlay;
        delete this.game.canvas.dataset.victoryHorse;
        delete this.game.canvas.dataset.overworldModalOpen;
    }

    private emitState(event?: OverworldEvent): void {
        this.options.onStateChanged(this.campaign, event);
    }

    /**
     * The exit is drawn as little stairs going down so its meaning is obvious
     * without a legend. The spawn corner carries no marker: the player is
     * standing on it, and a coloured square there told nobody anything.
     */
    private drawLandmarks(): void {
        const size = this.campaign.overworld.maze.length;
        const centerX = (size - 1.5) * CELL_SIZE;
        const centerY = (size - 1.5) * CELL_SIZE;
        const stairs = this.add.graphics().setDepth(5);
        const width = CELL_SIZE - 6;
        const left = centerX - width / 2;
        const top = centerY - width / 2;
        // A dark shaft behind four descending treads reads as "down" at a glance.
        stairs.fillStyle(0x14161a, 1).fillRect(left, top, width, width);
        const steps = 4;
        for (let step = 0; step < steps; step++) {
            const inset = (step * width) / (steps * 2);
            const depth = width / steps;
            stairs.fillStyle(step % 2 === 0 ? 0x9aa3a8 : 0x7d868b, 1);
            stairs.fillRect(left + inset, top + step * depth, width - inset * 2, depth * 0.62);
            stairs.fillStyle(0x2b3034, 1);
            stairs.fillRect(
                left + inset,
                top + step * depth + depth * 0.62,
                width - inset * 2,
                depth * 0.38
            );
        }
        stairs.lineStyle(2, 0x0f1113, 1).strokeRect(left, top, width, width);
        this.add.text(centerX, centerY + CELL_SIZE * 0.82, 'STAIRS DOWN', {
            color: '#171918',
            backgroundColor: 'rgba(245,240,223,0.86)',
            fontFamily: 'Georgia, serif',
            fontSize: '9px',
            padding: {x: 2, y: 1}
        }).setOrigin(0.5).setDepth(6);
    }


    private createObjectiveVisuals(): void {
        for (const placement of this.campaign.overworld.objectives) {
            const definition = OBJECTIVE_BY_ID[placement.objectiveId];
            const x = placement.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = placement.position.y * CELL_SIZE + CELL_SIZE / 2;
            const sprite = this.add.sprite(x, y, 'objective-sprites', definition.iconFrame)
                .setDepth(12)
                .setInteractive({useHandCursor: true});
            sprite.on('pointerdown', () => {
                const status = getObjectiveStatus(this.campaign.flags, placement.objectiveId);
                const message = status === 'locked'
                    ? objectiveLockedMessage(placement.objectiveId)
                    : `${definition.label}: ${status}. ` +
                    (status === 'available'
                        ? 'Stand here and interact to begin.'
                        : 'Completed sanctuary.');
                this.emitState(messageEvent(message));
            });
            const badge = this.add.text(x + 9, y - 12, '', {
                color: '#f5f0df',
                backgroundColor: '#171918',
                fontSize: '10px',
                padding: {x: 2, y: 1}
            }).setOrigin(0.5).setDepth(14);
            const label = this.add.text(x, y + 19, definition.label, {
                color: '#171918',
                backgroundColor: 'rgba(245,240,223,0.82)',
                fontFamily: 'Georgia, serif',
                fontSize: '10px',
                padding: {x: 2, y: 1}
            }).setOrigin(0.5).setDepth(13);
            this.objectiveVisuals.set(placement.objectiveId, {sprite, badge, label});
        }
        this.refreshObjectiveVisuals();
    }

    private createServiceSiteVisuals(): void {
        for (const site of this.campaign.overworld.serviceSites) {
            const definition = SERVICE_SITE_DEFINITIONS[site.kind];
            const x = site.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = site.position.y * CELL_SIZE + CELL_SIZE / 2;
            const container = this.add.container(x, y).setDepth(16);
            const marker = this.add.rectangle(0, 0, 27, 27, definition.color, 0.96)
                .setStrokeStyle(2, 0x171918)
                .setInteractive({useHandCursor: true});
            const glyph = this.add.text(0, -1, definition.marker, {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: site.kind === 'blackjack' ? '12px' : '19px',
                fontStyle: 'bold'
            }).setOrigin(0.5);
            const label = this.add.text(0, 20, definition.shortLabel, {
                color: '#171918',
                backgroundColor: 'rgba(245,240,223,0.88)',
                fontFamily: 'Georgia, serif',
                fontSize: '9px',
                padding: {x: 2, y: 1}
            }).setOrigin(0.5);
            marker.on('pointerdown', () => {
                this.emitState(messageEvent(
                    `${definition.label}. Optional. Stand here and press E or tap E to ${
                        site.kind === 'shop' ? 'browse' : 'play'
                    }.`
                ));
            });
            container.add([marker, glyph, label]);
            this.serviceSiteVisuals.set(site.id, {container});
        }
        this.game.canvas.dataset.serviceSites = this.campaign.overworld.serviceSites
            .map(site => `${site.kind}@${site.position.x},${site.position.y}`)
            .join(';');
        this.game.canvas.dataset.shopPresent = String(
            this.campaign.overworld.serviceSites.some(site => site.kind === 'shop')
        );
    }

    private refreshObjectiveVisuals(): void {
        for (const definition of OBJECTIVE_DEFINITIONS) {
            const visual = this.objectiveVisuals.get(definition.id);
            if (!visual) continue;
            const status = getObjectiveStatus(this.campaign.flags, definition.id);
            visual.sprite.clearTint();
            visual.sprite.setAlpha(status === 'completed' ? 0.55 : status === 'locked' ? 0.42 : 1);
            if (status === 'locked') visual.sprite.setTint(0x6b6f70);
            visual.badge.setText(status === 'locked' ? 'L' : status === 'completed' ? 'OK' : '!');
            visual.badge.setColor(status === 'available' ? '#efc75e' : '#f5f0df');
        }
    }

    /**
     * Draws the whole grid into one retained Graphics object: a base fill per
     * cell, a faint speckle on the floor so it reads as ground without hiding
     * loot, and a tag-driven texture on each wall.
     */
    private drawMaze(): void {
        const graphics = this.mazeGraphics;
        graphics.clear();
        const size = this.campaign.overworld.maze.length;
        for (let y = 0; y < size; y++) {
            const row = this.campaign.overworld.maze[y]!;
            for (let x = 0; x < row.length; x++) {
                const cell = row[x]!;
                const originX = x * CELL_SIZE;
                const originY = y * CELL_SIZE;
                if (cell.kind === 'passage') {
                    graphics.fillStyle(0xf4f1e8, 1)
                        .fillRect(originX, originY, CELL_SIZE, CELL_SIZE);
                    drawFloorTexture(graphics, originX, originY);
                    continue;
                }
                const base = colorToNumber(MATERIALS[cell.materialId].color);
                graphics.fillStyle(base, 1)
                    .fillRect(originX, originY, CELL_SIZE, CELL_SIZE);
                drawMaterialPattern(
                    graphics,
                    MATERIALS[cell.materialId].tags,
                    base,
                    originX,
                    originY
                );
            }
        }
    }

    private syncWorldVisuals(): void {
        this.refreshObjectiveVisuals();
        this.syncItemSprites();
        this.syncMonsterSprites();
        this.syncTrapGraphics();
    }

    /**
     * The player is a little rolling ball: a shaded sphere with two stripes
     * whose rotation follows the direction of travel, so movement reads as
     * rolling rather than sliding.
     */
    private createPlayerBall(): Phaser.GameObjects.Container {
        const radius = CELL_SIZE / 3;
        const container = this.add.container(0, 0).setDepth(30);
        const shadow = this.add.ellipse(0, radius * 0.85, radius * 1.7, radius * 0.6, 0x171918, 0.3);
        const art = this.add.graphics();
        art.fillStyle(0x2468d8, 1).fillCircle(0, 0, radius);
        art.fillStyle(0x5b96ef, 1).fillCircle(-radius * 0.3, -radius * 0.32, radius * 0.5);
        art.lineStyle(2.5, 0x102d66, 1);
        art.lineBetween(-radius * 0.82, -radius * 0.32, radius * 0.82, -radius * 0.32);
        art.lineBetween(-radius * 0.82, radius * 0.32, radius * 0.82, radius * 0.32);
        art.lineStyle(2, 0x0d2350, 1).strokeCircle(0, 0, radius);
        art.fillStyle(0xdfe9ff, 0.9).fillCircle(-radius * 0.34, -radius * 0.42, radius * 0.2);
        this.playerBallArt = art;
        container.add([shadow, art]);
        return container;
    }

    private syncPlayerMarker(direction?: DirectionId): void {
        const {x, y} = this.campaign.overworld.playerPosition;
        this.playerMarker.setPosition(
            x * CELL_SIZE + CELL_SIZE / 2,
            y * CELL_SIZE + CELL_SIZE / 2
        );
        if (direction) {
            // A quarter turn per cell, signed by travel direction. Vertical
            // moves roll the same way a ball would if you watched from the side.
            const spin = direction === 'left' || direction === 'up' ? -90 : 90;
            this.playerRollAngle += spin;
            if (this.reducedMotion) {
                this.playerBallArt.setAngle(this.playerRollAngle);
            } else {
                this.tweens.add({
                    targets: this.playerBallArt,
                    angle: this.playerRollAngle,
                    duration: 150,
                    ease: 'Sine.Out'
                });
            }
        }
        if (this.playerCameraConfigured) this.centerCameraOnPlayer();
    }

    /**
     * Walls are tappable like items and monsters: a tap reports the material,
     * whether the current pick can cut it, and what it yields.
     */
    private createWallInspector(): void {
        const pixels = this.campaign.overworld.maze.length * CELL_SIZE;
        const zone = this.add.zone(0, 0, pixels, pixels).setOrigin(0).setDepth(1);
        zone.setInteractive({useHandCursor: true});
        zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.modalContainer || this.encounterOpen) return;
            const position = {
                x: Math.floor(pointer.worldX / CELL_SIZE),
                y: Math.floor(pointer.worldY / CELL_SIZE)
            };
            const material = getWallMaterial(this.campaign.overworld.maze, position);
            if (!material) return;
            this.emitState(messageEvent(describeWallForPlayer(
                material,
                this.campaign.player,
                position,
                this.campaign.overworld
            )));
        });
    }

    private configurePlayerCamera(): void {
        const camera = this.cameras.main;
        camera.setBackgroundColor(0x242722);
        camera.setZoom(this.readableCameraZoom());
        camera.startFollow(this.playerMarker, true, 1, 1);
        camera.setRoundPixels(true);
        this.playerCameraConfigured = true;
        this.applyCameraBounds();
        this.centerCameraOnPlayer();

        this.game.canvas.dataset.overworldCameraMode = 'player-centered';
    }

    /**
     * Small screens shrink every maze cell, so the camera trades visible cells
     * for legibility until each one is comfortably tappable.
     */
    private readableCameraZoom(): number {
        const displayedWidth = this.game.canvas.getBoundingClientRect().width;
        if (!Number.isFinite(displayedWidth) || displayedWidth <= 0) return 1;
        const cssPixelsPerGamePixel = displayedWidth / GAME_VIEW_SIZE;
        const required = MINIMUM_READABLE_CELL_PX / (CELL_SIZE * cssPixelsPerGamePixel);
        // Quarter steps keep the zoom stable across small resize jitters.
        const quantized = Math.ceil(required * 4) / 4;
        return Math.min(MAXIMUM_CAMERA_ZOOM, Math.max(1, quantized));
    }

    private applyCameraBounds(): void {
        const camera = this.cameras.main;
        const worldSize = this.campaign.overworld.maze.length * CELL_SIZE;
        const paddingX = Math.max(
            0,
            camera.width / 2 / camera.zoom - WALKABLE_EDGE_CELL_CENTER
        );
        const paddingY = Math.max(
            0,
            camera.height / 2 / camera.zoom - WALKABLE_EDGE_CELL_CENTER
        );
        camera.setBounds(
            -paddingX,
            -paddingY,
            worldSize + paddingX * 2,
            worldSize + paddingY * 2
        );

        const canvas = this.game.canvas;
        canvas.dataset.overworldCameraZoom = camera.zoom.toFixed(2);
        canvas.dataset.overworldCameraPaddingX = String(paddingX);
        canvas.dataset.overworldCameraPaddingY = String(paddingY);
    }

    private readonly handleScaleResize = (): void => {
        if (!this.playerCameraConfigured) return;
        const zoom = this.readableCameraZoom();
        if (zoom === this.cameras.main.zoom) return;
        this.cameras.main.setZoom(zoom);
        this.applyCameraBounds();
        this.modalContainer?.setScale(1 / zoom);
        this.centerCameraOnPlayer();
    };

    private centerCameraOnPlayer(): void {
        const camera = this.cameras.main;
        camera.centerOn(this.playerMarker.x, this.playerMarker.y);

        const canvas = this.game.canvas;
        const halfWidth = camera.width / 2;
        const halfHeight = camera.height / 2;
        canvas.dataset.overworldPlayerScreenX = (
            camera.x + halfWidth +
            (this.playerMarker.x - camera.scrollX - halfWidth) * camera.zoom
        ).toFixed(1);
        canvas.dataset.overworldPlayerScreenY = (
            camera.y + halfHeight +
            (this.playerMarker.y - camera.scrollY - halfHeight) * camera.zoom
        ).toFixed(1);
    }

    private syncItemSprites(): void {
        const activeIds = new Set(this.campaign.overworld.items.map(item => item.instance.id));
        for (const [itemId, sprite] of this.itemSprites) {
            if (activeIds.has(itemId)) continue;
            sprite.destroy();
            this.itemSprites.delete(itemId);
        }
        for (const item of this.campaign.overworld.items) {
            const definition = ITEM_DEFINITIONS[item.instance.baseTypeId];
            const x = item.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = item.position.y * CELL_SIZE + CELL_SIZE / 2;
            const existing = this.itemSprites.get(item.instance.id);
            if (existing) {
                existing.setPosition(x, y);
                continue;
            }
            const sprite = this.add.sprite(
                x,
                y,
                'item-sprites',
                definition.spriteFrame
            ).setDepth(10).setInteractive({useHandCursor: true});
            sprite.on('pointerdown', () => {
                const current = this.campaign.overworld.items.find(candidate =>
                    candidate.instance.id === item.instance.id
                );
                if (!current) return;
                const instance = current.instance;
                this.emitState(messageEvent(
                    `${definition.label} · ${instance.quality}` +
                    `${instance.affixIds.length ? ` · ${instance.affixIds.join(', ')}` : ''}` +
                    `${instance.quantity > 1 ? ` · ×${instance.quantity}` : ''}`
                ));
            });
            this.itemSprites.set(item.instance.id, sprite);
        }
    }

    private syncMonsterSprites(): void {
        const activeIds = new Set(this.campaign.overworld.monsters.map(monster => monster.id));
        for (const [monsterId, sprite] of this.monsterSprites) {
            if (activeIds.has(monsterId)) continue;
            sprite.destroy();
            this.monsterSprites.delete(monsterId);
        }
        for (const monster of this.campaign.overworld.monsters) {
            const definition = MONSTER_DEFINITIONS[monster.typeId];
            const x = monster.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = monster.position.y * CELL_SIZE + CELL_SIZE / 2;
            const existing = this.monsterSprites.get(monster.id);
            const sprite = existing ?? this.add.sprite(
                x,
                y,
                'monster-sprites',
                definition.spriteFrame
            ).setDepth(20);
            sprite.setPosition(x, y);
            sprite.setAlpha(monster.revealed ? 1 : 0.72);
            if (monster.intent) sprite.setTint(0xff4d4d);
            else if (monster.elite) sprite.setTint(0xefc75e);
            else sprite.clearTint();
            if (!existing) {
                sprite.setInteractive({useHandCursor: true});
                sprite.on('pointerdown', () => {
                    const current = this.campaign.overworld.monsters.find(candidate =>
                        candidate.id === monster.id
                    );
                    if (!current) return;
                    const currentDefinition = MONSTER_DEFINITIONS[current.typeId];
                    this.emitState(messageEvent(
                        `${currentDefinition.label} · HP ${current.health}/${current.maxHealth}` +
                        ` · armor ${current.armor}` +
                        `${current.variantIds.length
                            ? ` · ${current.variantIds.join(', ')}`
                            : ''}` +
                        `${current.intent
                            ? ` · ${current.intent.kind} hits turn ${current.intent.executeOnTurn}`
                            : ''}` +
                        `${current.drop ? ' · carrying loot' : ''}`
                    ));
                });
                this.monsterSprites.set(monster.id, sprite);
            }
        }
    }

    private syncTrapGraphics(): void {
        const activeIds = new Set(this.campaign.overworld.traps.map(trap => trap.id));
        for (const [trapId, graphic] of this.trapGraphics) {
            if (activeIds.has(trapId)) continue;
            graphic.destroy();
            this.trapGraphics.delete(trapId);
        }
        for (const trap of this.campaign.overworld.traps) {
            const existing = this.trapGraphics.get(trap.id);
            if (existing) {
                existing.setVisible(trap.revealed && !trap.disabled);
                continue;
            }
            const x = trap.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = trap.position.y * CELL_SIZE + CELL_SIZE / 2;
            const color = trap.typeId === 'gas-vent'
                ? 0x55a33f
                : trap.typeId === 'arc-plate'
                    ? 0x67d5e8
                    : trap.typeId === 'flame-jet'
                        ? 0xef5b24
                        : 0x382f54;
            const marker = this.add.rectangle(x, y, 18, 8, color)
                .setStrokeStyle(2, 0x171918)
                .setDepth(11)
                .setVisible(trap.revealed && !trap.disabled)
                .setInteractive({useHandCursor: true});
            marker.on('pointerdown', () => {
                const current = this.campaign.overworld.traps.find(candidate =>
                    candidate.id === trap.id
                );
                if (!current) return;
                this.emitState(messageEvent(
                    `${current.typeId} · ${current.disabled ? 'disabled' : 'active'}` +
                    `${current.phase > 0 ? ' · warning phase' : ''}` +
                    ` · ${current.owner}`
                ));
            });
            this.trapGraphics.set(trap.id, marker);
        }
    }

    private hasReachedExit(): boolean {
        const size = this.campaign.overworld.maze.length;
        return this.campaign.overworld.playerPosition.x === size - 2 &&
            this.campaign.overworld.playerPosition.y === size - 2;
    }

    /** True while the player is choosing a direction for a ranged attack. */
    get attackTargetingActive(): boolean {
        return this.attackTargeting;
    }

    /**
     * Entry point for the shell's on-screen controls. It mirrors the keyboard
     * bindings, including the two-step targeting flows.
     */
    performControl(control: OverworldControl): void {
        // Pause stays reachable even while a modal or encounter owns the scene.
        if (control.kind === 'menu') {
            this.options.onMenuRequested?.();
            return;
        }
        if (
            this.encounterOpen ||
            this.modalContainer ||
            this.campaign.pendingLevelReward ||
            this.campaign.overworld.pendingDefeatChoice
        ) {
            return;
        }
        switch (control.kind) {
            case 'move':
                if (this.itemTargetingId) {
                    const itemId = this.itemTargetingId;
                    this.itemTargetingId = null;
                    this.perform({kind: 'use-item', itemId, direction: control.direction});
                } else if (this.attackTargeting) {
                    this.attackTargeting = false;
                    this.perform({kind: 'ranged', direction: control.direction});
                } else {
                    this.perform({kind: 'move', direction: control.direction});
                }
                break;
            case 'attack-toggle':
                if (this.itemTargetingId) {
                    this.itemTargetingId = null;
                    this.emitState(messageEvent('Item targeting cancelled.'));
                    break;
                }
                this.attackTargeting = !this.attackTargeting;
                this.emitState(messageEvent(this.attackTargeting
                    ? 'Choose an attack direction.'
                    : 'Attack cancelled.'));
                break;
            case 'use':
                this.useQuickSlot();
                break;
            case 'quick-slot':
                this.useQuickSlot(control.slot);
                break;
            case 'interact':
                this.interact();
                break;
            case 'wait':
                this.perform({kind: 'wait'});
                break;
            case 'inventory':
                this.showInventory();
                break;
            case 'cycle-objective':
                this.perform({kind: 'cycle-objective'});
                break;
        }
    }
}
