import type {MaterialId} from '../../domain/materials/materials';
import {
    chooseRandom,
    randomInteger,
    shuffle,
    type RandomSource
} from '../../domain/random/random-source';

export const PLATFORMER_PLAYER_SIZE = Object.freeze({width: 28, height: 40});
export const PLATFORMER_FIXED_STEP_MS = 16;
export const PLATFORMER_MAX_AMMO = 12;
export const PLATFORMER_CHECKPOINT_AMMO = 6;

export type PlatformerDifficulty = 'story' | 'standard' | 'expert';
export type PlatformerSurfaceKind =
    | 'normal'
    | 'ice'
    | 'conveyor'
    | 'crumbling'
    | 'bounce'
    | 'lift';
export type PlatformerCollectibleKind =
    | 'core'
    | 'salvage'
    | 'pulse-blaster'
    | 'ammo'
    | 'emp'
    | 'shield';
export type PlatformerEnemyKind =
    | 'patroller'
    | 'hopper'
    | 'turret'
    | 'drone'
    | 'sentry';
export type PlatformerHazardKind = 'spikes' | 'pit';
export type PlatformerStatus = 'active' | 'success' | 'failure';

export interface PlatformRect {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly materialId: string;
    readonly surfaceKind: PlatformerSurfaceKind;
    readonly conveyorVelocity: number;
    readonly liftStartY: number;
    readonly liftEndY: number;
}

export interface PlatformerCollectible {
    readonly id: string;
    readonly kind: PlatformerCollectibleKind;
    readonly x: number;
    readonly y: number;
    readonly platformId: string;
    readonly required: boolean;
}

export interface PlatformerEnemyDefinition {
    readonly id: string;
    readonly kind: PlatformerEnemyKind;
    readonly x: number;
    readonly y: number;
    readonly platformId: string;
    readonly patrolMinimumX: number;
    readonly patrolMaximumX: number;
    readonly health: number;
}

export interface PlatformerHazard extends PlatformRect {
    readonly hazardKind: PlatformerHazardKind;
}

export interface PlatformerCheckpoint extends PlatformRect {
    readonly respawnX: number;
    readonly respawnY: number;
    readonly baseline: boolean;
}

export interface PlatformerSection {
    readonly templateId: string;
    readonly x: number;
    readonly width: number;
    readonly entryY: number;
    readonly exitY: number;
    readonly difficultyCost: number;
    readonly traversalTags: readonly string[];
}

export interface PlatformerLevel {
    readonly generatorId: 'platformer-sections-v1';
    readonly width: number;
    readonly height: number;
    readonly difficulty: PlatformerDifficulty;
    readonly levelTier: number;
    readonly deathLimit: number;
    readonly spawn: {readonly x: number; readonly y: number};
    readonly sections: readonly PlatformerSection[];
    readonly platforms: readonly PlatformRect[];
    readonly hazards: readonly PlatformerHazard[];
    readonly checkpoints: readonly PlatformerCheckpoint[];
    readonly goal: PlatformRect;
    readonly collectibles: readonly PlatformerCollectible[];
    readonly enemies: readonly PlatformerEnemyDefinition[];
    readonly requiredCoreTotal: number;
    readonly optionalSalvageTotal: number;
    readonly fallbackUsed: boolean;
}

export interface PlatformerLevelModifiers {
    readonly powerRouting: number;
    readonly miningPower: number;
    readonly airspaceControl: number;
}

export interface PlatformerGenerationConfig {
    readonly difficulty: PlatformerDifficulty;
    readonly levelTier?: number;
    readonly modifiers: PlatformerLevelModifiers;
}

export interface PlatformerInput {
    readonly horizontal: -1 | 0 | 1;
    readonly jumpPressed: boolean;
    readonly jumpHeld: boolean;
    readonly firePressed?: boolean;
}

export interface PlatformerSurfaceState {
    readonly platformId: string;
    readonly crumbleContactMs: number;
    readonly crumbleDisabledMs: number;
    readonly liftOffsetY: number;
    readonly liftDirection: -1 | 1;
    readonly liftPauseMs: number;
}

export type PlatformerEnemyMode =
    | 'patrol'
    | 'idle'
    | 'crouch'
    | 'airborne'
    | 'aim'
    | 'warn'
    | 'dive'
    | 'stunned'
    | 'defeated';

export interface PlatformerEnemyState {
    readonly id: string;
    readonly kind: PlatformerEnemyKind;
    readonly x: number;
    readonly y: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly facing: -1 | 1;
    readonly health: number;
    readonly mode: PlatformerEnemyMode;
    readonly actionMs: number;
    readonly stunMs: number;
    readonly shotReady: boolean;
}

export interface PlatformerProjectile {
    readonly id: string;
    readonly owner: 'player' | 'enemy';
    readonly x: number;
    readonly y: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly remainingMs: number;
}

export type PlatformerEvent =
    | {readonly kind: 'jump'}
    | {readonly kind: 'shot-fired'}
    | {readonly kind: 'empty-weapon'}
    | {readonly kind: 'core-collected'; readonly remaining: number}
    | {readonly kind: 'salvage-collected'}
    | {readonly kind: 'weapon-collected'}
    | {readonly kind: 'ammo-collected'}
    | {readonly kind: 'emp-triggered'}
    | {readonly kind: 'shield-collected'}
    | {readonly kind: 'enemy-defeated'; readonly enemyId: string}
    | {readonly kind: 'player-hit'}
    | {readonly kind: 'shield-absorbed'}
    | {readonly kind: 'checkpoint'; readonly checkpointId: string}
    | {readonly kind: 'respawn'; readonly deaths: number}
    | {readonly kind: 'exit-locked'; readonly missing: number}
    | {readonly kind: 'success'}
    | {readonly kind: 'failure'};

export interface PlatformerState {
    readonly x: number;
    readonly y: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly facing: -1 | 1;
    readonly grounded: boolean;
    readonly groundedPlatformId: string | null;
    readonly coyoteMs: number;
    readonly jumpBufferMs: number;
    readonly jumpCutEligible: boolean;
    readonly fireBufferMs: number;
    readonly checkpoint: {readonly x: number; readonly y: number};
    readonly checkpointId: string | null;
    readonly deaths: number;
    readonly health: number;
    readonly damageEvents: number;
    readonly invulnerableMs: number;
    readonly weaponOwned: boolean;
    readonly ammo: number;
    readonly fireCooldownMs: number;
    readonly shieldMs: number;
    readonly collectedIds: readonly string[];
    readonly collectedCoreIds: readonly string[];
    readonly collectedSalvageIds: readonly string[];
    readonly collectedPickupIds: readonly string[];
    readonly defeatedEnemyIds: readonly string[];
    readonly enemies: readonly PlatformerEnemyState[];
    readonly projectiles: readonly PlatformerProjectile[];
    readonly surfaceStates: readonly PlatformerSurfaceState[];
    readonly activatedCheckpointIds: readonly string[];
    readonly nextProjectileId: number;
    readonly activeElapsedMs: number;
    readonly accumulatorMs: number;
    readonly lastExitMissingCount: number | null;
    readonly paused: boolean;
    readonly status: PlatformerStatus;
    readonly completed: boolean;
}

export interface PlatformerStepResult {
    readonly state: PlatformerState;
    readonly events: readonly PlatformerEvent[];
}

export interface PlatformerValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

export interface PlatformerOutcomeSummary {
    readonly scrapDelta: number;
    readonly campaignHealthDelta: number;
    readonly structuralStabilityDelta: number;
    readonly flags: readonly string[];
}

const PLAYER_ACCELERATION = 1_400;
const PLAYER_BRAKING = 1_800;
const PLAYER_AIR_ACCELERATION = 900;
const PLAYER_MAX_SPEED = 210;
const PLAYER_JUMP_IMPULSE = -430;
const PLAYER_GRAVITY = 1_000;
const PLAYER_EARLY_RELEASE_CLAMP = -180;
const PLAYER_MAX_FALL_SPEED = 760;
const PLAYER_MAX_HEALTH = 3;
const PLAYER_INVULNERABILITY_MS = 800;
const PLAYER_SHOT_COOLDOWN_MS = 250;
const PLAYER_PROJECTILE_SPEED = 420;
const PLAYER_PROJECTILE_LIFETIME_MS = 1_800;
const ENEMY_PROJECTILE_SPEED = 140;
const WORLD_HEIGHT = 672;
const BASE_GROUND_Y = 570;
const GENERATION_ATTEMPTS = 8;

const SECTION_TEMPLATES = Object.freeze([
    'basic-traversal',
    'material-lesson',
    'hazard-run',
    'enemy-patrol',
    'vertical-branch',
    'arena'
] as const);

const SPECIAL_SURFACES = Object.freeze([
    'ice',
    'conveyor',
    'crumbling',
    'bounce'
] as const);

const MATERIAL_FOR_SURFACE: Readonly<Record<PlatformerSurfaceKind, MaterialId>> =
    Object.freeze({
        normal: 'stone',
        ice: 'ice',
        conveyor: 'metal',
        crumbling: 'sand',
        bounce: 'crystal',
        lift: 'copper'
    });

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function approach(value: number, target: number, maximumDelta: number): number {
    if (value < target) return Math.min(target, value + maximumDelta);
    if (value > target) return Math.max(target, value - maximumDelta);
    return value;
}

function overlaps(
    x: number,
    y: number,
    width: number,
    height: number,
    rect: {readonly x: number; readonly y: number; readonly width: number; readonly height: number}
): boolean {
    return x < rect.x + rect.width && x + width > rect.x &&
        y < rect.y + rect.height && y + height > rect.y;
}

function pointPlatform(
    platforms: readonly PlatformRect[],
    x: number
): PlatformRect {
    const platform = platforms.find(candidate => x >= candidate.x && x <= candidate.x + candidate.width);
    if (!platform) throw new Error(`No platform supports generated socket at x=${x}.`);
    return platform;
}

function createPlatform(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    surfaceKind: PlatformerSurfaceKind = 'normal',
    options: {
        readonly conveyorVelocity?: number;
        readonly liftStartY?: number;
        readonly liftEndY?: number;
    } = {}
): PlatformRect {
    return {
        id,
        x,
        y,
        width,
        height,
        materialId: MATERIAL_FOR_SURFACE[surfaceKind],
        surfaceKind,
        conveyorVelocity: options.conveyorVelocity ?? 0,
        liftStartY: options.liftStartY ?? y,
        liftEndY: options.liftEndY ?? y
    };
}

function createHazard(
    id: string,
    hazardKind: PlatformerHazardKind,
    x: number,
    y: number,
    width: number,
    height: number
): PlatformerHazard {
    return {
        ...createPlatform(id, x, y, width, height),
        hazardKind
    };
}

function createCheckpoint(
    id: string,
    x: number,
    y: number,
    baseline: boolean
): PlatformerCheckpoint {
    return {
        ...createPlatform(id, x, y - 70, 40, 70),
        respawnX: x,
        respawnY: y,
        baseline
    };
}

function tier(config: PlatformerGenerationConfig): number {
    const value = config.levelTier ?? 0;
    if (!Number.isSafeInteger(value)) {
        throw new Error('Platformer level tier must be a safe integer.');
    }
    return clamp(value, 0, 5);
}

function deathLimit(difficulty: PlatformerDifficulty): number {
    if (difficulty === 'story') return 7;
    if (difficulty === 'expert') return 3;
    return 5;
}

function sectionCount(
    random: RandomSource,
    difficulty: PlatformerDifficulty,
    levelTier: number
): number {
    const base = difficulty === 'story' ? 5 : difficulty === 'expert' ? 7 : 6;
    const randomExtra = randomInteger(random, 3);
    const tierExtra = levelTier >= 4 ? 2 : levelTier >= 2 ? 1 : 0;
    return Math.min(10, base + randomExtra + tierExtra);
}

function groundHeightDelta(random: RandomSource): number {
    return [-36, 0, 0, 0, 36][randomInteger(random, 5)]!;
}

function chooseSurfaceSet(
    random: RandomSource,
    levelTier: number
): readonly PlatformerSurfaceKind[] {
    const availableCount = Math.min(SPECIAL_SURFACES.length, 2 + levelTier);
    const available = SPECIAL_SURFACES.slice(0, availableCount);
    const specialCount = levelTier === 0 ? 1 : 2;
    return shuffle(available, random).slice(0, specialCount);
}

function generateCandidate(
    random: RandomSource,
    config: PlatformerGenerationConfig,
    fallbackUsed: boolean
): PlatformerLevel {
    const levelTier = tier(config);
    const count = sectionCount(random, config.difficulty, levelTier);
    const middles = shuffle(SECTION_TEMPLATES, random);
    const templateIds = [
        'safe-introduction',
        ...Array.from({length: count - 2}, (_, index) =>
            middles[index % middles.length]!
        ),
        'exit-approach'
    ];
    const surfaceSet = chooseSurfaceSet(random, levelTier);
    const sections: PlatformerSection[] = [];
    const platforms: PlatformRect[] = [];
    const hazards: PlatformerHazard[] = [];
    const targetWidth = config.difficulty === 'story'
        ? 2_200 + randomInteger(random, 601)
        : config.difficulty === 'expert'
            ? 2_600 + randomInteger(random, 601)
            : 2_400 + randomInteger(random, 801);
    const baseSectionWidth = Math.floor(targetWidth / count);
    const wideSectionCount = targetWidth % count;
    let cursorX = 0;
    let groundY = BASE_GROUND_Y;

    for (let index = 0; index < templateIds.length; index++) {
        const templateId = templateIds[index]!;
        const width = baseSectionWidth + (index < wideSectionCount ? 1 : 0);
        const entryY = groundY;
        if (index > 0 && index < templateIds.length - 1) {
            groundY = clamp(groundY + groundHeightDelta(random), 510, 590);
        }
        const gapAfter = index === templateIds.length - 1
            ? 0
            : 72 + randomInteger(random, 29);
        const platformWidth = width - gapAfter;
        let surfaceKind: PlatformerSurfaceKind = 'normal';
        if (index >= 1 && index < templateIds.length - 1) {
            const specialIndex = index - 1;
            if (specialIndex < surfaceSet.length) surfaceKind = surfaceSet[specialIndex]!;
            else if (templateId === 'material-lesson' && randomInteger(random, 3) === 0) {
                surfaceKind = chooseRandom(surfaceSet, random);
            }
        }
        const ground = createPlatform(
            `ground-${index}`,
            cursorX,
            groundY,
            platformWidth,
            WORLD_HEIGHT - groundY,
            surfaceKind,
            surfaceKind === 'conveyor'
                ? {conveyorVelocity: randomInteger(random, 2) === 0 ? -70 : 70}
                : {}
        );
        platforms.push(ground);

        const tags = [templateId.includes('branch') ? 'branch' : 'main'];
        if (surfaceKind !== 'normal') tags.push(`surface:${surfaceKind}`);
        sections.push({
            templateId,
            x: cursorX,
            width,
            entryY,
            exitY: groundY,
            difficultyCost: templateId === 'safe-introduction' ? 0 :
                templateId === 'arena' ? 3 : 2,
            traversalTags: tags
        });

        if (templateId === 'vertical-branch' || templateId === 'material-lesson') {
            platforms.push(createPlatform(
                `ledge-${index}`,
                cursorX + Math.floor(width * 0.42),
                groundY - 72,
                118,
                18,
                'normal'
            ));
        }
        if (templateId === 'hazard-run' && index > 1) {
            hazards.push(createHazard(
                `spikes-${index}`,
                'spikes',
                cursorX + Math.floor(platformWidth * 0.55),
                groundY - 18,
                30,
                18
            ));
        }
        cursorX += width;
    }

    // Campaign rewards add useful optional geometry without changing the
    // certified baseline route.
    if (config.modifiers.miningPower >= 2) {
        const section = sections[Math.min(2, sections.length - 1)]!;
        platforms.push(createPlatform(
            'tool-bridge',
            section.x + 92,
            section.exitY - 108,
            156,
            18
        ));
    }
    if (config.modifiers.powerRouting >= 60) {
        const section = sections[Math.max(1, sections.length - 3)]!;
        platforms.push(createPlatform(
            'powered-lift',
            section.x + section.width - 82,
            section.exitY - 12,
            68,
            14,
            'lift',
            {liftStartY: section.exitY - 12, liftEndY: section.exitY - 148}
        ));
    }
    if (config.modifiers.airspaceControl >= 60) {
        const section = sections[Math.max(1, sections.length - 2)]!;
        platforms.push(createPlatform(
            'supply-drone-bridge',
            section.x + 36,
            section.exitY - 118,
            148,
            18
        ));
    }

    const width = cursorX;
    hazards.push(createHazard('lower-void', 'pit', 0, 666, width, 6));
    const mainPlatforms = platforms.filter(platform => platform.id.startsWith('ground-'));
    const requiredCoreTotal = Math.min(5, 3 + Math.floor(levelTier / 2));
    const optionalSalvageTotal = 2 + randomInteger(random, 3);
    const collectibleSections = shuffle(
        sections.slice(1, -1).map((_, index) => index + 1),
        random
    );
    const collectibles: PlatformerCollectible[] = [];

    for (let index = 0; index < requiredCoreTotal; index++) {
        const sectionIndex = collectibleSections[index % collectibleSections.length]!;
        const ledge = platforms.find(platform => platform.id === `ledge-${sectionIndex}`);
        const host = index % 2 === 0 && ledge
            ? ledge
            : mainPlatforms[sectionIndex]!;
        collectibles.push({
            id: `core-${index}`,
            kind: 'core',
            x: host.x + Math.min(host.width - 30, 54 + randomInteger(random, Math.max(1, host.width - 84))),
            y: host.y - 18,
            platformId: host.id,
            required: true
        });
    }

    for (let index = 0; index < optionalSalvageTotal; index++) {
        const sectionIndex = 1 + randomInteger(random, Math.max(1, sections.length - 2));
        const section = sections[sectionIndex]!;
        const optionalHosts = platforms.filter(platform =>
            platform.x >= section.x &&
            platform.x < section.x + section.width &&
            platform.id !== 'powered-lift'
        );
        const host = chooseRandom(optionalHosts, random);
        collectibles.push({
            id: `salvage-${index}`,
            kind: 'salvage',
            x: host.x + clamp(32 + randomInteger(random, Math.max(1, host.width - 64)), 24, host.width - 24),
            y: host.y - 18,
            platformId: host.id,
            required: false
        });
    }

    const openingGround = mainPlatforms[0]!;
    collectibles.push({
        id: 'pulse-blaster',
        kind: 'pulse-blaster',
        x: openingGround.x + 150,
        y: openingGround.y - 20,
        platformId: openingGround.id,
        required: false
    });
    const extraPickupKinds = shuffle(
        ['emp', 'shield', 'ammo'] as const,
        random
    ).slice(0, 1 + randomInteger(random, 2));
    for (let index = 0; index < extraPickupKinds.length; index++) {
        const hostIndex = Math.min(
            mainPlatforms.length - 2,
            2 + index * Math.max(1, Math.floor(mainPlatforms.length / 3))
        );
        const host = mainPlatforms[hostIndex]!;
        collectibles.push({
            id: `combat-${extraPickupKinds[index]}-${index}`,
            kind: extraPickupKinds[index]!,
            x: host.x + Math.min(host.width - 42, 96 + randomInteger(random, Math.max(1, host.width - 138))),
            y: host.y - 20,
            platformId: host.id,
            required: false
        });
    }
    if (config.modifiers.airspaceControl >= 60) {
        const host = platforms.find(platform => platform.id === 'supply-drone-bridge')!;
        collectibles.push({
            id: 'airspace-ammo',
            kind: 'ammo',
            x: host.x + host.width / 2,
            y: host.y - 20,
            platformId: host.id,
            required: false
        });
    }

    const enemyPool: PlatformerEnemyKind[] = ['patroller', 'hopper', 'turret'];
    if (levelTier >= 2) enemyPool.push('drone', 'sentry');
    const difficultyBudget = config.difficulty === 'story' ? -1 :
        config.difficulty === 'expert' ? 2 : 0;
    const enemyCount = clamp(sections.length - 2 + levelTier + difficultyBudget, 3, 14);
    let enemies: PlatformerEnemyDefinition[] = [];
    for (let index = 0; index < enemyCount; index++) {
        const hostIndex = 1 + (index % Math.max(1, mainPlatforms.length - 2));
        const host = mainPlatforms[hostIndex]!;
        const kind = chooseRandom(enemyPool, random);
        const health = kind === 'patroller' ? 1 : kind === 'sentry' ? 4 : 2;
        const x = host.x + clamp(
            80 + randomInteger(random, Math.max(1, host.width - 160)),
            44,
            host.width - 44
        );
        enemies.push({
            id: `enemy-${index}`,
            kind,
            x,
            y: host.y - (kind === 'drone' ? 112 : 32),
            platformId: host.id,
            patrolMinimumX: host.x + 30,
            patrolMaximumX: host.x + host.width - 30,
            health
        });
    }

    const midpointSection = sections[Math.floor(sections.length / 2)]!;
    const checkpointHost = mainPlatforms[Math.floor(mainPlatforms.length / 2)]!;
    const checkpoints: PlatformerCheckpoint[] = [
        createCheckpoint(
            'baseline-checkpoint',
            clamp(width * 0.52, midpointSection.x + 30, midpointSection.x + midpointSection.width - 70),
            checkpointHost.y,
            true
        )
    ];
    if (config.modifiers.airspaceControl >= 60) {
        const host = mainPlatforms[Math.max(1, mainPlatforms.length - 2)]!;
        checkpoints.push(createCheckpoint(
            'drone-checkpoint',
            host.x + 42,
            host.y,
            false
        ));
    }

    const occupiedEnemySockets: number[] = [];
    const placedEnemies: PlatformerEnemyDefinition[] = [];
    for (const enemy of enemies) {
        const host = platforms.find(platform => platform.id === enemy.platformId)!;
        const candidateXs = [
            enemy.x,
            ...Array.from(
                {length: Math.max(1, Math.floor((host.width - 80) / 28))},
                (_, socketIndex) => host.x + 40 + socketIndex * 28
            )
        ];
        const x = candidateXs.find(candidateX => {
            const enemyRect = {
                x: candidateX - 15,
                y: enemy.y - 30,
                width: 30,
                height: 34
            };
            return candidateX >= host.x + 30 &&
                candidateX <= host.x + host.width - 30 &&
                !occupiedEnemySockets.some(otherX => Math.abs(otherX - candidateX) < 34) &&
                !collectibles.some(item =>
                    overlaps(
                        item.x - 12,
                        item.y - 12,
                        24,
                        24,
                        enemyRect
                    )
                ) &&
                !checkpoints.some(checkpoint => overlaps(
                    enemyRect.x,
                    enemyRect.y,
                    enemyRect.width,
                    enemyRect.height,
                    checkpoint
                )) &&
                !hazards.some(hazard => overlaps(
                    enemyRect.x,
                    enemyRect.y,
                    enemyRect.width,
                    enemyRect.height,
                    hazard
                ));
        });
        // The budget is a cap. A crowded section drops the hostile instead of
        // violating a required-item, checkpoint, or hazard reservation.
        if (x === undefined) continue;
        occupiedEnemySockets.push(x);
        placedEnemies.push({
            ...enemy,
            x,
            patrolMinimumX: host.x + 30,
            patrolMaximumX: host.x + host.width - 30
        });
    }
    enemies = placedEnemies;

    const lastGround = mainPlatforms.at(-1)!;
    return {
        generatorId: 'platformer-sections-v1',
        width,
        height: WORLD_HEIGHT,
        difficulty: config.difficulty,
        levelTier,
        deathLimit: deathLimit(config.difficulty),
        spawn: {x: 70, y: openingGround.y},
        sections,
        platforms,
        hazards,
        checkpoints,
        goal: createPlatform(
            'maintenance-exit',
            lastGround.x + lastGround.width - 58,
            lastGround.y - 112,
            48,
            112
        ),
        collectibles,
        enemies,
        requiredCoreTotal,
        optionalSalvageTotal,
        fallbackUsed
    };
}

function fallbackLevel(config: PlatformerGenerationConfig): PlatformerLevel {
    const deterministicRandom: RandomSource = {
        next: (() => {
            let index = 0;
            const values = [0.12, 0.72, 0.34, 0.91, 0.46, 0.62, 0.21, 0.81];
            return () => values[index++ % values.length]!;
        })()
    };
    return generateCandidate(deterministicRandom, config, true);
}

export function createGeneratedPlatformerLevel(
    random: RandomSource,
    config: PlatformerGenerationConfig
): PlatformerLevel {
    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
        const candidate = generateCandidate(random, config, false);
        if (validatePlatformerLevel(candidate).valid) return candidate;
    }
    const fallback = fallbackLevel(config);
    const validation = validatePlatformerLevel(fallback);
    if (!validation.valid) {
        throw new Error(`Known-good platformer fallback failed: ${validation.errors.join('; ')}`);
    }
    return fallback;
}

/**
 * Compatibility wrapper retained for existing callers. New scene code uses the
 * seeded generator directly.
 */
export function createActOnePlatformerLevel(
    modifiers: PlatformerLevelModifiers
): PlatformerLevel {
    let state = 0x6d2b79f5;
    const random: RandomSource = {
        next: () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
        }
    };
    return createGeneratedPlatformerLevel(random, {
        difficulty: 'standard',
        levelTier: 0,
        modifiers
    });
}

function horizontalGap(from: PlatformRect, to: PlatformRect): number {
    if (from.x + from.width < to.x) return to.x - (from.x + from.width);
    if (to.x + to.width < from.x) return from.x - (to.x + to.width);
    return 0;
}

function ordinaryGapLimit(rise: number): number {
    if (rise <= 0) return 120;
    if (rise <= 36) return 105;
    if (rise <= 72) return 80;
    return -1;
}

function canTransition(from: PlatformRect, to: PlatformRect): boolean {
    if (from.id === to.id) return true;
    if (to.surfaceKind === 'lift') return false;
    const rise = from.y - to.y;
    return horizontalGap(from, to) <= ordinaryGapLimit(rise);
}

function reachablePlatformIds(
    platforms: readonly PlatformRect[],
    startId: string
): ReadonlySet<string> {
    const visited = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
        const id = queue.shift()!;
        const current = platforms.find(platform => platform.id === id);
        if (!current) continue;
        for (const candidate of platforms) {
            if (visited.has(candidate.id) || !canTransition(current, candidate)) continue;
            visited.add(candidate.id);
            queue.push(candidate.id);
        }
    }
    return visited;
}

export function validatePlatformerLevel(level: PlatformerLevel): PlatformerValidationResult {
    const errors: string[] = [];
    if (level.sections.length < 5 || level.sections.length > 10) {
        errors.push('section count outside supported bounds');
    }
    if (level.enemies.length > 14) errors.push('enemy budget exceeds fourteen');
    if (level.requiredCoreTotal < 3 || level.requiredCoreTotal > 5) {
        errors.push('required core total outside 3..5');
    }
    const mainPlatforms = level.platforms.filter(platform => platform.id.startsWith('ground-'));
    const start = pointPlatform(mainPlatforms, level.spawn.x);
    const reachable = reachablePlatformIds(level.platforms, start.id);
    const returnable = new Set(
        level.platforms
            .filter(candidate => canTransition(candidate, start) || candidate.id === start.id)
            .map(candidate => candidate.id)
    );
    // Expand reverse reachability for branch-order safety.
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const candidate of level.platforms) {
            if (returnable.has(candidate.id)) continue;
            if (level.platforms.some(destination =>
                returnable.has(destination.id) && canTransition(candidate, destination)
            )) {
                returnable.add(candidate.id);
                expanded = true;
            }
        }
    }
    for (const core of level.collectibles.filter(item => item.kind === 'core')) {
        if (!reachable.has(core.platformId)) errors.push(`core ${core.id} is unreachable`);
        if (!returnable.has(core.platformId)) errors.push(`core ${core.id} cannot return`);
        const host = level.platforms.find(platform => platform.id === core.platformId);
        const distanceToMain = host
            ? Math.min(...mainPlatforms.map(platform => horizontalGap(host, platform)))
            : Number.POSITIVE_INFINITY;
        if (distanceToMain > 700) {
            errors.push(`core ${core.id} branch exceeds 700px`);
        }
    }
    const goalPlatform = pointPlatform(mainPlatforms, level.goal.x + level.goal.width / 2);
    if (!reachable.has(goalPlatform.id)) errors.push('exit is unreachable');
    const baseline = level.checkpoints.find(checkpoint => checkpoint.baseline);
    if (!baseline) {
        errors.push('baseline checkpoint missing');
    } else {
        const ratio = baseline.x / level.width;
        if (ratio < 0.45 || ratio > 0.6) errors.push('baseline checkpoint outside midpoint band');
    }
    for (const enemy of level.enemies) {
        const collidesReserved = level.collectibles.some(item =>
            Math.abs(item.x - enemy.x) < 32 && Math.abs(item.y - enemy.y) < 48
        ) || level.checkpoints.some(checkpoint =>
            overlaps(enemy.x - 14, enemy.y - 28, 28, 32, checkpoint)
        ) || level.hazards.some(hazard =>
            overlaps(enemy.x - 14, enemy.y - 28, 28, 32, hazard)
        );
        if (collidesReserved) errors.push(`enemy ${enemy.id} overlaps reserved content`);
    }
    return {valid: errors.length === 0, errors};
}

export function canonicalPlatformerSignature(level: PlatformerLevel): string {
    return JSON.stringify({
        sections: level.sections.map(section => section.templateId),
        geometry: level.platforms.map(platform => [
            platform.x,
            platform.y,
            platform.width,
            platform.height,
            platform.surfaceKind,
            platform.conveyorVelocity,
            platform.liftStartY,
            platform.liftEndY
        ]),
        enemies: level.enemies.map(enemy => [
            enemy.kind,
            enemy.platformId,
            enemy.x,
            enemy.y
        ]),
        collectibles: level.collectibles.map(item => [
            item.kind,
            item.platformId,
            item.x,
            item.y
        ])
    });
}

function createEnemyState(enemy: PlatformerEnemyDefinition): PlatformerEnemyState {
    return {
        id: enemy.id,
        kind: enemy.kind,
        x: enemy.x,
        y: enemy.y,
        velocityX: enemy.kind === 'patroller' ? 70 : enemy.kind === 'sentry' ? 35 : 0,
        velocityY: 0,
        facing: 1,
        health: enemy.health,
        mode: enemy.kind === 'patroller' || enemy.kind === 'sentry' ? 'patrol' : 'idle',
        actionMs: enemy.kind === 'turret' ? 1_750 : 0,
        stunMs: 0,
        shotReady: false
    };
}

export function createPlatformerState(level: PlatformerLevel): PlatformerState {
    return {
        x: level.spawn.x,
        y: level.spawn.y - PLATFORMER_PLAYER_SIZE.height,
        velocityX: 0,
        velocityY: 0,
        facing: 1,
        grounded: false,
        groundedPlatformId: null,
        coyoteMs: 0,
        jumpBufferMs: 0,
        jumpCutEligible: false,
        fireBufferMs: 0,
        checkpoint: level.spawn,
        checkpointId: null,
        deaths: 0,
        health: PLAYER_MAX_HEALTH,
        damageEvents: 0,
        invulnerableMs: 0,
        weaponOwned: false,
        ammo: 0,
        fireCooldownMs: 0,
        shieldMs: 0,
        collectedIds: [],
        collectedCoreIds: [],
        collectedSalvageIds: [],
        collectedPickupIds: [],
        defeatedEnemyIds: [],
        enemies: level.enemies.map(createEnemyState),
        projectiles: [],
        surfaceStates: level.platforms.map(platform => ({
            platformId: platform.id,
            crumbleContactMs: 0,
            crumbleDisabledMs: 0,
            liftOffsetY: 0,
            liftDirection: -1,
            liftPauseMs: 350
        })),
        activatedCheckpointIds: [],
        nextProjectileId: 0,
        activeElapsedMs: 0,
        accumulatorMs: 0,
        lastExitMissingCount: null,
        paused: false,
        status: 'active',
        completed: false
    };
}

export function setPlatformerPaused(
    state: PlatformerState,
    paused: boolean
): PlatformerState {
    if (state.status !== 'active' || state.paused === paused) return state;
    return {...state, paused};
}

function surfaceState(
    state: PlatformerState,
    platformId: string
): PlatformerSurfaceState {
    return state.surfaceStates.find(candidate => candidate.platformId === platformId) ?? {
        platformId,
        crumbleContactMs: 0,
        crumbleDisabledMs: 0,
        liftOffsetY: 0,
        liftDirection: -1,
        liftPauseMs: 0
    };
}

export function runtimePlatformRect(
    state: PlatformerState,
    platform: PlatformRect
): PlatformRect {
    const dynamic = surfaceState(state, platform.id);
    return {
        ...platform,
        y: platform.y + dynamic.liftOffsetY
    };
}

function isPlatformSolid(state: PlatformerState, platform: PlatformRect): boolean {
    return platform.surfaceKind !== 'crumbling' ||
        surfaceState(state, platform.id).crumbleDisabledMs <= 0;
}

function updateSurfaces(
    state: PlatformerState,
    level: PlatformerLevel,
    stepMs: number
): {
    readonly states: readonly PlatformerSurfaceState[];
    readonly riderDeltaY: number;
} {
    let riderDeltaY = 0;
    const states = level.platforms.map(platform => {
        const current = surfaceState(state, platform.id);
        if (platform.surfaceKind === 'crumbling') {
            const occupied = state.groundedPlatformId === platform.id;
            if (current.crumbleDisabledMs > 0) {
                return {
                    ...current,
                    crumbleContactMs: 0,
                    crumbleDisabledMs: Math.max(0, current.crumbleDisabledMs - stepMs)
                };
            }
            const contactMs = occupied ? current.crumbleContactMs + stepMs : 0;
            return {
                ...current,
                crumbleContactMs: contactMs >= 600 ? 0 : contactMs,
                crumbleDisabledMs: contactMs >= 600 ? 2_000 : 0
            };
        }
        if (platform.surfaceKind !== 'lift') return current;
        let pauseMs = current.liftPauseMs;
        let direction = current.liftDirection;
        let offset = current.liftOffsetY;
        const previousOffset = offset;
        if (pauseMs > 0) {
            pauseMs = Math.max(0, pauseMs - stepMs);
        } else {
            offset += direction * 80 * (stepMs / 1_000);
            const minimumOffset = Math.min(0, platform.liftEndY - platform.liftStartY);
            const maximumOffset = Math.max(0, platform.liftEndY - platform.liftStartY);
            if (offset <= minimumOffset || offset >= maximumOffset) {
                offset = clamp(offset, minimumOffset, maximumOffset);
                direction = direction === -1 ? 1 : -1;
                pauseMs = 350;
            }
        }
        if (state.groundedPlatformId === platform.id) riderDeltaY += offset - previousOffset;
        return {
            ...current,
            liftOffsetY: offset,
            liftDirection: direction,
            liftPauseMs: pauseMs
        };
    });
    return {states, riderDeltaY};
}

function currentSurface(
    state: PlatformerState,
    level: PlatformerLevel
): PlatformRect | null {
    if (!state.groundedPlatformId) return null;
    return level.platforms.find(platform => platform.id === state.groundedPlatformId) ?? null;
}

function respawn(
    state: PlatformerState,
    level: PlatformerLevel,
    events: PlatformerEvent[]
): PlatformerState {
    const deaths = state.deaths + 1;
    events.push({kind: 'respawn', deaths});
    if (deaths >= level.deathLimit) {
        events.push({kind: 'failure'});
        return {
            ...state,
            deaths,
            health: 0,
            status: 'failure',
            completed: false,
            projectiles: []
        };
    }
    return {
        ...state,
        x: state.checkpoint.x,
        y: state.checkpoint.y - PLATFORMER_PLAYER_SIZE.height,
        velocityX: 0,
        velocityY: 0,
        grounded: false,
        groundedPlatformId: null,
        coyoteMs: 0,
        jumpBufferMs: 0,
        jumpCutEligible: false,
        health: PLAYER_MAX_HEALTH,
        invulnerableMs: PLAYER_INVULNERABILITY_MS,
        ammo: state.weaponOwned ? Math.max(PLATFORMER_CHECKPOINT_AMMO, state.ammo) : state.ammo,
        deaths,
        projectiles: []
    };
}

function damagePlayer(
    state: PlatformerState,
    sourceX: number,
    events: PlatformerEvent[]
): PlatformerState {
    if (state.invulnerableMs > 0 || state.status !== 'active') return state;
    if (state.shieldMs > 0) {
        events.push({kind: 'shield-absorbed'});
        return {...state, shieldMs: 0, invulnerableMs: 150};
    }
    const health = state.health - 1;
    events.push({kind: 'player-hit'});
    return {
        ...state,
        health,
        damageEvents: state.damageEvents + 1,
        invulnerableMs: PLAYER_INVULNERABILITY_MS,
        velocityX: state.x < sourceX ? -140 : 140,
        velocityY: -180
    };
}

function updateEnemies(
    state: PlatformerState,
    level: PlatformerLevel,
    stepMs: number
): {
    readonly enemies: readonly PlatformerEnemyState[];
    readonly spawnedProjectiles: readonly PlatformerProjectile[];
} {
    const seconds = stepMs / 1_000;
    const spawned: PlatformerProjectile[] = [];
    const definitions = new Map(level.enemies.map(enemy => [enemy.id, enemy]));
    const enemies = state.enemies.map(enemy => {
        if (enemy.health <= 0) return {...enemy, mode: 'defeated' as const};
        const definition = definitions.get(enemy.id);
        if (!definition) return enemy;
        if (enemy.stunMs > 0) {
            return {
                ...enemy,
                mode: 'stunned' as const,
                stunMs: Math.max(0, enemy.stunMs - stepMs),
                velocityX: 0
            };
        }

        if (enemy.kind === 'patroller' || enemy.kind === 'sentry') {
            const speed = enemy.kind === 'patroller' ? 70 : 35;
            let facing = enemy.facing;
            let x = enemy.x + facing * speed * seconds;
            if (x <= definition.patrolMinimumX || x >= definition.patrolMaximumX) {
                x = clamp(x, definition.patrolMinimumX, definition.patrolMaximumX);
                facing = facing === 1 ? -1 : 1;
            }
            return {...enemy, x, facing, velocityX: facing * speed, mode: 'patrol' as const};
        }

        if (enemy.kind === 'hopper') {
            let actionMs = enemy.actionMs + stepMs;
            let mode = enemy.mode;
            let y = enemy.y;
            let velocityY = enemy.velocityY;
            if (mode === 'idle' && actionMs >= 2_000) {
                mode = 'crouch';
                actionMs = 0;
            } else if (mode === 'crouch' && actionMs >= 500) {
                mode = 'airborne';
                actionMs = 0;
                velocityY = -340;
            } else if (mode === 'airborne') {
                velocityY += PLAYER_GRAVITY * seconds;
                y += velocityY * seconds;
                if (y >= definition.y) {
                    y = definition.y;
                    velocityY = 0;
                    mode = 'idle';
                    actionMs = 0;
                }
            }
            return {...enemy, actionMs, mode, y, velocityY};
        }

        if (enemy.kind === 'turret') {
            let actionMs = enemy.actionMs + stepMs;
            let mode: PlatformerEnemyMode = actionMs >= 1_750 ? 'aim' : 'idle';
            if (actionMs >= 2_400) {
                const direction = state.x < enemy.x ? -1 : 1;
                spawned.push({
                    id: `enemy-shot-${state.nextProjectileId + spawned.length}`,
                    owner: 'enemy',
                    x: enemy.x,
                    y: enemy.y + 8,
                    velocityX: direction * ENEMY_PROJECTILE_SPEED,
                    velocityY: 0,
                    remainingMs: 5_000
                });
                actionMs = 0;
                mode = 'idle';
            }
            const facing: -1 | 1 = state.x < enemy.x ? -1 : 1;
            return {...enemy, actionMs, mode, facing};
        }

        let actionMs = enemy.actionMs + stepMs;
        let mode = enemy.mode;
        let x = enemy.x;
        let y = enemy.y;
        if (mode === 'idle' && actionMs >= 2_000) {
            mode = 'warn';
            actionMs = 0;
        } else if (mode === 'warn' && actionMs >= 500) {
            mode = 'dive';
            actionMs = 0;
        } else if (mode === 'dive') {
            const dx = state.x - x;
            const dy = state.y - y;
            const length = Math.max(1, Math.hypot(dx, dy));
            x += dx / length * 155 * seconds;
            y += dy / length * 155 * seconds;
            if (actionMs >= 850) {
                mode = 'idle';
                actionMs = 0;
                x = definition.x;
                y = definition.y;
            }
        }
        return {...enemy, actionMs, mode, x, y};
    });
    return {enemies, spawnedProjectiles: spawned};
}

function collectItems(
    state: PlatformerState,
    level: PlatformerLevel,
    events: PlatformerEvent[]
): PlatformerState {
    let next = state;
    const coreIds = new Set(state.collectedCoreIds);
    const salvageIds = new Set(state.collectedSalvageIds);
    const pickupIds = new Set(state.collectedPickupIds);
    for (const item of level.collectibles) {
        const alreadyCollected = coreIds.has(item.id) ||
            salvageIds.has(item.id) ||
            pickupIds.has(item.id);
        if (alreadyCollected || !overlaps(
            state.x,
            state.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            {x: item.x - 12, y: item.y - 12, width: 24, height: 24}
        )) continue;

        if (item.kind === 'core') {
            coreIds.add(item.id);
            events.push({
                kind: 'core-collected',
                remaining: Math.max(0, level.requiredCoreTotal - coreIds.size)
            });
        } else if (item.kind === 'salvage') {
            salvageIds.add(item.id);
            events.push({kind: 'salvage-collected'});
        } else {
            pickupIds.add(item.id);
            if (item.kind === 'pulse-blaster') {
                next = {
                    ...next,
                    weaponOwned: true,
                    ammo: Math.max(PLATFORMER_CHECKPOINT_AMMO, next.ammo)
                };
                events.push({kind: 'weapon-collected'});
            } else if (item.kind === 'ammo') {
                next = {...next, ammo: Math.min(PLATFORMER_MAX_AMMO, next.ammo + 6)};
                events.push({kind: 'ammo-collected'});
            } else if (item.kind === 'shield') {
                next = {...next, shieldMs: 10_000};
                events.push({kind: 'shield-collected'});
            } else {
                const defeated = new Set(next.defeatedEnemyIds);
                const enemies = next.enemies.map(enemy => {
                    if (Math.hypot(enemy.x - next.x, enemy.y - next.y) > 240) return enemy;
                    if (enemy.kind === 'sentry') {
                        return {...enemy, stunMs: 3_000, mode: 'stunned' as const};
                    }
                    defeated.add(enemy.id);
                    events.push({kind: 'enemy-defeated', enemyId: enemy.id});
                    return {...enemy, health: 0, mode: 'defeated' as const};
                });
                next = {...next, enemies, defeatedEnemyIds: [...defeated]};
                events.push({kind: 'emp-triggered'});
            }
        }
    }
    const collectedIds = [...coreIds];
    return {
        ...next,
        collectedIds,
        collectedCoreIds: collectedIds,
        collectedSalvageIds: [...salvageIds],
        collectedPickupIds: [...pickupIds]
    };
}

function collectCheckpoint(
    state: PlatformerState,
    level: PlatformerLevel,
    events: PlatformerEvent[]
): PlatformerState {
    const checkpoint = level.checkpoints.find(candidate =>
        overlaps(
            state.x,
            state.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            candidate
        )
    );
    if (!checkpoint || state.activatedCheckpointIds.includes(checkpoint.id)) return state;
    events.push({kind: 'checkpoint', checkpointId: checkpoint.id});
    return {
        ...state,
        checkpoint: {x: checkpoint.respawnX, y: checkpoint.respawnY},
        checkpointId: checkpoint.id,
        activatedCheckpointIds: [...state.activatedCheckpointIds, checkpoint.id],
        ammo: state.weaponOwned ? Math.max(PLATFORMER_CHECKPOINT_AMMO, state.ammo) : state.ammo
    };
}

function resolvePlayerShots(
    state: PlatformerState,
    events: PlatformerEvent[]
): PlatformerState {
    let enemies = [...state.enemies];
    const defeated = new Set(state.defeatedEnemyIds);
    const kept: PlatformerProjectile[] = [];
    for (const projectile of state.projectiles) {
        if (projectile.owner !== 'player') {
            kept.push(projectile);
            continue;
        }
        const enemyIndex = enemies.findIndex(enemy =>
            enemy.health > 0 &&
            overlaps(
                projectile.x - 4,
                projectile.y - 3,
                8,
                6,
                {x: enemy.x - 16, y: enemy.y - 30, width: 32, height: 34}
            )
        );
        if (enemyIndex < 0) {
            kept.push(projectile);
            continue;
        }
        const enemy = enemies[enemyIndex]!;
        const health = enemy.health - 1;
        enemies[enemyIndex] = {
            ...enemy,
            health,
            mode: health <= 0 ? 'defeated' : enemy.mode
        };
        if (health <= 0) {
            defeated.add(enemy.id);
            events.push({kind: 'enemy-defeated', enemyId: enemy.id});
        }
    }
    return {
        ...state,
        enemies,
        projectiles: kept,
        defeatedEnemyIds: [...defeated]
    };
}

function stepFixed(
    state: PlatformerState,
    input: PlatformerInput,
    level: PlatformerLevel,
    stepMs: number
): PlatformerStepResult {
    const events: PlatformerEvent[] = [];
    const seconds = stepMs / 1_000;
    const dynamic = updateSurfaces(state, level, stepMs);
    let working: PlatformerState = {
        ...state,
        y: state.y + dynamic.riderDeltaY,
        surfaceStates: dynamic.states,
        invulnerableMs: Math.max(0, state.invulnerableMs - stepMs),
        fireCooldownMs: Math.max(0, state.fireCooldownMs - stepMs),
        shieldMs: Math.max(0, state.shieldMs - stepMs),
        jumpBufferMs: Math.max(0, state.jumpBufferMs - stepMs),
        fireBufferMs: Math.max(0, state.fireBufferMs - stepMs),
        activeElapsedMs: state.activeElapsedMs + stepMs
    };
    let coyoteMs = working.grounded ? 100 : Math.max(0, working.coyoteMs - stepMs);
    let velocityY = working.velocityY;
    let velocityX = working.velocityX;
    let jumpCutEligible = working.jumpCutEligible;
    let grounded = false;
    let groundedPlatformId: string | null = null;
    const supportingSurface = currentSurface(working, level);

    if (working.jumpBufferMs > 0 && coyoteMs > 0) {
        velocityY = PLAYER_JUMP_IMPULSE;
        working = {...working, jumpBufferMs: 0};
        coyoteMs = 0;
        jumpCutEligible = true;
        events.push({kind: 'jump'});
    }
    if (
        jumpCutEligible &&
        !input.jumpHeld &&
        velocityY < PLAYER_EARLY_RELEASE_CLAMP
    ) {
        velocityY = PLAYER_EARLY_RELEASE_CLAMP;
        jumpCutEligible = false;
    }

    const acceleration = working.grounded
        ? (supportingSurface?.surfaceKind === 'ice'
            ? PLAYER_ACCELERATION * 0.35
            : PLAYER_ACCELERATION)
        : PLAYER_AIR_ACCELERATION;
    const braking = working.grounded
        ? (supportingSurface?.surfaceKind === 'ice'
            ? PLAYER_BRAKING * 0.15
            : PLAYER_BRAKING)
        : PLAYER_AIR_ACCELERATION * 0.45;
    if (input.horizontal === 0) {
        velocityX = approach(velocityX, 0, braking * seconds);
    } else {
        velocityX = approach(
            velocityX,
            input.horizontal * PLAYER_MAX_SPEED,
            acceleration * seconds
        );
    }
    const facing = input.horizontal === 0 ? working.facing : input.horizontal;
    velocityY = Math.min(PLAYER_MAX_FALL_SPEED, velocityY + PLAYER_GRAVITY * seconds);
    const conveyorVelocity = working.grounded && supportingSurface?.surfaceKind === 'conveyor'
        ? supportingSurface.conveyorVelocity
        : 0;
    const previousBottom = working.y + PLATFORMER_PLAYER_SIZE.height;
    let x = clamp(
        working.x + (velocityX + conveyorVelocity) * seconds,
        0,
        level.width - PLATFORMER_PLAYER_SIZE.width
    );
    let y = working.y + velocityY * seconds;
    const nextBottom = y + PLATFORMER_PLAYER_SIZE.height;

    if (velocityY >= 0) {
        for (const platform of level.platforms) {
            if (!isPlatformSolid(working, platform)) continue;
            const rect = runtimePlatformRect(working, platform);
            const horizontalOverlap = x < rect.x + rect.width &&
                x + PLATFORMER_PLAYER_SIZE.width > rect.x;
            if (!horizontalOverlap || previousBottom > rect.y + 2 || nextBottom < rect.y) continue;
            y = rect.y - PLATFORMER_PLAYER_SIZE.height;
            if (platform.surfaceKind === 'bounce') {
                velocityY = -560;
                jumpCutEligible = false;
                events.push({kind: 'jump'});
            } else {
                velocityY = 0;
                grounded = true;
                groundedPlatformId = platform.id;
                coyoteMs = 100;
            }
            break;
        }
    }

    working = {
        ...working,
        x,
        y,
        velocityX,
        velocityY,
        jumpCutEligible: velocityY >= 0 ? false : jumpCutEligible,
        facing,
        grounded,
        groundedPlatformId,
        coyoteMs
    };

    if (working.fireBufferMs > 0 && working.fireCooldownMs <= 0) {
        if (!working.weaponOwned || working.ammo <= 0) {
            events.push({kind: 'empty-weapon'});
            working = {...working, fireBufferMs: 0};
        } else {
            const projectile: PlatformerProjectile = {
                id: `player-shot-${working.nextProjectileId}`,
                owner: 'player',
                x: working.x + (working.facing === 1 ? PLATFORMER_PLAYER_SIZE.width : 0),
                y: working.y + 18,
                velocityX: working.facing * PLAYER_PROJECTILE_SPEED,
                velocityY: 0,
                remainingMs: PLAYER_PROJECTILE_LIFETIME_MS
            };
            working = {
                ...working,
                ammo: working.ammo - 1,
                fireCooldownMs: PLAYER_SHOT_COOLDOWN_MS,
                fireBufferMs: 0,
                nextProjectileId: working.nextProjectileId + 1,
                projectiles: [...working.projectiles, projectile]
            };
            events.push({kind: 'shot-fired'});
        }
    }

    const enemyUpdate = updateEnemies(working, level, stepMs);
    let projectiles = [...working.projectiles, ...enemyUpdate.spawnedProjectiles]
        .map(projectile => ({
            ...projectile,
            x: projectile.x + projectile.velocityX * seconds,
            y: projectile.y + projectile.velocityY * seconds,
            remainingMs: projectile.remainingMs - stepMs
        }))
        .filter(projectile =>
            projectile.remainingMs > 0 &&
            projectile.x >= -20 &&
            projectile.x <= level.width + 20
        );
    working = {
        ...working,
        enemies: enemyUpdate.enemies,
        projectiles,
        nextProjectileId: working.nextProjectileId + enemyUpdate.spawnedProjectiles.length
    };
    working = resolvePlayerShots(working, events);
    projectiles = [];
    for (const projectile of working.projectiles) {
        if (projectile.owner === 'enemy' && overlaps(
            working.x,
            working.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            {x: projectile.x - 5, y: projectile.y - 4, width: 10, height: 8}
        )) {
            working = damagePlayer(working, projectile.x, events);
        } else {
            projectiles.push(projectile);
        }
    }
    working = {...working, projectiles};

    const contactEnemy = working.enemies.find(enemy =>
        enemy.health > 0 &&
        overlaps(
            working.x,
            working.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            {x: enemy.x - 15, y: enemy.y - 30, width: 30, height: 34}
        )
    );
    if (contactEnemy) working = damagePlayer(working, contactEnemy.x, events);
    if (working.health <= 0) working = respawn(working, level, events);

    const hitHazard = level.hazards.some(hazard =>
        overlaps(
            working.x,
            working.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            hazard
        )
    );
    if (working.status === 'active' && (hitHazard || working.y > level.height)) {
        working = respawn(working, level, events);
    }
    if (working.status !== 'active') return {state: working, events};

    working = collectItems(working, level, events);
    working = collectCheckpoint(working, level, events);
    if (overlaps(
        working.x,
        working.y,
        PLATFORMER_PLAYER_SIZE.width,
        PLATFORMER_PLAYER_SIZE.height,
        level.goal
    )) {
        const missing = Math.max(0, level.requiredCoreTotal - working.collectedCoreIds.length);
        if (missing > 0) {
            if (working.lastExitMissingCount !== missing) {
                events.push({kind: 'exit-locked', missing});
            }
            working = {...working, lastExitMissingCount: missing};
        } else {
            events.push({kind: 'success'});
            working = {
                ...working,
                status: 'success',
                completed: true,
                lastExitMissingCount: 0
            };
        }
    } else if (working.lastExitMissingCount !== null) {
        working = {...working, lastExitMissingCount: null};
    }
    return {state: working, events};
}

export function advancePlatformer(
    state: PlatformerState,
    input: PlatformerInput,
    level: PlatformerLevel,
    deltaMs: number
): PlatformerStepResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Platformer time delta must be a finite non-negative number.');
    }
    if (state.paused || state.status !== 'active' || deltaMs === 0) {
        return {state, events: []};
    }
    let working: PlatformerState = {
        ...state,
        accumulatorMs: state.accumulatorMs + deltaMs,
        jumpBufferMs: input.jumpPressed ? 120 : state.jumpBufferMs,
        fireBufferMs: input.firePressed === true ? 120 : state.fireBufferMs
    };
    const events: PlatformerEvent[] = [];
    while (working.accumulatorMs >= PLATFORMER_FIXED_STEP_MS &&
        working.status === 'active') {
        const stepped = stepFixed(working, input, level, PLATFORMER_FIXED_STEP_MS);
        working = {
            ...stepped.state,
            accumulatorMs: working.accumulatorMs - PLATFORMER_FIXED_STEP_MS
        };
        events.push(...stepped.events);
    }
    return {state: working, events};
}

export function stepPlatformer(
    state: PlatformerState,
    input: PlatformerInput,
    level: PlatformerLevel,
    deltaMs: number
): PlatformerState {
    return advancePlatformer(state, input, level, deltaMs).state;
}

export function platformerGrade(
    state: PlatformerState,
    level: PlatformerLevel
): 's' | 'a' | 'b' | 'c' | 'none' {
    if (state.status !== 'success') return 'none';
    const salvage = state.collectedSalvageIds.length;
    if (
        state.activeElapsedMs <= 105_000 &&
        state.deaths === 0 &&
        state.damageEvents <= 1 &&
        salvage === level.optionalSalvageTotal
    ) return 's';
    if (
        state.activeElapsedMs <= 130_000 &&
        state.deaths <= 1 &&
        salvage >= Math.ceil(level.optionalSalvageTotal / 2)
    ) return 'a';
    if (state.deaths <= 3) return 'b';
    return 'c';
}

export function platformerScore(state: PlatformerState): number {
    if (state.status !== 'success') return 0;
    return Math.max(
        500,
        3_000 +
        250 * state.collectedSalvageIds.length +
        150 * state.defeatedEnemyIds.length -
        300 * state.deaths -
        100 * state.damageEvents -
        5 * Math.floor(state.activeElapsedMs / 1_000)
    );
}

export function platformerOutcome(
    status: 'success' | 'failure' | 'abandoned',
    state: PlatformerState
): PlatformerOutcomeSummary {
    if (status === 'success') {
        return {
            scrapDelta: 4 + Math.min(3, state.collectedSalvageIds.length),
            campaignHealthDelta: 2,
            structuralStabilityDelta: 20,
            flags: [
                'sublevel-nine-stabilized',
                `memory-cartridges-${state.collectedCoreIds.length}`
            ]
        };
    }
    return {
        scrapDelta: 0,
        campaignHealthDelta: status === 'failure' ? -2 : -1,
        structuralStabilityDelta: -5,
        flags: ['sublevel-nine-awaits-repairs']
    };
}
