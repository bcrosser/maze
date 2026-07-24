import {randomInteger, type RandomSource} from '../../domain/random/random-source';

/**
 * The lane exports are retained for older integration/E2E callers. The gameplay
 * model no longer uses lanes; `lane` is only a coarse spawn-band hint.
 */
export const SHOOTER_LANES = [0, 1, 2, 3, 4] as const;
export type ShooterLane = (typeof SHOOTER_LANES)[number];

export const SHOOTER_FIXED_STEP_MS = 1000 / 60;
export const SHOOTER_APPROACH_END_MS = 20_000;
export const SHOOTER_WRECK_END_MS = 50_000;
export const SHOOTER_ELITE_END_MS = 65_000;
export const SHOOTER_LEVEL_TIER_CAP = 5;
export const SHOOTER_MISSION_LIMIT_MS = 300_000;
export const SHOOTER_MISSION_LIMIT_TIER_BONUS_MS = 30_000;
export const SHOOTER_BOMB_RADIUS = 280;
export const SHOOTER_BOSS_CORE_HIT_RADIUS = 34;

export function getShooterMissionLimitMs(levelTier: number): number {
    if (!Number.isFinite(levelTier)) {
        throw new Error('Shooter level tier must be a finite number.');
    }
    const normalizedTier = Math.min(
        SHOOTER_LEVEL_TIER_CAP,
        Math.max(0, Math.floor(levelTier))
    );
    return SHOOTER_MISSION_LIMIT_MS +
        normalizedTier * SHOOTER_MISSION_LIMIT_TIER_BONUS_MS;
}

export const SHOOTER_BOUNDS = Object.freeze({
    minX: 34,
    maxX: 300,
    minY: 126,
    maxY: 632
});

export type ShooterStagePhase = 'approach' | 'wreck' | 'elite' | 'boss';
export type ShooterTerminalStatus = 'success' | 'failure' | null;
export type ShooterEnemyArchetype = 'scout' | 'fighter' | 'turret' | 'carrier' | 'mine';
export type ShooterPathKind = 'swoop' | 'formation' | 'mounted' | 'carrier' | 'drift';
export type ShooterPickupKind =
    | 'splitter-core'
    | 'beam-coil'
    | 'companion-drone'
    | 'shield-cell'
    | 'bomb-refill';
export type ShooterWeaponCore = 'splitter-core' | 'beam-coil';
export type ShooterUtilityModule = 'companion-drone';
export type ShooterModuleChoiceAction = 'equip' | 'convert' | 'keep';

export interface ShooterPoint {
    readonly x: number;
    readonly y: number;
}

export interface ShooterWaveEntry {
    readonly id: string;
    readonly spawnAtMs: number;
    readonly lane: ShooterLane;
    readonly speed: number;
    readonly health: number;
    readonly score: number;
    readonly archetype: ShooterEnemyArchetype;
    readonly phase: Exclude<ShooterStagePhase, 'boss'>;
    readonly path: ShooterPathKind;
    readonly spawnY: number;
    readonly pathAmplitude: number;
    readonly pathPeriodMs: number;
    readonly fireIntervalMs: number;
    readonly fireOffsetMs: number;
    readonly drop: ShooterPickupDefinition | null;
}

export interface ShooterHazardDefinition {
    readonly id: string;
    readonly spawnAtMs: number;
    readonly y: number;
    readonly speed: number;
    readonly radius: number;
    readonly spinDirection: -1 | 1;
}

export interface ShooterPickupDefinition {
    readonly id: string;
    readonly kind: ShooterPickupKind;
    readonly unstable: boolean;
}

export interface ShooterPickupSpawn {
    readonly id: string;
    readonly spawnAtMs: number;
    readonly y: number;
    readonly pickup: ShooterPickupDefinition;
}

export interface ShooterBossDefinition {
    readonly patternVariant: number;
    readonly phaseOrderHint: readonly [string, string, string];
    readonly nodeHealth: number;
    readonly phaseTwoCoreHealth: number;
    readonly phaseThreeCoreHealth: number;
}

export interface ShooterMission {
    readonly startingShield: number;
    readonly maximumShield: number;
    readonly waves: readonly ShooterWaveEntry[];
    readonly hazards: readonly ShooterHazardDefinition[];
    readonly pickupSpawns: readonly ShooterPickupSpawn[];
    readonly boss: ShooterBossDefinition;
    readonly securityRank: number;
    readonly levelTier: number;
    readonly baseProjectileSpeedMultiplier: number;
    readonly unstableOfferCap: number;
    readonly archiveHint: string | null;
}

export interface ShooterMissionModifiers {
    readonly powerRouting: number;
    readonly archiveIntel: boolean;
    readonly securityAlert: number;
    readonly difficulty?: 'story' | 'standard' | 'expert';
    readonly levelTier?: number;
}

export interface ShooterInput {
    readonly moveX: number;
    readonly moveY: number;
    readonly fireHeld: boolean;
    readonly firePressed?: boolean;
    readonly fireReleased?: boolean;
    readonly bombPressed?: boolean;
}

export const NEUTRAL_SHOOTER_INPUT: ShooterInput = Object.freeze({
    moveX: 0,
    moveY: 0,
    fireHeld: false
});

export interface ShooterShotProfile {
    readonly holdMs: number;
    readonly damage: number;
    readonly penetrations: number;
    readonly cooldownMs: number;
    readonly speed: number;
}

export interface ShooterPlayerState {
    readonly position: ShooterPoint;
    readonly velocity: ShooterPoint;
    readonly hull: number;
    readonly maxHull: number;
    readonly shield: number;
    readonly maxShield: number;
    readonly bombs: number;
    readonly maxBombs: number;
    readonly bombsUsed: number;
    readonly chargeMs: number | null;
    readonly cooldownMs: number;
    readonly invulnerabilityMs: number;
    readonly hitsTaken: number;
    readonly weaponCore: ShooterWeaponCore | null;
    readonly weaponCoreUnstable: boolean;
    readonly utilityModule: ShooterUtilityModule | null;
    readonly utilityModuleUnstable: boolean;
    readonly droneBlocksRemaining: number;
}

export interface ShooterProjectileState {
    readonly id: string;
    readonly allegiance: 'player' | 'hostile';
    readonly position: ShooterPoint;
    readonly velocity: ShooterPoint;
    readonly damage: number;
    readonly penetrationsRemaining: number;
    readonly radius: number;
    readonly source: 'primary' | 'splitter' | 'drone' | 'enemy' | 'boss';
    readonly hitEntityIds: readonly string[];
}

export interface ShooterEnemyState {
    readonly id: string;
    readonly definitionId: string;
    readonly archetype: ShooterEnemyArchetype;
    readonly path: ShooterPathKind;
    readonly position: ShooterPoint;
    readonly spawnY: number;
    readonly speed: number;
    readonly pathAmplitude: number;
    readonly pathPeriodMs: number;
    readonly ageMs: number;
    readonly health: number;
    readonly maxHealth: number;
    readonly score: number;
    readonly radius: number;
    readonly fireIntervalMs: number;
    readonly shotTimerMs: number;
    readonly windupMs: number;
    readonly drop: ShooterPickupDefinition | null;
}

export interface ShooterHazardState {
    readonly id: string;
    readonly position: ShooterPoint;
    readonly speed: number;
    readonly radius: number;
    readonly rotation: number;
    readonly spinDirection: -1 | 1;
}

export interface ShooterPickupState {
    readonly id: string;
    readonly definition: ShooterPickupDefinition;
    readonly position: ShooterPoint;
    readonly velocity: ShooterPoint;
    readonly ageMs: number;
    readonly lifetimeMs: number;
}

export interface ShooterBossState {
    readonly phase: 1 | 2 | 3;
    readonly position: ShooterPoint;
    readonly nodeHealth: readonly [number, number];
    readonly nodeMaxHealth: readonly [number, number];
    readonly coreHealth: number;
    readonly coreMaxHealth: number;
    readonly coreExposed: boolean;
    readonly phaseElapsedMs: number;
    readonly attackTimerMs: number;
    readonly windupMs: number;
    readonly attackIndex: number;
}

export interface ShooterModuleChoice {
    readonly pickup: ShooterPickupDefinition;
}

export interface ShooterState {
    readonly mission: ShooterMission;
    readonly player: ShooterPlayerState;
    readonly projectiles: readonly ShooterProjectileState[];
    readonly enemies: readonly ShooterEnemyState[];
    readonly hazards: readonly ShooterHazardState[];
    readonly pickups: readonly ShooterPickupState[];
    readonly boss: ShooterBossState | null;
    readonly moduleChoice: ShooterModuleChoice | null;
    readonly phase: ShooterStagePhase;
    readonly activeTicks: number;
    readonly accumulatorMs: number;
    readonly directorIndex: number;
    readonly hazardIndex: number;
    readonly pickupSpawnIndex: number;
    readonly worldScroll: number;
    readonly rawScore: number;
    readonly kills: number;
    readonly escapedEnemies: number;
    readonly threatRank: number;
    readonly terminal: ShooterTerminalStatus;
    readonly terminalReason: 'boss-destroyed' | 'hull-lost' | 'warden-escaped' | null;
    readonly nextEntityId: number;
    readonly paused: boolean;
    readonly pendingFirePressed: boolean;
    readonly pendingFireReleased: boolean;
    readonly pendingBombPressed: boolean;
}

interface MutableShooterState {
    mission: ShooterMission;
    player: ShooterPlayerState;
    projectiles: ShooterProjectileState[];
    enemies: ShooterEnemyState[];
    hazards: ShooterHazardState[];
    pickups: ShooterPickupState[];
    boss: ShooterBossState | null;
    moduleChoice: ShooterModuleChoice | null;
    phase: ShooterStagePhase;
    activeTicks: number;
    accumulatorMs: number;
    directorIndex: number;
    hazardIndex: number;
    pickupSpawnIndex: number;
    worldScroll: number;
    rawScore: number;
    kills: number;
    escapedEnemies: number;
    threatRank: number;
    terminal: ShooterTerminalStatus;
    terminalReason: 'boss-destroyed' | 'hull-lost' | 'warden-escaped' | null;
    nextEntityId: number;
    paused: boolean;
    pendingFirePressed: boolean;
    pendingFireReleased: boolean;
    pendingBombPressed: boolean;
}

const ENEMY_VALUES: Readonly<Record<ShooterEnemyArchetype, {
    health: number;
    speed: number;
    score: number;
    radius: number;
    fireIntervalMs: number;
    path: ShooterPathKind;
}>> = Object.freeze({
    scout: {health: 1, speed: 172, score: 100, radius: 15, fireIntervalMs: 2_600, path: 'swoop'},
    fighter: {health: 2, speed: 126, score: 150, radius: 17, fireIntervalMs: 2_200, path: 'formation'},
    turret: {health: 3, speed: 88, score: 250, radius: 19, fireIntervalMs: 1_900, path: 'mounted'},
    carrier: {health: 7, speed: 70, score: 400, radius: 25, fireIntervalMs: 1_650, path: 'carrier'},
    mine: {health: 1, speed: 94, score: 100, radius: 15, fireIntervalMs: 99_000, path: 'drift'}
});

const EQUIPABLE_PICKUPS = [
    'splitter-core',
    'beam-coil',
    'companion-drone'
] as const satisfies readonly ShooterPickupKind[];

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function length(x: number, y: number): number {
    return Math.hypot(x, y);
}

function distanceSquared(first: ShooterPoint, second: ShooterPoint): number {
    const x = first.x - second.x;
    const y = first.y - second.y;
    return x * x + y * y;
}

function isEquipable(kind: ShooterPickupKind): kind is ShooterWeaponCore | ShooterUtilityModule {
    return kind === 'splitter-core' || kind === 'beam-coil' || kind === 'companion-drone';
}

export function rollShooterUnstableVariant(random: RandomSource): boolean {
    const value = random.next();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error('RandomSource.next() must return a number in [0, 1).');
    }
    return value < 0.10;
}

function phaseForSpawn(spawnAtMs: number): Exclude<ShooterStagePhase, 'boss'> {
    if (spawnAtMs < SHOOTER_APPROACH_END_MS) return 'approach';
    if (spawnAtMs < SHOOTER_WRECK_END_MS) return 'wreck';
    return 'elite';
}

function laneForY(y: number): ShooterLane {
    return clamp(Math.floor((y - 120) / 102), 0, 4) as ShooterLane;
}

function rollPickup(
    random: RandomSource,
    id: string,
    kind: ShooterPickupKind,
    unstableRemaining: {value: number}
): ShooterPickupDefinition {
    const rolledUnstable = isEquipable(kind) && rollShooterUnstableVariant(random);
    const unstable = rolledUnstable && unstableRemaining.value > 0;
    if (unstable) unstableRemaining.value--;
    return {id, kind, unstable};
}

function createWave(
    random: RandomSource,
    index: number,
    spawnAtMs: number,
    archetype: ShooterEnemyArchetype,
    drop: ShooterPickupDefinition | null
): ShooterWaveEntry {
    const values = ENEMY_VALUES[archetype];
    const spawnY = 155 + randomInteger(random, 430);
    const speedVariance = randomInteger(random, 25) - 12;
    return {
        id: `enemy-${index + 1}`,
        spawnAtMs,
        lane: laneForY(spawnY),
        speed: values.speed + speedVariance,
        health: values.health,
        score: values.score,
        archetype,
        phase: phaseForSpawn(spawnAtMs),
        path: values.path,
        spawnY,
        pathAmplitude: archetype === 'turret'
            ? 0
            : 18 + randomInteger(random, archetype === 'scout' ? 60 : 34),
        pathPeriodMs: 1_500 + randomInteger(random, 1_800),
        fireIntervalMs: values.fireIntervalMs + randomInteger(random, 600),
        fireOffsetMs: 650 + randomInteger(random, 900),
        drop
    };
}

export function calculateHostileProjectileSpeedMultiplier(
    securityRank: number,
    levelTier: number,
    threatRank: number
): number {
    return Math.min(
        1.50,
        1 +
        0.03 * clamp(Math.floor(securityRank), 0, 5) +
        0.04 * clamp(Math.floor(levelTier), 0, SHOOTER_LEVEL_TIER_CAP) +
        0.08 * clamp(Math.floor(threatRank), 0, 3)
    );
}

export function createShooterMission(
    random: RandomSource,
    modifiers: ShooterMissionModifiers
): ShooterMission {
    const difficulty = modifiers.difficulty ?? 'standard';
    const levelTier = clamp(
        Math.floor(modifiers.levelTier ?? 0),
        0,
        SHOOTER_LEVEL_TIER_CAP
    );
    const securityRank = clamp(Math.floor(modifiers.securityAlert / 20), 0, 5);
    const poweredShield = modifiers.powerRouting >= 60;
    const unstableOfferCap = difficulty === 'expert' ? 2 : 1;
    const unstableRemaining = {value: unstableOfferCap};
    const waves: ShooterWaveEntry[] = [];
    let waveIndex = 0;

    const addFormation = (
        startMs: number,
        count: number,
        spacingMs: number,
        choices: readonly ShooterEnemyArchetype[]
    ): void => {
        for (let entry = 0; entry < count; entry++) {
            const archetype = choices[randomInteger(random, choices.length)]!;
            waves.push(createWave(
                random,
                waveIndex++,
                startMs + entry * spacingMs + randomInteger(random, 240),
                archetype,
                null
            ));
        }
    };

    addFormation(1_600, 4, 1_450, ['scout', 'fighter']);
    addFormation(8_500, 5, 1_650, ['scout', 'fighter']);
    addFormation(20_800, 7, 2_100, ['fighter', 'turret', 'mine']);
    addFormation(35_500, 7, 1_850, ['scout', 'turret', 'mine']);
    addFormation(50_600, 4, 2_450, ['fighter', 'carrier', 'turret']);

    // The three tutorial targets are intentionally harmless practice passes.
    for (let index = 0; index < Math.min(3, waves.length); index++) {
        waves[index] = {...waves[index]!, fireOffsetMs: 99_000};
    }

    // Security rank adds exactly that many one-point normal-enemy budget entries.
    // They are staggered by at least 1.8 s, keeping the simultaneous increment <= 2.
    for (let extra = 0; extra < securityRank; extra++) {
        const spawnAtMs = extra % 2 === 0
            ? 26_000 + extra * 1_800
            : 53_000 + extra * 1_800;
        waves.push(createWave(
            random,
            waveIndex++,
            spawnAtMs,
            extra % 2 === 0 ? 'scout' : 'mine',
            null
        ));
    }

    const optionalKind = EQUIPABLE_PICKUPS[randomInteger(random, EQUIPABLE_PICKUPS.length)]!;
    const optionalDrop = rollPickup(
        random,
        'pickup-carrier',
        optionalKind,
        unstableRemaining
    );
    const carrierIndex = waves.findIndex(wave =>
        wave.phase === 'wreck' && wave.archetype === 'turret'
    );
    if (carrierIndex >= 0) {
        const original = waves[carrierIndex]!;
        waves[carrierIndex] = {...original, drop: optionalDrop};
    }

    waves.sort((first, second) =>
        first.spawnAtMs - second.spawnAtMs || first.id.localeCompare(second.id)
    );

    const guaranteedKind = EQUIPABLE_PICKUPS[randomInteger(random, EQUIPABLE_PICKUPS.length)]!;
    const guaranteedPickup = rollPickup(
        random,
        'pickup-elite-guaranteed',
        guaranteedKind,
        unstableRemaining
    );
    const defensiveKind: ShooterPickupKind = random.next() < 0.5 ? 'shield-cell' : 'bomb-refill';
    const defensivePickup = rollPickup(
        random,
        'pickup-defensive',
        defensiveKind,
        unstableRemaining
    );
    const pickupSpawns: ShooterPickupSpawn[] = [
        {
            id: 'spawn-defensive',
            spawnAtMs: 45_000 + randomInteger(random, 2_000),
            y: 175 + randomInteger(random, 390),
            pickup: defensivePickup
        },
        {
            id: 'spawn-elite-guaranteed',
            spawnAtMs: 62_000,
            y: 220 + randomInteger(random, 290),
            pickup: guaranteedPickup
        }
    ];

    const hazards: ShooterHazardDefinition[] = Array.from({length: 8}, (_, index) => ({
        id: `debris-${index + 1}`,
        spawnAtMs: 21_500 + index * 3_350 + randomInteger(random, 850),
        y: 145 + randomInteger(random, 455),
        speed: 82 + randomInteger(random, 65),
        radius: 13 + randomInteger(random, 12),
        spinDirection: random.next() < 0.5 ? -1 : 1
    }));
    const patternVariant = randomInteger(random, 12);
    const hintOptions = [
        'Lattice nodes fail from top to bottom.',
        'Core windows follow the warning rings.',
        'Emergency sweeps alternate around the centerline.'
    ] as const;
    // Health is integral, so each exact +10% tier increment rounds upward.
    // Integer arithmetic keeps the roll deterministic across runtimes.
    const scaledBossHealth = (baseHealth: number): number =>
        Math.ceil(baseHealth * (10 + levelTier) / 10);

    return {
        startingShield: poweredShield ? 2 : 1,
        maximumShield: poweredShield ? 2 : 1,
        waves,
        hazards,
        pickupSpawns,
        boss: {
            patternVariant,
            phaseOrderHint: ['shield lattice', 'open core', 'emergency protocol'],
            nodeHealth: scaledBossHealth(8),
            phaseTwoCoreHealth: scaledBossHealth(12),
            phaseThreeCoreHealth: scaledBossHealth(18)
        },
        securityRank,
        levelTier,
        baseProjectileSpeedMultiplier: calculateHostileProjectileSpeedMultiplier(
            securityRank,
            levelTier,
            0
        ),
        unstableOfferCap,
        archiveHint: modifiers.archiveIntel
            ? hintOptions[patternVariant % hintOptions.length]!
            : null
    };
}

export function createShooterState(mission: ShooterMission): ShooterState {
    return {
        mission,
        player: {
            position: {x: 116, y: 380},
            velocity: {x: 0, y: 0},
            hull: 3,
            maxHull: 3,
            shield: mission.startingShield,
            maxShield: mission.maximumShield,
            bombs: 2,
            maxBombs: 3,
            bombsUsed: 0,
            chargeMs: null,
            cooldownMs: 0,
            invulnerabilityMs: 0,
            hitsTaken: 0,
            weaponCore: null,
            weaponCoreUnstable: false,
            utilityModule: null,
            utilityModuleUnstable: false,
            droneBlocksRemaining: 0
        },
        projectiles: [],
        enemies: [],
        hazards: [],
        pickups: [],
        boss: null,
        moduleChoice: null,
        phase: 'approach',
        activeTicks: 0,
        accumulatorMs: 0,
        directorIndex: 0,
        hazardIndex: 0,
        pickupSpawnIndex: 0,
        worldScroll: 0,
        rawScore: 0,
        kills: 0,
        escapedEnemies: 0,
        threatRank: 0,
        terminal: null,
        terminalReason: null,
        nextEntityId: 1,
        paused: false,
        pendingFirePressed: false,
        pendingFireReleased: false,
        pendingBombPressed: false
    };
}

export function calculatePrimaryShot(
    holdMs: number,
    weaponCore: ShooterWeaponCore | null,
    unstable: boolean
): ShooterShotProfile {
    const clampedHoldMs = Math.max(0, holdMs);
    if (clampedHoldMs < 250) {
        return {
            holdMs: clampedHoldMs,
            damage: 1,
            penetrations: 1,
            cooldownMs: 180,
            speed: 520
        };
    }

    let capMs = 1_200;
    let maxDamage = 6;
    let maxPenetrations = 3;
    let cooldownMultiplier = 1;
    if (weaponCore === 'beam-coil') {
        capMs = unstable ? 750 : 900;
        maxDamage = unstable ? 8 : 7;
        maxPenetrations = 4;
        cooldownMultiplier = unstable ? 1.10 : 1.20;
    }
    const u = clamp((Math.min(clampedHoldMs, capMs) - 250) / (capMs - 250), 0, 1);
    return {
        holdMs: clampedHoldMs,
        damage: 2 + Math.floor((maxDamage - 2) * u),
        penetrations: 1 + Math.floor((maxPenetrations - 1) * u),
        cooldownMs: Math.round((180 + 270 * u) * cooldownMultiplier),
        speed: 520
    };
}

function cloneState(state: ShooterState): MutableShooterState {
    return {
        ...state,
        player: {
            ...state.player,
            position: {...state.player.position},
            velocity: {...state.player.velocity}
        },
        projectiles: state.projectiles.map(projectile => ({
            ...projectile,
            position: {...projectile.position},
            velocity: {...projectile.velocity}
        })),
        enemies: state.enemies.map(enemy => ({
            ...enemy,
            position: {...enemy.position}
        })),
        hazards: state.hazards.map(hazard => ({
            ...hazard,
            position: {...hazard.position}
        })),
        pickups: state.pickups.map(pickup => ({
            ...pickup,
            position: {...pickup.position},
            velocity: {...pickup.velocity}
        })),
        boss: state.boss === null
            ? null
            : {
                ...state.boss,
                position: {...state.boss.position},
                nodeHealth: [...state.boss.nodeHealth] as [number, number],
                nodeMaxHealth: [...state.boss.nodeMaxHealth] as [number, number]
            }
    };
}

function nextId(state: MutableShooterState, prefix: string): string {
    const id = `${prefix}-${state.nextEntityId}`;
    state.nextEntityId++;
    return id;
}

function spawnPlayerProjectile(
    state: MutableShooterState,
    yOffset: number,
    angleRadians: number,
    damage: number,
    penetrations: number,
    source: ShooterProjectileState['source']
): void {
    const speed = 520;
    state.projectiles.push({
        id: nextId(state, 'shot'),
        allegiance: 'player',
        position: {
            x: state.player.position.x + 24,
            y: state.player.position.y + yOffset
        },
        velocity: {
            x: Math.cos(angleRadians) * speed,
            y: Math.sin(angleRadians) * speed
        },
        damage: Math.max(1, Math.floor(damage)),
        penetrationsRemaining: Math.max(1, Math.floor(penetrations)),
        radius: source === 'primary' ? 5 : 4,
        source,
        hitEntityIds: []
    });
}

function releasePrimary(state: MutableShooterState, holdMs: number): void {
    const player = state.player;
    const profile = calculatePrimaryShot(
        holdMs,
        player.weaponCore,
        player.weaponCore === 'beam-coil' && player.weaponCoreUnstable
    );
    let forwardDamage = profile.damage;
    if (player.weaponCore === 'splitter-core') {
        forwardDamage = player.weaponCoreUnstable
            ? profile.damage
            : Math.max(1, Math.floor(profile.damage * 0.8));
    }
    spawnPlayerProjectile(
        state,
        0,
        0,
        forwardDamage,
        profile.penetrations,
        'primary'
    );

    if (player.weaponCore === 'splitter-core') {
        const sideDamage = player.weaponCoreUnstable
            ? Math.max(1, Math.ceil(profile.damage * 0.5))
            : Math.max(1, Math.floor(profile.damage * 0.4));
        const angle = 20 * Math.PI / 180;
        spawnPlayerProjectile(state, 0, -angle, sideDamage, 1, 'splitter');
        spawnPlayerProjectile(state, 0, angle, sideDamage, 1, 'splitter');
    }

    if (player.utilityModule === 'companion-drone') {
        const multiplier = player.utilityModuleUnstable ? 0.60 : 0.40;
        const droneDamage = Math.max(1, Math.ceil(profile.damage * multiplier));
        spawnPlayerProjectile(state, -22, 0, droneDamage, profile.penetrations, 'drone');
    }

    state.player = {
        ...state.player,
        chargeMs: null,
        cooldownMs: profile.cooldownMs
    };
}

function updatePlayer(state: MutableShooterState, input: ShooterInput): void {
    const stepSeconds = SHOOTER_FIXED_STEP_MS / 1000;
    let moveX = clamp(input.moveX, -1, 1);
    let moveY = clamp(input.moveY, -1, 1);
    const magnitude = length(moveX, moveY);
    if (magnitude > 1) {
        moveX /= magnitude;
        moveY /= magnitude;
    }

    const acceleration = 900;
    const deceleration = 1_050;
    const maxSpeed = 255;
    let velocityX = state.player.velocity.x;
    let velocityY = state.player.velocity.y;
    if (Math.abs(moveX) > 0.001) {
        velocityX += moveX * acceleration * stepSeconds;
    } else {
        velocityX = Math.sign(velocityX) * Math.max(
            0,
            Math.abs(velocityX) - deceleration * stepSeconds
        );
    }
    if (Math.abs(moveY) > 0.001) {
        velocityY += moveY * acceleration * stepSeconds;
    } else {
        velocityY = Math.sign(velocityY) * Math.max(
            0,
            Math.abs(velocityY) - deceleration * stepSeconds
        );
    }
    const speed = length(velocityX, velocityY);
    if (speed > maxSpeed) {
        velocityX = velocityX / speed * maxSpeed;
        velocityY = velocityY / speed * maxSpeed;
    }
    let x = clamp(
        state.player.position.x + velocityX * stepSeconds,
        SHOOTER_BOUNDS.minX,
        SHOOTER_BOUNDS.maxX
    );
    let y = clamp(
        state.player.position.y + velocityY * stepSeconds,
        SHOOTER_BOUNDS.minY,
        SHOOTER_BOUNDS.maxY
    );
    if (x === SHOOTER_BOUNDS.minX || x === SHOOTER_BOUNDS.maxX) velocityX = 0;
    if (y === SHOOTER_BOUNDS.minY || y === SHOOTER_BOUNDS.maxY) velocityY = 0;

    let chargeMs = state.player.chargeMs;
    if (input.firePressed && state.player.cooldownMs <= 0 && chargeMs === null) {
        chargeMs = 0;
    }
    if (chargeMs !== null && input.fireHeld) chargeMs += SHOOTER_FIXED_STEP_MS;

    state.player = {
        ...state.player,
        position: {x, y},
        velocity: {x: velocityX, y: velocityY},
        chargeMs,
        cooldownMs: Math.max(0, state.player.cooldownMs - SHOOTER_FIXED_STEP_MS),
        invulnerabilityMs: Math.max(
            0,
            state.player.invulnerabilityMs - SHOOTER_FIXED_STEP_MS
        )
    };

    if (input.fireReleased && chargeMs !== null && state.player.cooldownMs <= 0) {
        releasePrimary(state, chargeMs);
    } else if (input.fireReleased && chargeMs !== null) {
        state.player = {...state.player, chargeMs: null};
    }
}

function spawnEnemy(state: MutableShooterState, definition: ShooterWaveEntry): void {
    const radius = ENEMY_VALUES[definition.archetype].radius;
    state.enemies.push({
        id: definition.id,
        definitionId: definition.id,
        archetype: definition.archetype,
        path: definition.path,
        position: {x: 708 + radius, y: definition.spawnY},
        spawnY: definition.spawnY,
        speed: definition.speed,
        pathAmplitude: definition.pathAmplitude,
        pathPeriodMs: definition.pathPeriodMs,
        ageMs: 0,
        health: definition.health,
        maxHealth: definition.health,
        score: definition.score,
        radius,
        fireIntervalMs: definition.fireIntervalMs,
        shotTimerMs: definition.fireOffsetMs,
        windupMs: 0,
        drop: definition.drop
    });
}

function spawnHazard(state: MutableShooterState, definition: ShooterHazardDefinition): void {
    state.hazards.push({
        id: definition.id,
        position: {x: 710 + definition.radius, y: definition.y},
        speed: definition.speed,
        radius: definition.radius,
        rotation: 0,
        spinDirection: definition.spinDirection
    });
}

function spawnPickup(
    state: MutableShooterState,
    definition: ShooterPickupDefinition,
    position: ShooterPoint
): void {
    state.pickups.push({
        id: definition.id,
        definition,
        position: {...position},
        velocity: {x: -62, y: 0},
        ageMs: 0,
        lifetimeMs: 20_000
    });
}

function spawnScheduledContent(state: MutableShooterState, elapsedMs: number): void {
    while (
        state.directorIndex < state.mission.waves.length &&
        state.mission.waves[state.directorIndex]!.spawnAtMs <= elapsedMs
    ) {
        spawnEnemy(state, state.mission.waves[state.directorIndex]!);
        state.directorIndex++;
    }
    while (
        state.hazardIndex < state.mission.hazards.length &&
        state.mission.hazards[state.hazardIndex]!.spawnAtMs <= elapsedMs
    ) {
        spawnHazard(state, state.mission.hazards[state.hazardIndex]!);
        state.hazardIndex++;
    }
    while (
        state.pickupSpawnIndex < state.mission.pickupSpawns.length &&
        state.mission.pickupSpawns[state.pickupSpawnIndex]!.spawnAtMs <= elapsedMs
    ) {
        const spawn = state.mission.pickupSpawns[state.pickupSpawnIndex]!;
        spawnPickup(state, spawn.pickup, {x: 696, y: spawn.y});
        state.pickupSpawnIndex++;
    }
}

function phaseForElapsed(elapsedMs: number): ShooterStagePhase {
    if (elapsedMs < SHOOTER_APPROACH_END_MS) return 'approach';
    if (elapsedMs < SHOOTER_WRECK_END_MS) return 'wreck';
    if (elapsedMs < SHOOTER_ELITE_END_MS) return 'elite';
    return 'boss';
}

function enterBoss(state: MutableShooterState): void {
    state.enemies = [];
    state.hazards = [];
    state.projectiles = state.projectiles.filter(projectile =>
        projectile.allegiance === 'player'
    );
    const nodeHealth = state.mission.boss.nodeHealth;
    state.boss = {
        phase: 1,
        position: {x: 586, y: 380},
        nodeHealth: [nodeHealth, nodeHealth],
        nodeMaxHealth: [nodeHealth, nodeHealth],
        coreHealth: 0,
        coreMaxHealth: 0,
        coreExposed: false,
        phaseElapsedMs: 0,
        attackTimerMs: 1_300,
        windupMs: 0,
        attackIndex: 0
    };
}

function aimedVelocity(
    origin: ShooterPoint,
    target: ShooterPoint,
    speed: number,
    angleOffset = 0
): ShooterPoint {
    const baseAngle = Math.atan2(target.y - origin.y, target.x - origin.x) + angleOffset;
    return {x: Math.cos(baseAngle) * speed, y: Math.sin(baseAngle) * speed};
}

function spawnHostileProjectile(
    state: MutableShooterState,
    origin: ShooterPoint,
    velocity: ShooterPoint,
    source: 'enemy' | 'boss',
    radius = 6
): void {
    state.projectiles.push({
        id: nextId(state, source === 'boss' ? 'warden-shot' : 'hostile-shot'),
        allegiance: 'hostile',
        position: {...origin},
        velocity,
        damage: 1,
        penetrationsRemaining: 1,
        radius,
        source,
        hitEntityIds: []
    });
}

function fireEnemy(state: MutableShooterState, enemy: ShooterEnemyState): void {
    const speedMultiplier = calculateHostileProjectileSpeedMultiplier(
        state.mission.securityRank,
        state.mission.levelTier,
        state.threatRank
    );
    const speed = (enemy.archetype === 'carrier' ? 205 : 225) * speedMultiplier;
    const origin = {x: enemy.position.x - enemy.radius, y: enemy.position.y};
    spawnHostileProjectile(
        state,
        origin,
        aimedVelocity(origin, state.player.position, speed),
        'enemy'
    );
}

function updateEnemies(state: MutableShooterState): void {
    const stepSeconds = SHOOTER_FIXED_STEP_MS / 1000;
    const updated: ShooterEnemyState[] = [];
    for (const enemy of state.enemies) {
        const ageMs = enemy.ageMs + SHOOTER_FIXED_STEP_MS;
        let x = enemy.position.x - enemy.speed * stepSeconds;
        let y = enemy.position.y;
        const wave = Math.sin(ageMs / enemy.pathPeriodMs * Math.PI * 2);
        if (enemy.path === 'swoop') {
            y = enemy.spawnY + wave * enemy.pathAmplitude;
            x -= Math.max(0, wave) * 0.7;
        } else if (enemy.path === 'formation') {
            y = enemy.spawnY + wave * enemy.pathAmplitude * 0.45;
        } else if (enemy.path === 'mounted') {
            x = Math.max(510, x);
        } else if (enemy.path === 'carrier') {
            y = enemy.spawnY + wave * enemy.pathAmplitude * 0.25;
        } else {
            y = enemy.spawnY + wave * enemy.pathAmplitude * 0.65;
        }

        let shotTimerMs = enemy.shotTimerMs;
        let windupMs = enemy.windupMs;
        if (enemy.archetype !== 'mine') {
            if (windupMs > 0) {
                windupMs = Math.max(0, windupMs - SHOOTER_FIXED_STEP_MS);
                if (windupMs === 0) {
                    fireEnemy(state, {...enemy, position: {x, y}});
                    shotTimerMs = enemy.fireIntervalMs;
                }
            } else {
                shotTimerMs -= SHOOTER_FIXED_STEP_MS;
                if (shotTimerMs <= 0) windupMs = 600;
            }
        }

        if (x >= -enemy.radius - 12) {
            updated.push({
                ...enemy,
                position: {x, y: clamp(y, 120, 640)},
                ageMs,
                shotTimerMs,
                windupMs
            });
        } else {
            state.escapedEnemies++;
        }
    }
    state.enemies = updated;
}

function bossComponentPositions(boss: ShooterBossState): {
    firstNode: ShooterPoint;
    secondNode: ShooterPoint;
    core: ShooterPoint;
} {
    return {
        firstNode: {x: boss.position.x - 8, y: boss.position.y - 92},
        secondNode: {x: boss.position.x - 8, y: boss.position.y + 92},
        core: {x: boss.position.x - 18, y: boss.position.y}
    };
}

function fireBossPattern(state: MutableShooterState, boss: ShooterBossState): void {
    const speedMultiplier = calculateHostileProjectileSpeedMultiplier(
        state.mission.securityRank,
        state.mission.levelTier,
        state.threatRank
    );
    const speed = (boss.phase === 3 ? 270 : 235) * speedMultiplier;
    const origin = {x: boss.position.x - 48, y: boss.position.y};
    const variant = (state.mission.boss.patternVariant + boss.attackIndex) % 3;
    const baseOffsets = variant === 0
        ? [-0.22, 0, 0.22]
        : variant === 1
            ? [-0.38, -0.12, 0.12, 0.38]
            : [-0.28, -0.09, 0.09, 0.28];
    const rankModifiers =
        (state.mission.securityRank >= 2 ? 1 : 0) +
        (state.mission.securityRank >= 4 ? 1 : 0) +
        state.threatRank;
    const offsets = [...baseOffsets];
    for (let index = 0; index < rankModifiers; index++) {
        offsets.push((index % 2 === 0 ? -1 : 1) * (0.48 + Math.floor(index / 2) * 0.08));
    }
    for (const offset of offsets) {
        spawnHostileProjectile(
            state,
            origin,
            aimedVelocity(origin, state.player.position, speed, offset),
            'boss',
            boss.phase === 3 ? 7 : 6
        );
    }
}

function updateBoss(state: MutableShooterState): void {
    if (state.boss === null) return;
    let boss = state.boss;
    const phaseElapsedMs = boss.phaseElapsedMs + SHOOTER_FIXED_STEP_MS;
    const position = boss.phase === 3
        ? {
            x: 565 + Math.sin(phaseElapsedMs / 2_700 * Math.PI * 2) * 24,
            y: 380 + Math.sin(phaseElapsedMs / 3_500 * Math.PI * 2) * 125
        }
        : boss.position;
    const cycleMs = boss.phase === 2 ? 4_000 : 3_000;
    const cyclePosition = phaseElapsedMs % cycleMs;
    const criticalCore = boss.phase > 1 && boss.coreHealth === 1;
    const coreExposed = criticalCore || (
        boss.phase === 2
            ? cyclePosition >= 800 && cyclePosition < 3_300
            : boss.phase === 3 && cyclePosition >= 500 && cyclePosition < 2_700
    );
    let attackTimerMs = boss.attackTimerMs;
    let windupMs = boss.windupMs;
    let attackIndex = boss.attackIndex;
    if (windupMs > 0) {
        windupMs = Math.max(0, windupMs - SHOOTER_FIXED_STEP_MS);
        if (windupMs === 0) {
            fireBossPattern(state, {...boss, position});
            attackIndex++;
            attackTimerMs = boss.phase === 1 ? 2_300 : boss.phase === 2 ? 1_850 : 1_350;
        }
    } else {
        attackTimerMs -= SHOOTER_FIXED_STEP_MS;
        if (attackTimerMs <= 0) windupMs = boss.phase === 3 ? 500 : 650;
    }
    boss = {
        ...boss,
        position,
        phaseElapsedMs,
        coreExposed,
        attackTimerMs,
        windupMs,
        attackIndex
    };
    state.boss = boss;
}

function updateProjectiles(state: MutableShooterState): void {
    const stepSeconds = SHOOTER_FIXED_STEP_MS / 1000;
    state.projectiles = state.projectiles
        .map(projectile => ({
            ...projectile,
            position: {
                x: projectile.position.x + projectile.velocity.x * stepSeconds,
                y: projectile.position.y + projectile.velocity.y * stepSeconds
            }
        }))
        .filter(projectile =>
            projectile.position.x >= -30 &&
            projectile.position.x <= 720 &&
            projectile.position.y >= 90 &&
            projectile.position.y <= 660
        );
}

function damagePlayer(state: MutableShooterState, sourceIsProjectile: boolean): boolean {
    if (state.player.invulnerabilityMs > 0 || state.terminal !== null) return false;
    if (
        sourceIsProjectile &&
        state.player.utilityModule === 'companion-drone' &&
        state.player.droneBlocksRemaining > 0
    ) {
        const remainingBlocks = state.player.droneBlocksRemaining - 1;
        state.player = {
            ...state.player,
            utilityModule: remainingBlocks === 0 ? null : state.player.utilityModule,
            utilityModuleUnstable: remainingBlocks === 0
                ? false
                : state.player.utilityModuleUnstable,
            droneBlocksRemaining: remainingBlocks
        };
        return true;
    }
    const shield = Math.max(0, state.player.shield - 1);
    const hull = state.player.shield > 0
        ? state.player.hull
        : Math.max(0, state.player.hull - 1);
    state.player = {
        ...state.player,
        shield,
        hull,
        velocity: {x: -150, y: state.player.velocity.y * -0.4},
        invulnerabilityMs: 900,
        hitsTaken: state.player.hitsTaken + 1
    };
    if (hull === 0) {
        state.terminal = 'failure';
        state.terminalReason = 'hull-lost';
    }
    return true;
}

function intersectsPlayerHitbox(
    playerPosition: ShooterPoint,
    objectPosition: ShooterPoint,
    objectRadius: number
): boolean {
    const closestX = clamp(
        objectPosition.x,
        playerPosition.x - 13,
        playerPosition.x + 13
    );
    const closestY = clamp(
        objectPosition.y,
        playerPosition.y - 9,
        playerPosition.y + 9
    );
    return distanceSquared(objectPosition, {x: closestX, y: closestY}) <= objectRadius ** 2;
}

function dropEnemyPickup(state: MutableShooterState, enemy: ShooterEnemyState): void {
    if (enemy.drop === null) return;
    spawnPickup(state, enemy.drop, enemy.position);
}

function damageEnemy(
    state: MutableShooterState,
    enemyIndex: number,
    damage: number
): boolean {
    const enemy = state.enemies[enemyIndex];
    if (enemy === undefined) return false;
    const health = Math.max(0, enemy.health - damage);
    if (health > 0) {
        state.enemies[enemyIndex] = {...enemy, health};
        return false;
    }
    state.enemies.splice(enemyIndex, 1);
    state.rawScore += enemy.score;
    state.kills++;
    dropEnemyPickup(state, enemy);
    return true;
}

function damageBossAtPoint(
    state: MutableShooterState,
    point: ShooterPoint,
    radius: number,
    damage: number
): boolean {
    const boss = state.boss;
    if (boss === null) return false;
    const positions = bossComponentPositions(boss);
    if (boss.phase === 1) {
        const nodes = [...boss.nodeHealth] as [number, number];
        const targets = [positions.firstNode, positions.secondNode] as const;
        for (let index = 0; index < targets.length; index++) {
            if (
                nodes[index]! > 0 &&
                distanceSquared(point, targets[index]!) <= (radius + 18) ** 2
            ) {
                const previous = nodes[index]!;
                nodes[index] = Math.max(0, previous - damage);
                if (previous > 0 && nodes[index] === 0) state.rawScore += 500;
                let updatedBoss: ShooterBossState = {...boss, nodeHealth: nodes};
                if (nodes[0] === 0 && nodes[1] === 0) {
                    updatedBoss = {
                        ...updatedBoss,
                        phase: 2,
                        coreHealth: state.mission.boss.phaseTwoCoreHealth,
                        coreMaxHealth: state.mission.boss.phaseTwoCoreHealth,
                        coreExposed: false,
                        phaseElapsedMs: 0,
                        attackTimerMs: 1_000,
                        windupMs: 0
                    };
                }
                state.boss = updatedBoss;
                return true;
            }
        }
        return false;
    }
    if (!boss.coreExposed) return false;
    if (boss.coreHealth <= 0) return false;
    if (
        distanceSquared(point, positions.core) >
        (radius + SHOOTER_BOSS_CORE_HIT_RADIUS) ** 2
    ) return false;
    const coreHealth = Math.max(0, boss.coreHealth - damage);
    if (coreHealth > 0) {
        state.boss = {...boss, coreHealth};
        return true;
    }
    if (boss.phase === 2) {
        state.boss = {
            ...boss,
            phase: 3,
            coreHealth: state.mission.boss.phaseThreeCoreHealth,
            coreMaxHealth: state.mission.boss.phaseThreeCoreHealth,
            coreExposed: false,
            phaseElapsedMs: 0,
            attackTimerMs: 700,
            windupMs: 0
        };
        return true;
    }
    state.boss = {...boss, coreHealth: 0};
    state.rawScore += 5_000;
    state.terminal = 'success';
    state.terminalReason = 'boss-destroyed';
    return true;
}

/**
 * Boss destruction is the authoritative terminal condition for the mission.
 * Keep this reconciliation separate from the collision that dealt the last
 * point of damage so a same-tick player hit, legacy stale failure, or scene completion
 * callback can never turn a defeated Warden into a failed attempt.
 */
export function reconcileShooterBossVictory(state: ShooterState): ShooterState {
    const bossDestroyed =
        state.boss?.phase === 3 &&
        state.boss.coreHealth <= 0;
    if (!bossDestroyed || (
        state.terminal === 'success' &&
        state.terminalReason === 'boss-destroyed'
    )) {
        return state;
    }
    return {
        ...state,
        terminal: 'success',
        terminalReason: 'boss-destroyed'
    };
}

function bossComponentHitId(
    boss: ShooterBossState,
    point: ShooterPoint,
    radius: number
): string | null {
    const positions = bossComponentPositions(boss);
    if (boss.phase === 1) {
        if (
            boss.nodeHealth[0] > 0 &&
            distanceSquared(point, positions.firstNode) <= (radius + 18) ** 2
        ) {
            return 'boss-node-0';
        }
        if (
            boss.nodeHealth[1] > 0 &&
            distanceSquared(point, positions.secondNode) <= (radius + 18) ** 2
        ) {
            return 'boss-node-1';
        }
        return null;
    }
    if (
        boss.coreHealth > 0 &&
        boss.coreExposed &&
        distanceSquared(point, positions.core) <=
            (radius + SHOOTER_BOSS_CORE_HIT_RADIUS) ** 2
    ) {
        return `boss-core-phase-${boss.phase}`;
    }
    return null;
}

function resolveProjectileCollisions(state: MutableShooterState): void {
    const surviving: ShooterProjectileState[] = [];
    for (const projectile of state.projectiles) {
        if (projectile.allegiance === 'hostile') {
            if (intersectsPlayerHitbox(
                state.player.position,
                projectile.position,
                projectile.radius
            )) {
                damagePlayer(state, true);
                continue;
            }
            surviving.push(projectile);
            continue;
        }

        let hit = false;
        let penetrationsRemaining = projectile.penetrationsRemaining;
        let hitEntityIds = [...projectile.hitEntityIds];
        for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
            const enemy = state.enemies[enemyIndex]!;
            if (hitEntityIds.includes(enemy.id)) continue;
            const hitRadius = projectile.radius + enemy.radius;
            if (distanceSquared(projectile.position, enemy.position) > hitRadius * hitRadius) {
                continue;
            }
            damageEnemy(state, enemyIndex, projectile.damage);
            penetrationsRemaining--;
            hitEntityIds.push(enemy.id);
            hit = true;
            break;
        }
        if (!hit && state.boss !== null) {
            const componentId = bossComponentHitId(
                state.boss,
                projectile.position,
                projectile.radius
            );
            if (componentId !== null && !hitEntityIds.includes(componentId)) {
                hit = damageBossAtPoint(
                    state,
                    projectile.position,
                    projectile.radius,
                    projectile.damage
                );
                if (hit) {
                    penetrationsRemaining--;
                    hitEntityIds.push(componentId);
                }
            }
        }
        if (!hit || penetrationsRemaining > 0) {
            surviving.push({...projectile, penetrationsRemaining, hitEntityIds});
        }
    }
    state.projectiles = surviving;
}

function resolveBodyCollisions(state: MutableShooterState): void {
    for (let index = state.enemies.length - 1; index >= 0; index--) {
        const enemy = state.enemies[index]!;
        if (!intersectsPlayerHitbox(
            state.player.position,
            enemy.position,
            enemy.radius
        )) {
            continue;
        }
        damagePlayer(state, false);
        state.enemies.splice(index, 1);
    }
    for (let index = state.hazards.length - 1; index >= 0; index--) {
        const hazard = state.hazards[index]!;
        if (!intersectsPlayerHitbox(
            state.player.position,
            hazard.position,
            hazard.radius
        )) {
            continue;
        }
        damagePlayer(state, false);
        state.hazards.splice(index, 1);
    }
}

function updateHazards(state: MutableShooterState): void {
    const stepSeconds = SHOOTER_FIXED_STEP_MS / 1000;
    state.hazards = state.hazards
        .map(hazard => ({
            ...hazard,
            position: {
                x: hazard.position.x - hazard.speed * stepSeconds,
                y: hazard.position.y
            },
            rotation: hazard.rotation + hazard.spinDirection * 1.8 * stepSeconds
        }))
        .filter(hazard => hazard.position.x >= -hazard.radius - 10);
}

function openModuleChoice(
    state: MutableShooterState,
    pickup: ShooterPickupDefinition
): void {
    state.moduleChoice = {pickup};
    state.player = {
        ...state.player,
        velocity: {x: 0, y: 0},
        chargeMs: null
    };
    state.accumulatorMs = 0;
}

function collectPickup(state: MutableShooterState, pickup: ShooterPickupState): void {
    if (isEquipable(pickup.definition.kind)) {
        openModuleChoice(state, pickup.definition);
        return;
    }
    if (pickup.definition.kind === 'shield-cell') {
        state.player = {
            ...state.player,
            shield: Math.min(state.player.maxShield, state.player.shield + 1)
        };
    } else if (pickup.definition.kind === 'bomb-refill') {
        state.player = {
            ...state.player,
            bombs: Math.min(state.player.maxBombs, state.player.bombs + 1)
        };
    }
}

function updatePickups(state: MutableShooterState): void {
    const stepSeconds = SHOOTER_FIXED_STEP_MS / 1000;
    const updated: ShooterPickupState[] = [];
    for (const pickup of state.pickups) {
        const ageMs = pickup.ageMs + SHOOTER_FIXED_STEP_MS;
        let velocityX = pickup.velocity.x;
        let velocityY = pickup.velocity.y;
        const distance = Math.sqrt(distanceSquared(pickup.position, state.player.position));
        if (distance <= 80 && distance > 0.01) {
            velocityX += (state.player.position.x - pickup.position.x) / distance * 240 * stepSeconds;
            velocityY += (state.player.position.y - pickup.position.y) / distance * 240 * stepSeconds;
        }
        const position = {
            x: pickup.position.x + velocityX * stepSeconds,
            y: pickup.position.y + velocityY * stepSeconds
        };
        if (distanceSquared(position, state.player.position) <= 28 ** 2) {
            collectPickup(state, {...pickup, position, ageMs});
            if (state.moduleChoice !== null) {
                updated.push(...state.pickups
                    .filter(other => other.id !== pickup.id)
                    .filter(other => !updated.some(existing => existing.id === other.id)));
                state.pickups = updated;
                return;
            }
            continue;
        }
        if (ageMs < pickup.lifetimeMs && position.x >= -30) {
            updated.push({
                ...pickup,
                position,
                velocity: {x: velocityX, y: velocityY},
                ageMs
            });
        }
    }
    state.pickups = updated;
}

function activateBomb(state: MutableShooterState): void {
    if (state.player.bombs <= 0 || state.terminal !== null) return;
    const center = state.player.position;
    state.player = {
        ...state.player,
        bombs: state.player.bombs - 1,
        bombsUsed: state.player.bombsUsed + 1,
        invulnerabilityMs: Math.max(state.player.invulnerabilityMs, 750)
    };
    state.projectiles = state.projectiles.filter(projectile =>
        projectile.allegiance !== 'hostile' ||
        distanceSquared(projectile.position, center) >
            (SHOOTER_BOMB_RADIUS + projectile.radius) ** 2
    );
    for (let index = state.enemies.length - 1; index >= 0; index--) {
        const enemy = state.enemies[index]!;
        if (
            distanceSquared(enemy.position, center) <=
            (SHOOTER_BOMB_RADIUS + enemy.radius) ** 2
        ) {
            damageEnemy(state, index, 3);
        }
    }
    const boss = state.boss;
    if (boss !== null) {
        const positions = bossComponentPositions(boss);
        let maxHealth = 0;
        let target: ShooterPoint | null = null;
        if (boss.phase === 1) {
            const candidates = [
                {health: boss.nodeHealth[0], point: positions.firstNode},
                {health: boss.nodeHealth[1], point: positions.secondNode}
            ];
            const candidate = candidates.find(entry =>
                entry.health > 0 &&
                distanceSquared(entry.point, center) <= (SHOOTER_BOMB_RADIUS + 18) ** 2
            );
            if (candidate !== undefined) {
                maxHealth = boss.nodeMaxHealth[0];
                target = candidate.point;
            }
        } else if (
            boss.coreExposed &&
            distanceSquared(positions.core, center) <=
                (SHOOTER_BOMB_RADIUS + SHOOTER_BOSS_CORE_HIT_RADIUS) ** 2
        ) {
            maxHealth = boss.coreMaxHealth;
            target = positions.core;
        }
        if (target !== null) {
            damageBossAtPoint(state, target, 1, Math.max(1, Math.floor(maxHealth * 0.08)));
        }
    }
}

function simulateTick(state: MutableShooterState, input: ShooterInput): void {
    if (state.terminal !== null || state.paused || state.moduleChoice !== null) return;
    state.activeTicks++;
    const elapsedMs = state.activeTicks * SHOOTER_FIXED_STEP_MS;
    state.worldScroll += 74 * SHOOTER_FIXED_STEP_MS / 1000;
    const newPhase = phaseForElapsed(elapsedMs);
    if (newPhase !== state.phase) {
        state.phase = newPhase;
        if (newPhase === 'boss' && state.boss === null) enterBoss(state);
    }
    if (state.phase !== 'boss') spawnScheduledContent(state, elapsedMs);

    updatePlayer(state, input);
    if (input.bombPressed) activateBomb(state);
    if (state.phase !== 'boss') {
        updateEnemies(state);
        updateHazards(state);
    }
    updateBoss(state);
    updateProjectiles(state);
    resolveProjectileCollisions(state);
    resolveBodyCollisions(state);
    updatePickups(state);

    const reconciled = reconcileShooterBossVictory(state);
    state.terminal = reconciled.terminal;
    state.terminalReason = reconciled.terminalReason;
    if (
        elapsedMs >= getShooterMissionLimitMs(state.mission.levelTier) &&
        state.terminal === null
    ) {
        state.terminal = 'failure';
        state.terminalReason = 'warden-escaped';
    }
}

export function stepShooter(state: ShooterState, input: ShooterInput): ShooterState {
    const reconciled = reconcileShooterBossVictory(state);
    if (
        reconciled.terminal !== null ||
        reconciled.paused ||
        reconciled.moduleChoice !== null
    ) {
        return reconciled;
    }
    const next = cloneState(reconciled);
    simulateTick(next, input);
    return next;
}

/**
 * Consumes all supplied active time in deterministic 60 Hz steps. Edge inputs
 * apply only to the first consumed step; held movement/fire applies to every step.
 */
export function advanceShooter(
    state: ShooterState,
    input: ShooterInput,
    deltaMs: number
): ShooterState {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Shooter delta must be a finite non-negative number.');
    }
    const reconciled = reconcileShooterBossVictory(state);
    if (
        reconciled.terminal !== null ||
        reconciled.paused ||
        reconciled.moduleChoice !== null ||
        deltaMs === 0
    ) {
        return reconciled;
    }
    const next = cloneState(reconciled);
    next.accumulatorMs += deltaMs;
    next.pendingFirePressed ||= input.firePressed === true;
    next.pendingFireReleased ||= input.fireReleased === true;
    next.pendingBombPressed ||= input.bombPressed === true;
    let firstStep = true;
    while (
        next.accumulatorMs + 1e-9 >= SHOOTER_FIXED_STEP_MS &&
        next.terminal === null &&
        next.moduleChoice === null
    ) {
        simulateTick(next, {
            moveX: input.moveX,
            moveY: input.moveY,
            fireHeld: input.fireHeld,
            firePressed: firstStep && next.pendingFirePressed,
            fireReleased: firstStep && next.pendingFireReleased,
            bombPressed: firstStep && next.pendingBombPressed
        });
        if (firstStep) {
            next.pendingFirePressed = false;
            next.pendingFireReleased = false;
            next.pendingBombPressed = false;
        }
        next.accumulatorMs -= SHOOTER_FIXED_STEP_MS;
        if (Math.abs(next.accumulatorMs) < 1e-9) next.accumulatorMs = 0;
        firstStep = false;
    }
    return next;
}

export function setShooterPaused(state: ShooterState, paused: boolean): ShooterState {
    if (state.paused === paused) return state;
    return {
        ...state,
        paused,
        accumulatorMs: 0,
        player: {
            ...state.player,
            velocity: {x: 0, y: 0},
            chargeMs: null
        },
        pendingFirePressed: false,
        pendingFireReleased: false,
        pendingBombPressed: false
    };
}

export function chooseShooterModule(
    state: ShooterState,
    action: ShooterModuleChoiceAction
): ShooterState {
    if (state.moduleChoice === null || state.terminal !== null) return state;
    const pickup = state.moduleChoice.pickup;
    let player: ShooterPlayerState = {
        ...state.player,
        velocity: {x: 0, y: 0},
        chargeMs: null
    };
    let rawScore = state.rawScore;
    let threatRank = state.threatRank;
    if (action === 'convert') rawScore += 400;
    if (action === 'equip') {
        if (pickup.kind === 'splitter-core' || pickup.kind === 'beam-coil') {
            player = {
                ...player,
                weaponCore: pickup.kind,
                weaponCoreUnstable: pickup.unstable
            };
        } else if (pickup.kind === 'companion-drone') {
            player = {
                ...player,
                utilityModule: 'companion-drone',
                utilityModuleUnstable: pickup.unstable,
                droneBlocksRemaining: pickup.unstable ? 2 : 1
            };
        }
        if (pickup.unstable) threatRank = Math.min(3, threatRank + 1);
    }
    return {
        ...state,
        player,
        rawScore,
        threatRank,
        moduleChoice: null,
        accumulatorMs: 0,
        pendingFirePressed: false,
        pendingFireReleased: false,
        pendingBombPressed: false
    };
}

export function calculateShooterScore(state: ShooterState): number {
    const completionBonus = state.terminal === 'success'
        ? state.player.hull * 500 + state.player.bombs * 250
        : 0;
    return Math.floor(
        (state.rawScore + completionBonus) * (1 + 0.25 * state.threatRank)
    );
}

export function getShooterGrade(state: ShooterState): 's' | 'a' | 'b' | 'c' | 'none' {
    if (state.terminal !== 'success') return 'none';
    const elapsedMs = state.activeTicks * SHOOTER_FIXED_STEP_MS;
    if (
        elapsedMs <= 120_000 &&
        state.player.hull === 3 &&
        state.player.bombsUsed <= 1
    ) return 's';
    if (state.player.hull >= 2) return 'a';
    if (state.player.hull >= 1) return 'b';
    return 'c';
}

export function getShooterActiveElapsedMs(state: ShooterState): number {
    return state.activeTicks * SHOOTER_FIXED_STEP_MS;
}

export function getShooterChargeRatio(state: ShooterState): number {
    if (state.player.chargeMs === null) return 0;
    const cap = state.player.weaponCore === 'beam-coil'
        ? state.player.weaponCoreUnstable ? 750 : 900
        : 1_200;
    return clamp(state.player.chargeMs / cap, 0, 1);
}

export interface ShooterBossWitnessResult {
    readonly success: boolean;
    readonly elapsedMs: number;
    readonly missedOpportunities: number;
    readonly firedOpportunities: number;
}

/**
 * Deterministic balance validator used by generation/tests. It models the
 * no-module, no-bomb pilot taking one tap-fire opportunity every 200 ms and
 * intentionally missing exactly three opportunities in each group of ten.
 * The witness is concerned with damage feasibility; its scripted dodge route
 * avoids the deterministic projectile patterns.
 */
export function replayBaseWeaponBossWitness(
    mission: ShooterMission
): ShooterBossWitnessResult {
    let phase: 1 | 2 | 3 = 1;
    let phaseElapsedMs = 0;
    let health = mission.boss.nodeHealth * 2;
    let elapsedMs = 0;
    let opportunity = 0;
    let missedOpportunities = 0;
    let firedOpportunities = 0;
    while (elapsedMs <= 50_000) {
        const cycleMs = phase === 2 ? 4_000 : 3_000;
        const cyclePosition = phaseElapsedMs % cycleMs;
        const exposed = phase === 1 ||
            (phase === 2 && cyclePosition >= 800 && cyclePosition < 3_300) ||
            (phase === 3 && cyclePosition >= 500 && cyclePosition < 2_700);
        if (exposed) {
            const missSlot = opportunity % 10;
            const intentionallyMissed = missSlot === 1 || missSlot === 4 || missSlot === 7;
            if (intentionallyMissed) {
                missedOpportunities++;
            } else {
                health--;
                firedOpportunities++;
            }
            opportunity++;
        }
        if (health <= 0) {
            if (phase === 1) {
                phase = 2;
                health = mission.boss.phaseTwoCoreHealth;
                phaseElapsedMs = 0;
            } else if (phase === 2) {
                phase = 3;
                health = mission.boss.phaseThreeCoreHealth;
                phaseElapsedMs = 0;
            } else {
                return {
                    success: true,
                    elapsedMs,
                    missedOpportunities,
                    firedOpportunities
                };
            }
        }
        elapsedMs += 200;
        phaseElapsedMs += 200;
    }
    return {
        success: false,
        elapsedMs: 50_000,
        missedOpportunities,
        firedOpportunities
    };
}
