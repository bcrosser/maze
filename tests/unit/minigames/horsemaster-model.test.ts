import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    HORSEMASTER_BIKE_HIT_TOLERANCE,
    HORSEMASTER_EDGE_DEATH_MARGIN,
    HORSEMASTER_FIXED_STEP_MS,
    HORSEMASTER_GRID_HOP_MS,
    HORSEMASTER_HOP_DURATION_MS,
    HORSEMASTER_LANDING_TOLERANCE,
    HORSEMASTER_MIN_BIKE_GAP,
    HORSEMASTER_MIN_GYM_RUNWAY,
    HORSEMASTER_MIN_VEHICLE_GAP,
    HORSEMASTER_RECOVERY_MS,
    HORSEMASTER_TRAFFIC_MAX_X,
    HORSEMASTER_TRAFFIC_MIN_X,
    HORSEMASTER_WORLD_WIDTH,
    advanceHorsemaster,
    canonicalHorsemasterCourseSignature,
    createHorsemasterCourse,
    createHorsemasterState,
    getHorsemasterRenderSnapshot,
    hasHorsemasterWaitTimingRoute,
    horsemasterColumnX,
    horsemasterRowY,
    validateHorsemasterCourse,
    wrapHorsemasterTrafficX,
    type HorsemasterCourse,
    type HorsemasterInput,
    type HorsemasterState,
    type HorsemasterVehicleDefinition,
    type HorsemasterVehicleLane
} from '../../../src/minigames/horsemaster/horsemaster-model';

const IDLE: HorsemasterInput = {horizontal: 0, vertical: 0};
const UP: HorsemasterInput = {horizontal: 0, vertical: 1};
const DOWN: HorsemasterInput = {horizontal: 0, vertical: -1};
const LEFT: HorsemasterInput = {horizontal: -1, vertical: 0};
const RIGHT: HorsemasterInput = {horizontal: 1, vertical: 0};

function vehicleDefinition(
    course: HorsemasterCourse,
    id: string
): HorsemasterVehicleDefinition {
    const result = course.vehicleLanes
        .flatMap(lane => lane.vehicles)
        .find(vehicle => vehicle.id === id);
    if (result === undefined) throw new Error(`Missing test vehicle ${id}.`);
    return result;
}

function laneOfTier(
    course: HorsemasterCourse,
    tier: 'green' | 'yellow' | 'red'
): HorsemasterVehicleLane {
    const lane = course.vehicleLanes.find(candidate => candidate.tier === tier);
    if (lane === undefined) throw new Error(`Course has no ${tier} lane.`);
    return lane;
}

function setVehicleCenter(
    state: HorsemasterState,
    id: string,
    x: number
): HorsemasterState {
    return {
        ...state,
        vehicles: state.vehicles.map(vehicle =>
            vehicle.id === id
                ? {...vehicle, previousX: x, x}
                : vehicle
        )
    };
}

function setBicycleCenter(
    state: HorsemasterState,
    id: string,
    x: number
): HorsemasterState {
    return {
        ...state,
        bicycles: state.bicycles.map(bicycle =>
            bicycle.id === id
                ? {...bicycle, previousX: x, x}
                : bicycle
        )
    };
}

function placeOnRow(
    state: HorsemasterState,
    row: number,
    column: number
): HorsemasterState {
    const x = horsemasterColumnX(column);
    const y = horsemasterRowY(row);
    return {
        ...state,
        player: {
            ...state.player,
            previousX: x,
            x,
            previousY: y,
            y,
            row,
            ride: null,
            jump: null
        }
    };
}

function placeOnRide(
    state: HorsemasterState,
    vehicleId: string,
    slotIndex: number
): HorsemasterState {
    const definition = vehicleDefinition(state.course, vehicleId);
    const slot = definition.slots[slotIndex];
    if (slot === undefined) throw new Error(`Missing slot ${slotIndex} on ${vehicleId}.`);
    const vehicle = state.vehicles.find(candidate => candidate.id === vehicleId);
    if (vehicle === undefined) throw new Error(`Missing vehicle state ${vehicleId}.`);
    const lane = state.course.vehicleLanes[definition.laneIndex]!;
    const x = vehicle.x + slot.offsetX;
    return {
        ...state,
        player: {
            ...state.player,
            previousX: x,
            x,
            previousY: lane.y,
            y: lane.y,
            row: lane.row,
            ride: {vehicleId, slotIndex},
            jump: null
        }
    };
}

/**
 * Positions a vehicle so the requested slot center sits exactly at landingX
 * when a vehicle jump pressed right now finishes (19 fixed steps later).
 */
function arrangeSlotLanding(
    state: HorsemasterState,
    vehicleId: string,
    slotIndex: number,
    landingX: number
): HorsemasterState {
    const definition = vehicleDefinition(state.course, vehicleId);
    const slot = definition.slots[slotIndex];
    if (slot === undefined) throw new Error(`Missing slot ${slotIndex} on ${vehicleId}.`);
    const initialX = landingX -
        slot.offsetX -
        definition.direction *
        definition.speed *
        (HORSEMASTER_HOP_DURATION_MS / 1_000);
    return setVehicleCenter(state, vehicleId, initialX);
}

/** Parks a bike lane's bicycles far from the center start column (x = 360). */
function parkBikes(state: HorsemasterState, laneIndex: number): HorsemasterState {
    let next = state;
    const positions = [40, 140, 640];
    state.course.bikeLanes[laneIndex]!.bicycles.forEach((bicycle, index) => {
        next = setBicycleCenter(next, bicycle.id, positions[index % positions.length]!);
    });
    return next;
}

/** Places the player on the median and parks lane-0 traffic far from them. */
function arrangeMiss(state: HorsemasterState): HorsemasterState {
    let next = placeOnRow(state, 6, 0);
    const lane = next.course.vehicleLanes[0]!;
    lane.vehicles.forEach((vehicle, index) => {
        next = setVehicleCenter(next, vehicle.id, 220 + index * 140);
    });
    return next;
}

function advanceInSchedule(
    initial: HorsemasterState,
    totalMs: number,
    schedule: readonly number[],
    firstInput: HorsemasterInput = IDLE
): HorsemasterState {
    let state = initial;
    let elapsedMs = 0;
    let scheduleIndex = 0;
    let first = true;
    while (elapsedMs < totalMs) {
        const requested = schedule[scheduleIndex % schedule.length]!;
        const deltaMs = Math.min(requested, totalMs - elapsedMs);
        state = advanceHorsemaster(state, first ? firstInput : IDLE, deltaMs).state;
        elapsedMs += deltaMs;
        scheduleIndex += 1;
        first = false;
    }
    return state;
}

function deathEdgeX(direction: -1 | 1): number {
    return direction === 1
        ? HORSEMASTER_WORLD_WIDTH + HORSEMASTER_EDGE_DEATH_MARGIN
        : -HORSEMASTER_EDGE_DEATH_MARGIN;
}

function runwayToEdge(x: number, direction: -1 | 1): number {
    return direction === 1 ? deathEdgeX(1) - x : x - deathEdgeX(-1);
}

function crossBikeRowOnce(initial: HorsemasterState): HorsemasterState {
    let state = initial;
    for (let waitTick = 0; waitTick < 3_000; waitTick++) {
        const lives = state.player.lives;
        const hop = advanceHorsemaster(state, UP, HORSEMASTER_GRID_HOP_MS).state;
        const hopSurvives = hop.player.lives === lives;
        if (hopSurvives) {
            const settled = advanceHorsemaster(hop, IDLE, 400).state;
            if (settled.player.lives === lives) return hop;
        }
        const standing = advanceHorsemaster(state, IDLE, 320).state;
        if (standing.player.lives === lives) {
            state = advanceHorsemaster(state, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
            continue;
        }
        // A bicycle is closing in on where the horse stands. Prefer a live
        // hop forward, then a settled sideways or backward dodge, and only
        // gamble upward (airborne-immune) when nothing else is safe.
        if (hopSurvives) return hop;
        for (const escape of [RIGHT, LEFT, DOWN]) {
            const dodged = advanceHorsemaster(state, escape, HORSEMASTER_GRID_HOP_MS).state;
            if (dodged.player.lives !== lives) continue;
            if (
                dodged.player.x === state.player.x &&
                dodged.player.y === state.player.y
            ) {
                continue;
            }
            const settled = advanceHorsemaster(dodged, IDLE, 400).state;
            if (settled.player.lives === lives) return dodged;
        }
        return hop;
    }
    return state;
}

function boardNextLane(initial: HorsemasterState): HorsemasterState {
    let state = initial;
    const course = state.course;
    const startRow = state.player.row;
    const targetLane = course.vehicleLanes[startRow + 1 - 7]!;
    const gym = course.buildings[course.gymIndex]!;
    const finalLane = targetLane.row === 11;
    const requiredRunway = targetLane.tier === 'red' ? 330 : 250;
    for (let waitTick = 0; waitTick < 3_000; waitTick++) {
        const attempt = advanceHorsemaster(state, UP, HORSEMASTER_HOP_DURATION_MS).state;
        if (
            attempt.player.row === startRow + 1 &&
            attempt.player.lives === state.player.lives
        ) {
            const desperate = startRow > 6 && runwayToEdge(
                state.player.x,
                course.vehicleLanes[startRow - 7]!.direction
            ) < 100;
            const gymAhead = targetLane.direction === 1
                ? gym.centerX - attempt.player.x
                : attempt.player.x - gym.centerX;
            const acceptable = finalLane
                ? gymAhead >= -20
                : desperate ||
                    runwayToEdge(attempt.player.x, targetLane.direction) >= requiredRunway;
            if (acceptable) return attempt;
        }
        state = advanceHorsemaster(state, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
        if (state.player.row !== startRow || state.status !== 'active') return state;
    }
    return state;
}

function jumpToGym(initial: HorsemasterState): HorsemasterState {
    let state = initial;
    for (let waitTick = 0; waitTick < 3_000; waitTick++) {
        const attempt = advanceHorsemaster(state, UP, HORSEMASTER_HOP_DURATION_MS).state;
        if (attempt.status === 'success') return attempt;
        state = advanceHorsemaster(state, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
        if (state.player.row !== 11 || state.status !== 'active') return state;
    }
    return state;
}

/**
 * Wait-and-hop autoplay: dodge across the bike road, board each vehicle lane
 * when a slot lands with enough runway before the death edge, and leave the
 * top lane only inside the gym door zone. Proves generated courses solvable.
 */
function solveFroggerCourse(initial: HorsemasterState): HorsemasterState {
    let state = initial;
    for (let dispatch = 0; dispatch < 500 && state.status === 'active'; dispatch++) {
        const row = state.player.row;
        if (row < 6) state = crossBikeRowOnce(state);
        else if (row < 11) state = boardNextLane(state);
        else state = jumpToGym(state);
    }
    return state;
}

describe('Horsemaster course generation', () => {
    it('reproduces seeds, varies layouts, and validates 160 constructive routes', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 160; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed));
            const duplicate = createHorsemasterCourse(new Mulberry32Random(seed));

            expect(course).toEqual(duplicate);
            expect(course.vehicleLanes).toHaveLength(5);
            expect(course.bikeLanes).toHaveLength(5);
            expect(validateHorsemasterCourse(course)).toEqual({valid: true, errors: []});
            expect(hasHorsemasterWaitTimingRoute(course)).toBe(true);
            signatures.add(canonicalHorsemasterCourseSignature(course));
        }

        expect(signatures.size).toBeGreaterThanOrEqual(155);
    });

    it('lays out the fixed Frogger grid with five buildings and one gym', () => {
        const gymIndexes = new Set<number>();
        for (let seed = 0; seed < 200; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed * 31 + 7));

            expect(course.start).toEqual({x: 360, y: 648});
            expect(course.medianY).toBe(360);
            expect(course.goalY).toBe(72);
            course.bikeLanes.forEach((lane, index) => {
                expect(lane.row).toBe(1 + index);
                expect(lane.y).toBe(648 - 48 * (1 + index));
            });
            course.vehicleLanes.forEach((lane, index) => {
                expect(lane.row).toBe(7 + index);
                expect(lane.y).toBe(648 - 48 * (7 + index));
            });
            expect(course.buildings.map(building => building.centerX))
                .toEqual([48, 192, 336, 480, 624]);
            expect(course.buildings.filter(building => building.isGym)).toHaveLength(1);
            expect(course.buildings[course.gymIndex]!.isGym).toBe(true);
            const topDirection = course.vehicleLanes[4]!.direction;
            const gymCenter = course.buildings[course.gymIndex]!.centerX;
            const runway = topDirection === 1
                ? gymCenter
                : HORSEMASTER_WORLD_WIDTH - gymCenter;
            expect(runway).toBeGreaterThanOrEqual(HORSEMASTER_MIN_GYM_RUNWAY);
            gymIndexes.add(course.gymIndex);
        }
        expect(gymIndexes.size).toBeGreaterThanOrEqual(3);
    });

    it('always fields three green, one yellow, and one red vehicle lane', () => {
        for (let seed = 0; seed < 200; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed * 97 + 3));
            const count = (tier: string): number =>
                course.vehicleLanes.filter(lane => lane.tier === tier).length;

            expect(count('green')).toBe(3);
            expect(count('yellow')).toBe(1);
            expect(count('red')).toBe(1);
            expect(course.vehicleLanes[0]!.tier).not.toBe('red');
            expect(course.vehicleLanes[4]!.tier).not.toBe('red');

            for (const lane of course.vehicleLanes) {
                if (lane.tier === 'red') {
                    expect(lane.speed).toBeGreaterThanOrEqual(74);
                    expect(lane.speed).toBeLessThanOrEqual(86);
                }
                else {
                    expect(lane.speed).toBeGreaterThanOrEqual(50);
                    expect(lane.speed).toBeLessThanOrEqual(60);
                }
                for (const vehicle of lane.vehicles) {
                    expect(vehicle.speed).toBe(lane.speed);
                    if (lane.tier === 'green') {
                        expect(vehicle.carWidth).toBe(120);
                        expect(vehicle.slots.map(slot => slot.offsetX)).toEqual([-24, 24]);
                    }
                    else {
                        expect(vehicle.carWidth).toBe(72);
                        expect(vehicle.slots.map(slot => slot.offsetX)).toEqual([0]);
                    }
                    for (const slot of vehicle.slots) {
                        expect(['treadmill', 'exercise-bike']).toContain(slot.exerciseKind);
                    }
                }
            }
        }
    });

    it('tiers bike lanes three green, one yellow, one red with speed-matched colors', () => {
        for (let seed = 0; seed < 100; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed * 53 + 11));
            const count = (tier: string): number =>
                course.bikeLanes.filter(lane => lane.tier === tier).length;
            expect(count('green')).toBe(3);
            expect(count('yellow')).toBe(1);
            expect(count('red')).toBe(1);
            for (let index = 0; index < course.bikeLanes.length; index++) {
                const lane = course.bikeLanes[index]!;
                if (lane.tier === 'green') {
                    expect(lane.speed).toBeGreaterThanOrEqual(22);
                    expect(lane.speed).toBeLessThanOrEqual(28);
                }
                else if (lane.tier === 'yellow') {
                    expect(lane.speed).toBeGreaterThanOrEqual(38);
                    expect(lane.speed).toBeLessThanOrEqual(44);
                }
                else {
                    expect(lane.speed).toBeGreaterThanOrEqual(58);
                    expect(lane.speed).toBeLessThanOrEqual(66);
                }
                if (index > 0) {
                    expect(lane.direction)
                        .toBe(-course.bikeLanes[index - 1]!.direction);
                }
                const centers = [...lane.bicycles]
                    .map(bicycle => bicycle.initialX)
                    .sort((left, right) => left - right);
                for (let pair = 0; pair < centers.length; pair++) {
                    const current = centers[pair]!;
                    const next = pair === centers.length - 1
                        ? centers[0]! + (HORSEMASTER_TRAFFIC_MAX_X - HORSEMASTER_TRAFFIC_MIN_X)
                        : centers[pair + 1]!;
                    expect(next - current - 36).toBeGreaterThanOrEqual(HORSEMASTER_MIN_BIKE_GAP);
                }
            }
            for (let index = 1; index < course.vehicleLanes.length; index++) {
                expect(course.vehicleLanes[index]!.direction)
                    .toBe(-course.vehicleLanes[index - 1]!.direction);
            }
        }
    });

    it('never lets same-lane vehicles overlap across a minute of simulation', () => {
        for (let seed = 0; seed < 4; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed * 211 + 5));
            let state = createHorsemasterState(course);
            for (let chunk = 0; chunk < 60; chunk++) {
                state = advanceHorsemaster(state, IDLE, 1_000).state;
                for (const lane of course.vehicleLanes) {
                    const positions = lane.vehicles.map(definition => ({
                        width: definition.carWidth,
                        x: state.vehicles.find(vehicle => vehicle.id === definition.id)!.x
                    })).sort((left, right) => left.x - right.x);
                    for (let index = 0; index < positions.length; index++) {
                        const current = positions[index]!;
                        const next = index === positions.length - 1
                            ? {
                                ...positions[0]!,
                                x: positions[0]!.x +
                                    (HORSEMASTER_TRAFFIC_MAX_X - HORSEMASTER_TRAFFIC_MIN_X)
                            }
                            : positions[index + 1]!;
                        const gap = next.x - current.x - current.width / 2 - next.width / 2;
                        expect(gap).toBeGreaterThanOrEqual(HORSEMASTER_MIN_VEHICLE_GAP - 1e-6);
                    }
                }
            }
        }
    });

    it('can complete varied courses by waiting for safe hops and landings', () => {
        for (let seed = 0; seed < 24; seed++) {
            const course = createHorsemasterCourse(
                new Mulberry32Random(seed * 1_009 + 17)
            );
            const solved = solveFroggerCourse(createHorsemasterState(course));

            expect(solved.status, `seed ${seed}`).toBe('success');
            expect(solved.player.lives, `seed ${seed}`).toBe(course.startingLives);
        }
    });

    it('rejects malformed generation settings and detects broken route invariants', () => {
        expect(() => createHorsemasterCourse(
            new Mulberry32Random(1),
            {startingLives: 0}
        )).toThrow(/starting lives/i);

        const course = createHorsemasterCourse(new Mulberry32Random(1));
        const sameDirection: HorsemasterCourse = {
            ...course,
            vehicleLanes: course.vehicleLanes.map((lane, index) =>
                index === 1
                    ? {
                        ...lane,
                        direction: course.vehicleLanes[0]!.direction,
                        vehicles: lane.vehicles.map(vehicle => ({
                            ...vehicle,
                            direction: course.vehicleLanes[0]!.direction
                        }))
                    }
                    : lane
            )
        };
        expect(hasHorsemasterWaitTimingRoute(sameDirection)).toBe(false);
        expect(validateHorsemasterCourse(sameDirection).valid).toBe(false);

        const twoGyms: HorsemasterCourse = {
            ...course,
            buildings: course.buildings.map(building =>
                building.index === (course.gymIndex + 1) % 5
                    ? {...building, isGym: true}
                    : building
            )
        };
        expect(hasHorsemasterWaitTimingRoute(twoGyms)).toBe(false);
        expect(validateHorsemasterCourse(twoGyms).valid).toBe(false);

        const packed: HorsemasterCourse = {
            ...course,
            vehicleLanes: course.vehicleLanes.map((lane, index) =>
                index === 0
                    ? {
                        ...lane,
                        vehicles: lane.vehicles.map(vehicle => ({
                            ...vehicle,
                            initialX: 300
                        }))
                    }
                    : lane
            )
        };
        expect(hasHorsemasterWaitTimingRoute(packed)).toBe(false);
        expect(validateHorsemasterCourse(packed).valid).toBe(false);
    });
});

describe('Horsemaster traffic and movement', () => {
    it('wraps traffic on the shared track and carries a riding horse', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(12));
        const lane = course.vehicleLanes[0]!;
        const vehicle = lane.vehicles[0]!;
        const slot = vehicle.slots[0]!;
        const edgeX = vehicle.direction === 1
            ? HORSEMASTER_TRAFFIC_MAX_X - 0.5
            : HORSEMASTER_TRAFFIC_MIN_X + 0.5;
        const wrapping = setVehicleCenter(createHorsemasterState(course), vehicle.id, edgeX);
        const wrapped = advanceHorsemaster(wrapping, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
        const movedVehicle = wrapped.vehicles.find(candidate => candidate.id === vehicle.id)!;
        if (vehicle.direction === 1) {
            expect(movedVehicle.x).toBeLessThan(HORSEMASTER_TRAFFIC_MIN_X + 5);
        }
        else {
            expect(movedVehicle.x).toBeGreaterThan(HORSEMASTER_TRAFFIC_MAX_X - 5);
        }

        let riding = setVehicleCenter(createHorsemasterState(course), vehicle.id, 336);
        riding = placeOnRide(riding, vehicle.id, slot.index);
        const carried = advanceHorsemaster(riding, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
        const carrier = carried.vehicles.find(candidate => candidate.id === vehicle.id)!;

        expect(carried.player.x).toBeCloseTo(carrier.x + slot.offsetX, 8);
        expect(carried.player.y).toBe(lane.y);
        expect(carried.player.ride).toEqual({vehicleId: vehicle.id, slotIndex: slot.index});
    });

    it('hops the grid in whole tiles and clamps at the playfield columns', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(29));
        const start = createHorsemasterState(course);

        const partial = advanceHorsemaster(start, RIGHT, HORSEMASTER_GRID_HOP_MS - 20).state;
        expect(partial.player.jump).not.toBeNull();
        expect(partial.player.row).toBe(0);
        const hopped = advanceHorsemaster(partial, IDLE, 20).state;
        expect(hopped.player.jump).toBeNull();
        expect(hopped.player.x).toBe(horsemasterColumnX(8));
        expect(hopped.player.row).toBe(0);

        const atLeftEdge = placeOnRow(start, 0, 0);
        const clamped = advanceHorsemaster(atLeftEdge, LEFT, HORSEMASTER_GRID_HOP_MS);
        expect(clamped.state.player.x).toBe(horsemasterColumnX(0));
        expect(clamped.events).toHaveLength(0);

        const onMedian = parkBikes(placeOnRow(start, 6, 7), 4);
        const droppedDown = advanceHorsemaster(onMedian, DOWN, HORSEMASTER_GRID_HOP_MS).state;
        expect(droppedDown.player.row).toBe(5);
        const atStart = advanceHorsemaster(start, DOWN, HORSEMASTER_GRID_HOP_MS);
        expect(atStart.state.player.row).toBe(0);
        expect(atStart.events).toHaveLength(0);

        const both = advanceHorsemaster(
            parkBikes(start, 0),
            {horizontal: 1, vertical: 1},
            HORSEMASTER_GRID_HOP_MS
        ).state;
        expect(both.player.row).toBe(1);
        expect(both.player.x).toBe(horsemasterColumnX(7));
    });

    it('steps between bus slots but not off a car', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(41));
        const bus = laneOfTier(course, 'green').vehicles[0]!;
        let riding = setVehicleCenter(createHorsemasterState(course), bus.id, 336);
        riding = placeOnRide(riding, bus.id, 0);

        const stepped = advanceHorsemaster(riding, RIGHT, HORSEMASTER_FIXED_STEP_MS);
        const busState = stepped.state.vehicles.find(candidate => candidate.id === bus.id)!;
        expect(stepped.state.player.ride).toEqual({vehicleId: bus.id, slotIndex: 1});
        expect(stepped.state.player.x).toBeCloseTo(busState.x + 24, 8);
        expect(stepped.events).toContainEqual({kind: 'aligned', direction: 1});

        const blocked = advanceHorsemaster(stepped.state, RIGHT, HORSEMASTER_FIXED_STEP_MS);
        expect(blocked.state.player.ride).toEqual({vehicleId: bus.id, slotIndex: 1});
        expect(blocked.events).toHaveLength(0);

        const car = laneOfTier(course, 'yellow').vehicles[0]!;
        let carRide = setVehicleCenter(createHorsemasterState(course), car.id, 336);
        carRide = placeOnRide(carRide, car.id, 0);
        const carBlocked = advanceHorsemaster(carRide, RIGHT, HORSEMASTER_FIXED_STEP_MS);
        expect(carBlocked.state.player.ride).toEqual({vehicleId: car.id, slotIndex: 0});
        expect(carBlocked.events).toHaveLength(0);
    });

    it('lands only when a machine slot is under hoof and snaps to its center', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(78));
        const vehicle = course.vehicleLanes[0]!.vehicles[0]!;
        const slot = vehicle.slots[0]!;
        let arranged = placeOnRow(createHorsemasterState(course), 6, 7);
        arranged = arrangeSlotLanding(arranged, vehicle.id, slot.index, 360);
        const landed = advanceHorsemaster(arranged, UP, HORSEMASTER_HOP_DURATION_MS);
        const carrier = landed.state.vehicles.find(candidate => candidate.id === vehicle.id)!;

        expect(landed.state.player.row).toBe(7);
        expect(landed.state.player.ride)
            .toEqual({vehicleId: vehicle.id, slotIndex: slot.index});
        expect(landed.state.player.x).toBeCloseTo(carrier.x + slot.offsetX, 6);
        expect(Math.abs(landed.state.player.x - 360))
            .toBeLessThanOrEqual(HORSEMASTER_LANDING_TOLERANCE + 1);
        expect(landed.state.player.lives).toBe(course.startingLives);
        expect(landed.events).toContainEqual({
            kind: 'landed',
            row: 7,
            vehicleId: vehicle.id,
            slotIndex: slot.index
        });

        const missed = advanceHorsemaster(
            arrangeMiss(createHorsemasterState(course)),
            UP,
            HORSEMASTER_HOP_DURATION_MS
        );
        expect(missed.state.player.row).toBe(0);
        expect(missed.state.player.ride).toBeNull();
        expect(missed.state.player.x).toBe(course.start.x);
        expect(missed.state.player.lives).toBe(course.startingLives - 1);
        expect(missed.state.player.recoveryMs).toBe(HORSEMASTER_RECOVERY_MS);
        expect(missed.events.map(event => event.kind))
            .toEqual(expect.arrayContaining(['road-impact', 'reset']));
    });

    it('lands mid-truck and settles the horse onto the nearest machine', () => {
        // Find a course whose first vehicle lane is a two-slot green flatbed.
        let course = createHorsemasterCourse(new Mulberry32Random(1));
        for (let seed = 2; course.vehicleLanes[0]!.tier !== 'green'; seed++) {
            course = createHorsemasterCourse(new Mulberry32Random(seed));
        }
        const vehicle = course.vehicleLanes[0]!.vehicles[0]!;
        let arranged = placeOnRow(createHorsemasterState(course), 6, 7);
        course.vehicleLanes[0]!.vehicles
            .filter(candidate => candidate.id !== vehicle.id)
            .forEach((candidate, index) => {
                arranged = setVehicleCenter(arranged, candidate.id, 40 + index * 560);
            });
        // Slot 0 sits at -24, so this puts the truck's center exactly under
        // the horse at landing — 24px from either machine, far beyond the
        // old 12px per-slot tolerance.
        arranged = arrangeSlotLanding(arranged, vehicle.id, 0, 360 - 24);
        const landed = advanceHorsemaster(arranged, UP, HORSEMASTER_HOP_DURATION_MS);
        const carrier = landed.state.vehicles.find(
            candidate => candidate.id === vehicle.id
        )!;
        const ride = landed.state.player.ride;

        expect(landed.state.player.lives).toBe(course.startingLives);
        expect(landed.state.player.row).toBe(7);
        expect(ride?.vehicleId).toBe(vehicle.id);
        expect([0, 1]).toContain(ride?.slotIndex);
        expect(landed.state.player.x).toBeCloseTo(
            carrier.x + vehicle.slots[ride!.slotIndex]!.offsetX,
            6
        );
    });

    it('accepts landings overlapping 80% of the truck, cab included, and rejects less', () => {
        // Find a course whose first vehicle lane is single-slot (yellow).
        let course = createHorsemasterCourse(new Mulberry32Random(1));
        for (let seed = 2; course.vehicleLanes[0]!.tier === 'green'; seed++) {
            course = createHorsemasterCourse(new Mulberry32Random(seed));
        }
        const lane = course.vehicleLanes[0]!;
        const vehicle = lane.vehicles[0]!;
        const direction = lane.direction;
        const parkOthers = (state: HorsemasterState): HorsemasterState => {
            let next = state;
            const positions = [40, 140, 600];
            lane.vehicles
                .filter(candidate => candidate.id !== vehicle.id)
                .forEach((candidate, index) => {
                    next = setVehicleCenter(
                        next,
                        candidate.id,
                        positions[index % positions.length]!
                    );
                });
            return next;
        };
        const jumpWithTruckAt = (centerOffset: number) => {
            let state = parkOthers(placeOnRow(createHorsemasterState(course), 6, 7));
            state = arrangeSlotLanding(state, vehicle.id, 0, 360 + centerOffset);
            return advanceHorsemaster(state, UP, HORSEMASTER_HOP_DURATION_MS).state;
        };

        // 28px behind the bed center: 80%+ of the horse still overlaps the bed.
        const bedLanding = jumpWithTruckAt(direction * 28);
        expect(bedLanding.player.lives).toBe(course.startingLives);
        expect(bedLanding.player.ride?.vehicleId).toBe(vehicle.id);

        // 45px onto the leading side: the driver's cab counts as the truck too.
        const cabLanding = jumpWithTruckAt(-direction * 45);
        expect(cabLanding.player.lives).toBe(course.startingLives);
        expect(cabLanding.player.ride?.vehicleId).toBe(vehicle.id);

        // 34px behind the bed leaves less than 80% of the horse aboard.
        const missed = jumpWithTruckAt(direction * 34);
        expect(missed.player.lives).toBe(course.startingLives - 1);
        expect(missed.player.ride).toBeNull();
        expect(missed.player.row).toBe(0);
    });

    it('prevents another hop during recovery and fails after the final heart', () => {
        const course = createHorsemasterCourse(
            new Mulberry32Random(83),
            {startingLives: 2}
        );
        let state = advanceHorsemaster(
            arrangeMiss(createHorsemasterState(course)),
            UP,
            HORSEMASTER_HOP_DURATION_MS
        ).state;

        const protectedState = advanceHorsemaster(state, UP, 400).state;
        expect(protectedState.player.jump).toBeNull();
        expect(protectedState.player.lives).toBe(1);
        expect(protectedState.status).toBe('active');

        state = advanceHorsemaster(protectedState, IDLE, 500).state;
        expect(state.player.recoveryMs).toBe(0);
        const finalMiss = advanceHorsemaster(
            arrangeMiss(state),
            UP,
            HORSEMASTER_HOP_DURATION_MS
        );

        expect(finalMiss.state.status).toBe('failure');
        expect(finalMiss.state.player.lives).toBe(0);
        expect(finalMiss.events.at(-1)).toEqual({kind: 'failure'});
    });

    it('hits the horse only when a bicycle is close and never mid-hop', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(64));
        const bike = course.bikeLanes[0]!.bicycles[0]!;
        let onLane = placeOnRow(createHorsemasterState(course), 1, 7);
        onLane = parkBikes(parkBikes(onLane, 0), 1);
        const playerX = horsemasterColumnX(7);

        const nearMiss = setBicycleCenter(
            onLane,
            bike.id,
            playerX + HORSEMASTER_BIKE_HIT_TOLERANCE + 4
        );
        const safe = advanceHorsemaster(nearMiss, IDLE, HORSEMASTER_FIXED_STEP_MS);
        expect(safe.state.player.lives).toBe(course.startingLives);

        const hit = setBicycleCenter(onLane, bike.id, playerX + 20);
        const struck = advanceHorsemaster(hit, IDLE, HORSEMASTER_FIXED_STEP_MS);
        expect(struck.state.player.lives).toBe(course.startingLives - 1);
        expect(struck.state.player.row).toBe(0);
        expect(struck.state.player.x).toBe(course.start.x);
        expect(struck.state.player.recoveryMs).toBe(HORSEMASTER_RECOVERY_MS);
        expect(struck.events.map(event => event.kind))
            .toEqual(expect.arrayContaining(['bicycle-hit', 'reset']));

        const swept = setBicycleCenter(onLane, bike.id, playerX + 10);
        const hopped = advanceHorsemaster(swept, UP, HORSEMASTER_GRID_HOP_MS).state;
        expect(hopped.player.lives).toBe(course.startingLives);
        expect(hopped.player.row).toBe(2);
    });

    it('loses a heart when a ride carries the horse past the playfield edge', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(90));
        const lane = course.vehicleLanes[0]!;
        const vehicle = lane.vehicles[0]!;
        const slot = vehicle.slots[0]!;
        const nearEdgeX = lane.direction === 1
            ? HORSEMASTER_WORLD_WIDTH + HORSEMASTER_EDGE_DEATH_MARGIN - 0.5
            : -HORSEMASTER_EDGE_DEATH_MARGIN + 0.5;
        let state = setVehicleCenter(
            createHorsemasterState(course),
            vehicle.id,
            nearEdgeX - slot.offsetX
        );
        state = placeOnRide(state, vehicle.id, slot.index);

        const result = advanceHorsemaster(state, IDLE, HORSEMASTER_FIXED_STEP_MS);
        expect(result.state.player.lives).toBe(course.startingLives - 1);
        expect(result.state.player.ride).toBeNull();
        expect(result.state.player.row).toBe(0);
        expect(result.state.player.x).toBe(course.start.x);
        expect(result.events.map(event => event.kind))
            .toEqual(expect.arrayContaining(['carried-off-edge', 'reset']));

        const snapshot = getHorsemasterRenderSnapshot(result.state);
        expect(snapshot.player.x).toBe(course.start.x);
    });

    it('finishes only through the gym door on the goal row', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(144));
        const lane = course.vehicleLanes[4]!;
        const vehicle = lane.vehicles[0]!;
        const slot = vehicle.slots[0]!;
        const gym = course.buildings[course.gymIndex]!;
        const jumpFrom = (takeoffX: number) => {
            // Traffic advances before the press applies, so the takeoff x is
            // the carried position after one further step.
            const vehicleCenter = takeoffX -
                slot.offsetX -
                lane.direction * lane.speed * (HORSEMASTER_FIXED_STEP_MS / 1_000);
            let state = setVehicleCenter(
                createHorsemasterState(course),
                vehicle.id,
                vehicleCenter
            );
            state = placeOnRide(state, vehicle.id, slot.index);
            return advanceHorsemaster(state, UP, 20 + HORSEMASTER_HOP_DURATION_MS);
        };

        const throughDoor = jumpFrom(gym.centerX + gym.doorHalfWidth - 1);
        expect(throughDoor.state.status).toBe('success');
        expect(throughDoor.state.player.row).toBe(12);
        expect(throughDoor.state.player.x).toBe(gym.centerX);
        expect(throughDoor.state.player.y).toBe(course.goalY);
        expect(throughDoor.events.at(-1)).toEqual({kind: 'success'});

        const missedDoor = jumpFrom(gym.centerX + gym.doorHalfWidth + 2);
        expect(missedDoor.state.status).toBe('active');
        expect(missedDoor.state.player.lives).toBe(course.startingLives - 1);
        expect(missedDoor.events.map(event => event.kind)).toContain('wrong-building');

        const decoy = course.buildings.find(building => !building.isGym)!;
        const wrongBuilding = jumpFrom(decoy.centerX);
        expect(wrongBuilding.state.status).toBe('active');
        expect(wrongBuilding.state.player.lives).toBe(course.startingLives - 1);
        expect(wrongBuilding.events.map(event => event.kind)).toContain('wrong-building');
    });
});

describe('Horsemaster deterministic stepping and rendering', () => {
    it('produces identical states under different frame schedules', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(9001));
        const initial = createHorsemasterState(course);
        const single = advanceHorsemaster(initial, IDLE, 2_713).state;
        const scheduled = advanceInSchedule(initial, 2_713, [7, 13, 41, 79, 3, 117]);

        expect(scheduled).toEqual(single);
        expect(single.activeTicks).toBe(Math.floor(2_713 / HORSEMASTER_FIXED_STEP_MS));
        expect(single.accumulatorMs).toBe(13);
    });

    it('buffers a hop press until the first fixed step', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(511));
        const vehicle = course.vehicleLanes[0]!.vehicles[0]!;
        let initial = placeOnRow(createHorsemasterState(course), 6, 7);
        initial = arrangeSlotLanding(initial, vehicle.id, 0, 360);
        const single = advanceHorsemaster(initial, UP, HORSEMASTER_HOP_DURATION_MS).state;
        const scheduled = advanceInSchedule(
            initial,
            HORSEMASTER_HOP_DURATION_MS,
            [7, 11, 3, 49],
            UP
        );

        expect(scheduled).toEqual(single);
        expect(single.player.ride?.vehicleId).toBe(vehicle.id);
    });

    it('exposes fixed-step interpolation without sweeping across a traffic wrap', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(20));
        const vehicle = course.vehicleLanes
            .flatMap(lane => lane.vehicles)
            .find(candidate => candidate.direction === 1)!;
        const initial = setVehicleCenter(
            createHorsemasterState(course),
            vehicle.id,
            HORSEMASTER_TRAFFIC_MAX_X - 0.2
        );
        const state = advanceHorsemaster(
            initial,
            IDLE,
            HORSEMASTER_FIXED_STEP_MS + HORSEMASTER_FIXED_STEP_MS / 2
        ).state;
        const snapshot = getHorsemasterRenderSnapshot(state);
        const rendered = snapshot.vehicles.find(candidate => candidate.id === vehicle.id)!;

        expect(snapshot.interpolation).toBe(0.5);
        expect(rendered.x < HORSEMASTER_TRAFFIC_MIN_X + 5 ||
            rendered.x > HORSEMASTER_TRAFFIC_MAX_X - 5).toBe(true);
        expect(snapshot.bicycles).toHaveLength(15);
        expect(snapshot.player.lives).toBe(course.startingLives);
    });

    it('normalizes traffic across arbitrarily large positive and negative distances', () => {
        for (const x of [-20_000, -1_000, -96, 0, 768, 1_000, 20_000]) {
            const wrapped = wrapHorsemasterTrafficX(x);
            expect(wrapped).toBeGreaterThanOrEqual(HORSEMASTER_TRAFFIC_MIN_X);
            expect(wrapped).toBeLessThan(HORSEMASTER_TRAFFIC_MAX_X);
        }
    });

    it('rejects invalid frame deltas', () => {
        const state = createHorsemasterState(
            createHorsemasterCourse(new Mulberry32Random(1))
        );
        expect(() => advanceHorsemaster(state, IDLE, -1)).toThrow(/delta/i);
        expect(() => advanceHorsemaster(state, IDLE, Number.NaN)).toThrow(/delta/i);
    });
});
