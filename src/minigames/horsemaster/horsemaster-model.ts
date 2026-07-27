import {
    chooseRandom,
    randomInteger,
    shuffle,
    type RandomSource
} from '../../domain/random/random-source';

export const HORSEMASTER_WORLD_WIDTH = 672;
export const HORSEMASTER_WORLD_HEIGHT = 672;
export const HORSEMASTER_FIXED_STEP_MS = 20;
export const HORSEMASTER_TILE = 48;
export const HORSEMASTER_COLUMNS = 14;
export const HORSEMASTER_START_COLUMN = 7;
export const HORSEMASTER_ROW_COUNT = 13;
export const HORSEMASTER_GOAL_ROW = 12;
export const HORSEMASTER_GRID_HOP_MS = 160;
export const HORSEMASTER_HOP_DURATION_MS = 380;
export const HORSEMASTER_STARTING_LIVES = 3;
export const HORSEMASTER_RECOVERY_MS = 900;
export const HORSEMASTER_TRAFFIC_MIN_X = -96;
export const HORSEMASTER_TRAFFIC_MAX_X = HORSEMASTER_WORLD_WIDTH + 96;
export const HORSEMASTER_HORSE_HALF_WIDTH = 13;
export const HORSEMASTER_SLOT_WIDTH = 48;
/** Retained for reference: landings now accept the whole truck, not a slot. */
export const HORSEMASTER_LANDING_TOLERANCE = 12;
/** The driver's cab extends this far beyond the bed on the leading side. */
export const HORSEMASTER_CAB_LENGTH = 26;
/** A landing sticks when at least this much of the horse overlaps the truck. */
export const HORSEMASTER_LANDING_OVERLAP_RATIO = 0.8;
export const HORSEMASTER_DOOR_HALF_WIDTH = 24;
export const HORSEMASTER_EDGE_DEATH_MARGIN = 12;
export const HORSEMASTER_BIKE_HIT_TOLERANCE = 26;
export const HORSEMASTER_MIN_VEHICLE_GAP = 96;
export const HORSEMASTER_MAX_SLOT_GAP = 320;
export const HORSEMASTER_MIN_BIKE_GAP = 180;
export const HORSEMASTER_MIN_GYM_RUNWAY = 336;

const GRID_ARC_HEIGHT = 12;
const JUMP_ARC_HEIGHT = 48;
const BUS_WIDTH = 120;
const CAR_WIDTH = 72;
const BIKE_LENGTH = 36;
const BIKE_LANE_COUNT = 5;
const VEHICLE_LANE_COUNT = 5;
const BUILDING_COUNT = 5;
const BUILDING_WIDTH = 96;
const MEDIAN_ROW = 6;
const FIRST_VEHICLE_ROW = 7;

export type HorsemasterStatus = 'active' | 'success' | 'failure';
export type HorsemasterVehicleTier = 'green' | 'yellow' | 'red';
export type HorsemasterExerciseKind = 'treadmill' | 'exercise-bike';
export type HorsemasterRowKind = 'start' | 'bike' | 'median' | 'vehicle' | 'goal';
export type HorsemasterHopKind = 'grid' | 'vehicle';

export interface HorsemasterPoint {
    readonly x: number;
    readonly y: number;
}

export interface HorsemasterSlotDefinition {
    readonly index: number;
    readonly offsetX: number;
    readonly exerciseKind: HorsemasterExerciseKind;
}

export interface HorsemasterVehicleDefinition {
    readonly id: string;
    readonly laneIndex: number;
    readonly tier: HorsemasterVehicleTier;
    readonly initialX: number;
    readonly direction: -1 | 1;
    readonly speed: number;
    readonly carWidth: number;
    readonly carHeight: number;
    readonly slots: readonly HorsemasterSlotDefinition[];
    readonly colorIndex: number;
}

export interface HorsemasterVehicleLane {
    readonly index: number;
    readonly row: number;
    readonly y: number;
    readonly tier: HorsemasterVehicleTier;
    readonly direction: -1 | 1;
    readonly speed: number;
    readonly vehicles: readonly HorsemasterVehicleDefinition[];
}

export interface HorsemasterBicycleDefinition {
    readonly id: string;
    readonly laneIndex: number;
    readonly initialX: number;
    readonly direction: -1 | 1;
    readonly speed: number;
    readonly colorIndex: number;
}

export interface HorsemasterBikeLane {
    readonly index: number;
    readonly row: number;
    readonly y: number;
    /** Speed tier; bikes render in this color so speed reads at a glance. */
    readonly tier: HorsemasterVehicleTier;
    readonly direction: -1 | 1;
    readonly speed: number;
    readonly bicycles: readonly HorsemasterBicycleDefinition[];
}

export interface HorsemasterBuilding {
    readonly index: number;
    readonly centerX: number;
    readonly width: number;
    readonly doorHalfWidth: number;
    readonly isGym: boolean;
}

export interface HorsemasterCourse {
    readonly generatorId: 'horsemaster-frogger-v2';
    readonly width: number;
    readonly height: number;
    readonly startingLives: number;
    readonly start: HorsemasterPoint;
    readonly bikeLanes: readonly HorsemasterBikeLane[];
    readonly vehicleLanes: readonly HorsemasterVehicleLane[];
    readonly medianY: number;
    readonly goalY: number;
    readonly buildings: readonly HorsemasterBuilding[];
    readonly gymIndex: number;
}

export interface HorsemasterGenerationConfig {
    readonly startingLives?: number;
}

export interface HorsemasterVehicleState {
    readonly id: string;
    readonly previousX: number;
    readonly x: number;
}

export interface HorsemasterBicycleState {
    readonly id: string;
    readonly previousX: number;
    readonly x: number;
}

export interface HorsemasterRide {
    readonly vehicleId: string;
    readonly slotIndex: number;
}

export interface HorsemasterJumpState {
    readonly hop: HorsemasterHopKind;
    readonly sourceX: number;
    readonly sourceY: number;
    readonly targetX: number;
    readonly targetY: number;
    readonly targetRow: number;
    readonly elapsedMs: number;
    readonly durationMs: number;
}

export interface HorsemasterPlayerState {
    readonly previousX: number;
    readonly previousY: number;
    readonly x: number;
    readonly y: number;
    readonly row: number;
    readonly ride: HorsemasterRide | null;
    readonly lives: number;
    readonly recoveryMs: number;
    readonly jump: HorsemasterJumpState | null;
}

export interface HorsemasterState {
    readonly course: HorsemasterCourse;
    readonly player: HorsemasterPlayerState;
    readonly vehicles: readonly HorsemasterVehicleState[];
    readonly bicycles: readonly HorsemasterBicycleState[];
    readonly activeTicks: number;
    readonly accumulatorMs: number;
    readonly status: HorsemasterStatus;
    readonly paused: boolean;
    readonly pendingHorizontal: -1 | 0 | 1;
    readonly pendingVertical: -1 | 0 | 1;
}

export interface HorsemasterInput {
    /**
     * Edge-triggered hops. Scenes should pass -1/1 only on a press, not
     * continuously while a key is held. When both axes are pressed on the
     * same step, vertical wins and horizontal is dropped (no diagonals).
     */
    readonly horizontal: -1 | 0 | 1;
    readonly vertical: -1 | 0 | 1;
}

export type HorsemasterDeathCause =
    | 'road-impact'
    | 'bicycle-hit'
    | 'carried-off-edge'
    | 'wrong-building';

export type HorsemasterEvent =
    | {readonly kind: 'aligned'; readonly direction: -1 | 1}
    | {
        readonly kind: 'jump-started';
        readonly hop: HorsemasterHopKind;
        readonly targetRow: number;
    }
    | {
        readonly kind: 'landed';
        readonly row: number;
        readonly vehicleId: string;
        readonly slotIndex: number;
    }
    | {readonly kind: 'road-impact'; readonly lives: number}
    | {readonly kind: 'bicycle-hit'; readonly lives: number}
    | {readonly kind: 'carried-off-edge'; readonly lives: number}
    | {readonly kind: 'wrong-building'; readonly lives: number}
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

export interface HorsemasterRenderBicycle {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly definition: HorsemasterBicycleDefinition;
}

export interface HorsemasterRenderSnapshot {
    readonly interpolation: number;
    readonly player: {
        readonly x: number;
        readonly y: number;
        readonly row: number;
        readonly ride: HorsemasterRide | null;
        readonly ridingMachine: HorsemasterExerciseKind | null;
        readonly lives: number;
        readonly recoveryMs: number;
        readonly jumping: boolean;
        readonly hopKind: HorsemasterHopKind | null;
        readonly hopProgress: number;
    };
    readonly vehicles: readonly HorsemasterRenderVehicle[];
    readonly bicycles: readonly HorsemasterRenderBicycle[];
    readonly status: HorsemasterStatus;
}

interface MutableTrafficState {
    id: string;
    previousX: number;
    x: number;
}

interface MutableJumpState {
    hop: HorsemasterHopKind;
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    targetRow: number;
    elapsedMs: number;
    durationMs: number;
}

interface MutableRide {
    vehicleId: string;
    slotIndex: number;
}

interface MutablePlayerState {
    previousX: number;
    previousY: number;
    x: number;
    y: number;
    row: number;
    ride: MutableRide | null;
    lives: number;
    recoveryMs: number;
    jump: MutableJumpState | null;
}

interface MutableHorsemasterState {
    course: HorsemasterCourse;
    player: MutablePlayerState;
    vehicles: MutableTrafficState[];
    bicycles: MutableTrafficState[];
    activeTicks: number;
    accumulatorMs: number;
    status: HorsemasterStatus;
    paused: boolean;
    pendingHorizontal: -1 | 0 | 1;
    pendingVertical: -1 | 0 | 1;
}

const EXERCISE_KINDS: readonly HorsemasterExerciseKind[] = Object.freeze([
    'treadmill',
    'exercise-bike'
]);

/**
 * Every level fields exactly three green lanes, one yellow, and one red, so
 * a fast Frogger lane always appears while green stays dominant.
 */
const VEHICLE_TIER_POOL: readonly HorsemasterVehicleTier[] = Object.freeze([
    'green',
    'green',
    'green',
    'yellow',
    'red'
]);

/** Bike lanes mirror the same mix: three slow, one medium, one fast. */
const BIKE_TIER_POOL: readonly HorsemasterVehicleTier[] = Object.freeze([
    'green',
    'green',
    'green',
    'yellow',
    'red'
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

/** Center y of a progress row (0 = start at the bottom, 12 = goal at the top). */
export function horsemasterRowY(row: number): number {
    return HORSEMASTER_WORLD_HEIGHT - HORSEMASTER_TILE / 2 - HORSEMASTER_TILE * row;
}

/** Center x of a grid column (0..13). */
export function horsemasterColumnX(column: number): number {
    return HORSEMASTER_TILE / 2 + HORSEMASTER_TILE * column;
}

export function horsemasterRowKind(row: number): HorsemasterRowKind {
    if (row <= 0) return 'start';
    if (row < MEDIAN_ROW) return 'bike';
    if (row === MEDIAN_ROW) return 'median';
    if (row < HORSEMASTER_GOAL_ROW) return 'vehicle';
    return 'goal';
}

function buildingCenterX(index: number): number {
    return 48 + 144 * index;
}

/**
 * Wraps a traffic center over a shared circular track. A shared track and
 * alternating adjacent directions are the constructive reachability invariant:
 * every machine slot in the next lane must repeatedly pass every carried horse.
 */
export function wrapHorsemasterTrafficX(x: number): number {
    const span = trafficSpan();
    let wrapped = x;
    while (wrapped >= HORSEMASTER_TRAFFIC_MAX_X) wrapped -= span;
    while (wrapped < HORSEMASTER_TRAFFIC_MIN_X) wrapped += span;
    return wrapped;
}

function assertGenerationConfig(config: HorsemasterGenerationConfig): void {
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

function drawLaneTiers(random: RandomSource): HorsemasterVehicleTier[] {
    const tiers = [...shuffle(VEHICLE_TIER_POOL, random)];
    // The first jump off the median and the gym-timing lane are never the
    // fast lane. The pool carries exactly one red lane and three green
    // lanes, so a middle-lane green donor always exists.
    for (const guarded of [0, VEHICLE_LANE_COUNT - 1]) {
        if (tiers[guarded] !== 'red') continue;
        const donor = tiers.findIndex(
            (tier, index) =>
                tier === 'green' && index !== 0 && index !== VEHICLE_LANE_COUNT - 1
        );
        if (donor >= 0) {
            tiers[guarded] = 'green';
            tiers[donor] = 'red';
        }
    }
    return tiers;
}

function laneSpeed(tier: HorsemasterVehicleTier, random: RandomSource): number {
    return tier === 'red'
        ? 74 + randomInteger(random, 13)
        : 50 + randomInteger(random, 11);
}

/** Bike speed bands: color always tells the horse how fast a lane flows. */
function bikeLaneSpeed(tier: HorsemasterVehicleTier, random: RandomSource): number {
    switch (tier) {
        case 'green':
            return 22 + randomInteger(random, 7);
        case 'yellow':
            return 38 + randomInteger(random, 7);
        case 'red':
            return 58 + randomInteger(random, 9);
    }
}

export function createHorsemasterCourse(
    random: RandomSource,
    config: HorsemasterGenerationConfig = {}
): HorsemasterCourse {
    assertGenerationConfig(config);

    const tiers = drawLaneTiers(random);
    const vehicleFirstDirection: -1 | 1 = randomInteger(random, 2) === 0 ? -1 : 1;
    const vehicleLanes: HorsemasterVehicleLane[] = [];
    for (let laneIndex = 0; laneIndex < VEHICLE_LANE_COUNT; laneIndex++) {
        const tier = tiers[laneIndex]!;
        const direction: -1 | 1 = laneIndex % 2 === 0
            ? vehicleFirstDirection
            : vehicleFirstDirection === 1 ? -1 : 1;
        const speed = laneSpeed(tier, random);
        const vehicleCount = tier === 'green' ? 3 : 4;
        const spacing = trafficSpan() / vehicleCount;
        const jitterRange = tier === 'green' ? 36 : 24;
        const phase = random.next() * spacing;
        const vehicles: HorsemasterVehicleDefinition[] = [];
        for (let slot = 0; slot < vehicleCount; slot++) {
            const jitter = randomInteger(random, jitterRange * 2 + 1) - jitterRange;
            const slots: HorsemasterSlotDefinition[] = tier === 'green'
                ? [
                    {index: 0, offsetX: -24, exerciseKind: chooseRandom(EXERCISE_KINDS, random)},
                    {index: 1, offsetX: 24, exerciseKind: chooseRandom(EXERCISE_KINDS, random)}
                ]
                : [
                    {index: 0, offsetX: 0, exerciseKind: chooseRandom(EXERCISE_KINDS, random)}
                ];
            vehicles.push({
                id: `vehicle-${laneIndex}-${slot}`,
                laneIndex,
                tier,
                initialX: wrapHorsemasterTrafficX(
                    HORSEMASTER_TRAFFIC_MIN_X + phase + slot * spacing + jitter
                ),
                direction,
                speed,
                carWidth: tier === 'green' ? BUS_WIDTH : CAR_WIDTH,
                carHeight: (tier === 'green' ? 42 : 32) + randomInteger(random, 5),
                slots,
                colorIndex: randomInteger(random, 8)
            });
        }
        vehicleLanes.push({
            index: laneIndex,
            row: FIRST_VEHICLE_ROW + laneIndex,
            y: horsemasterRowY(FIRST_VEHICLE_ROW + laneIndex),
            tier,
            direction,
            speed,
            vehicles
        });
    }

    const bikeFirstDirection: -1 | 1 = randomInteger(random, 2) === 0 ? -1 : 1;
    const bikeTiers = shuffle(BIKE_TIER_POOL, random);
    const bikeLanes: HorsemasterBikeLane[] = [];
    for (let laneIndex = 0; laneIndex < BIKE_LANE_COUNT; laneIndex++) {
        const direction: -1 | 1 = laneIndex % 2 === 0
            ? bikeFirstDirection
            : bikeFirstDirection === 1 ? -1 : 1;
        const tier = bikeTiers[laneIndex]!;
        const speed = bikeLaneSpeed(tier, random);
        const spacing = trafficSpan() / 3;
        const phase = random.next() * spacing;
        const bicycles: HorsemasterBicycleDefinition[] = [];
        for (let slot = 0; slot < 3; slot++) {
            const jitter = randomInteger(random, 61) - 30;
            bicycles.push({
                id: `bike-${laneIndex}-${slot}`,
                laneIndex,
                initialX: wrapHorsemasterTrafficX(
                    HORSEMASTER_TRAFFIC_MIN_X + phase + slot * spacing + jitter
                ),
                direction,
                speed,
                colorIndex: randomInteger(random, 8)
            });
        }
        bikeLanes.push({
            index: laneIndex,
            row: 1 + laneIndex,
            y: horsemasterRowY(1 + laneIndex),
            tier,
            direction,
            speed,
            bicycles
        });
    }

    // The gym must leave enough upstream runway on the top lane that a horse
    // boarding it always sweeps through the door zone before the death edge.
    const topDirection = vehicleLanes[VEHICLE_LANE_COUNT - 1]!.direction;
    const eligibleGyms: number[] = [];
    for (let index = 0; index < BUILDING_COUNT; index++) {
        const runway = topDirection === 1
            ? buildingCenterX(index)
            : HORSEMASTER_WORLD_WIDTH - buildingCenterX(index);
        if (runway >= HORSEMASTER_MIN_GYM_RUNWAY) eligibleGyms.push(index);
    }
    const gymIndex = chooseRandom(eligibleGyms, random);
    const buildings: HorsemasterBuilding[] = Array.from(
        {length: BUILDING_COUNT},
        (_, index) => ({
            index,
            centerX: buildingCenterX(index),
            width: BUILDING_WIDTH,
            doorHalfWidth: HORSEMASTER_DOOR_HALF_WIDTH,
            isGym: index === gymIndex
        })
    );

    const course: HorsemasterCourse = {
        generatorId: 'horsemaster-frogger-v2',
        width: HORSEMASTER_WORLD_WIDTH,
        height: HORSEMASTER_WORLD_HEIGHT,
        startingLives: config.startingLives ?? HORSEMASTER_STARTING_LIVES,
        start: {
            x: horsemasterColumnX(HORSEMASTER_START_COLUMN),
            y: horsemasterRowY(0)
        },
        bikeLanes,
        vehicleLanes,
        medianY: horsemasterRowY(MEDIAN_ROW),
        goalY: horsemasterRowY(HORSEMASTER_GOAL_ROW),
        buildings,
        gymIndex
    };
    const validation = validateHorsemasterCourse(course);
    if (!validation.valid) {
        throw new Error(`Generated invalid Horsemaster course: ${validation.errors.join('; ')}`);
    }
    return course;
}

export function canonicalHorsemasterCourseSignature(course: HorsemasterCourse): string {
    const vehicleLanes = course.vehicleLanes.map(lane =>
        `V${lane.index}:${lane.tier},${lane.direction},${lane.speed}:${lane.vehicles.map(vehicle =>
            [
                vehicle.initialX.toFixed(3),
                vehicle.colorIndex,
                vehicle.slots.map(slot => slot.exerciseKind).join('+')
            ].join(',')
        ).join('|')}`
    );
    const bikeLanes = course.bikeLanes.map(lane =>
        `B${lane.index}:${lane.tier},${lane.direction},${lane.speed}:${lane.bicycles.map(bicycle =>
            `${bicycle.initialX.toFixed(3)},${bicycle.colorIndex}`
        ).join('|')}`
    );
    return [`gym:${course.gymIndex}`, ...vehicleLanes, ...bikeLanes].join('/');
}

/**
 * Circular edge-to-edge gaps between same-lane traffic sorted by center.
 * Because every lane moves at one uniform speed, these gaps never change,
 * so a static check proves vehicles can never overlap or pass each other.
 */
function circularEdgeGaps(
    items: readonly {readonly centerX: number; readonly width: number}[]
): number[] {
    if (items.length < 2) return [];
    const sorted = [...items].sort((left, right) => left.centerX - right.centerX);
    const gaps: number[] = [];
    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index]!;
        const next = sorted[(index + 1) % sorted.length]!;
        const centerDistance = index === sorted.length - 1
            ? next.centerX + trafficSpan() - current.centerX
            : next.centerX - current.centerX;
        gaps.push(centerDistance - current.width / 2 - next.width / 2);
    }
    return gaps;
}

function circularCenterGaps(centers: readonly number[]): number[] {
    if (centers.length < 2) return [];
    const sorted = [...centers].sort((left, right) => left - right);
    const gaps: number[] = [];
    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index]!;
        const next = sorted[(index + 1) % sorted.length]!;
        gaps.push(index === sorted.length - 1
            ? next + trafficSpan() - current
            : next - current);
    }
    return gaps;
}

function laneSlotCenters(lane: HorsemasterVehicleLane): number[] {
    return lane.vehicles.flatMap(vehicle =>
        vehicle.slots.map(slot => vehicle.initialX + slot.offsetX)
    );
}

/**
 * Proves the constructive route the generator relies on:
 * - Bike lanes are slow with wide gaps, and the horse can wait indefinitely
 *   on any safe tile, so a dodge window into each bike row always recurs.
 * - Adjacent vehicle lanes travel in opposite directions at uniform per-lane
 *   speeds, so relative slot motion is non-zero and bounded slot gaps mean a
 *   landable machine crosses any x position within a few seconds.
 * - The gym building keeps enough upstream runway on the top lane that a
 *   boarding horse always sweeps through the door zone before the edge.
 */
export function hasHorsemasterWaitTimingRoute(course: HorsemasterCourse): boolean {
    if (course.vehicleLanes.length !== VEHICLE_LANE_COUNT) return false;
    for (let index = 0; index < course.vehicleLanes.length; index++) {
        const lane = course.vehicleLanes[index]!;
        if (lane.speed <= 0 || lane.vehicles.length === 0) return false;
        if (index > 0 && course.vehicleLanes[index - 1]!.direction === lane.direction) {
            return false;
        }
        if (lane.vehicles.some(vehicle =>
            vehicle.direction !== lane.direction ||
            vehicle.speed !== lane.speed ||
            vehicle.slots.length === 0
        )) {
            return false;
        }
        const bumperGaps = circularEdgeGaps(lane.vehicles.map(vehicle => ({
            centerX: vehicle.initialX,
            width: vehicle.carWidth
        })));
        if (bumperGaps.some(gap => gap < HORSEMASTER_MIN_VEHICLE_GAP - 1e-6)) {
            return false;
        }
        const slotGaps = circularCenterGaps(laneSlotCenters(lane));
        if (slotGaps.some(gap => gap > HORSEMASTER_MAX_SLOT_GAP + 1e-6)) {
            return false;
        }
    }
    if (course.bikeLanes.length !== BIKE_LANE_COUNT) return false;
    for (const lane of course.bikeLanes) {
        if (lane.speed < 20 || lane.speed > 70) return false;
        const gaps = circularEdgeGaps(lane.bicycles.map(bicycle => ({
            centerX: bicycle.initialX,
            width: BIKE_LENGTH
        })));
        if (gaps.some(gap => gap < HORSEMASTER_MIN_BIKE_GAP - 1e-6)) return false;
    }
    const gyms = course.buildings.filter(building => building.isGym);
    if (gyms.length !== 1) return false;
    const topDirection = course.vehicleLanes[VEHICLE_LANE_COUNT - 1]!.direction;
    const runway = topDirection === 1
        ? gyms[0]!.centerX
        : course.width - gyms[0]!.centerX;
    return runway >= HORSEMASTER_MIN_GYM_RUNWAY;
}

export function validateHorsemasterCourse(
    course: HorsemasterCourse
): HorsemasterValidationResult {
    const errors: string[] = [];
    if (course.generatorId !== 'horsemaster-frogger-v2') {
        errors.push('Unknown Horsemaster generator.');
    }
    if (course.width !== HORSEMASTER_WORLD_WIDTH || course.height !== HORSEMASTER_WORLD_HEIGHT) {
        errors.push('Course dimensions do not match the Horsemaster playfield.');
    }
    if (
        !Number.isSafeInteger(course.startingLives) ||
        course.startingLives < 1 ||
        course.startingLives > 9
    ) {
        errors.push('Course starting lives are invalid.');
    }
    if (
        course.start.x !== horsemasterColumnX(HORSEMASTER_START_COLUMN) ||
        course.start.y !== horsemasterRowY(0)
    ) {
        errors.push('Course start is not on the start row tile.');
    }
    if (course.medianY !== horsemasterRowY(MEDIAN_ROW)) {
        errors.push('Course median is misplaced.');
    }
    if (course.goalY !== horsemasterRowY(HORSEMASTER_GOAL_ROW)) {
        errors.push('Course goal row is misplaced.');
    }

    if (course.buildings.length !== BUILDING_COUNT) {
        errors.push('Course must contain exactly five buildings.');
    }
    const gyms = course.buildings.filter(building => building.isGym);
    if (gyms.length !== 1 || gyms[0]?.index !== course.gymIndex) {
        errors.push('Course must mark exactly one building as the gym.');
    }
    course.buildings.forEach((building, index) => {
        if (
            building.index !== index ||
            building.centerX !== buildingCenterX(index) ||
            building.width !== BUILDING_WIDTH ||
            building.doorHalfWidth !== HORSEMASTER_DOOR_HALF_WIDTH
        ) {
            errors.push(`Building ${index} is malformed.`);
        }
    });

    if (course.vehicleLanes.length !== VEHICLE_LANE_COUNT) {
        errors.push('Course must contain exactly five vehicle lanes.');
    }
    else {
        const tierCount = (tier: HorsemasterVehicleTier): number =>
            course.vehicleLanes.filter(lane => lane.tier === tier).length;
        if (tierCount('green') !== 3 || tierCount('yellow') !== 1 || tierCount('red') !== 1) {
            errors.push('Vehicle lanes must be exactly three green, one yellow, one red.');
        }
        if (
            course.vehicleLanes[0]!.tier === 'red' ||
            course.vehicleLanes[VEHICLE_LANE_COUNT - 1]!.tier === 'red'
        ) {
            errors.push('The first and last vehicle lanes must not be red.');
        }
    }

    const vehicleIds = new Set<string>();
    course.vehicleLanes.forEach((lane, laneIndex) => {
        if (
            lane.index !== laneIndex ||
            lane.row !== FIRST_VEHICLE_ROW + laneIndex ||
            lane.y !== horsemasterRowY(lane.row)
        ) {
            errors.push(`Vehicle lane ${laneIndex} is misplaced.`);
        }
        if (laneIndex > 0 && course.vehicleLanes[laneIndex - 1]!.direction === lane.direction) {
            errors.push(`Vehicle lane ${laneIndex} does not alternate direction.`);
        }
        const speedValid = lane.tier === 'red'
            ? lane.speed >= 74 && lane.speed <= 86
            : lane.speed >= 50 && lane.speed <= 60;
        if (!speedValid) errors.push(`Vehicle lane ${laneIndex} speed is out of band.`);
        const expectedCount = lane.tier === 'green' ? 3 : 4;
        if (lane.vehicles.length !== expectedCount) {
            errors.push(`Vehicle lane ${laneIndex} has the wrong vehicle count.`);
        }
        for (const vehicle of lane.vehicles) {
            if (vehicleIds.has(vehicle.id)) errors.push(`Duplicate vehicle id ${vehicle.id}.`);
            vehicleIds.add(vehicle.id);
            if (
                vehicle.laneIndex !== laneIndex ||
                vehicle.tier !== lane.tier ||
                vehicle.direction !== lane.direction ||
                vehicle.speed !== lane.speed
            ) {
                errors.push(`Vehicle ${vehicle.id} does not match its lane.`);
            }
            if (
                vehicle.initialX < HORSEMASTER_TRAFFIC_MIN_X ||
                vehicle.initialX >= HORSEMASTER_TRAFFIC_MAX_X
            ) {
                errors.push(`Vehicle ${vehicle.id} starts outside its wrap track.`);
            }
            if (vehicle.carHeight < 30) {
                errors.push(`Vehicle ${vehicle.id} has invalid dimensions.`);
            }
            const expectedWidth = lane.tier === 'green' ? BUS_WIDTH : CAR_WIDTH;
            const expectedOffsets = lane.tier === 'green' ? [-24, 24] : [0];
            if (
                vehicle.carWidth !== expectedWidth ||
                vehicle.slots.length !== expectedOffsets.length ||
                vehicle.slots.some((slot, slotIndex) =>
                    slot.index !== slotIndex ||
                    slot.offsetX !== expectedOffsets[slotIndex] ||
                    !EXERCISE_KINDS.includes(slot.exerciseKind)
                )
            ) {
                errors.push(`Vehicle ${vehicle.id} has an invalid slot layout.`);
            }
        }
        const bumperGaps = circularEdgeGaps(lane.vehicles.map(vehicle => ({
            centerX: vehicle.initialX,
            width: vehicle.carWidth
        })));
        if (bumperGaps.some(gap => gap < HORSEMASTER_MIN_VEHICLE_GAP - 1e-6)) {
            errors.push(`Vehicle lane ${laneIndex} packs vehicles too tightly.`);
        }
        const slotGaps = circularCenterGaps(laneSlotCenters(lane));
        if (slotGaps.some(gap => gap > HORSEMASTER_MAX_SLOT_GAP + 1e-6)) {
            errors.push(`Vehicle lane ${laneIndex} leaves an unlandable slot gap.`);
        }
    });

    if (course.bikeLanes.length !== BIKE_LANE_COUNT) {
        errors.push('Course must contain exactly five bike lanes.');
    }
    else {
        const bikeTierCount = (tier: HorsemasterVehicleTier): number =>
            course.bikeLanes.filter(lane => lane.tier === tier).length;
        if (
            bikeTierCount('green') !== 3 ||
            bikeTierCount('yellow') !== 1 ||
            bikeTierCount('red') !== 1
        ) {
            errors.push('Bike lanes must be exactly three green, one yellow, one red.');
        }
    }
    const bicycleIds = new Set<string>();
    course.bikeLanes.forEach((lane, laneIndex) => {
        if (
            lane.index !== laneIndex ||
            lane.row !== 1 + laneIndex ||
            lane.y !== horsemasterRowY(lane.row)
        ) {
            errors.push(`Bike lane ${laneIndex} is misplaced.`);
        }
        if (laneIndex > 0 && course.bikeLanes[laneIndex - 1]!.direction === lane.direction) {
            errors.push(`Bike lane ${laneIndex} does not alternate direction.`);
        }
        const bikeSpeedValid = lane.tier === 'green'
            ? lane.speed >= 22 && lane.speed <= 28
            : lane.tier === 'yellow'
                ? lane.speed >= 38 && lane.speed <= 44
                : lane.speed >= 58 && lane.speed <= 66;
        if (!bikeSpeedValid) {
            errors.push(`Bike lane ${laneIndex} speed does not match its tier.`);
        }
        if (lane.bicycles.length < 2) {
            errors.push(`Bike lane ${laneIndex} has too few bicycles.`);
        }
        for (const bicycle of lane.bicycles) {
            if (bicycleIds.has(bicycle.id)) errors.push(`Duplicate bicycle id ${bicycle.id}.`);
            bicycleIds.add(bicycle.id);
            if (
                bicycle.laneIndex !== laneIndex ||
                bicycle.direction !== lane.direction ||
                bicycle.speed !== lane.speed
            ) {
                errors.push(`Bicycle ${bicycle.id} does not match its lane.`);
            }
            if (
                bicycle.initialX < HORSEMASTER_TRAFFIC_MIN_X ||
                bicycle.initialX >= HORSEMASTER_TRAFFIC_MAX_X
            ) {
                errors.push(`Bicycle ${bicycle.id} starts outside its wrap track.`);
            }
        }
        const gaps = circularEdgeGaps(lane.bicycles.map(bicycle => ({
            centerX: bicycle.initialX,
            width: BIKE_LENGTH
        })));
        if (gaps.some(gap => gap < HORSEMASTER_MIN_BIKE_GAP - 1e-6)) {
            errors.push(`Bike lane ${laneIndex} packs bicycles too tightly.`);
        }
    });

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
            row: 0,
            ride: null,
            lives: course.startingLives,
            recoveryMs: 0,
            jump: null
        },
        vehicles: course.vehicleLanes.flatMap(lane =>
            lane.vehicles.map(vehicle => ({
                id: vehicle.id,
                previousX: vehicle.initialX,
                x: vehicle.initialX
            }))
        ),
        bicycles: course.bikeLanes.flatMap(lane =>
            lane.bicycles.map(bicycle => ({
                id: bicycle.id,
                previousX: bicycle.initialX,
                x: bicycle.initialX
            }))
        ),
        activeTicks: 0,
        accumulatorMs: 0,
        status: 'active',
        paused: false,
        pendingHorizontal: 0,
        pendingVertical: 0
    };
}

function cloneState(state: HorsemasterState): MutableHorsemasterState {
    return {
        course: state.course,
        player: {
            ...state.player,
            ride: state.player.ride === null ? null : {...state.player.ride},
            jump: state.player.jump === null ? null : {...state.player.jump}
        },
        vehicles: state.vehicles.map(vehicle => ({...vehicle})),
        bicycles: state.bicycles.map(bicycle => ({...bicycle})),
        activeTicks: state.activeTicks,
        accumulatorMs: state.accumulatorMs,
        status: state.status,
        paused: state.paused,
        pendingHorizontal: state.pendingHorizontal,
        pendingVertical: state.pendingVertical
    };
}

function vehicleDefinitionsById(
    course: HorsemasterCourse
): ReadonlyMap<string, HorsemasterVehicleDefinition> {
    return new Map(course.vehicleLanes.flatMap(lane =>
        lane.vehicles.map(vehicle => [vehicle.id, vehicle] as const)
    ));
}

function bicycleDefinitionsById(
    course: HorsemasterCourse
): ReadonlyMap<string, HorsemasterBicycleDefinition> {
    return new Map(course.bikeLanes.flatMap(lane =>
        lane.bicycles.map(bicycle => [bicycle.id, bicycle] as const)
    ));
}

function advanceTraffic(state: MutableHorsemasterState): void {
    const vehicleDefinitions = vehicleDefinitionsById(state.course);
    for (const vehicle of state.vehicles) {
        const definition = vehicleDefinitions.get(vehicle.id);
        if (definition === undefined) continue;
        vehicle.previousX = vehicle.x;
        vehicle.x = wrapHorsemasterTrafficX(
            vehicle.x +
            definition.direction *
            definition.speed *
            (HORSEMASTER_FIXED_STEP_MS / 1_000)
        );
    }
    const bicycleDefinitions = bicycleDefinitionsById(state.course);
    for (const bicycle of state.bicycles) {
        const definition = bicycleDefinitions.get(bicycle.id);
        if (definition === undefined) continue;
        bicycle.previousX = bicycle.x;
        bicycle.x = wrapHorsemasterTrafficX(
            bicycle.x +
            definition.direction *
            definition.speed *
            (HORSEMASTER_FIXED_STEP_MS / 1_000)
        );
    }
}

function carryHorseWithRide(state: MutableHorsemasterState): void {
    const ride = state.player.ride;
    if (ride === null || state.player.jump !== null) return;
    const vehicle = state.vehicles.find(candidate => candidate.id === ride.vehicleId);
    const definition = vehicleDefinitionsById(state.course).get(ride.vehicleId);
    const slot = definition?.slots[ride.slotIndex];
    if (vehicle === undefined || definition === undefined || slot === undefined) return;
    state.player.x = vehicle.x + slot.offsetX;
    state.player.y = state.course.vehicleLanes[definition.laneIndex]!.y;
}

function loseHeart(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[],
    cause: HorsemasterDeathCause
): void {
    const player = state.player;
    player.lives -= 1;
    player.jump = null;
    player.ride = null;
    events.push({kind: cause, lives: player.lives});
    if (player.lives <= 0) {
        state.status = 'failure';
        events.push({kind: 'failure'});
        return;
    }
    player.x = state.course.start.x;
    player.y = state.course.start.y;
    player.previousX = player.x;
    player.previousY = player.y;
    player.row = 0;
    player.recoveryMs = HORSEMASTER_RECOVERY_MS;
    events.push({kind: 'reset', recoveryMs: HORSEMASTER_RECOVERY_MS});
}

/**
 * Riding past the visible playfield edge is fatal. Vehicles keep wrapping on
 * the shared track, but the horse is pulled off well before the wrap seam,
 * so a rendered player position never has to cross it.
 */
function checkCarriedOffEdge(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[]
): boolean {
    const player = state.player;
    if (player.ride === null || player.jump !== null) return false;
    if (
        player.x < -HORSEMASTER_EDGE_DEATH_MARGIN ||
        player.x > state.course.width - HORSEMASTER_EDGE_DEATH_MARGIN
    ) {
        loseHeart(state, events, 'carried-off-edge');
        return true;
    }
    return false;
}

function startHop(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[],
    hop: HorsemasterHopKind,
    targetX: number,
    targetRow: number
): void {
    const player = state.player;
    player.jump = {
        hop,
        sourceX: player.x,
        sourceY: player.y,
        targetX,
        targetY: targetRow === HORSEMASTER_GOAL_ROW
            ? state.course.goalY
            : horsemasterRowY(targetRow),
        targetRow,
        elapsedMs: 0,
        durationMs: hop === 'grid' ? HORSEMASTER_GRID_HOP_MS : HORSEMASTER_HOP_DURATION_MS
    };
    player.ride = null;
    events.push({kind: 'jump-started', hop, targetRow});
}

function applyVerticalInput(
    state: MutableHorsemasterState,
    direction: -1 | 1,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    if (player.jump !== null || player.recoveryMs > 0) return;
    if (direction === 1) {
        if (player.row >= HORSEMASTER_GOAL_ROW) return;
        const targetRow = player.row + 1;
        // Hops below the median are on-foot grid hops; from the median up,
        // every forward hop is a committed vehicle-length jump whose landing
        // x is frozen at takeoff (no mid-air steering, Frogger-style).
        startHop(
            state,
            events,
            player.row < MEDIAN_ROW ? 'grid' : 'vehicle',
            player.x,
            targetRow
        );
        return;
    }
    if (player.ride !== null) return;
    if (player.row < 1 || player.row > MEDIAN_ROW) return;
    startHop(state, events, 'grid', player.x, player.row - 1);
}

function applyHorizontalInput(
    state: MutableHorsemasterState,
    direction: -1 | 1,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    if (player.jump !== null) return;
    if (player.ride !== null) {
        const definition = vehicleDefinitionsById(state.course).get(player.ride.vehicleId);
        const vehicle = state.vehicles.find(
            candidate => candidate.id === player.ride!.vehicleId
        );
        if (definition === undefined || vehicle === undefined) return;
        const nextSlot = definition.slots[player.ride.slotIndex + direction];
        if (nextSlot === undefined) return;
        player.ride.slotIndex = nextSlot.index;
        player.x = vehicle.x + nextSlot.offsetX;
        events.push({kind: 'aligned', direction});
        return;
    }
    if (player.row > MEDIAN_ROW) return;
    const column = Math.round(
        (player.x - HORSEMASTER_TILE / 2) / HORSEMASTER_TILE
    );
    const targetColumn = clamp(column + direction, 0, HORSEMASTER_COLUMNS - 1);
    if (targetColumn === column) return;
    startHop(state, events, 'grid', horsemasterColumnX(targetColumn), player.row);
}

/**
 * A landing counts when at least 80% of the horse overlaps the truck —
 * cab included — and the horse then settles onto the closest machine slot.
 * Trucks never sit close enough for a horse to qualify on two at once, so
 * the best-overlap pick is unambiguous.
 */
function resolveSlotLanding(
    state: MutableHorsemasterState,
    targetRow: number,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    const lane = state.course.vehicleLanes[targetRow - FIRST_VEHICLE_ROW];
    if (lane === undefined) {
        loseHeart(state, events, 'road-impact');
        return;
    }
    const requiredOverlap =
        HORSEMASTER_LANDING_OVERLAP_RATIO * HORSEMASTER_HORSE_HALF_WIDTH * 2;
    const candidates = lane.vehicles.flatMap(definition => {
        const vehicle = state.vehicles.find(candidate => candidate.id === definition.id);
        if (vehicle === undefined) return [];
        const left = vehicle.x -
            definition.carWidth / 2 -
            (definition.direction === -1 ? HORSEMASTER_CAB_LENGTH : 0);
        const right = vehicle.x +
            definition.carWidth / 2 +
            (definition.direction === 1 ? HORSEMASTER_CAB_LENGTH : 0);
        const overlap =
            Math.min(right, player.x + HORSEMASTER_HORSE_HALF_WIDTH) -
            Math.max(left, player.x - HORSEMASTER_HORSE_HALF_WIDTH);
        if (overlap < requiredOverlap) return [];
        return definition.slots.map(slot => {
            const center = vehicle.x + slot.offsetX;
            return {definition, slot, center, distance: Math.abs(player.x - center), overlap};
        });
    }).sort((left, right) =>
        right.overlap - left.overlap ||
        left.distance - right.distance ||
        left.slot.index - right.slot.index
    );
    const closest = candidates[0];
    if (closest === undefined) {
        loseHeart(state, events, 'road-impact');
        return;
    }
    player.x = closest.center;
    player.y = lane.y;
    player.row = targetRow;
    player.ride = {vehicleId: closest.definition.id, slotIndex: closest.slot.index};
    events.push({
        kind: 'landed',
        row: targetRow,
        vehicleId: closest.definition.id,
        slotIndex: closest.slot.index
    });
}

function resolveGoalLanding(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    const building = state.course.buildings.find(candidate =>
        Math.abs(player.x - candidate.centerX) <= candidate.doorHalfWidth
    );
    if (building === undefined || !building.isGym) {
        loseHeart(state, events, 'wrong-building');
        return;
    }
    player.x = building.centerX;
    player.y = state.course.goalY;
    player.row = HORSEMASTER_GOAL_ROW;
    state.status = 'success';
    events.push({kind: 'success'});
}

function finishJump(
    state: MutableHorsemasterState,
    jump: MutableJumpState,
    events: HorsemasterEvent[]
): void {
    const player = state.player;
    player.jump = null;
    if (jump.targetRow === HORSEMASTER_GOAL_ROW) {
        resolveGoalLanding(state, events);
        return;
    }
    if (jump.targetRow >= FIRST_VEHICLE_ROW) {
        resolveSlotLanding(state, jump.targetRow, events);
        return;
    }
    player.x = jump.targetX;
    player.y = jump.targetY;
    player.row = jump.targetRow;
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
    const arcHeight = jump.hop === 'grid' ? GRID_ARC_HEIGHT : JUMP_ARC_HEIGHT;
    state.player.x = lerp(jump.sourceX, jump.targetX, easedProgress);
    state.player.y =
        lerp(jump.sourceY, jump.targetY, easedProgress) -
        Math.sin(Math.PI * progress) * arcHeight;
    if (jump.elapsedMs >= jump.durationMs) finishJump(state, jump, events);
}

function checkBicycleCollision(
    state: MutableHorsemasterState,
    events: HorsemasterEvent[]
): void {
    if (state.status !== 'active') return;
    const player = state.player;
    if (player.jump !== null) return;
    if (player.row < 1 || player.row > BIKE_LANE_COUNT) return;
    const lane = state.course.bikeLanes[player.row - 1];
    if (lane === undefined) return;
    for (const definition of lane.bicycles) {
        const bicycle = state.bicycles.find(candidate => candidate.id === definition.id);
        if (bicycle === undefined) continue;
        if (Math.abs(bicycle.x - player.x) < HORSEMASTER_BIKE_HIT_TOLERANCE) {
            loseHeart(state, events, 'bicycle-hit');
            return;
        }
    }
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
    carryHorseWithRide(state);
    if (checkCarriedOffEdge(state, events)) return;
    if (input.vertical !== 0) applyVerticalInput(state, input.vertical, events);
    else if (input.horizontal !== 0) applyHorizontalInput(state, input.horizontal, events);
    advanceJump(state, events);
    checkBicycleCollision(state, events);
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
    if (input.vertical !== 0) next.pendingVertical = input.vertical;
    const events: HorsemasterEvent[] = [];
    while (
        next.accumulatorMs + 1e-9 >= HORSEMASTER_FIXED_STEP_MS &&
        next.status === 'active'
    ) {
        const consumable = next.player.jump === null;
        simulateStep(next, {
            horizontal: next.pendingHorizontal,
            vertical: next.pendingVertical
        }, events);
        if (consumable) {
            next.pendingHorizontal = 0;
            next.pendingVertical = 0;
        }
        next.accumulatorMs -= HORSEMASTER_FIXED_STEP_MS;
        if (Math.abs(next.accumulatorMs) < 1e-9) next.accumulatorMs = 0;
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
        pendingVertical: 0
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
    const vehicleDefinitions = vehicleDefinitionsById(state.course);
    const vehicles = state.vehicles.flatMap(vehicle => {
        const definition = vehicleDefinitions.get(vehicle.id);
        if (definition === undefined) return [];
        return [{
            id: vehicle.id,
            x: interpolateWrappedX(vehicle.previousX, vehicle.x, interpolation),
            y: state.course.vehicleLanes[definition.laneIndex]!.y,
            definition
        }];
    });
    const bicycleDefinitions = bicycleDefinitionsById(state.course);
    const bicycles = state.bicycles.flatMap(bicycle => {
        const definition = bicycleDefinitions.get(bicycle.id);
        if (definition === undefined) return [];
        return [{
            id: bicycle.id,
            x: interpolateWrappedX(bicycle.previousX, bicycle.x, interpolation),
            y: state.course.bikeLanes[definition.laneIndex]!.y,
            definition
        }];
    });
    const ride = state.player.ride;
    const ridingMachine = ride === null
        ? null
        : vehicleDefinitions.get(ride.vehicleId)?.slots[ride.slotIndex]?.exerciseKind ?? null;
    const jump = state.player.jump;
    return {
        interpolation,
        player: {
            // Plain interpolation is safe: riding off the edge is fatal at
            // ±HORSEMASTER_EDGE_DEATH_MARGIN, far inside the wrap seam, so a
            // player position never sweeps across a wrap.
            x: lerp(state.player.previousX, state.player.x, interpolation),
            y: lerp(state.player.previousY, state.player.y, interpolation),
            row: state.player.row,
            ride,
            ridingMachine,
            lives: state.player.lives,
            recoveryMs: state.player.recoveryMs,
            jumping: jump !== null,
            hopKind: jump?.hop ?? null,
            hopProgress: jump === null
                ? 0
                : clamp(
                    (jump.elapsedMs + interpolation * HORSEMASTER_FIXED_STEP_MS) /
                    jump.durationMs,
                    0,
                    1
                )
        },
        vehicles,
        bicycles,
        status: state.status
    };
}
