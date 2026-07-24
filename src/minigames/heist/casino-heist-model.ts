import {
    randomInteger,
    type RandomSource
} from '../../domain/random/random-source';

export const CASINO_HEIST_WORLD_WIDTH = 720;
export const CASINO_HEIST_WORLD_HEIGHT = 672;
export const CASINO_HEIST_FIXED_STEP_MS = 20;
export const CASINO_HEIST_REWARD_CREDITS = 1_000;
export const CASINO_HEIST_BASE_HEALTH = 3;
export const CASINO_HEIST_RECOVERY_MS = 900;
export const CASINO_HEIST_PLAYER_SPEED = 150;
export const CASINO_HEIST_SEGMENT_LENGTH = 320;
export const CASINO_HEIST_ROAD_WIDTH = 420;
export const CASINO_HEIST_PLAYER_SCREEN_Y = 510;
export const CASINO_HEIST_MAX_AMMO = 30;

const PLAYER_HALF_WIDTH = 17;
const PLAYER_HALF_LENGTH = 29;
const ENEMY_HALF_WIDTH = 23;
const ENEMY_HALF_LENGTH = 35;
const LANE_OFFSET = 120;
const BASE_STEERING_ACCELERATION = 1_400;
const BASE_LATERAL_SPEED = 260;
const PLAYER_FIRE_COOLDOWN_TICKS = 8;
const PROJECTILE_HALF_LENGTH = 7;
const VISIBLE_BEHIND_DISTANCE = 190;
const VISIBLE_AHEAD_DISTANCE = CASINO_HEIST_WORLD_HEIGHT - CASINO_HEIST_PLAYER_SCREEN_Y + 520;

export type CasinoHeistStatus = 'active' | 'success' | 'failure';
export type CasinoHeistTerminalReason = 'casino-reached' | 'car-destroyed' | null;
export type CasinoHeistLane = -1 | 0 | 1;
export type CasinoHeistObstacleKind = 'nano-crate' | 'security-bollard';
export type CasinoHeistPickupKind = 'weapon' | 'ammo';
export type CasinoHeistWeapon = 'none' | 'pulse-cannon';
export type CasinoHeistProjectileAllegiance = 'player' | 'enemy';
export type CasinoHeistDamageSource = 'obstacle' | 'spikes' | 'enemy-shot' | 'road-edge';

export interface CasinoHeistItemBonuses {
    /** Extra points of hull supplied by maze items. */
    readonly armor: number;
    /** A normalized 0..1 bonus to steering acceleration and top lateral speed. */
    readonly handling: number;
    /** An additive 0..1 chance for optional road powerups. */
    readonly powerupChance: number;
    /** Ammo (and therefore a weapon) supplied at the start of the getaway. */
    readonly startAmmo: number;
}

export interface CasinoHeistGenerationConfig {
    readonly segmentCount?: number;
    readonly bonuses?: Partial<CasinoHeistItemBonuses>;
}

export interface CasinoHeistObstacleDefinition {
    readonly id: string;
    readonly kind: CasinoHeistObstacleKind;
    readonly x: number;
    readonly distance: number;
    readonly width: number;
    readonly length: number;
    readonly damage: number;
}

export interface CasinoHeistPickupDefinition {
    readonly id: string;
    readonly kind: CasinoHeistPickupKind;
    readonly x: number;
    readonly distance: number;
    readonly ammo: number;
}

export interface CasinoHeistEnemyDefinition {
    readonly id: string;
    readonly lane: CasinoHeistLane;
    readonly triggerDistance: number;
    readonly spawnGap: number;
    readonly speed: number;
    readonly weaveAmplitude: number;
    readonly weavePeriodTicks: number;
    readonly weavePhaseTicks: number;
    readonly fireIntervalTicks: number;
    readonly fireDelayTicks: number;
    readonly health: number;
    readonly colorIndex: number;
}

export interface CasinoHeistRoadSegment {
    readonly index: number;
    readonly startDistance: number;
    readonly endDistance: number;
    readonly centerStartX: number;
    readonly centerEndX: number;
    readonly safeLane: CasinoHeistLane;
    readonly obstacles: readonly CasinoHeistObstacleDefinition[];
    readonly pickups: readonly CasinoHeistPickupDefinition[];
    readonly enemies: readonly CasinoHeistEnemyDefinition[];
}

export interface CasinoHeistCourse {
    readonly generatorId: 'casino-heist-road-v1';
    readonly width: number;
    readonly segmentLength: number;
    readonly roadWidth: number;
    readonly finishDistance: number;
    readonly startingHealth: number;
    readonly bonuses: CasinoHeistItemBonuses;
    readonly segments: readonly CasinoHeistRoadSegment[];
}

export interface CasinoHeistPlayerState {
    readonly previousX: number;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    readonly lateralVelocity: number;
    readonly health: number;
    readonly maxHealth: number;
    readonly recoveryMs: number;
    readonly weapon: CasinoHeistWeapon;
    readonly ammo: number;
    readonly fireCooldownTicks: number;
}

export interface CasinoHeistEnemyState {
    readonly definitionId: string;
    readonly previousX: number;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    readonly health: number;
    readonly fireCooldownTicks: number;
    readonly contactCooldownMs: number;
}

export interface CasinoHeistProjectileState {
    readonly id: string;
    readonly allegiance: CasinoHeistProjectileAllegiance;
    readonly sourceId: string;
    readonly x: number;
    readonly previousDistance: number;
    readonly distance: number;
    /** Positive means the projectile travels toward the casino. */
    readonly forwardVelocity: number;
    readonly damage: number;
}

export interface CasinoHeistTelemetry {
    readonly powerupsCollected: number;
    readonly ammoCollected: number;
    readonly shotsFired: number;
    readonly enemyShotsFired: number;
    readonly enemiesDestroyed: number;
    readonly collisions: number;
    readonly hitsTaken: number;
    readonly damageTaken: number;
}

export interface CasinoHeistState {
    readonly course: CasinoHeistCourse;
    readonly player: CasinoHeistPlayerState;
    readonly enemies: readonly CasinoHeistEnemyState[];
    readonly projectiles: readonly CasinoHeistProjectileState[];
    readonly removedObstacleIds: readonly string[];
    readonly collectedPickupIds: readonly string[];
    readonly spawnedEnemyIds: readonly string[];
    readonly activeTicks: number;
    readonly accumulatorMs: number;
    readonly paused: boolean;
    readonly status: CasinoHeistStatus;
    readonly terminalReason: CasinoHeistTerminalReason;
    readonly creditsStolen: number;
    readonly nextProjectileId: number;
    readonly telemetry: CasinoHeistTelemetry;
}

export interface CasinoHeistInput {
    /** Continuous keyboard, gamepad, or touch steering in the inclusive range -1..1. */
    readonly steer: number;
    /** A level-triggered fire control; the model applies its own fire cadence. */
    readonly fire: boolean;
}

export const NEUTRAL_CASINO_HEIST_INPUT: CasinoHeistInput = Object.freeze({
    steer: 0,
    fire: false
});

export type CasinoHeistEvent =
    | {
        readonly kind: 'enemy-spawned';
        readonly tick: number;
        readonly enemyId: string;
    }
    | {
        readonly kind: 'pickup-collected';
        readonly tick: number;
        readonly pickupId: string;
        readonly pickupKind: CasinoHeistPickupKind;
        readonly ammo: number;
        readonly weapon: CasinoHeistWeapon;
    }
    | {
        readonly kind: 'player-fired';
        readonly tick: number;
        readonly projectileId: string;
        readonly ammo: number;
    }
    | {
        readonly kind: 'enemy-fired';
        readonly tick: number;
        readonly enemyId: string;
        readonly projectileId: string;
    }
    | {
        readonly kind: 'damage';
        readonly tick: number;
        readonly source: CasinoHeistDamageSource;
        readonly sourceId: string | null;
        readonly amount: number;
        readonly health: number;
    }
    | {
        readonly kind: 'recovered';
        readonly tick: number;
    }
    | {
        readonly kind: 'enemy-destroyed';
        readonly tick: number;
        readonly enemyId: string;
    }
    | {
        readonly kind: 'success';
        readonly tick: number;
        readonly credits: number;
    }
    | {
        readonly kind: 'failure';
        readonly tick: number;
        readonly reason: 'car-destroyed';
    };

export interface CasinoHeistStepResult {
    readonly state: CasinoHeistState;
    readonly events: readonly CasinoHeistEvent[];
}

export interface CasinoHeistValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

export interface CasinoHeistRoadGeometry {
    readonly centerX: number;
    readonly width: number;
    readonly leftX: number;
    readonly rightX: number;
    readonly segmentIndex: number;
}

export interface CasinoHeistRenderRoad {
    readonly segmentIndex: number;
    readonly nearY: number;
    readonly farY: number;
    readonly nearCenterX: number;
    readonly farCenterX: number;
    readonly width: number;
}

export interface CasinoHeistRenderEntity {
    readonly id: string;
    readonly x: number;
    readonly y: number;
}

export interface CasinoHeistRenderSnapshot {
    readonly interpolation: number;
    readonly road: readonly CasinoHeistRenderRoad[];
    readonly player: {
        readonly x: number;
        readonly y: number;
        readonly distance: number;
        readonly health: number;
        readonly maxHealth: number;
        readonly recoveryMs: number;
        readonly weapon: CasinoHeistWeapon;
        readonly ammo: number;
    };
    readonly obstacles: readonly (CasinoHeistRenderEntity & {
        readonly kind: CasinoHeistObstacleKind;
        readonly width: number;
        readonly length: number;
    })[];
    readonly powerups: readonly (CasinoHeistRenderEntity & {
        readonly kind: CasinoHeistPickupKind;
        readonly ammo: number;
    })[];
    readonly enemies: readonly (CasinoHeistRenderEntity & {
        readonly health: number;
        readonly colorIndex: number;
    })[];
    readonly projectiles: readonly (CasinoHeistRenderEntity & {
        readonly allegiance: CasinoHeistProjectileAllegiance;
    })[];
    readonly finishY: number;
    readonly finishDistance: number;
    readonly status: CasinoHeistStatus;
    readonly creditsStolen: number;
}

export interface CasinoHeistWitnessResult {
    readonly success: boolean;
    readonly ticks: number;
    readonly state: CasinoHeistState;
}

interface MutablePlayerState {
    previousX: number;
    x: number;
    previousDistance: number;
    distance: number;
    lateralVelocity: number;
    health: number;
    maxHealth: number;
    recoveryMs: number;
    weapon: CasinoHeistWeapon;
    ammo: number;
    fireCooldownTicks: number;
}

interface MutableEnemyState {
    definitionId: string;
    previousX: number;
    x: number;
    previousDistance: number;
    distance: number;
    health: number;
    fireCooldownTicks: number;
    contactCooldownMs: number;
}

interface MutableProjectileState {
    id: string;
    allegiance: CasinoHeistProjectileAllegiance;
    sourceId: string;
    x: number;
    previousDistance: number;
    distance: number;
    forwardVelocity: number;
    damage: number;
}

interface MutableTelemetry {
    powerupsCollected: number;
    ammoCollected: number;
    shotsFired: number;
    enemyShotsFired: number;
    enemiesDestroyed: number;
    collisions: number;
    hitsTaken: number;
    damageTaken: number;
}

interface MutableCasinoHeistState {
    course: CasinoHeistCourse;
    player: MutablePlayerState;
    enemies: MutableEnemyState[];
    projectiles: MutableProjectileState[];
    removedObstacleIds: string[];
    collectedPickupIds: string[];
    spawnedEnemyIds: string[];
    activeTicks: number;
    accumulatorMs: number;
    paused: boolean;
    status: CasinoHeistStatus;
    terminalReason: CasinoHeistTerminalReason;
    creditsStolen: number;
    nextProjectileId: number;
    telemetry: MutableTelemetry;
}

const LANES: readonly CasinoHeistLane[] = Object.freeze([-1, 0, 1]);
const DEFAULT_BONUSES: CasinoHeistItemBonuses = Object.freeze({
    armor: 0,
    handling: 0,
    powerupChance: 0,
    startAmmo: 0
});

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

function isLane(value: number): value is CasinoHeistLane {
    return value === -1 || value === 0 || value === 1;
}

function assertFiniteRange(
    value: number,
    minimum: number,
    maximum: number,
    label: string
): void {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
    }
}

function resolveBonuses(
    supplied: Partial<CasinoHeistItemBonuses> | undefined
): CasinoHeistItemBonuses {
    const bonuses = {
        armor: supplied?.armor ?? DEFAULT_BONUSES.armor,
        handling: supplied?.handling ?? DEFAULT_BONUSES.handling,
        powerupChance: supplied?.powerupChance ?? DEFAULT_BONUSES.powerupChance,
        startAmmo: supplied?.startAmmo ?? DEFAULT_BONUSES.startAmmo
    };
    if (!Number.isSafeInteger(bonuses.armor) || bonuses.armor < 0 || bonuses.armor > 5) {
        throw new Error('Casino Heist armor bonus must be an integer from 0 through 5.');
    }
    assertFiniteRange(bonuses.handling, 0, 1, 'Casino Heist handling bonus');
    assertFiniteRange(bonuses.powerupChance, 0, 1, 'Casino Heist powerup chance bonus');
    if (
        !Number.isSafeInteger(bonuses.startAmmo) ||
        bonuses.startAmmo < 0 ||
        bonuses.startAmmo > CASINO_HEIST_MAX_AMMO
    ) {
        throw new Error(
            `Casino Heist starting ammo must be an integer from 0 through ${CASINO_HEIST_MAX_AMMO}.`
        );
    }
    return bonuses;
}

function chooseLane(random: RandomSource, values: readonly CasinoHeistLane[]): CasinoHeistLane {
    return values[randomInteger(random, values.length)]!;
}

function segmentCenterAt(segment: CasinoHeistRoadSegment, distance: number): number {
    const progress = clamp(
        (distance - segment.startDistance) /
        (segment.endDistance - segment.startDistance),
        0,
        1
    );
    return lerp(segment.centerStartX, segment.centerEndX, progress);
}

function laneXAt(
    segment: CasinoHeistRoadSegment,
    distance: number,
    lane: CasinoHeistLane
): number {
    return segmentCenterAt(segment, distance) + lane * LANE_OFFSET;
}

function partialSegment(
    index: number,
    startDistance: number,
    endDistance: number,
    centerStartX: number,
    centerEndX: number,
    safeLane: CasinoHeistLane
): CasinoHeistRoadSegment {
    return {
        index,
        startDistance,
        endDistance,
        centerStartX,
        centerEndX,
        safeLane,
        obstacles: [],
        pickups: [],
        enemies: []
    };
}

export function createCasinoHeistCourse(
    random: RandomSource,
    config: CasinoHeistGenerationConfig = {}
): CasinoHeistCourse {
    const segmentCount = config.segmentCount ?? 20;
    if (!Number.isSafeInteger(segmentCount) || segmentCount < 8 || segmentCount > 40) {
        throw new Error('Casino Heist segment count must be an integer from 8 through 40.');
    }
    const bonuses = resolveBonuses(config.bonuses);
    const segments: CasinoHeistRoadSegment[] = [];
    let centerX = CASINO_HEIST_WORLD_WIDTH / 2;
    let previousSafeLane = chooseLane(random, LANES);

    for (let index = 0; index < segmentCount; index++) {
        const startDistance = index * CASINO_HEIST_SEGMENT_LENGTH;
        const endDistance = startDistance + CASINO_HEIST_SEGMENT_LENGTH;
        const nextCenterX = clamp(
            centerX + randomInteger(random, 61) - 30,
            CASINO_HEIST_ROAD_WIDTH / 2 + 22,
            CASINO_HEIST_WORLD_WIDTH - CASINO_HEIST_ROAD_WIDTH / 2 - 22
        );
        const laneChoices = LANES.filter(lane => Math.abs(lane - previousSafeLane) <= 1);
        const safeLane = index === 0
            ? previousSafeLane
            : chooseLane(random, laneChoices);
        const shell = partialSegment(
            index,
            startDistance,
            endDistance,
            centerX,
            nextCenterX,
            safeLane
        );

        const obstacleDistance = startDistance + 215 + randomInteger(random, 31);
        const nonSafeLanes = LANES.filter(lane => lane !== safeLane);
        const firstBlockedLane = chooseLane(random, nonSafeLanes);
        const secondBlockedLane = nonSafeLanes.find(lane => lane !== firstBlockedLane)!;
        const blockBoth = random.next() < 0.58;
        const blockedLanes = blockBoth
            ? [firstBlockedLane, secondBlockedLane]
            : [firstBlockedLane];
        const obstacleKindRoll = randomInteger(random, 2);
        const obstacleWidthRoll = randomInteger(random, 14);
        const obstacleLengthRoll = randomInteger(random, 13);
        const obstacles = blockedLanes.map((lane, obstacleIndex) => ({
            id: `segment-${index}-obstacle-${obstacleIndex}`,
            kind: (obstacleKindRoll + obstacleIndex) % 2 === 0
                ? 'nano-crate'
                : 'security-bollard',
            x: laneXAt(shell, obstacleDistance, lane),
            distance: obstacleDistance,
            width: 54 + (obstacleWidthRoll + obstacleIndex * 3) % 14,
            length: 46 + (obstacleLengthRoll + obstacleIndex * 2) % 13,
            damage: 1
        } satisfies CasinoHeistObstacleDefinition));

        // Draw every pickup random value even when this segment is forced. That
        // makes powerupChance monotonic without perturbing later road generation.
        const optionalPickupRoll = random.next();
        const pickupKindRoll = randomInteger(random, 5);
        const pickupAmmoRoll = randomInteger(random, 5);
        const forcedPickupKind: CasinoHeistPickupKind | null =
            index === 0 ? 'weapon' : index % 3 === 0 ? 'ammo' : null;
        const hasOptionalPickup =
            optionalPickupRoll < Math.min(1, 0.2 + bonuses.powerupChance);
        const pickupKind: CasinoHeistPickupKind =
            forcedPickupKind ?? (pickupKindRoll === 0 ? 'weapon' : 'ammo');
        const pickupDistance = startDistance + 108;
        const pickups: CasinoHeistPickupDefinition[] =
            forcedPickupKind !== null || hasOptionalPickup
                ? [{
                    id: `segment-${index}-pickup`,
                    kind: pickupKind,
                    x: laneXAt(shell, pickupDistance, safeLane),
                    distance: pickupDistance,
                    ammo: pickupKind === 'weapon' ? 12 : 7 + pickupAmmoRoll
                }]
                : [];

        const enemySpawnRoll = random.next();
        const enemyLaneRoll = randomInteger(random, nonSafeLanes.length);
        const enemyTriggerRoll = randomInteger(random, 31);
        const enemySpeedRoll = randomInteger(random, 31);
        const enemyWeaveRoll = randomInteger(random, 11);
        const enemyPeriodRoll = randomInteger(random, 51);
        const enemyPhaseRoll = randomInteger(random, 111);
        const enemyFireRoll = randomInteger(random, 22);
        const enemyDelayRoll = randomInteger(random, 18);
        const enemyColorRoll = randomInteger(random, 8);
        const enemyLane = nonSafeLanes[enemyLaneRoll]!;
        const enemies: CasinoHeistEnemyDefinition[] =
            index > 0 && enemySpawnRoll < 0.58
                ? [{
                    id: `segment-${index}-luxury-car`,
                    lane: enemyLane,
                    triggerDistance: startDistance + 42 + enemyTriggerRoll,
                    spawnGap: 130,
                    speed: 245 + enemySpeedRoll,
                    weaveAmplitude: 8 + enemyWeaveRoll,
                    weavePeriodTicks: 60 + enemyPeriodRoll,
                    weavePhaseTicks: enemyPhaseRoll,
                    fireIntervalTicks: 34 + enemyFireRoll,
                    fireDelayTicks: 8 + enemyDelayRoll,
                    health: 2,
                    colorIndex: enemyColorRoll
                }]
                : [];

        segments.push({
            ...shell,
            obstacles,
            pickups,
            enemies
        });
        centerX = nextCenterX;
        previousSafeLane = safeLane;
    }

    const course: CasinoHeistCourse = {
        generatorId: 'casino-heist-road-v1',
        width: CASINO_HEIST_WORLD_WIDTH,
        segmentLength: CASINO_HEIST_SEGMENT_LENGTH,
        roadWidth: CASINO_HEIST_ROAD_WIDTH,
        finishDistance: segmentCount * CASINO_HEIST_SEGMENT_LENGTH,
        startingHealth: CASINO_HEIST_BASE_HEALTH + bonuses.armor,
        bonuses,
        segments
    };
    const validation = validateCasinoHeistCourse(course);
    if (!validation.valid) {
        throw new Error(`Generated invalid Casino Heist road: ${validation.errors.join('; ')}`);
    }
    return course;
}

export function getCasinoHeistRoadGeometry(
    course: CasinoHeistCourse,
    distance: number
): CasinoHeistRoadGeometry {
    if (!Number.isFinite(distance)) {
        throw new Error('Casino Heist road distance must be finite.');
    }
    if (course.segments.length === 0) {
        throw new Error('Casino Heist road has no segments.');
    }
    const boundedDistance = clamp(distance, 0, Math.max(0, course.finishDistance - 1e-9));
    const segmentIndex = clamp(
        Math.floor(boundedDistance / course.segmentLength),
        0,
        course.segments.length - 1
    );
    const segment = course.segments[segmentIndex]!;
    const centerX = segmentCenterAt(segment, boundedDistance);
    return {
        centerX,
        width: course.roadWidth,
        leftX: centerX - course.roadWidth / 2,
        rightX: centerX + course.roadWidth / 2,
        segmentIndex
    };
}

export function canonicalCasinoHeistCourseSignature(course: CasinoHeistCourse): string {
    const bonusSignature = [
        course.bonuses.armor,
        course.bonuses.handling.toFixed(3),
        course.bonuses.powerupChance.toFixed(3),
        course.bonuses.startAmmo
    ].join(',');
    return `${bonusSignature}/${course.segments.map(segment => [
        segment.centerStartX.toFixed(2),
        segment.centerEndX.toFixed(2),
        segment.safeLane,
        segment.obstacles.map(obstacle =>
            `${obstacle.kind}:${obstacle.x.toFixed(2)}:${obstacle.distance}:${obstacle.width}`
        ).join(','),
        segment.pickups.map(pickup =>
            `${pickup.kind}:${pickup.x.toFixed(2)}:${pickup.distance}:${pickup.ammo}`
        ).join(','),
        segment.enemies.map(enemy =>
            [
                enemy.lane,
                enemy.triggerDistance,
                enemy.speed,
                enemy.weaveAmplitude,
                enemy.fireIntervalTicks,
                enemy.colorIndex
            ].join(':')
        ).join(',')
    ].join('|')).join('/')}`;
}

function routeLooksConstructive(course: CasinoHeistCourse): boolean {
    if (course.segments.length === 0) return false;
    const firstWeapon = course.segments
        .flatMap(segment => segment.pickups)
        .find(pickup => pickup.kind === 'weapon');
    if (firstWeapon === undefined) return false;
    const firstObstacleDistance = Math.min(
        ...course.segments.flatMap(segment =>
            segment.obstacles.map(obstacle => obstacle.distance)
        )
    );
    if (!(firstWeapon.distance < firstObstacleDistance)) return false;

    let previousSafeLane: CasinoHeistLane | null = null;
    for (const segment of course.segments) {
        if (!isLane(segment.safeLane)) return false;
        if (
            previousSafeLane !== null &&
            Math.abs(segment.safeLane - previousSafeLane) > 1
        ) {
            return false;
        }
        const obstacleDistance = segment.obstacles[0]?.distance;
        if (obstacleDistance === undefined) return false;
        const safeX = laneXAt(segment, obstacleDistance, segment.safeLane);
        if (segment.obstacles.some(obstacle =>
            Math.abs(obstacle.x - safeX) <=
            obstacle.width / 2 + PLAYER_HALF_WIDTH + 12
        )) {
            return false;
        }
        if (segment.enemies.some(enemy => enemy.lane === segment.safeLane)) {
            return false;
        }
        const transitionDistance = obstacleDistance - segment.startDistance;
        const maximumShift = BASE_LATERAL_SPEED * transitionDistance / CASINO_HEIST_PLAYER_SPEED;
        const previousX = previousSafeLane === null
            ? segment.centerStartX
            : segment.centerStartX + previousSafeLane * LANE_OFFSET;
        if (Math.abs(safeX - previousX) > maximumShift - 24) return false;
        previousSafeLane = segment.safeLane;
    }
    return true;
}

export function hasCasinoHeistSafeRoute(course: CasinoHeistCourse): boolean {
    return routeLooksConstructive(course);
}

export function validateCasinoHeistCourse(
    course: CasinoHeistCourse
): CasinoHeistValidationResult {
    const errors: string[] = [];
    if (course.generatorId !== 'casino-heist-road-v1') {
        errors.push('Unknown Casino Heist road generator.');
    }
    if (course.width !== CASINO_HEIST_WORLD_WIDTH) {
        errors.push('Casino Heist world width is invalid.');
    }
    if (course.segmentLength !== CASINO_HEIST_SEGMENT_LENGTH) {
        errors.push('Casino Heist segment length is invalid.');
    }
    if (course.roadWidth !== CASINO_HEIST_ROAD_WIDTH) {
        errors.push('Casino Heist road width is invalid.');
    }
    if (course.segments.length < 8 || course.segments.length > 40) {
        errors.push('Casino Heist road must contain 8 through 40 segments.');
    }
    if (course.finishDistance !== course.segments.length * course.segmentLength) {
        errors.push('Casino Heist finish distance does not match its segments.');
    }
    if (
        !Number.isSafeInteger(course.startingHealth) ||
        course.startingHealth !== CASINO_HEIST_BASE_HEALTH + course.bonuses.armor
    ) {
        errors.push('Casino Heist starting health is invalid.');
    }
    try {
        const resolved = resolveBonuses(course.bonuses);
        if (
            resolved.armor !== course.bonuses.armor ||
            resolved.handling !== course.bonuses.handling ||
            resolved.powerupChance !== course.bonuses.powerupChance ||
            resolved.startAmmo !== course.bonuses.startAmmo
        ) {
            errors.push('Casino Heist item bonuses are not fully resolved.');
        }
    } catch {
        errors.push('Casino Heist item bonuses are invalid.');
    }

    const ids = new Set<string>();
    let previousCenterEnd: number | null = null;
    for (let index = 0; index < course.segments.length; index++) {
        const segment = course.segments[index]!;
        const expectedStart = index * course.segmentLength;
        if (
            segment.index !== index ||
            segment.startDistance !== expectedStart ||
            segment.endDistance !== expectedStart + course.segmentLength
        ) {
            errors.push(`Segment ${index} is not contiguous.`);
        }
        if (
            previousCenterEnd !== null &&
            Math.abs(segment.centerStartX - previousCenterEnd) > 1e-9
        ) {
            errors.push(`Segment ${index} does not join the previous road center.`);
        }
        previousCenterEnd = segment.centerEndX;
        const minimumCenter = course.roadWidth / 2 + 20;
        const maximumCenter = course.width - course.roadWidth / 2 - 20;
        if (
            !Number.isFinite(segment.centerStartX) ||
            !Number.isFinite(segment.centerEndX) ||
            segment.centerStartX < minimumCenter ||
            segment.centerStartX > maximumCenter ||
            segment.centerEndX < minimumCenter ||
            segment.centerEndX > maximumCenter
        ) {
            errors.push(`Segment ${index} leaves the world.`);
        }
        if (!isLane(segment.safeLane)) errors.push(`Segment ${index} has an invalid safe lane.`);
        if (segment.obstacles.length < 1 || segment.obstacles.length > 2) {
            errors.push(`Segment ${index} has an invalid obstacle row.`);
        }

        for (const obstacle of segment.obstacles) {
            if (ids.has(obstacle.id)) errors.push(`Duplicate road entity id ${obstacle.id}.`);
            ids.add(obstacle.id);
            if (
                obstacle.distance < segment.startDistance + 170 ||
                obstacle.distance > segment.endDistance - 55 ||
                obstacle.width < 48 ||
                obstacle.length < 40 ||
                obstacle.damage !== 1
            ) {
                errors.push(`Obstacle ${obstacle.id} has invalid dimensions or placement.`);
            }
            const center = segmentCenterAt(segment, obstacle.distance);
            if (
                obstacle.x - obstacle.width / 2 < center - course.roadWidth / 2 ||
                obstacle.x + obstacle.width / 2 > center + course.roadWidth / 2
            ) {
                errors.push(`Obstacle ${obstacle.id} is outside the road.`);
            }
        }
        for (const pickup of segment.pickups) {
            if (ids.has(pickup.id)) errors.push(`Duplicate road entity id ${pickup.id}.`);
            ids.add(pickup.id);
            if (
                pickup.distance <= segment.startDistance ||
                pickup.distance >= segment.endDistance ||
                !Number.isSafeInteger(pickup.ammo) ||
                pickup.ammo < 1
            ) {
                errors.push(`Powerup ${pickup.id} is invalid.`);
            }
            const center = segmentCenterAt(segment, pickup.distance);
            if (Math.abs(pickup.x - center) > course.roadWidth / 2 - PLAYER_HALF_WIDTH) {
                errors.push(`Powerup ${pickup.id} is outside the road.`);
            }
        }
        for (const enemy of segment.enemies) {
            if (ids.has(enemy.id)) errors.push(`Duplicate road entity id ${enemy.id}.`);
            ids.add(enemy.id);
            if (
                !isLane(enemy.lane) ||
                enemy.lane === segment.safeLane ||
                enemy.triggerDistance <= segment.startDistance ||
                enemy.triggerDistance >= segment.endDistance ||
                enemy.spawnGap < 100 ||
                enemy.speed < CASINO_HEIST_PLAYER_SPEED + 80 ||
                enemy.weaveAmplitude < 0 ||
                enemy.weavePeriodTicks < 40 ||
                enemy.fireIntervalTicks < 20 ||
                enemy.fireDelayTicks < 1 ||
                enemy.health < 1
            ) {
                errors.push(`Enemy ${enemy.id} has invalid behavior.`);
            }
        }
    }
    if (!routeLooksConstructive(course)) {
        errors.push('Casino Heist road has no constructive safe-lane route.');
    }
    return {valid: errors.length === 0, errors};
}

export function createCasinoHeistState(course: CasinoHeistCourse): CasinoHeistState {
    const validation = validateCasinoHeistCourse(course);
    if (!validation.valid) {
        throw new Error(`Cannot start invalid Casino Heist road: ${validation.errors.join('; ')}`);
    }
    const startX = getCasinoHeistRoadGeometry(course, 0).centerX;
    const startAmmo = course.bonuses.startAmmo;
    return {
        course,
        player: {
            previousX: startX,
            x: startX,
            previousDistance: 0,
            distance: 0,
            lateralVelocity: 0,
            health: course.startingHealth,
            maxHealth: course.startingHealth,
            recoveryMs: 0,
            weapon: startAmmo > 0 ? 'pulse-cannon' : 'none',
            ammo: startAmmo,
            fireCooldownTicks: 0
        },
        enemies: [],
        projectiles: [],
        removedObstacleIds: [],
        collectedPickupIds: [],
        spawnedEnemyIds: [],
        activeTicks: 0,
        accumulatorMs: 0,
        paused: false,
        status: 'active',
        terminalReason: null,
        creditsStolen: 0,
        nextProjectileId: 0,
        telemetry: {
            powerupsCollected: 0,
            ammoCollected: 0,
            shotsFired: 0,
            enemyShotsFired: 0,
            enemiesDestroyed: 0,
            collisions: 0,
            hitsTaken: 0,
            damageTaken: 0
        }
    };
}

function cloneState(state: CasinoHeistState): MutableCasinoHeistState {
    return {
        course: state.course,
        player: {...state.player},
        enemies: state.enemies.map(enemy => ({...enemy})),
        projectiles: state.projectiles.map(projectile => ({...projectile})),
        removedObstacleIds: [...state.removedObstacleIds],
        collectedPickupIds: [...state.collectedPickupIds],
        spawnedEnemyIds: [...state.spawnedEnemyIds],
        activeTicks: state.activeTicks,
        accumulatorMs: state.accumulatorMs,
        paused: state.paused,
        status: state.status,
        terminalReason: state.terminalReason,
        creditsStolen: state.creditsStolen,
        nextProjectileId: state.nextProjectileId,
        telemetry: {...state.telemetry}
    };
}

function enemyDefinition(
    course: CasinoHeistCourse,
    id: string
): CasinoHeistEnemyDefinition {
    for (const segment of course.segments) {
        const definition = segment.enemies.find(enemy => enemy.id === id);
        if (definition !== undefined) return definition;
    }
    throw new Error(`Missing Casino Heist enemy definition ${id}.`);
}

function nextProjectileId(state: MutableCasinoHeistState, prefix: string): string {
    const id = `${prefix}-${state.nextProjectileId}`;
    state.nextProjectileId += 1;
    return id;
}

function normalizeInput(input: CasinoHeistInput): CasinoHeistInput {
    if (!Number.isFinite(input.steer)) {
        throw new Error('Casino Heist steering input must be finite.');
    }
    return {
        steer: clamp(input.steer, -1, 1),
        fire: input.fire
    };
}

function overlapsMovingLongitudinally(
    firstPrevious: number,
    firstCurrent: number,
    secondPrevious: number,
    secondCurrent: number,
    combinedHalfLength: number
): boolean {
    const previousDelta = firstPrevious - secondPrevious;
    const currentDelta = firstCurrent - secondCurrent;
    return (
        Math.abs(previousDelta) <= combinedHalfLength ||
        Math.abs(currentDelta) <= combinedHalfLength ||
        (previousDelta < -combinedHalfLength && currentDelta > combinedHalfLength) ||
        (previousDelta > combinedHalfLength && currentDelta < -combinedHalfLength)
    );
}

function applyDamage(
    state: MutableCasinoHeistState,
    source: CasinoHeistDamageSource,
    sourceId: string | null,
    amount: number,
    events: CasinoHeistEvent[]
): boolean {
    if (state.player.recoveryMs > 0 || amount <= 0) return false;
    const applied = Math.min(amount, state.player.health);
    if (applied <= 0) return false;
    state.player.health -= applied;
    state.player.recoveryMs = CASINO_HEIST_RECOVERY_MS;
    state.telemetry.hitsTaken += 1;
    state.telemetry.damageTaken += applied;
    if (source !== 'enemy-shot') state.telemetry.collisions += 1;
    events.push({
        kind: 'damage',
        tick: state.activeTicks,
        source,
        sourceId,
        amount: applied,
        health: state.player.health
    });
    return true;
}

function updatePlayerMotion(
    state: MutableCasinoHeistState,
    input: CasinoHeistInput,
    events: CasinoHeistEvent[]
): void {
    const player = state.player;
    player.previousX = player.x;
    player.previousDistance = player.distance;
    const handlingMultiplier = 1 + state.course.bonuses.handling * 0.5;
    const maxLateralSpeed = BASE_LATERAL_SPEED * handlingMultiplier;
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    if (Math.abs(input.steer) > 1e-6) {
        player.lateralVelocity = clamp(
            player.lateralVelocity +
            input.steer * BASE_STEERING_ACCELERATION * handlingMultiplier * dt,
            -maxLateralSpeed,
            maxLateralSpeed
        );
    } else {
        player.lateralVelocity *= 0.82;
        if (Math.abs(player.lateralVelocity) < 0.05) player.lateralVelocity = 0;
    }
    player.x += player.lateralVelocity * dt;
    const recoverySpeedMultiplier = player.recoveryMs > 0 ? 0.82 : 1;
    player.distance = Math.min(
        state.course.finishDistance,
        player.distance + CASINO_HEIST_PLAYER_SPEED * recoverySpeedMultiplier * dt
    );

    const geometry = getCasinoHeistRoadGeometry(state.course, player.distance);
    const minimumX = geometry.leftX + PLAYER_HALF_WIDTH;
    const maximumX = geometry.rightX - PLAYER_HALF_WIDTH;
    if (player.x < minimumX || player.x > maximumX) {
        player.x = clamp(player.x, minimumX, maximumX);
        player.lateralVelocity = 0;
        applyDamage(state, 'road-edge', null, 1, events);
    }
}

function spawnEnemies(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    for (const segment of state.course.segments) {
        for (const definition of segment.enemies) {
            if (
                state.player.distance < definition.triggerDistance ||
                state.spawnedEnemyIds.includes(definition.id)
            ) {
                continue;
            }
            const distance = state.player.distance - definition.spawnGap;
            const geometry = getCasinoHeistRoadGeometry(state.course, Math.max(0, distance));
            const x = geometry.centerX + definition.lane * LANE_OFFSET;
            state.spawnedEnemyIds.push(definition.id);
            state.enemies.push({
                definitionId: definition.id,
                previousX: x,
                x,
                previousDistance: distance,
                distance,
                health: definition.health,
                fireCooldownTicks: definition.fireDelayTicks,
                contactCooldownMs: 0
            });
            events.push({
                kind: 'enemy-spawned',
                tick: state.activeTicks,
                enemyId: definition.id
            });
        }
    }
}

function updateEnemies(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    for (const enemy of state.enemies) {
        const definition = enemyDefinition(state.course, enemy.definitionId);
        enemy.previousX = enemy.x;
        enemy.previousDistance = enemy.distance;
        enemy.distance += definition.speed * dt;
        enemy.contactCooldownMs = Math.max(
            0,
            enemy.contactCooldownMs - CASINO_HEIST_FIXED_STEP_MS
        );
        enemy.fireCooldownTicks = Math.max(0, enemy.fireCooldownTicks - 1);
        const geometry = getCasinoHeistRoadGeometry(state.course, enemy.distance);
        const wave =
            Math.sin(
                (state.activeTicks + definition.weavePhaseTicks) /
                definition.weavePeriodTicks *
                Math.PI *
                2
            ) *
            definition.weaveAmplitude;
        const targetX = geometry.centerX + definition.lane * LANE_OFFSET + wave;
        enemy.x += clamp(targetX - enemy.x, -2.4, 2.4);

        const gapAhead = state.player.distance - enemy.distance;
        if (
            enemy.fireCooldownTicks === 0 &&
            gapAhead > 25 &&
            gapAhead < 500 &&
            Math.abs(state.player.x - enemy.x) < 92
        ) {
            const projectileId = nextProjectileId(state, 'enemy-shot');
            // The positive velocity and nose-offset are the front-only gun invariant.
            state.projectiles.push({
                id: projectileId,
                allegiance: 'enemy',
                sourceId: enemy.definitionId,
                x: enemy.x,
                previousDistance: enemy.distance + ENEMY_HALF_LENGTH + 4,
                distance: enemy.distance + ENEMY_HALF_LENGTH + 4,
                forwardVelocity: 350,
                damage: 1
            });
            enemy.fireCooldownTicks = definition.fireIntervalTicks;
            state.telemetry.enemyShotsFired += 1;
            events.push({
                kind: 'enemy-fired',
                tick: state.activeTicks,
                enemyId: enemy.definitionId,
                projectileId
            });
        }
    }
    state.enemies = state.enemies.filter(enemy =>
        enemy.health > 0 &&
        enemy.distance > state.player.distance - 300 &&
        enemy.distance < state.player.distance + 440
    );
}

function firePlayerWeapon(
    state: MutableCasinoHeistState,
    input: CasinoHeistInput,
    events: CasinoHeistEvent[]
): void {
    state.player.fireCooldownTicks = Math.max(0, state.player.fireCooldownTicks - 1);
    if (
        !input.fire ||
        state.player.weapon === 'none' ||
        state.player.ammo <= 0 ||
        state.player.fireCooldownTicks > 0
    ) {
        return;
    }
    const projectileId = nextProjectileId(state, 'player-shot');
    state.projectiles.push({
        id: projectileId,
        allegiance: 'player',
        sourceId: 'player',
        x: state.player.x,
        previousDistance: state.player.distance + PLAYER_HALF_LENGTH + 4,
        distance: state.player.distance + PLAYER_HALF_LENGTH + 4,
        forwardVelocity: 410,
        damage: 1
    });
    state.player.ammo -= 1;
    state.player.fireCooldownTicks = PLAYER_FIRE_COOLDOWN_TICKS;
    state.telemetry.shotsFired += 1;
    events.push({
        kind: 'player-fired',
        tick: state.activeTicks,
        projectileId,
        ammo: state.player.ammo
    });
}

function updateProjectiles(state: MutableCasinoHeistState): void {
    const dt = CASINO_HEIST_FIXED_STEP_MS / 1_000;
    for (const projectile of state.projectiles) {
        projectile.previousDistance = projectile.distance;
        projectile.distance += projectile.forwardVelocity * dt;
    }
}

function collectPowerups(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    for (const segment of state.course.segments) {
        for (const pickup of segment.pickups) {
            if (state.collectedPickupIds.includes(pickup.id)) continue;
            if (
                !overlapsMovingLongitudinally(
                    state.player.previousDistance,
                    state.player.distance,
                    pickup.distance,
                    pickup.distance,
                    PLAYER_HALF_LENGTH + 18
                ) ||
                Math.abs(state.player.x - pickup.x) > PLAYER_HALF_WIDTH + 20
            ) {
                continue;
            }
            state.collectedPickupIds.push(pickup.id);
            state.player.weapon = 'pulse-cannon';
            state.player.ammo = Math.min(
                CASINO_HEIST_MAX_AMMO,
                state.player.ammo + pickup.ammo
            );
            state.telemetry.powerupsCollected += 1;
            state.telemetry.ammoCollected += pickup.ammo;
            events.push({
                kind: 'pickup-collected',
                tick: state.activeTicks,
                pickupId: pickup.id,
                pickupKind: pickup.kind,
                ammo: state.player.ammo,
                weapon: state.player.weapon
            });
        }
    }
}

function collideWithObstacles(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    for (const segment of state.course.segments) {
        for (const obstacle of segment.obstacles) {
            if (state.removedObstacleIds.includes(obstacle.id)) continue;
            if (
                !overlapsMovingLongitudinally(
                    state.player.previousDistance,
                    state.player.distance,
                    obstacle.distance,
                    obstacle.distance,
                    PLAYER_HALF_LENGTH + obstacle.length / 2
                ) ||
                Math.abs(state.player.x - obstacle.x) >
                PLAYER_HALF_WIDTH + obstacle.width / 2
            ) {
                continue;
            }
            state.removedObstacleIds.push(obstacle.id);
            applyDamage(state, 'obstacle', obstacle.id, obstacle.damage, events);
        }
    }
}

function resolveProjectileHits(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const removedProjectileIds = new Set<string>();
    const destroyedEnemyIds = new Set<string>();
    for (const projectile of state.projectiles) {
        if (projectile.allegiance === 'enemy') {
            if (
                overlapsMovingLongitudinally(
                    projectile.previousDistance,
                    projectile.distance,
                    state.player.previousDistance,
                    state.player.distance,
                    PLAYER_HALF_LENGTH + PROJECTILE_HALF_LENGTH
                ) &&
                Math.abs(projectile.x - state.player.x) <= PLAYER_HALF_WIDTH + 4
            ) {
                removedProjectileIds.add(projectile.id);
                applyDamage(
                    state,
                    'enemy-shot',
                    projectile.sourceId,
                    projectile.damage,
                    events
                );
            }
            continue;
        }
        for (const enemy of state.enemies) {
            if (destroyedEnemyIds.has(enemy.definitionId)) continue;
            if (
                overlapsMovingLongitudinally(
                    projectile.previousDistance,
                    projectile.distance,
                    enemy.previousDistance,
                    enemy.distance,
                    ENEMY_HALF_LENGTH + PROJECTILE_HALF_LENGTH
                ) &&
                Math.abs(projectile.x - enemy.x) <= ENEMY_HALF_WIDTH + 4
            ) {
                removedProjectileIds.add(projectile.id);
                enemy.health -= projectile.damage;
                if (enemy.health <= 0) {
                    destroyedEnemyIds.add(enemy.definitionId);
                    state.telemetry.enemiesDestroyed += 1;
                    events.push({
                        kind: 'enemy-destroyed',
                        tick: state.activeTicks,
                        enemyId: enemy.definitionId
                    });
                }
                break;
            }
        }
    }
    state.enemies = state.enemies.filter(enemy => enemy.health > 0);
    state.projectiles = state.projectiles.filter(projectile =>
        !removedProjectileIds.has(projectile.id) &&
        projectile.distance > state.player.distance - 240 &&
        projectile.distance < state.player.distance + 760
    );
}

function collideWithEnemies(
    state: MutableCasinoHeistState,
    events: CasinoHeistEvent[]
): void {
    const geometry = getCasinoHeistRoadGeometry(state.course, state.player.distance);
    for (const enemy of state.enemies) {
        if (
            enemy.contactCooldownMs > 0 ||
            !overlapsMovingLongitudinally(
                state.player.previousDistance,
                state.player.distance,
                enemy.previousDistance,
                enemy.distance,
                PLAYER_HALF_LENGTH + ENEMY_HALF_LENGTH
            ) ||
            Math.abs(state.player.x - enemy.x) > PLAYER_HALF_WIDTH + ENEMY_HALF_WIDTH
        ) {
            continue;
        }
        const damaged = applyDamage(
            state,
            'spikes',
            enemy.definitionId,
            1,
            events
        );
        enemy.contactCooldownMs = CASINO_HEIST_RECOVERY_MS;
        if (damaged) {
            const direction = state.player.x >= enemy.x ? 1 : -1;
            state.player.x = clamp(
                state.player.x + direction * 38,
                geometry.leftX + PLAYER_HALF_WIDTH,
                geometry.rightX - PLAYER_HALF_WIDTH
            );
            state.player.lateralVelocity = direction * 80;
        }
    }
}

function simulateStep(
    state: MutableCasinoHeistState,
    input: CasinoHeistInput,
    events: CasinoHeistEvent[]
): void {
    if (state.status !== 'active' || state.paused) return;
    state.activeTicks += 1;
    const wasRecovering = state.player.recoveryMs > 0;
    state.player.recoveryMs = Math.max(
        0,
        state.player.recoveryMs - CASINO_HEIST_FIXED_STEP_MS
    );
    if (wasRecovering && state.player.recoveryMs === 0) {
        events.push({kind: 'recovered', tick: state.activeTicks});
    }
    updatePlayerMotion(state, input, events);
    spawnEnemies(state, events);
    updateEnemies(state, events);
    firePlayerWeapon(state, input, events);
    updateProjectiles(state);
    collectPowerups(state, events);
    collideWithObstacles(state, events);
    resolveProjectileHits(state, events);
    collideWithEnemies(state, events);

    // Reaching the casino wins even if a final-frame impact also depleted the
    // hull. This explicit precedence prevents a finish-line race condition.
    if (state.player.distance >= state.course.finishDistance) {
        state.status = 'success';
        state.terminalReason = 'casino-reached';
        state.creditsStolen = CASINO_HEIST_REWARD_CREDITS;
        events.push({
            kind: 'success',
            tick: state.activeTicks,
            credits: CASINO_HEIST_REWARD_CREDITS
        });
    } else if (state.player.health <= 0) {
        state.status = 'failure';
        state.terminalReason = 'car-destroyed';
        events.push({
            kind: 'failure',
            tick: state.activeTicks,
            reason: 'car-destroyed'
        });
    }
}

export function stepCasinoHeist(
    state: CasinoHeistState,
    input: CasinoHeistInput
): CasinoHeistStepResult {
    if (state.status !== 'active' || state.paused) return {state, events: []};
    const next = cloneState(state);
    const events: CasinoHeistEvent[] = [];
    simulateStep(next, normalizeInput(input), events);
    return {state: next, events};
}

export function advanceCasinoHeist(
    state: CasinoHeistState,
    input: CasinoHeistInput,
    deltaMs: number
): CasinoHeistStepResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Casino Heist delta must be a finite non-negative number.');
    }
    if (
        state.status !== 'active' ||
        state.paused ||
        deltaMs === 0
    ) {
        return {state, events: []};
    }
    const normalizedInput = normalizeInput(input);
    const next = cloneState(state);
    next.accumulatorMs += deltaMs;
    const events: CasinoHeistEvent[] = [];
    while (
        next.accumulatorMs + 1e-9 >= CASINO_HEIST_FIXED_STEP_MS &&
        next.status === 'active'
    ) {
        simulateStep(next, normalizedInput, events);
        next.accumulatorMs -= CASINO_HEIST_FIXED_STEP_MS;
        if (Math.abs(next.accumulatorMs) < 1e-9) next.accumulatorMs = 0;
    }
    return {state: next, events};
}

export function setCasinoHeistPaused(
    state: CasinoHeistState,
    paused: boolean
): CasinoHeistState {
    if (state.paused === paused) return state;
    return {
        ...state,
        paused,
        accumulatorMs: 0
    };
}

function renderY(entityDistance: number, playerDistance: number): number {
    return CASINO_HEIST_PLAYER_SCREEN_Y - (entityDistance - playerDistance);
}

export function getCasinoHeistRenderSnapshot(
    state: CasinoHeistState
): CasinoHeistRenderSnapshot {
    const interpolation = clamp(
        state.accumulatorMs / CASINO_HEIST_FIXED_STEP_MS,
        0,
        1
    );
    const playerDistance = lerp(
        state.player.previousDistance,
        state.player.distance,
        interpolation
    );
    const playerX = lerp(state.player.previousX, state.player.x, interpolation);
    const minimumDistance = playerDistance - VISIBLE_BEHIND_DISTANCE;
    const maximumDistance = playerDistance + VISIBLE_AHEAD_DISTANCE;
    const road = state.course.segments
        .filter(segment =>
            segment.endDistance >= minimumDistance &&
            segment.startDistance <= maximumDistance
        )
        .map(segment => {
            const nearDistance = Math.max(segment.startDistance, minimumDistance);
            const farDistance = Math.min(segment.endDistance, maximumDistance);
            return {
                segmentIndex: segment.index,
                nearY: renderY(nearDistance, playerDistance),
                farY: renderY(farDistance, playerDistance),
                nearCenterX: segmentCenterAt(segment, nearDistance),
                farCenterX: segmentCenterAt(segment, farDistance),
                width: state.course.roadWidth
            };
        });
    const obstacles = state.course.segments
        .flatMap(segment => segment.obstacles)
        .filter(obstacle =>
            !state.removedObstacleIds.includes(obstacle.id) &&
            obstacle.distance >= minimumDistance &&
            obstacle.distance <= maximumDistance
        )
        .map(obstacle => ({
            id: obstacle.id,
            x: obstacle.x,
            y: renderY(obstacle.distance, playerDistance),
            kind: obstacle.kind,
            width: obstacle.width,
            length: obstacle.length
        }));
    const powerups = state.course.segments
        .flatMap(segment => segment.pickups)
        .filter(pickup =>
            !state.collectedPickupIds.includes(pickup.id) &&
            pickup.distance >= minimumDistance &&
            pickup.distance <= maximumDistance
        )
        .map(pickup => ({
            id: pickup.id,
            x: pickup.x,
            y: renderY(pickup.distance, playerDistance),
            kind: pickup.kind,
            ammo: pickup.ammo
        }));
    const enemies = state.enemies.map(enemy => {
        const definition = enemyDefinition(state.course, enemy.definitionId);
        const distance = lerp(enemy.previousDistance, enemy.distance, interpolation);
        return {
            id: enemy.definitionId,
            x: lerp(enemy.previousX, enemy.x, interpolation),
            y: renderY(distance, playerDistance),
            health: enemy.health,
            colorIndex: definition.colorIndex
        };
    });
    const projectiles = state.projectiles.map(projectile => ({
        id: projectile.id,
        x: projectile.x,
        y: renderY(
            lerp(projectile.previousDistance, projectile.distance, interpolation),
            playerDistance
        ),
        allegiance: projectile.allegiance
    }));
    return {
        interpolation,
        road,
        player: {
            x: playerX,
            y: CASINO_HEIST_PLAYER_SCREEN_Y,
            distance: playerDistance,
            health: state.player.health,
            maxHealth: state.player.maxHealth,
            recoveryMs: state.player.recoveryMs,
            weapon: state.player.weapon,
            ammo: state.player.ammo
        },
        obstacles,
        powerups,
        enemies,
        projectiles,
        finishY: renderY(state.course.finishDistance, playerDistance),
        finishDistance: state.course.finishDistance,
        status: state.status,
        creditsStolen: state.creditsStolen
    };
}

function witnessTargetX(state: CasinoHeistState): number {
    const currentGeometry = getCasinoHeistRoadGeometry(
        state.course,
        state.player.distance
    );
    const segment = state.course.segments[currentGeometry.segmentIndex]!;
    const obstacleEnd = Math.max(
        ...segment.obstacles.map(obstacle =>
            obstacle.distance + obstacle.length / 2 + PLAYER_HALF_LENGTH + 12
        )
    );
    let targetSegment = segment;
    if (
        state.player.distance > obstacleEnd &&
        segment.index + 1 < state.course.segments.length
    ) {
        targetSegment = state.course.segments[segment.index + 1]!;
    }
    const targetDistance = clamp(
        Math.max(state.player.distance, targetSegment.startDistance) + 45,
        targetSegment.startDistance,
        targetSegment.endDistance
    );
    return segmentCenterAt(targetSegment, targetDistance) +
        targetSegment.safeLane * LANE_OFFSET;
}

/**
 * A deterministic accessibility/witness driver. It follows the generator's
 * certified safe lane and only fires when a luxury car has moved ahead.
 */
export function chooseCasinoHeistWitnessInput(
    state: CasinoHeistState
): CasinoHeistInput {
    if (state.status !== 'active' || state.paused) return NEUTRAL_CASINO_HEIST_INPUT;
    const targetX = witnessTargetX(state);
    const error = targetX - state.player.x;
    const steer = clamp(
        error / 48 - state.player.lateralVelocity / 310,
        -1,
        1
    );
    const enemyAhead = state.enemies.some(enemy =>
        enemy.distance > state.player.distance + 25 &&
        enemy.distance < state.player.distance + 430 &&
        Math.abs(enemy.x - state.player.x) < 48
    );
    return {
        steer,
        fire:
            enemyAhead &&
            state.player.weapon !== 'none' &&
            state.player.ammo > 0
    };
}

export function replayCasinoHeistWitness(
    course: CasinoHeistCourse,
    maximumTicks = Math.ceil(
        course.finishDistance /
        (CASINO_HEIST_PLAYER_SPEED * 0.75) *
        (1_000 / CASINO_HEIST_FIXED_STEP_MS)
    ) + 1_000
): CasinoHeistWitnessResult {
    if (!Number.isSafeInteger(maximumTicks) || maximumTicks < 1) {
        throw new Error('Casino Heist witness tick limit must be a positive safe integer.');
    }
    let state = createCasinoHeistState(course);
    let ticks = 0;
    while (state.status === 'active' && ticks < maximumTicks) {
        state = stepCasinoHeist(state, chooseCasinoHeistWitnessInput(state)).state;
        ticks += 1;
    }
    return {
        success: state.status === 'success',
        ticks,
        state
    };
}
