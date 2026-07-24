import {
    chooseRandom,
    randomInteger,
    shuffle,
    type RandomSource
} from '../../domain/random/random-source';

export const ZAPPER_WORLD_WIDTH = 720;
export const ZAPPER_WORLD_HEIGHT = 480;
export const ZAPPER_LANE_COUNT = 4;
export const ZAPPER_FIXED_STEP_MS = 20;
export const ZAPPER_SERVICE_X = 74;
export const ZAPPER_ALIEN_SPAWN_X = 674;
export const ZAPPER_DANGER_X = 94;
export const ZAPPER_OUTGOING_MISS_X = 714;
export const ZAPPER_RETURN_MISS_X = 8;
export const ZAPPER_OUTGOING_SPEED = 360;
export const ZAPPER_RETURN_SPEED = 320;
export const ZAPPER_DEFAULT_QUOTA = 12;
export const ZAPPER_DEFAULT_STARTING_LIVES = 3;
export const ZAPPER_BASE_FILL_DURATION_MS = 920;
export const ZAPPER_BASE_CATCH_TOLERANCE_PX = 72;

const MIN_GLOBAL_SPAWN_GAP_MS = 1_400;
const MIN_SAME_LANE_SPAWN_GAP_MS = 2_700;
const MIN_APPROACH_BUDGET_MS = 12_000;
const MAX_DIFFICULTY = 5;

export type ZapperStatus = 'active' | 'success' | 'failure';
export type ZapperAlienPhase = 'approaching' | 'assembling' | 'waiting-return';
export type ZapperProjectileKind = 'outgoing' | 'returning';
export type ZapperFailureReason =
    | 'outgoing-missed'
    | 'return-missed'
    | 'alien-breached'
    | 'quota-unreachable';
export type ZapperAlienSpecies =
    | 'tripod'
    | 'jelly'
    | 'crystal'
    | 'moth'
    | 'slug'
    | 'orb';
export type ZapperBlasterStyle =
    | 'ray-pistol'
    | 'plasma-loop'
    | 'ion-fork'
    | 'nova-nozzle';
export type ZapperSlimeFlavor =
    | 'radioactive-lime'
    | 'mint-nebula'
    | 'glow-worm'
    | 'toxic-pickle';

/**
 * Bonuses are deliberately expressed without campaign or inventory types so
 * maze items can be mapped to them at the scene boundary.
 */
export interface ZapperBonuses {
    /** Values above one fill a blaster faster. */
    readonly fillSpeedMultiplier?: number;
    readonly extraStartingLives?: number;
    /** Extra pixels added to the completed-blaster catch window. */
    readonly catchTolerancePx?: number;
}

export interface ZapperGenerationConfig {
    readonly difficulty?: number;
    readonly completionQuota?: number;
    readonly startingLives?: number;
    readonly bonuses?: ZapperBonuses;
}

export interface ZapperTuning {
    readonly fillDurationMs: number;
    readonly catchTolerancePx: number;
    readonly outgoingSpeed: number;
    readonly returnSpeed: number;
}

export interface ZapperAlienAppearance {
    readonly species: ZapperAlienSpecies;
    readonly bodyColorIndex: number;
    readonly eyeCount: number;
    readonly antennaCount: number;
    readonly blasterStyle: ZapperBlasterStyle;
    readonly slimeFlavor: ZapperSlimeFlavor;
}

export interface ZapperOrderDefinition {
    readonly id: string;
    readonly laneIndex: number;
    readonly waveIndex: number;
    readonly spawnAtMs: number;
    readonly approachSpeed: number;
    readonly assemblyDurationMs: number;
    readonly appearance: ZapperAlienAppearance;
}

export interface ZapperCourse {
    readonly generatorId: 'zapper-lab-v1';
    readonly width: number;
    readonly height: number;
    readonly laneCount: number;
    readonly difficulty: number;
    readonly completionQuota: number;
    readonly startingLives: number;
    readonly tuning: ZapperTuning;
    readonly bonuses: Required<ZapperBonuses>;
    readonly orders: readonly ZapperOrderDefinition[];
}

export interface ZapperPlayerState {
    readonly laneIndex: number;
    readonly fillProgress: number;
    readonly heldCompletedOrderId: string | null;
}

export interface ZapperAlienState {
    readonly orderId: string;
    readonly laneIndex: number;
    readonly previousX: number;
    readonly x: number;
    readonly phase: ZapperAlienPhase;
    readonly assemblyRemainingMs: number;
}

export interface ZapperProjectileState {
    readonly id: string;
    readonly kind: ZapperProjectileKind;
    readonly laneIndex: number;
    readonly orderId: string | null;
    readonly previousX: number;
    readonly x: number;
}

export interface ZapperState {
    readonly course: ZapperCourse;
    readonly player: ZapperPlayerState;
    readonly aliens: readonly ZapperAlienState[];
    readonly projectiles: readonly ZapperProjectileState[];
    readonly lives: number;
    readonly score: number;
    readonly completedOrders: number;
    readonly failedOrders: number;
    readonly nextOrderIndex: number;
    readonly nextProjectileId: number;
    readonly currentWaveIndex: number;
    readonly activeTicks: number;
    readonly accumulatorMs: number;
    readonly status: ZapperStatus;
    readonly failureReason: ZapperFailureReason | null;
    readonly paused: boolean;
    readonly chargeHeld: boolean;
    readonly pendingLaneDelta: -1 | 0 | 1;
    readonly pendingAction: boolean;
}

/**
 * `laneDelta` and `actionPressed` are edge-triggered. `chargeHeld` is a level
 * input. A scene can map these equally well from a keyboard, gamepad, or touch.
 *
 * The action launches a full blaster, or hands off a caught completed blaster.
 */
export interface ZapperInput {
    readonly laneDelta: -1 | 0 | 1;
    readonly chargeHeld: boolean;
    readonly actionPressed: boolean;
}

export const ZAPPER_IDLE_INPUT: ZapperInput = Object.freeze({
    laneDelta: 0,
    chargeHeld: false,
    actionPressed: false
});

export type ZapperActionRejection =
    | 'blaster-not-full'
    | 'handoff-wrong-lane'
    | 'handoff-customer-missing';

export type ZapperEvent =
    | {readonly kind: 'wave-started'; readonly waveIndex: number}
    | {
        readonly kind: 'alien-spawned';
        readonly orderId: string;
        readonly laneIndex: number;
    }
    | {readonly kind: 'lane-changed'; readonly laneIndex: number}
    | {readonly kind: 'blaster-ready'}
    | {
        readonly kind: 'outgoing-launched';
        readonly projectileId: string;
        readonly laneIndex: number;
    }
    | {
        readonly kind: 'alien-received';
        readonly orderId: string;
        readonly projectileId: string;
    }
    | {
        readonly kind: 'return-launched';
        readonly orderId: string;
        readonly projectileId: string;
    }
    | {readonly kind: 'return-caught'; readonly orderId: string}
    | {
        readonly kind: 'handoff-complete';
        readonly orderId: string;
        readonly completedOrders: number;
        readonly quota: number;
    }
    | {
        readonly kind: 'action-rejected';
        readonly reason: ZapperActionRejection;
    }
    | {
        readonly kind: 'life-lost';
        readonly reason: Exclude<ZapperFailureReason, 'quota-unreachable'>;
        readonly lives: number;
        readonly orderId: string | null;
    }
    | {readonly kind: 'success'}
    | {readonly kind: 'failure'; readonly reason: ZapperFailureReason};

export interface ZapperStepResult {
    readonly state: ZapperState;
    readonly events: readonly ZapperEvent[];
}

export interface ZapperValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

export interface ZapperTelemetry {
    readonly elapsedMs: number;
    readonly laneIndex: number;
    readonly lives: number;
    readonly score: number;
    readonly fillProgress: number;
    readonly blasterReady: boolean;
    readonly heldCompletedOrderId: string | null;
    readonly completedOrders: number;
    readonly completionQuota: number;
    readonly failedOrders: number;
    readonly activeAliens: number;
    readonly approachingAliens: number;
    readonly returningBlasters: number;
    readonly currentWave: number;
    readonly scheduledOrdersRemaining: number;
    readonly nearestThreatMs: number | null;
    readonly status: ZapperStatus;
    readonly failureReason: ZapperFailureReason | null;
}

export interface ZapperRenderSnapshot {
    readonly interpolation: number;
    readonly player: ZapperPlayerState;
    readonly lives: number;
    readonly score: number;
    readonly completedOrders: number;
    readonly completionQuota: number;
    readonly currentWave: number;
    readonly aliens: readonly (Omit<ZapperAlienState, 'previousX'> & {
        readonly x: number;
        readonly appearance: ZapperAlienAppearance;
    })[];
    readonly projectiles: readonly (Omit<ZapperProjectileState, 'previousX'> & {
        readonly x: number;
    })[];
    readonly status: ZapperStatus;
}

interface MutablePlayerState {
    laneIndex: number;
    fillProgress: number;
    heldCompletedOrderId: string | null;
}

interface MutableAlienState {
    orderId: string;
    laneIndex: number;
    previousX: number;
    x: number;
    phase: ZapperAlienPhase;
    assemblyRemainingMs: number;
}

interface MutableProjectileState {
    id: string;
    kind: ZapperProjectileKind;
    laneIndex: number;
    orderId: string | null;
    previousX: number;
    x: number;
}

interface MutableZapperState {
    course: ZapperCourse;
    player: MutablePlayerState;
    aliens: MutableAlienState[];
    projectiles: MutableProjectileState[];
    lives: number;
    score: number;
    completedOrders: number;
    failedOrders: number;
    nextOrderIndex: number;
    nextProjectileId: number;
    currentWaveIndex: number;
    activeTicks: number;
    accumulatorMs: number;
    status: ZapperStatus;
    failureReason: ZapperFailureReason | null;
    paused: boolean;
    chargeHeld: boolean;
    pendingLaneDelta: -1 | 0 | 1;
    pendingAction: boolean;
}

const ALIEN_SPECIES: readonly ZapperAlienSpecies[] = Object.freeze([
    'tripod',
    'jelly',
    'crystal',
    'moth',
    'slug',
    'orb'
]);
const BLASTER_STYLES: readonly ZapperBlasterStyle[] = Object.freeze([
    'ray-pistol',
    'plasma-loop',
    'ion-fork',
    'nova-nozzle'
]);
const SLIME_FLAVORS: readonly ZapperSlimeFlavor[] = Object.freeze([
    'radioactive-lime',
    'mint-nebula',
    'glow-worm',
    'toxic-pickle'
]);

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

function alignToFixedStep(milliseconds: number): number {
    return Math.round(milliseconds / ZAPPER_FIXED_STEP_MS) * ZAPPER_FIXED_STEP_MS;
}

function assertSafeIntegerInRange(
    value: number | undefined,
    name: string,
    minimum: number,
    maximum: number
): void {
    if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    ) {
        throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
    }
}

function normalizeBonuses(bonuses: ZapperBonuses | undefined): Required<ZapperBonuses> {
    const fillSpeedMultiplier = bonuses?.fillSpeedMultiplier ?? 1;
    const extraStartingLives = bonuses?.extraStartingLives ?? 0;
    const catchTolerancePx = bonuses?.catchTolerancePx ?? 0;
    if (
        !Number.isFinite(fillSpeedMultiplier) ||
        fillSpeedMultiplier < 0.65 ||
        fillSpeedMultiplier > 2
    ) {
        throw new Error('Zapper fill speed multiplier must be from 0.65 through 2.');
    }
    assertSafeIntegerInRange(extraStartingLives, 'Zapper extra starting lives', 0, 4);
    if (
        !Number.isFinite(catchTolerancePx) ||
        catchTolerancePx < 0 ||
        catchTolerancePx > 88
    ) {
        throw new Error('Zapper catch tolerance bonus must be from 0 through 88 pixels.');
    }
    return {
        fillSpeedMultiplier,
        extraStartingLives,
        catchTolerancePx
    };
}

function assertGenerationConfig(config: ZapperGenerationConfig): void {
    assertSafeIntegerInRange(
        config.difficulty,
        'Zapper difficulty',
        0,
        MAX_DIFFICULTY
    );
    assertSafeIntegerInRange(
        config.completionQuota,
        'Zapper completion quota',
        1,
        24
    );
    assertSafeIntegerInRange(
        config.startingLives,
        'Zapper starting lives',
        1,
        7
    );
    normalizeBonuses(config.bonuses);
}

function randomAppearance(random: RandomSource): ZapperAlienAppearance {
    return {
        species: chooseRandom(ALIEN_SPECIES, random),
        bodyColorIndex: randomInteger(random, 10),
        eyeCount: 1 + randomInteger(random, 5),
        antennaCount: randomInteger(random, 4),
        blasterStyle: chooseRandom(BLASTER_STYLES, random),
        slimeFlavor: chooseRandom(SLIME_FLAVORS, random)
    };
}

/**
 * Generates arrivals in shuffled four-order waves. Every lane appears once per
 * complete wave, global arrivals have breathing room, and aliens approach
 * slowly enough for several complete charge/launch/return cycles. Those are
 * the constructive solvability invariants checked below.
 */
export function createZapperCourse(
    random: RandomSource,
    config: ZapperGenerationConfig = {}
): ZapperCourse {
    assertGenerationConfig(config);
    const difficulty = config.difficulty ?? 1;
    const completionQuota = config.completionQuota ?? ZAPPER_DEFAULT_QUOTA;
    const bonuses = normalizeBonuses(config.bonuses);
    const baseStartingLives = config.startingLives ?? ZAPPER_DEFAULT_STARTING_LIVES;
    const startingLives = baseStartingLives + bonuses.extraStartingLives;
    const orderCount = completionQuota + startingLives + 2;
    const fillDurationMs = alignToFixedStep(
        ZAPPER_BASE_FILL_DURATION_MS / bonuses.fillSpeedMultiplier
    );
    const tuning: ZapperTuning = {
        fillDurationMs,
        catchTolerancePx:
            ZAPPER_BASE_CATCH_TOLERANCE_PX + bonuses.catchTolerancePx,
        outgoingSpeed: ZAPPER_OUTGOING_SPEED,
        returnSpeed: ZAPPER_RETURN_SPEED
    };

    const orders: ZapperOrderDefinition[] = [];
    let spawnAtMs = 0;
    let previousLane = -1;
    let waveIndex = 0;
    while (orders.length < orderCount) {
        let lanes = shuffle([0, 1, 2, 3] as const, random);
        if (lanes[0] === previousLane) {
            const replacementIndex = lanes.findIndex(lane => lane !== previousLane);
            if (replacementIndex > 0) {
                const first = lanes[0]!;
                lanes[0] = lanes[replacementIndex]!;
                lanes[replacementIndex] = first;
            }
        }

        for (const laneIndex of lanes) {
            if (orders.length >= orderCount) break;
            if (orders.length > 0) {
                const baseGap = 1_900 - difficulty * 80;
                spawnAtMs += baseGap + randomInteger(random, 701);
                if (orders.length % ZAPPER_LANE_COUNT === 0) {
                    spawnAtMs += 900 + randomInteger(random, 601);
                }
                spawnAtMs = alignToFixedStep(spawnAtMs);
            }
            const orderIndex = orders.length;
            orders.push({
                id: `wave-${waveIndex}-order-${orderIndex}`,
                laneIndex,
                waveIndex,
                spawnAtMs,
                approachSpeed: 23 + difficulty * 2 + randomInteger(random, 10),
                assemblyDurationMs: alignToFixedStep(440 + randomInteger(random, 421)),
                appearance: randomAppearance(random)
            });
            previousLane = laneIndex;
        }
        waveIndex += 1;
    }

    const course: ZapperCourse = {
        generatorId: 'zapper-lab-v1',
        width: ZAPPER_WORLD_WIDTH,
        height: ZAPPER_WORLD_HEIGHT,
        laneCount: ZAPPER_LANE_COUNT,
        difficulty,
        completionQuota,
        startingLives,
        tuning,
        bonuses,
        orders
    };
    const validation = validateZapperCourse(course);
    if (!validation.valid) {
        throw new Error(`Generated invalid Zapper course: ${validation.errors.join('; ')}`);
    }
    return course;
}

export function canonicalZapperCourseSignature(course: ZapperCourse): string {
    return [
        course.difficulty,
        course.completionQuota,
        course.startingLives,
        course.tuning.fillDurationMs,
        course.tuning.catchTolerancePx,
        course.orders.map(order => [
            order.id,
            order.laneIndex,
            order.waveIndex,
            order.spawnAtMs,
            order.approachSpeed,
            order.assemblyDurationMs,
            order.appearance.species,
            order.appearance.bodyColorIndex,
            order.appearance.eyeCount,
            order.appearance.antennaCount,
            order.appearance.blasterStyle,
            order.appearance.slimeFlavor
        ].join(',')).join('|')
    ].join('/');
}

/**
 * Checks the construction proof used by the generator. This intentionally does
 * not claim that every possible player action wins; it proves there is enough
 * time and spacing for the straightforward priority strategy exported below.
 */
export function hasZapperConstructiveServiceRoute(course: ZapperCourse): boolean {
    if (
        course.orders.length < course.completionQuota ||
        course.tuning.fillDurationMs > 1_420 ||
        course.tuning.catchTolerancePx < 48
    ) {
        return false;
    }
    const previousSpawnByLane = new Map<number, number>();
    for (let index = 0; index < course.orders.length; index++) {
        const order = course.orders[index]!;
        const approachBudgetMs =
            (ZAPPER_ALIEN_SPAWN_X - ZAPPER_DANGER_X) /
            order.approachSpeed *
            1_000;
        if (approachBudgetMs < MIN_APPROACH_BUDGET_MS) return false;
        if (
            index > 0 &&
            order.spawnAtMs - course.orders[index - 1]!.spawnAtMs <
                MIN_GLOBAL_SPAWN_GAP_MS
        ) {
            return false;
        }
        const previousInLane = previousSpawnByLane.get(order.laneIndex);
        if (
            previousInLane !== undefined &&
            order.spawnAtMs - previousInLane < MIN_SAME_LANE_SPAWN_GAP_MS
        ) {
            return false;
        }
        previousSpawnByLane.set(order.laneIndex, order.spawnAtMs);
    }
    return true;
}

export function validateZapperCourse(course: ZapperCourse): ZapperValidationResult {
    const errors: string[] = [];
    if (course.generatorId !== 'zapper-lab-v1') {
        errors.push('Unknown Zapper generator.');
    }
    if (
        course.width !== ZAPPER_WORLD_WIDTH ||
        course.height !== ZAPPER_WORLD_HEIGHT ||
        course.laneCount !== ZAPPER_LANE_COUNT
    ) {
        errors.push('Course dimensions or lane count do not match the Zapper laboratory.');
    }
    if (
        !Number.isSafeInteger(course.difficulty) ||
        course.difficulty < 0 ||
        course.difficulty > MAX_DIFFICULTY
    ) {
        errors.push('Course difficulty is outside the supported range.');
    }
    if (
        !Number.isSafeInteger(course.completionQuota) ||
        course.completionQuota < 1 ||
        course.completionQuota > 24
    ) {
        errors.push('Course completion quota is invalid.');
    }
    if (
        !Number.isSafeInteger(course.startingLives) ||
        course.startingLives < 1 ||
        course.startingLives > 11
    ) {
        errors.push('Course starting lives are invalid.');
    }
    if (
        !Number.isFinite(course.tuning.fillDurationMs) ||
        course.tuning.fillDurationMs < 440 ||
        course.tuning.fillDurationMs > 1_420
    ) {
        errors.push('Course fill duration is invalid.');
    }
    if (
        !Number.isFinite(course.tuning.catchTolerancePx) ||
        course.tuning.catchTolerancePx < 48 ||
        course.tuning.catchTolerancePx > 160
    ) {
        errors.push('Course catch tolerance is invalid.');
    }
    if (
        course.tuning.outgoingSpeed !== ZAPPER_OUTGOING_SPEED ||
        course.tuning.returnSpeed !== ZAPPER_RETURN_SPEED
    ) {
        errors.push('Course projectile speeds are invalid.');
    }

    const ids = new Set<string>();
    const populatedLanes = new Set<number>();
    let previousSpawnAtMs = -1;
    let previousWaveIndex = -1;
    for (const order of course.orders) {
        if (ids.has(order.id)) errors.push(`Duplicate order id ${order.id}.`);
        ids.add(order.id);
        if (
            !Number.isSafeInteger(order.laneIndex) ||
            order.laneIndex < 0 ||
            order.laneIndex >= ZAPPER_LANE_COUNT
        ) {
            errors.push(`Order ${order.id} has an invalid lane.`);
        }
        populatedLanes.add(order.laneIndex);
        if (
            !Number.isSafeInteger(order.waveIndex) ||
            order.waveIndex < 0 ||
            order.waveIndex < previousWaveIndex ||
            order.waveIndex > previousWaveIndex + 1
        ) {
            errors.push(`Order ${order.id} has a non-sequential wave.`);
        }
        previousWaveIndex = order.waveIndex;
        if (
            !Number.isSafeInteger(order.spawnAtMs) ||
            order.spawnAtMs < 0 ||
            order.spawnAtMs <= previousSpawnAtMs ||
            order.spawnAtMs % ZAPPER_FIXED_STEP_MS !== 0
        ) {
            if (!(previousSpawnAtMs < 0 && order.spawnAtMs === 0)) {
                errors.push(`Order ${order.id} has an invalid spawn time.`);
            }
        }
        previousSpawnAtMs = order.spawnAtMs;
        if (order.approachSpeed < 23 || order.approachSpeed > 42) {
            errors.push(`Order ${order.id} has an invalid approach speed.`);
        }
        if (
            order.assemblyDurationMs < 440 ||
            order.assemblyDurationMs > 860 ||
            order.assemblyDurationMs % ZAPPER_FIXED_STEP_MS !== 0
        ) {
            errors.push(`Order ${order.id} has an invalid assembly duration.`);
        }
        if (
            !ALIEN_SPECIES.includes(order.appearance.species) ||
            !BLASTER_STYLES.includes(order.appearance.blasterStyle) ||
            !SLIME_FLAVORS.includes(order.appearance.slimeFlavor) ||
            order.appearance.bodyColorIndex < 0 ||
            order.appearance.bodyColorIndex > 9 ||
            order.appearance.eyeCount < 1 ||
            order.appearance.eyeCount > 5 ||
            order.appearance.antennaCount < 0 ||
            order.appearance.antennaCount > 3
        ) {
            errors.push(`Order ${order.id} has an invalid alien appearance.`);
        }
    }
    if (course.orders.length < course.completionQuota + course.startingLives - 1) {
        errors.push('Course does not contain enough orders to survive recoverable mistakes.');
    }
    if (course.orders.length >= ZAPPER_LANE_COUNT && populatedLanes.size !== ZAPPER_LANE_COUNT) {
        errors.push('Course does not use all four laboratory counters.');
    }
    if (!hasZapperConstructiveServiceRoute(course)) {
        errors.push('Course does not satisfy the constructive service route.');
    }
    return {valid: errors.length === 0, errors};
}

export function createZapperState(course: ZapperCourse): ZapperState {
    const validation = validateZapperCourse(course);
    if (!validation.valid) {
        throw new Error(`Cannot start invalid Zapper course: ${validation.errors.join('; ')}`);
    }
    return {
        course,
        player: {
            laneIndex: 0,
            fillProgress: 0,
            heldCompletedOrderId: null
        },
        aliens: [],
        projectiles: [],
        lives: course.startingLives,
        score: 0,
        completedOrders: 0,
        failedOrders: 0,
        nextOrderIndex: 0,
        nextProjectileId: 0,
        currentWaveIndex: -1,
        activeTicks: 0,
        accumulatorMs: 0,
        status: 'active',
        failureReason: null,
        paused: false,
        chargeHeld: false,
        pendingLaneDelta: 0,
        pendingAction: false
    };
}

function cloneState(state: ZapperState): MutableZapperState {
    return {
        course: state.course,
        player: {...state.player},
        aliens: state.aliens.map(alien => ({...alien})),
        projectiles: state.projectiles.map(projectile => ({...projectile})),
        lives: state.lives,
        score: state.score,
        completedOrders: state.completedOrders,
        failedOrders: state.failedOrders,
        nextOrderIndex: state.nextOrderIndex,
        nextProjectileId: state.nextProjectileId,
        currentWaveIndex: state.currentWaveIndex,
        activeTicks: state.activeTicks,
        accumulatorMs: state.accumulatorMs,
        status: state.status,
        failureReason: state.failureReason,
        paused: state.paused,
        chargeHeld: state.chargeHeld,
        pendingLaneDelta: state.pendingLaneDelta,
        pendingAction: state.pendingAction
    };
}

function orderById(
    course: ZapperCourse,
    orderId: string
): ZapperOrderDefinition | undefined {
    return course.orders.find(order => order.id === orderId);
}

function spawnDueAliens(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    const elapsedMs = state.activeTicks * ZAPPER_FIXED_STEP_MS;
    while (
        state.nextOrderIndex < state.course.orders.length &&
        state.course.orders[state.nextOrderIndex]!.spawnAtMs <= elapsedMs
    ) {
        const order = state.course.orders[state.nextOrderIndex]!;
        if (order.waveIndex > state.currentWaveIndex) {
            state.currentWaveIndex = order.waveIndex;
            events.push({kind: 'wave-started', waveIndex: order.waveIndex});
        }
        state.aliens.push({
            orderId: order.id,
            laneIndex: order.laneIndex,
            previousX: ZAPPER_ALIEN_SPAWN_X,
            x: ZAPPER_ALIEN_SPAWN_X,
            phase: 'approaching',
            assemblyRemainingMs: 0
        });
        state.nextOrderIndex += 1;
        events.push({
            kind: 'alien-spawned',
            orderId: order.id,
            laneIndex: order.laneIndex
        });
    }
}

function changeLane(
    state: MutableZapperState,
    laneDelta: -1 | 0 | 1,
    events: ZapperEvent[]
): void {
    if (laneDelta === 0) return;
    const nextLane = clamp(
        state.player.laneIndex + laneDelta,
        0,
        ZAPPER_LANE_COUNT - 1
    );
    if (nextLane === state.player.laneIndex) return;
    state.player.laneIndex = nextLane;
    events.push({kind: 'lane-changed', laneIndex: nextLane});
}

function chargeBlaster(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    if (
        !state.chargeHeld ||
        state.player.heldCompletedOrderId !== null ||
        state.player.fillProgress >= 1
    ) {
        return;
    }
    const previous = state.player.fillProgress;
    state.player.fillProgress = clamp(
        previous + ZAPPER_FIXED_STEP_MS / state.course.tuning.fillDurationMs,
        0,
        1
    );
    if (previous < 1 && state.player.fillProgress >= 1) {
        events.push({kind: 'blaster-ready'});
    }
}

function handoffHeldBlaster(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    const orderId = state.player.heldCompletedOrderId;
    if (orderId === null) return;
    const alien = state.aliens.find(candidate => candidate.orderId === orderId);
    if (alien === undefined || alien.phase !== 'waiting-return') {
        events.push({kind: 'action-rejected', reason: 'handoff-customer-missing'});
        return;
    }
    if (alien.laneIndex !== state.player.laneIndex) {
        events.push({kind: 'action-rejected', reason: 'handoff-wrong-lane'});
        return;
    }
    state.player.heldCompletedOrderId = null;
    state.aliens = state.aliens.filter(candidate => candidate.orderId !== orderId);
    state.completedOrders += 1;
    state.score += 500;
    events.push({
        kind: 'handoff-complete',
        orderId,
        completedOrders: state.completedOrders,
        quota: state.course.completionQuota
    });
    if (state.completedOrders >= state.course.completionQuota) {
        state.status = 'success';
        events.push({kind: 'success'});
    }
}

function launchOutgoing(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    if (state.player.fillProgress < 1) {
        events.push({kind: 'action-rejected', reason: 'blaster-not-full'});
        return;
    }
    const id = `outgoing-${state.nextProjectileId}`;
    state.nextProjectileId += 1;
    state.projectiles.push({
        id,
        kind: 'outgoing',
        laneIndex: state.player.laneIndex,
        orderId: null,
        previousX: ZAPPER_SERVICE_X,
        x: ZAPPER_SERVICE_X
    });
    state.player.fillProgress = 0;
    events.push({
        kind: 'outgoing-launched',
        projectileId: id,
        laneIndex: state.player.laneIndex
    });
}

function performAction(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    if (state.player.heldCompletedOrderId !== null) {
        handoffHeldBlaster(state, events);
    }
    else {
        launchOutgoing(state, events);
    }
}

function loseLife(
    state: MutableZapperState,
    reason: Exclude<ZapperFailureReason, 'quota-unreachable'>,
    orderId: string | null,
    events: ZapperEvent[]
): void {
    state.lives = Math.max(0, state.lives - 1);
    if (reason !== 'outgoing-missed') state.failedOrders += 1;
    events.push({kind: 'life-lost', reason, lives: state.lives, orderId});
    if (state.lives <= 0) {
        state.status = 'failure';
        state.failureReason = reason;
        events.push({kind: 'failure', reason});
    }
}

function advanceApproachingAliens(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    const breachedOrderIds: string[] = [];
    for (const alien of state.aliens) {
        alien.previousX = alien.x;
        if (alien.phase !== 'approaching') continue;
        const order = orderById(state.course, alien.orderId);
        if (order === undefined) continue;
        alien.x -= order.approachSpeed * ZAPPER_FIXED_STEP_MS / 1_000;
        if (alien.x <= ZAPPER_DANGER_X) breachedOrderIds.push(alien.orderId);
    }
    for (const orderId of breachedOrderIds) {
        state.aliens = state.aliens.filter(alien => alien.orderId !== orderId);
        state.projectiles = state.projectiles.filter(
            projectile => projectile.orderId !== orderId
        );
        if (state.player.heldCompletedOrderId === orderId) {
            state.player.heldCompletedOrderId = null;
        }
        loseLife(state, 'alien-breached', orderId, events);
        if (state.status !== 'active') return;
    }
}

function findOutgoingCollision(
    state: MutableZapperState,
    projectile: MutableProjectileState
): MutableAlienState | undefined {
    return state.aliens
        .filter(alien =>
            alien.laneIndex === projectile.laneIndex &&
            alien.phase === 'approaching' &&
            projectile.x >= alien.x - 10
        )
        .sort((left, right) => left.x - right.x)[0];
}

function advanceOutgoingProjectiles(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    const removeIds = new Set<string>();
    for (const projectile of state.projectiles) {
        if (projectile.kind !== 'outgoing') continue;
        projectile.previousX = projectile.x;
        projectile.x += state.course.tuning.outgoingSpeed *
            ZAPPER_FIXED_STEP_MS /
            1_000;
        const alien = findOutgoingCollision(state, projectile);
        if (alien !== undefined) {
            const order = orderById(state.course, alien.orderId);
            if (order !== undefined) {
                alien.phase = 'assembling';
                alien.assemblyRemainingMs = order.assemblyDurationMs;
                state.score += 75;
                projectile.orderId = alien.orderId;
                removeIds.add(projectile.id);
                events.push({
                    kind: 'alien-received',
                    orderId: alien.orderId,
                    projectileId: projectile.id
                });
            }
        }
        else if (projectile.x >= ZAPPER_OUTGOING_MISS_X) {
            removeIds.add(projectile.id);
            loseLife(state, 'outgoing-missed', null, events);
            if (state.status !== 'active') break;
        }
    }
    state.projectiles = state.projectiles.filter(
        projectile => !removeIds.has(projectile.id)
    );
}

function advanceAssembly(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    for (const alien of state.aliens) {
        if (alien.phase !== 'assembling') continue;
        alien.assemblyRemainingMs = Math.max(
            0,
            alien.assemblyRemainingMs - ZAPPER_FIXED_STEP_MS
        );
        if (alien.assemblyRemainingMs > 0) continue;
        alien.phase = 'waiting-return';
        const id = `return-${state.nextProjectileId}`;
        state.nextProjectileId += 1;
        state.projectiles.push({
            id,
            kind: 'returning',
            laneIndex: alien.laneIndex,
            orderId: alien.orderId,
            previousX: alien.x,
            x: alien.x
        });
        events.push({
            kind: 'return-launched',
            orderId: alien.orderId,
            projectileId: id
        });
    }
}

function advanceReturningProjectiles(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    const removeIds = new Set<string>();
    const failedOrderIds = new Set<string>();
    const catchThreshold =
        ZAPPER_SERVICE_X + state.course.tuning.catchTolerancePx;
    const orderedReturns = state.projectiles
        .filter(projectile => projectile.kind === 'returning')
        .sort((left, right) => left.x - right.x);
    for (const projectile of orderedReturns) {
        projectile.previousX = projectile.x;
        projectile.x -= state.course.tuning.returnSpeed *
            ZAPPER_FIXED_STEP_MS /
            1_000;
        const canCatch =
            projectile.x <= catchThreshold &&
            projectile.x >= ZAPPER_RETURN_MISS_X &&
            projectile.laneIndex === state.player.laneIndex &&
            state.player.heldCompletedOrderId === null;
        if (canCatch && projectile.orderId !== null) {
            state.player.heldCompletedOrderId = projectile.orderId;
            state.score += 100;
            removeIds.add(projectile.id);
            events.push({kind: 'return-caught', orderId: projectile.orderId});
        }
        else if (projectile.x < ZAPPER_RETURN_MISS_X) {
            removeIds.add(projectile.id);
            if (projectile.orderId !== null) failedOrderIds.add(projectile.orderId);
            loseLife(state, 'return-missed', projectile.orderId, events);
            if (state.status !== 'active') break;
        }
    }
    state.projectiles = state.projectiles.filter(
        projectile => !removeIds.has(projectile.id)
    );
    if (failedOrderIds.size > 0) {
        state.aliens = state.aliens.filter(
            alien => !failedOrderIds.has(alien.orderId)
        );
    }
}

function checkQuotaReachability(
    state: MutableZapperState,
    events: ZapperEvent[]
): void {
    if (
        state.status !== 'active' ||
        state.nextOrderIndex < state.course.orders.length ||
        state.aliens.length > 0 ||
        state.projectiles.length > 0
    ) {
        return;
    }
    if (state.completedOrders < state.course.completionQuota) {
        state.status = 'failure';
        state.failureReason = 'quota-unreachable';
        events.push({kind: 'failure', reason: 'quota-unreachable'});
    }
}

function simulateStep(
    state: MutableZapperState,
    input: ZapperInput,
    events: ZapperEvent[]
): void {
    if (state.status !== 'active' || state.paused) return;
    state.activeTicks += 1;
    for (const alien of state.aliens) alien.previousX = alien.x;
    for (const projectile of state.projectiles) projectile.previousX = projectile.x;
    spawnDueAliens(state, events);
    changeLane(state, input.laneDelta, events);
    if (input.actionPressed) performAction(state, events);
    chargeBlaster(state, events);
    advanceApproachingAliens(state, events);
    if (state.status !== 'active') return;
    advanceOutgoingProjectiles(state, events);
    if (state.status !== 'active') return;
    advanceAssembly(state, events);
    advanceReturningProjectiles(state, events);
    if (state.status !== 'active') return;
    checkQuotaReachability(state, events);
}

export function stepZapper(
    state: ZapperState,
    input: ZapperInput
): ZapperStepResult {
    if (state.status !== 'active' || state.paused) return {state, events: []};
    const next = cloneState(state);
    next.chargeHeld = input.chargeHeld;
    const events: ZapperEvent[] = [];
    simulateStep(next, input, events);
    return {state: next, events};
}

/**
 * Advances at a deterministic 50 Hz. Edge inputs are buffered until the first
 * fixed step and consumed once, while charge remains held for every consumed
 * step.
 */
export function advanceZapper(
    state: ZapperState,
    input: ZapperInput,
    deltaMs: number
): ZapperStepResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Zapper delta must be a finite non-negative number.');
    }
    if (state.status !== 'active' || state.paused || deltaMs === 0) {
        return {state, events: []};
    }
    const next = cloneState(state);
    next.accumulatorMs += deltaMs;
    next.chargeHeld = input.chargeHeld;
    if (input.laneDelta !== 0) next.pendingLaneDelta = input.laneDelta;
    next.pendingAction ||= input.actionPressed;
    const events: ZapperEvent[] = [];
    let firstStep = true;
    while (
        next.accumulatorMs + 1e-9 >= ZAPPER_FIXED_STEP_MS &&
        next.status === 'active'
    ) {
        simulateStep(next, {
            laneDelta: firstStep ? next.pendingLaneDelta : 0,
            chargeHeld: next.chargeHeld,
            actionPressed: firstStep && next.pendingAction
        }, events);
        if (firstStep) {
            next.pendingLaneDelta = 0;
            next.pendingAction = false;
        }
        next.accumulatorMs -= ZAPPER_FIXED_STEP_MS;
        if (Math.abs(next.accumulatorMs) < 1e-9) next.accumulatorMs = 0;
        firstStep = false;
    }
    return {state: next, events};
}

export function setZapperPaused(
    state: ZapperState,
    paused: boolean
): ZapperState {
    if (state.paused === paused) return state;
    return {
        ...state,
        paused,
        accumulatorMs: 0,
        pendingLaneDelta: 0,
        pendingAction: false,
        chargeHeld: false
    };
}

/**
 * A deterministic priority policy useful for attract modes, accessibility
 * assists, and generation tests. It never reads wall-clock time or randomness.
 */
export function recommendZapperInput(state: ZapperState): ZapperInput {
    if (state.status !== 'active' || state.paused) return ZAPPER_IDLE_INPUT;

    const moveToward = (laneIndex: number): -1 | 0 | 1 =>
        laneIndex < state.player.laneIndex
            ? -1
            : laneIndex > state.player.laneIndex ? 1 : 0;

    const heldOrderId = state.player.heldCompletedOrderId;
    if (heldOrderId !== null) {
        const waitingAlien = state.aliens.find(alien => alien.orderId === heldOrderId);
        if (waitingAlien === undefined) {
            return {...ZAPPER_IDLE_INPUT, actionPressed: true};
        }
        const laneDelta = moveToward(waitingAlien.laneIndex);
        return {
            laneDelta,
            chargeHeld: false,
            actionPressed: laneDelta === 0
        };
    }

    const returning = state.projectiles
        .filter(projectile => projectile.kind === 'returning')
        .sort((left, right) => left.x - right.x)[0];
    if (returning !== undefined) {
        const catchThreshold =
            ZAPPER_SERVICE_X + state.course.tuning.catchTolerancePx;
        const timeUntilCatchMs = Math.max(
            0,
            (returning.x - catchThreshold) /
            state.course.tuning.returnSpeed *
            1_000
        );
        if (timeUntilCatchMs <= 900) {
            return {
                laneDelta: moveToward(returning.laneIndex),
                chargeHeld: state.player.fillProgress < 1,
                actionPressed: false
            };
        }
    }

    if (state.player.fillProgress >= 1) {
        const lanesWithOutgoing = new Set(
            state.projectiles
                .filter(projectile => projectile.kind === 'outgoing')
                .map(projectile => projectile.laneIndex)
        );
        const target = state.aliens
            .filter(alien =>
                alien.phase === 'approaching' &&
                !lanesWithOutgoing.has(alien.laneIndex)
            )
            .sort((left, right) => left.x - right.x)[0];
        if (target === undefined) return ZAPPER_IDLE_INPUT;
        const laneDelta = moveToward(target.laneIndex);
        return {
            laneDelta,
            chargeHeld: false,
            actionPressed: laneDelta === 0
        };
    }

    return {
        laneDelta: 0,
        chargeHeld: true,
        actionPressed: false
    };
}

export function getZapperTelemetry(state: ZapperState): ZapperTelemetry {
    const nearestThreat = state.aliens
        .filter(alien => alien.phase === 'approaching')
        .flatMap(alien => {
            const order = orderById(state.course, alien.orderId);
            return order === undefined
                ? []
                : [Math.max(
                    0,
                    (alien.x - ZAPPER_DANGER_X) / order.approachSpeed * 1_000
                )];
        })
        .sort((left, right) => left - right)[0] ?? null;
    return {
        elapsedMs: state.activeTicks * ZAPPER_FIXED_STEP_MS,
        laneIndex: state.player.laneIndex,
        lives: state.lives,
        score: state.score,
        fillProgress: state.player.fillProgress,
        blasterReady: state.player.fillProgress >= 1,
        heldCompletedOrderId: state.player.heldCompletedOrderId,
        completedOrders: state.completedOrders,
        completionQuota: state.course.completionQuota,
        failedOrders: state.failedOrders,
        activeAliens: state.aliens.length,
        approachingAliens: state.aliens.filter(
            alien => alien.phase === 'approaching'
        ).length,
        returningBlasters: state.projectiles.filter(
            projectile => projectile.kind === 'returning'
        ).length,
        currentWave: state.currentWaveIndex + 1,
        scheduledOrdersRemaining: state.course.orders.length - state.nextOrderIndex,
        nearestThreatMs: nearestThreat,
        status: state.status,
        failureReason: state.failureReason
    };
}

export function getZapperRenderSnapshot(
    state: ZapperState
): ZapperRenderSnapshot {
    const interpolation = clamp(
        state.accumulatorMs / ZAPPER_FIXED_STEP_MS,
        0,
        1
    );
    return {
        interpolation,
        player: state.player,
        lives: state.lives,
        score: state.score,
        completedOrders: state.completedOrders,
        completionQuota: state.course.completionQuota,
        currentWave: state.currentWaveIndex + 1,
        aliens: state.aliens.flatMap(alien => {
            const order = orderById(state.course, alien.orderId);
            return order === undefined
                ? []
                : [{
                    orderId: alien.orderId,
                    laneIndex: alien.laneIndex,
                    x: lerp(alien.previousX, alien.x, interpolation),
                    phase: alien.phase,
                    assemblyRemainingMs: alien.assemblyRemainingMs,
                    appearance: order.appearance
                }];
        }),
        projectiles: state.projectiles.map(projectile => ({
            id: projectile.id,
            kind: projectile.kind,
            laneIndex: projectile.laneIndex,
            orderId: projectile.orderId,
            x: lerp(projectile.previousX, projectile.x, interpolation)
        })),
        status: state.status
    };
}
