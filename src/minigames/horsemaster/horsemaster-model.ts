import {
    chooseRandom,
    randomInteger,
    shuffle,
    type RandomSource
} from '../../domain/random/random-source';

export const HORSEMASTER_WORLD_WIDTH = 672;
export const HORSEMASTER_WORLD_HEIGHT = 672;
export const HORSEMASTER_FIXED_STEP_MS = 20;
export const HORSEMASTER_HOP_DURATION_MS = 420;
export const HORSEMASTER_STARTING_LIVES = 3;
export const HORSEMASTER_RECOVERY_MS = 900;
export const HORSEMASTER_TRAFFIC_MIN_X = -96;
export const HORSEMASTER_TRAFFIC_MAX_X = HORSEMASTER_WORLD_WIDTH + 96;
export const HORSEMASTER_HORSE_HALF_WIDTH = 13;

const START_Y = 620;
const GYM_Y = 48;
const HORIZONTAL_HOP_DISTANCE = 34;
const JUMP_ARC_HEIGHT = 48;
const ROAD_MARGIN = 28;

export type HorsemasterStatus = 'active' | 'success' | 'failure';
export type HorsemasterOpportunity = 'easy' | 'standard' | 'hard';
export type HorsemasterExerciseKind =
    | 'treadmill'
    | 'exercise-bike'
    | 'rowing-machine'
    | 'elliptical'
    | 'weight-bench'
    | 'stair-stepper';

export interface HorsemasterPoint {
    readonly x: number;
    readonly y: number;
}

export interface HorsemasterVehicleDefinition {
    readonly id: string;
    readonly laneIndex: number;
    readonly initialX: number;
    readonly direction: -1 | 1;
    readonly speed: number;
    readonly carWidth: number;
    readonly carHeight: number;
    readonly machineWidth: number;
    readonly exerciseKind: HorsemasterExerciseKind;
    readonly opportunity: HorsemasterOpportunity;
    readonly colorIndex: number;
}

export interface HorsemasterLane {
    readonly index: number;
    readonly y: number;
    readonly direction: -1 | 1;
    readonly vehicles: readonly HorsemasterVehicleDefinition[];
}

export interface HorsemasterCourse {
    readonly generatorId: 'horsemaster-traffic-v1';
    readonly width: number;
    readonly height: number;
    readonly start: HorsemasterPoint;
    readonly gym: HorsemasterPoint;
    readonly startingLives: number;
    readonly lanes: readonly HorsemasterLane[];
}

export interface HorsemasterGenerationConfig {
    readonly laneCount?: number;
    readonly startingLives?: number;
}

export interface HorsemasterVehicleState {
    readonly id: string;
    readonly previousX: number;
    readonly x: number;
}

export interface HorsemasterJumpState {
    readonly sourceX: number;
    readonly sourceY: number;
    readonly targetX: number;
    readonly targetY: number;
    readonly targetLaneIndex: number;
    readonly elapsedMs: number;
    readonly durationMs: number;
}

export interface HorsemasterPlayerState {
    readonly previousX: number;
    readonly previousY: number;
    readonly x: number;
    readonly y: number;
    readonly laneIndex: number;
    readonly platformId: string | null;
    readonly platformOffsetX: number;
    readonly lives: number;
    readonly recoveryMs: number;
    readonly jump: HorsemasterJumpState | null;
}

export interface HorsemasterState {
    readonly course: HorsemasterCourse;
    readonly player: HorsemasterPlayerState;
    readonly vehicles: readonly HorsemasterVehicleState[];
    readonly activeTicks: number;
    readonly accumulatorMs: number;
    readonly status: HorsemasterStatus;
    readonly paused: boolean;
    readonly pendingHorizontal: -1 | 0 | 1;
    readonly pendingForward: boolean;
}

export interface HorsemasterInput {
    /**
     * Edge-triggered alignment hop. Scenes should pass -1/1 only on a press,
     * not continuously while a key is held.
     */
    readonly horizontal: -1 | 0 | 1;
    readonly forwardPressed: boolean;
}

export type HorsemasterEvent =
    | {readonly kind: 'aligned'; readonly direction: -1 | 1}
    | {readonly kind: 'jump-started'; readonly targetLaneIndex: number}
    | {
        readonly kind: 'landed';
        readonly laneIndex: number;
        readonly platformId: string;
    }
    | {readonly kind: 'road-impact'; readonly lives: number}
    | {readonly kind: 'reset'; readonly recoveryMs: number}
    | {readonly kind: 'success'}
    | {readonly kind: 'failure'};

export interface HorsemasterStepResult {
    readonly state: HorsemasterState;
    readonly events: readonly HorsemasterEvent[];
}

export interface HorsemasterValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
}

export interface HorsemasterRenderVehicle {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly definition: HorsemasterVehicleDefinition;
}

export interface HorsemasterRenderSnapshot {
    readonly interpolation: number;
    readonly player: {
        readonly x: number;
        readonly y: number;
        readonly laneIndex: number;
        readonly platformId: string | null;
        readonly lives: number;
        readonly recoveryMs: number;
        readonly jumping: boolean;
    };
    readonly vehicles: readonly HorsemasterRenderVehicle[];
    readonly status: HorsemasterStatus;
}

interface MutableVehicleState {
    id: string;
    previousX: number;
    x: number;
}

interface MutableJumpState {
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    targetLaneIndex: number;
    elapsedMs: number;
    durationMs: number;
}

interface MutablePlayerState {
    previousX: number;
    previousY: number;
    x: number;
    y: number;
    laneIndex: number;
    platformId: string | null;
    platformOffsetX: number;
    lives: number;
    recoveryMs: number;
    jump: MutableJumpState | null;
}

interface MutableHorsemasterState {
    course: HorsemasterCourse;
    player: MutablePlayerState;
    vehicles: MutableVehicleState[];
    activeTicks: number;
    accumulatorMs: number;
    status: HorsemasterStatus;
    paused: boolean;
    pendingHorizontal: -1 | 0 | 1;
    pendingForward: boolean;
}

const EXERCISE_KINDS: readonly HorsemasterExerciseKind[] = Object.freeze([
    'treadmill',
    'exercise-bike',
    'rowing-machine',
    'elliptical',
    'weight-bench',
    'stair-stepper'
]);

const OPPORTUNITIES: readonly HorsemasterOpportunity[] = Object.freeze([
    'easy',
    'standard',
    'hard'
]);

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

function trafficSpan(): number {
    return HORSEMASTER_TRAFFIC_MAX_X - HORSEMASTER_TRAFFIC_MIN_X;
}

/**
 * Wraps a traffic center over a shared circular track. A shared track and
 * alternating adjacent directions are the constructive reachability invariant:
 * every machine in the next lane must repeatedly pass every carried horse.
 */
export function wrapHorsemasterTrafficX(x: number): number {
    const span = trafficSpan();
    let wrapped = x;
    while (wrapped >= HORSEMASTER_TRAFFIC_MAX_X) wrapped -= span;
    while (wrapped < HORSEMASTER_TRAFFIC_MIN_X) wrapped += span;
    return wrapped;
}

function opportunityDimensions(
    opportunity: HorsemasterOpportunity,
    random: RandomSource
): {readonly speed: number; readonly machineWidth: number; readonly carWidth: number} {
    switch (opportunity) {
        case 'easy': {
            const machineWidth = 112 + randomInteger(random, 25);
            return {
                speed: 42 + randomInteger(random, 20),
                machineWidth,
                carWidth: machineWidth + 22 + randomInteger(random, 15)
            };
        }
        case 'standard': {
            const machineWidth = 82 + randomInteger(random, 23);
            return {
                speed: 74 + randomInteger(random, 31),
                machineWidth,
                carWidth: machineWidth + 20 + randomInteger(random, 13)
            };
        }
        case 'hard': {
            const machineWidth = 52 + randomInteger(random, 17);
            return {
                speed: 110 + randomInteger(random, 41),
                machineWidth,
                carWidth: machineWidth + 18 + randomInteger(random, 11)
            };
        }
    }
}

function assertGenerationConfig(config: HorsemasterGenerationConfig): void {
    if (
        config.laneCount !== undefined &&
        (
            !Number.isSafeInteger(config.laneCount) ||
            config.laneCount < 6 ||
            config.laneCount > 8
        )
    ) {
        throw new Error('Horsemaster lane count must be an integer from 6 through 8.');
    }
    if (
        config.startingLives !== undefined &&
        (
            !Number.isSafeInteger(config.startingLives) ||
            config.startingLives < 1 ||
            config.startingLives > 9
        )
    ) {
        throw new Error('Horsemaster starting lives must be an integer from 1 through 9.');
    }
}

export function createHorsemasterCourse(
    random: RandomSource,
    config: HorsemasterGenerationConfig = {}
): HorsemasterCourse {
    assertGenerationConfig(config);
    const laneCount = config.laneCount ?? 6 + randomInteger(random, 3);
    const firstDirection: -1 | 1 = randomInteger(random, 2) === 0 ? -1 : 1;
    const laneStride = (START_Y - GYM_Y) / (laneCount + 1);
    const slotWidth = trafficSpan() / OPPORTUNITIES.length;

    const lanes: HorsemasterLane[] = [];
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
        const direction: -1 | 1 = laneIndex % 2 === 0
            ? firstDirection
            : firstDirection === 1 ? -1 : 1;
        const orderedOpportunities = shuffle(OPPORTUNITIES, random);
        const phase = random.next() * slotWidth;
        const vehicles = orderedOpportunities.map((opportunity, slotIndex) => {
            const dimensions = opportunityDimensions(opportunity, random);
            const slotJitter = randomInteger(random, 49) - 24;
            return {
                id: `lane-${laneIndex}-${opportunity}`,
                laneIndex,
                initialX: wrapHorsemasterTrafficX(
                    HORSEMASTER_TRAFFIC_MIN_X +
                    phase +
                    slotIndex * slotWidth +
                    slotJitter
                ),
                direction,
                speed: dimensions.speed,
                carWidth: dimensions.carWidth,
                carHeight: 38 + randomInteger(random, 9),
                machineWidth: dimensions.machineWidth,
                exerciseKind: chooseRandom(EXERCISE_KINDS, random),
                opportunity,
                colorIndex: randomInteger(random, 8)
            } satisfies HorsemasterVehicleDefinition;
        });
        lanes.push({
            index: laneIndex,
            y: START_Y - laneStride * (laneIndex + 1),
            direction,
            vehicles
        });
    }

    const course: HorsemasterCourse = {
        generatorId: 'horsemaster-traffic-v1',
        width: HORSEMASTER_WORLD_WIDTH,
        height: HORSEMASTER_WORLD_HEIGHT,
        start: {x: HORSEMASTER_WORLD_WIDTH / 2, y: START_Y},
        gym: {x: HORSEMASTER_WORLD_WIDTH / 2, y: GYM_Y},
        startingLives: config.startingLives ?? HORSEMASTER_STARTING_LIVES,
        lanes
    };
    const validation = validateHorsemasterCourse(course);
    if (!validation.valid) {
        throw new Error(`Generated invalid Horsemaster course: ${validation.errors.join('; ')}`);
    }
    return course;
}

export function canonicalHorsemasterCourseSignature(course: HorsemasterCourse): string {
    return course.lanes.map(lane =>
        `${lane.direction}:${lane.vehicles.map(vehicle =>
            [
                vehicle.opportunity,
                vehicle.initialX.toFixed(3),
                vehicle.speed,
                vehicle.machineWidth,
                vehicle.exerciseKind,
                vehicle.colorIndex
            ].join(',')
        ).join('|')}`
    ).join('/');
}

/**
 * Proves the constructive route used by the generator. The roadside is fixed,
 * every platform wraps across the entire playfield, and adjacent lanes travel
 * in opposite directions. Consequently their relative motion is non-zero and
 * a player can always wait until a next-lane machine crosses their x position.
 */
export function hasHorsemasterWaitTimingRoute(course: HorsemasterCourse): boolean {
    if (course.lanes.length < 1) return false;
    for (let index = 0; index < course.lanes.length; index++) {
        const lane = course.lanes[index]!;
        if (
            lane.vehicles.length === 0 ||
            lane.vehicles.some(vehicle =>
                vehicle.speed <= 0 ||
                vehicle.direction !== lane.direction ||
                vehicle.machineWidth <= HORSEMASTER_HORSE_HALF_WIDTH * 2
            )
        ) {
            return false;
        }
        if (index > 0 && course.lanes[index - 1]!.direction === lane.direction) {
            return false;
        }
    }
    return true;
}

export function validateHorsemasterCourse(
    course: HorsemasterCourse
): HorsemasterValidationResult {
    const errors: string[] = [];
    if (course.generatorId !== 'horsemaster-traffic-v1') {
        errors.push('Unknown Horsemaster generator.');
    }
    if (course.width !== HORSEMASTER_WORLD_WIDTH || course.height !== HORSEMASTER_WORLD_HEIGHT) {
        errors.push('Course dimensions do not match the Horsemaster playfield.');
    }
    if (course.lanes.length < 6 || course.lanes.length > 8) {
        errors.push('Course must contain six through eight traffic lanes.');
    }
    if (
        !Number.isSafeInteger(course.startingLives) ||
        course.startingLives < 1 ||
        course.startingLives > 9
    ) {
        errors.push('Course starting lives are invalid.');
    }

    const vehicleIds = new Set<string>();
    let previousY = course.start.y;
    for (let laneIndex = 0; laneIndex < course.lanes.length; laneIndex++) {
        const lane = course.lanes[laneIndex]!;
        if (lane.index !== laneIndex) errors.push(`Lane ${laneIndex} has a non-sequential index.`);
        if (!(lane.y < previousY && lane.y > course.gym.y)) {
            errors.push(`Lane ${laneIndex} is outside the upward route.`);
        }
        previousY = lane.y;
        if (lane.vehicles.length < 3) {
            errors.push(`Lane ${laneIndex} has too few landing opportunities.`);
        }
        if (!lane.vehicles.some(vehicle => vehicle.opportunity === 'easy')) {
            errors.push(`Lane ${laneIndex} is missing an easy opportunity.`);
        }
        if (!lane.vehicles.some(vehicle => vehicle.opportunity === 'hard')) {
            errors.push(`Lane ${laneIndex} is missing a hard opportunity.`);
        }

        for (const vehicle of lane.vehicles) {
            if (vehicleIds.has(vehicle.id)) errors.push(`Duplicate vehicle id ${vehicle.id}.`);
            vehicleIds.add(vehicle.id);
            if (vehicle.laneIndex !== laneIndex || vehicle.direction !== lane.direction) {
                errors.push(`Vehicle ${vehicle.id} is assigned to the wrong lane.`);
            }
            if (
                vehicle.initialX < HORSEMASTER_TRAFFIC_MIN_X ||
                vehicle.initialX >= HORSEMASTER_TRAFFIC_MAX_X
            ) {
                errors.push(`Vehicle ${vehicle.id} starts outside its wrap track.`);
            }
            if (vehicle.machineWidth <= HORSEMASTER_HORSE_HALF_WIDTH * 2 + 4) {
                errors.push(`Vehicle ${vehicle.id} cannot hold the horse.`);
            }
            if (vehicle.carWidth < vehicle.machineWidth || vehicle.carHeight < 30) {
                errors.push(`Vehicle ${vehicle.id} has invalid dimensions.`);
            }
            if (vehicle.speed < 42 || vehicle.speed > 150) {
                errors.push(`Vehicle ${vehicle.id} has invalid speed.`);
            }
            if (
                vehicle.opportunity === 'easy' &&
                (vehicle.speed > 61 || vehicle.machineWidth < 112)
            ) {
                errors.push(`Vehicle ${vehicle.id} is not an easy opportunity.`);
            }
            if (
                vehicle.opportunity === 'hard' &&
                (vehicle.speed < 110 || vehicle.machineWidth > 68)
            ) {
                errors.push(`Vehicle ${vehicle.id} is not a hard opportunity.`);
            }
        }
    }
    if (!hasHorsemasterWaitTimingRoute(course)) {
        errors.push('Course does not have a constructive wait-and-timing route.');
    }
    return {valid: errors.length === 0, errors};
}

export function createHorsemasterState(course: HorsemasterCourse): HorsemasterState {
    const validation = validateHorsemasterCourse(course);
    if (!validation.valid) {
        throw new Error(`Cannot start invalid Horsemaster course: ${validation.errors.join('; ')}`);
    }
    return {
        course,
        player: {
            previousX: course.start.x,
            previousY: course.start.y,
            x: course.start.x,
            y: course.start.y,
            laneIndex: -1,
            platformId: null,
            platformOffsetX: 0,
            lives: course.startingLives,
            recoveryMs: 0,
            jump: null
        },
        vehicles: course.lanes.flatMap(lane =>
            lane.vehicles.map(vehicle => ({
                id: vehicle.id,
                previousX: vehicle.initialX,
                x: vehicle.initialX
            }))
        ),
        activeTicks: 0,
        accumulatorMs: 0,
        status: 'active',
        paused: false,
        pendingHorizontal: 0,
        pendingForward: false
    };
}

function cloneState(state: HorsemasterState): MutableHorsemasterState {
    return {
        course: state.course,
        player: {
            ...state.player,
            jump: state.player.jump === null ? null : {...state.player.jump}
        },
        vehicles: state.vehicles.map(vehicle => ({...vehicle})),
        activeTicks: state.activeTicks,
        accumulatorMs: state.accumulatorMs,
        status: state.status,
        paused: state.paused,
        pendingHorizontal: state.pendingHorizontal,
        pendingForward: state.pendingForward
    };
}

function vehicleDefinitionsById(
    course: HorsemasterCourse
): ReadonlyMap<string, HorsemasterVehicleDefinition> {
    return new Map(course.lanes.flatMap(lane =>
        lane.vehicles.map(vehicle => [vehicle.id, vehicle] as const)
    ));
}

function advanceTraffic(state: MutableHorsemasterState): void {
    const definitions = vehicleDefinitionsById(state.course);
    for (const vehicle of state.vehicles) {
        const definition = definitions.get(vehicle.id);
        if (definition === undefined) continue;
        vehicle.previousX = vehicle.x;
        vehicle.x = wrapHorsemasterTrafficX(
            vehicle.x +
            definition.direction *
            definition.speed *
            (HORSEMASTER_FIXED_STEP_MS / 1_000)
        );
    }
}

function carryHorseWithPlatform(state: MutableHorsemasterState): void {
    const platformId = state.player.platformId;
    if (platformId === null || state.player.jump !== null) return;
    const platform = state.vehicles.find(vehicle => vehicle.id === platformId);
    const definition = state.course.lanes
        .flatMap(lane => lane.vehicles)
        .find(vehicle => vehicle.id === platformId);
    if (platform === undefined || definition === undefined) return;
    state.player.x = platform.x + state.player.platformOffsetX;
    state.player.y = state.course.lanes[definition.laneIndex]!.y;
}

function alignHorse(
    state: MutableHorsemasterState,
    direction: -1 | 1,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    if (player.jump !== null) {
        player.jump.targetX = clamp(
            player.jump.targetX + direction * HORIZONTAL_HOP_DISTANCE,
            ROAD_MARGIN,
            state.course.width - ROAD_MARGIN
        );
    }
    else if (player.platformId !== null) {
        const definition = state.course.lanes
            .flatMap(lane => lane.vehicles)
            .find(vehicle => vehicle.id === player.platformId);
        const platform = state.vehicles.find(vehicle => vehicle.id === player.platformId);
        if (definition !== undefined && platform !== undefined) {
            const maximumOffset = Math.max(
                0,
                definition.machineWidth / 2 - HORSEMASTER_HORSE_HALF_WIDTH - 3
            );
            player.platformOffsetX = clamp(
                player.platformOffsetX + direction * HORIZONTAL_HOP_DISTANCE,
                -maximumOffset,
                maximumOffset
            );
            player.x = platform.x + player.platformOffsetX;
        }
    }
    else {
        player.x = clamp(
            player.x + direction * HORIZONTAL_HOP_DISTANCE,
            ROAD_MARGIN,
            state.course.width - ROAD_MARGIN
        );
    }
    events.push({kind: 'aligned', direction});
}

function startForwardJump(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    if (player.jump !== null || player.recoveryMs > 0) return;
    const targetLaneIndex = player.laneIndex + 1;
    const targetY = targetLaneIndex >= state.course.lanes.length
        ? state.course.gym.y
        : state.course.lanes[targetLaneIndex]!.y;
    player.jump = {
        sourceX: player.x,
        sourceY: player.y,
        targetX: clamp(player.x, ROAD_MARGIN, state.course.width - ROAD_MARGIN),
        targetY,
        targetLaneIndex,
        elapsedMs: 0,
        durationMs: HORSEMASTER_HOP_DURATION_MS
    };
    player.platformId = null;
    player.platformOffsetX = 0;
    events.push({kind: 'jump-started', targetLaneIndex});
}

function resetHorseAfterImpact(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    player.lives -= 1;
    player.jump = null;
    player.platformId = null;
    player.platformOffsetX = 0;
    events.push({kind: 'road-impact', lives: player.lives});
    if (player.lives <= 0) {
        state.status = 'failure';
        events.push({kind: 'failure'});
        return;
    }
    player.x = state.course.start.x;
    player.y = state.course.start.y;
    player.previousX = player.x;
    player.previousY = player.y;
    player.laneIndex = -1;
    player.recoveryMs = HORSEMASTER_RECOVERY_MS;
    events.push({kind: 'reset', recoveryMs: HORSEMASTER_RECOVERY_MS});
}

function landingPlatform(
    state: MutableHorsemasterState,
    laneIndex: number,
    x: number
): {
    readonly definition: HorsemasterVehicleDefinition;
    readonly vehicle: MutableVehicleState;
} | null {
    const lane = state.course.lanes[laneIndex];
    if (lane === undefined) return null;
    const candidates = lane.vehicles.flatMap(definition => {
        const vehicle = state.vehicles.find(candidate => candidate.id === definition.id);
        if (vehicle === undefined) return [];
        const distance = Math.abs(x - vehicle.x);
        const safeHalfWidth = definition.machineWidth / 2 - HORSEMASTER_HORSE_HALF_WIDTH;
        return distance <= safeHalfWidth
            ? [{definition, vehicle, distance}]
            : [];
    }).sort((left, right) => left.distance - right.distance);
    const closest = candidates[0];
    return closest === undefined
        ? null
        : {definition: closest.definition, vehicle: closest.vehicle};
}

function finishJump(
    state: MutableHorsemasterState,
    jump: MutableJumpState,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    if (jump.targetLaneIndex >= state.course.lanes.length) {
        player.x = state.course.gym.x;
        player.y = state.course.gym.y;
        player.laneIndex = state.course.lanes.length;
        player.platformId = null;
        player.jump = null;
        state.status = 'success';
        events.push({kind: 'success'});
        return;
    }
    const platform = landingPlatform(state, jump.targetLaneIndex, player.x);
    if (platform === null) {
        resetHorseAfterImpact(state, events);
        return;
    }
    player.y = state.course.lanes[jump.targetLaneIndex]!.y;
    player.laneIndex = jump.targetLaneIndex;
    player.platformId = platform.definition.id;
    player.platformOffsetX = player.x - platform.vehicle.x;
    player.jump = null;
    events.push({
        kind: 'landed',
        laneIndex: jump.targetLaneIndex,
        platformId: platform.definition.id
    });
}

function advanceJump(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[]
): void {
    const jump = state.player.jump;
    if (jump === null) return;
    jump.elapsedMs = Math.min(jump.durationMs, jump.elapsedMs + HORSEMASTER_FIXED_STEP_MS);
    const progress = jump.elapsedMs / jump.durationMs;
    const easedProgress = progress * progress * (3 - 2 * progress);
    state.player.x = lerp(jump.sourceX, jump.targetX, easedProgress);
    state.player.y =
        lerp(jump.sourceY, jump.targetY, easedProgress) -
        Math.sin(Math.PI * progress) * JUMP_ARC_HEIGHT;
    if (jump.elapsedMs >= jump.durationMs) finishJump(state, jump, events);
}

function simulateStep(
    state: MutableHorsemasterState,
    input: HorsemasterInput,
    events: HorsemasterEvent[]
): void {
    if (state.status !== 'active' || state.paused) return;
    state.activeTicks += 1;
    state.player.previousX = state.player.x;
    state.player.previousY = state.player.y;
    state.player.recoveryMs = Math.max(
        0,
        state.player.recoveryMs - HORSEMASTER_FIXED_STEP_MS
    );
    advanceTraffic(state);
    carryHorseWithPlatform(state);
    if (input.horizontal !== 0) alignHorse(state, input.horizontal, events);
    if (input.forwardPressed) startForwardJump(state, events);
    advanceJump(state, events);
}

export function stepHorsemaster(
    state: HorsemasterState,
    input: HorsemasterInput
): HorsemasterStepResult {
    if (state.status !== 'active' || state.paused) return {state, events: []};
    const next = cloneState(state);
    const events: HorsemasterEvent[] = [];
    simulateStep(next, input, events);
    return {state: next, events};
}

/**
 * Advances the model in deterministic 50 Hz steps. Press inputs are buffered
 * until a step is consumed, then apply to that step only.
 */
export function advanceHorsemaster(
    state: HorsemasterState,
    input: HorsemasterInput,
    deltaMs: number
): HorsemasterStepResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new Error('Horsemaster delta must be a finite non-negative number.');
    }
    if (state.status !== 'active' || state.paused || deltaMs === 0) {
        return {state, events: []};
    }
    const next = cloneState(state);
    next.accumulatorMs += deltaMs;
    if (input.horizontal !== 0) next.pendingHorizontal = input.horizontal;
    next.pendingForward ||= input.forwardPressed;
    const events: HorsemasterEvent[] = [];
    let firstStep = true;
    while (
        next.accumulatorMs + 1e-9 >= HORSEMASTER_FIXED_STEP_MS &&
        next.status === 'active'
    ) {
        simulateStep(next, {
            horizontal: firstStep ? next.pendingHorizontal : 0,
            forwardPressed: firstStep && next.pendingForward
        }, events);
        if (firstStep) {
            next.pendingHorizontal = 0;
            next.pendingForward = false;
        }
        next.accumulatorMs -= HORSEMASTER_FIXED_STEP_MS;
        if (Math.abs(next.accumulatorMs) < 1e-9) next.accumulatorMs = 0;
        firstStep = false;
    }
    return {state: next, events};
}

export function setHorsemasterPaused(
    state: HorsemasterState,
    paused: boolean
): HorsemasterState {
    if (state.paused === paused) return state;
    return {
        ...state,
        paused,
        accumulatorMs: 0,
        pendingHorizontal: 0,
        pendingForward: false
    };
}

function interpolateWrappedX(previousX: number, x: number, progress: number): number {
    const span = trafficSpan();
    let adjustedX = x;
    const difference = adjustedX - previousX;
    if (difference > span / 2) adjustedX -= span;
    else if (difference < -span / 2) adjustedX += span;
    return wrapHorsemasterTrafficX(lerp(previousX, adjustedX, progress));
}

export function getHorsemasterRenderSnapshot(
    state: HorsemasterState
): HorsemasterRenderSnapshot {
    const interpolation = clamp(
        state.accumulatorMs / HORSEMASTER_FIXED_STEP_MS,
        0,
        1
    );
    const definitions = vehicleDefinitionsById(state.course);
    const vehicles = state.vehicles.flatMap(vehicle => {
        const definition = definitions.get(vehicle.id);
        if (definition === undefined) return [];
        return [{
            id: vehicle.id,
            x: interpolateWrappedX(vehicle.previousX, vehicle.x, interpolation),
            y: state.course.lanes[definition.laneIndex]!.y,
            definition
        }];
    });
    const playerUsesWrappedTrack =
        state.player.platformId !== null ||
        state.player.jump !== null;
    return {
        interpolation,
        player: {
            x: playerUsesWrappedTrack
                ? interpolateWrappedX(
                    state.player.previousX,
                    state.player.x,
                    interpolation
                )
                : lerp(state.player.previousX, state.player.x, interpolation),
            y: lerp(state.player.previousY, state.player.y, interpolation),
            laneIndex: state.player.laneIndex,
            platformId: state.player.platformId,
            lives: state.player.lives,
            recoveryMs: state.player.recoveryMs,
            jumping: state.player.jump !== null
        },
        vehicles,
        status: state.status
    };
}
