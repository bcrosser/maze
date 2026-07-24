import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    HORSEMASTER_FIXED_STEP_MS,
    HORSEMASTER_HOP_DURATION_MS,
    HORSEMASTER_RECOVERY_MS,
    HORSEMASTER_TRAFFIC_MAX_X,
    HORSEMASTER_TRAFFIC_MIN_X,
    advanceHorsemaster,
    canonicalHorsemasterCourseSignature,
    createHorsemasterCourse,
    createHorsemasterState,
    getHorsemasterRenderSnapshot,
    hasHorsemasterWaitTimingRoute,
    validateHorsemasterCourse,
    wrapHorsemasterTrafficX,
    type HorsemasterCourse,
    type HorsemasterInput,
    type HorsemasterState,
    type HorsemasterVehicleDefinition
} from '../../../src/minigames/horsemaster/horsemaster-model';

const IDLE: HorsemasterInput = {
    horizontal: 0,
    forwardPressed: false
};

function definition(
    course: HorsemasterCourse,
    id: string
): HorsemasterVehicleDefinition {
    const result = course.lanes
        .flatMap(lane => lane.vehicles)
        .find(vehicle => vehicle.id === id);
    if (result === undefined) throw new Error(`Missing test vehicle ${id}.`);
    return result;
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

function arrangeLanding(
    state: HorsemasterState,
    laneIndex: number,
    platformId: string,
    landingX: number
): HorsemasterState {
    const platform = definition(state.course, platformId);
    const initialX = landingX -
        platform.direction *
        platform.speed *
        (HORSEMASTER_HOP_DURATION_MS / 1_000);
    const withVehicle = setVehicleCenter(state, platformId, initialX);
    return {
        ...withVehicle,
        player: {
            ...withVehicle.player,
            previousX: landingX,
            x: landingX,
            previousY: laneIndex < 0
                ? withVehicle.course.start.y
                : withVehicle.course.lanes[laneIndex]!.y,
            y: laneIndex < 0
                ? withVehicle.course.start.y
                : withVehicle.course.lanes[laneIndex]!.y,
            laneIndex,
            platformId: laneIndex < 0 ? null : withVehicle.player.platformId,
            platformOffsetX: 0,
            jump: null
        }
    };
}

function arrangeMiss(state: HorsemasterState): HorsemasterState {
    const targetLaneIndex = state.player.laneIndex + 1;
    const targetLane = state.course.lanes[targetLaneIndex];
    if (targetLane === undefined) throw new Error('Cannot arrange a miss at the gym.');
    const landingCenters = [250, 420, 590];
    const vehicles = state.vehicles.map(vehicle => {
        const index = targetLane.vehicles.findIndex(candidate => candidate.id === vehicle.id);
        if (index < 0) return vehicle;
        const candidate = targetLane.vehicles[index]!;
        const landingCenter = landingCenters[index]!;
        const x = landingCenter -
            candidate.direction *
            candidate.speed *
            (HORSEMASTER_HOP_DURATION_MS / 1_000);
        return {...vehicle, previousX: x, x};
    });
    return {
        ...state,
        vehicles,
        player: {
            ...state.player,
            previousX: 40,
            x: 40,
            jump: null
        }
    };
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

function solveByWaitingForLandingWindows(initial: HorsemasterState): HorsemasterState {
    let state = initial;
    for (let targetLaneIndex = 0; targetLaneIndex <= state.course.lanes.length; targetLaneIndex++) {
        let landed = false;
        for (let waitStep = 0; waitStep < 650; waitStep++) {
            const attempt = advanceHorsemaster(
                state,
                {horizontal: 0, forwardPressed: true},
                HORSEMASTER_HOP_DURATION_MS
            ).state;
            if (
                attempt.status === 'success' ||
                attempt.player.laneIndex === targetLaneIndex
            ) {
                state = attempt;
                landed = true;
                break;
            }
            state = advanceHorsemaster(state, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
        }
        if (!landed) return state;
        if (state.status === 'success') return state;
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
            expect(course.lanes.length).toBeGreaterThanOrEqual(6);
            expect(course.lanes.length).toBeLessThanOrEqual(8);
            expect(validateHorsemasterCourse(course)).toEqual({valid: true, errors: []});
            expect(hasHorsemasterWaitTimingRoute(course)).toBe(true);
            signatures.add(canonicalHorsemasterCourseSignature(course));
        }

        expect(signatures.size).toBeGreaterThanOrEqual(155);
    });

    it('can actually complete varied courses by waiting for safe landing windows', () => {
        for (let seed = 0; seed < 24; seed++) {
            const course = createHorsemasterCourse(
                new Mulberry32Random(seed * 1_009 + 17)
            );
            const solved = solveByWaitingForLandingWindows(
                createHorsemasterState(course)
            );

            expect(solved.status, `seed ${seed}`).toBe('success');
            expect(solved.player.lives, `seed ${seed}`).toBe(course.startingLives);
        }
    });

    it('puts an easy slow/wide and hard fast/narrow machine in every lane', () => {
        for (let seed = 0; seed < 120; seed++) {
            const course = createHorsemasterCourse(new Mulberry32Random(seed * 97 + 3));
            for (const lane of course.lanes) {
                const easy = lane.vehicles.find(vehicle => vehicle.opportunity === 'easy');
                const hard = lane.vehicles.find(vehicle => vehicle.opportunity === 'hard');

                expect(easy).toBeDefined();
                expect(easy!.speed).toBeGreaterThanOrEqual(42);
                expect(easy!.speed).toBeLessThanOrEqual(61);
                expect(easy!.machineWidth).toBeGreaterThanOrEqual(112);
                expect(hard).toBeDefined();
                expect(hard!.speed).toBeGreaterThanOrEqual(110);
                expect(hard!.speed).toBeLessThanOrEqual(150);
                expect(hard!.machineWidth).toBeGreaterThanOrEqual(52);
                expect(hard!.machineWidth).toBeLessThanOrEqual(68);
            }
        }
    });

    it('alternates traffic so every adjacent-lane relative speed is non-zero', () => {
        const course = createHorsemasterCourse(
            new Mulberry32Random(43),
            {laneCount: 8}
        );

        expect(course.lanes).toHaveLength(8);
        for (let index = 1; index < course.lanes.length; index++) {
            expect(course.lanes[index]!.direction)
                .toBe(-course.lanes[index - 1]!.direction);
        }
    });

    it('rejects malformed generation settings and detects a broken route invariant', () => {
        expect(() => createHorsemasterCourse(
            new Mulberry32Random(1),
            {laneCount: 5}
        )).toThrow(/six through 8|6 through 8|6 through 8/i);
        expect(() => createHorsemasterCourse(
            new Mulberry32Random(1),
            {startingLives: 0}
        )).toThrow(/starting lives/i);

        const course = createHorsemasterCourse(
            new Mulberry32Random(1),
            {laneCount: 6}
        );
        const broken: HorsemasterCourse = {
            ...course,
            lanes: course.lanes.map((lane, index) =>
                index === 1
                    ? {
                        ...lane,
                        direction: course.lanes[0]!.direction,
                        vehicles: lane.vehicles.map(vehicle => ({
                            ...vehicle,
                            direction: course.lanes[0]!.direction
                        }))
                    }
                    : lane
            )
        };

        expect(hasHorsemasterWaitTimingRoute(broken)).toBe(false);
        expect(validateHorsemasterCourse(broken).valid).toBe(false);
    });
});

describe('Horsemaster traffic and movement', () => {
    it('wraps cars and carries a horse with its exercise machine', () => {
        const course = createHorsemasterCourse(
            new Mulberry32Random(12),
            {laneCount: 6}
        );
        const platform = course.lanes[0]!.vehicles[0]!;
        const edgeX = platform.direction === 1
            ? HORSEMASTER_TRAFFIC_MAX_X - 0.5
            : HORSEMASTER_TRAFFIC_MIN_X + 0.5;
        let state = setVehicleCenter(createHorsemasterState(course), platform.id, edgeX);
        state = {
            ...state,
            player: {
                ...state.player,
                previousX: edgeX + 9,
                x: edgeX + 9,
                previousY: course.lanes[0]!.y,
                y: course.lanes[0]!.y,
                laneIndex: 0,
                platformId: platform.id,
                platformOffsetX: 9
            }
        };

        const next = advanceHorsemaster(state, IDLE, HORSEMASTER_FIXED_STEP_MS).state;
        const movedPlatform = next.vehicles.find(vehicle => vehicle.id === platform.id)!;

        if (platform.direction === 1) {
            expect(movedPlatform.x).toBeLessThan(HORSEMASTER_TRAFFIC_MIN_X + 5);
        }
        else {
            expect(movedPlatform.x).toBeGreaterThan(HORSEMASTER_TRAFFIC_MAX_X - 5);
        }
        expect(next.player.x).toBeCloseTo(movedPlatform.x + 9, 8);
        expect(next.player.platformId).toBe(platform.id);
    });

    it('aligns on the roadside and clamps alignment to a machine top', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(29));
        const roadside = createHorsemasterState(course);
        const aligned = advanceHorsemaster(
            roadside,
            {horizontal: 1, forwardPressed: false},
            HORSEMASTER_FIXED_STEP_MS
        );
        expect(aligned.state.player.x).toBe(roadside.player.x + 34);
        expect(aligned.events).toContainEqual({kind: 'aligned', direction: 1});

        const platform = course.lanes[0]!.vehicles.find(
            vehicle => vehicle.opportunity === 'hard'
        )!;
        const maximumOffset =
            platform.machineWidth / 2 -
            13 -
            3;
        let riding = setVehicleCenter(roadside, platform.id, 336);
        riding = {
            ...riding,
            player: {
                ...riding.player,
                previousX: 336,
                x: 336,
                previousY: course.lanes[0]!.y,
                y: course.lanes[0]!.y,
                laneIndex: 0,
                platformId: platform.id,
                platformOffsetX: 0
            }
        };
        for (let press = 0; press < 4; press++) {
            riding = advanceHorsemaster(
                riding,
                {horizontal: 1, forwardPressed: false},
                HORSEMASTER_FIXED_STEP_MS
            ).state;
        }

        expect(riding.player.platformOffsetX).toBeCloseTo(maximumOffset, 8);
        expect(riding.player.platformId).toBe(platform.id);
    });

    it('lands only when the horse is over an exercise machine', () => {
        const course = createHorsemasterCourse(
            new Mulberry32Random(78),
            {laneCount: 6}
        );
        const platform = course.lanes[0]!.vehicles.find(
            vehicle => vehicle.opportunity === 'easy'
        )!;
        const arranged = arrangeLanding(
            createHorsemasterState(course),
            -1,
            platform.id,
            336
        );
        const landed = advanceHorsemaster(
            arranged,
            {horizontal: 0, forwardPressed: true},
            HORSEMASTER_HOP_DURATION_MS
        );

        expect(landed.state.player.laneIndex).toBe(0);
        expect(landed.state.player.platformId).toBe(platform.id);
        expect(landed.state.player.lives).toBe(course.startingLives);
        expect(landed.events).toContainEqual({
            kind: 'landed',
            laneIndex: 0,
            platformId: platform.id
        });

        const missed = advanceHorsemaster(
            arrangeMiss(createHorsemasterState(course)),
            {horizontal: 0, forwardPressed: true},
            HORSEMASTER_HOP_DURATION_MS
        );
        expect(missed.state.player.laneIndex).toBe(-1);
        expect(missed.state.player.platformId).toBeNull();
        expect(missed.state.player.lives).toBe(course.startingLives - 1);
        expect(missed.state.player.recoveryMs).toBe(HORSEMASTER_RECOVERY_MS);
        expect(missed.events.map(event => event.kind))
            .toEqual(expect.arrayContaining(['road-impact', 'reset']));
    });

    it('prevents another jump during recovery and fails after the final heart', () => {
        const course = createHorsemasterCourse(
            new Mulberry32Random(83),
            {laneCount: 6, startingLives: 2}
        );
        let state = advanceHorsemaster(
            arrangeMiss(createHorsemasterState(course)),
            {horizontal: 0, forwardPressed: true},
            HORSEMASTER_HOP_DURATION_MS
        ).state;

        const protectedState = advanceHorsemaster(
            state,
            {horizontal: 0, forwardPressed: true},
            400
        ).state;
        expect(protectedState.player.jump).toBeNull();
        expect(protectedState.player.lives).toBe(1);
        expect(protectedState.status).toBe('active');

        state = advanceHorsemaster(protectedState, IDLE, 500).state;
        expect(state.player.recoveryMs).toBe(0);
        const finalMiss = advanceHorsemaster(
            arrangeMiss(state),
            {horizontal: 0, forwardPressed: true},
            HORSEMASTER_HOP_DURATION_MS
        );

        expect(finalMiss.state.status).toBe('failure');
        expect(finalMiss.state.player.lives).toBe(0);
        expect(finalMiss.events.at(-1)).toEqual({kind: 'failure'});
    });

    it('reaches the Ultra Horse Gym after the last traffic lane', () => {
        const course = createHorsemasterCourse(
            new Mulberry32Random(144),
            {laneCount: 7}
        );
        const lastLane = course.lanes.at(-1)!;
        const platform = lastLane.vehicles[0]!;
        let state = setVehicleCenter(createHorsemasterState(course), platform.id, 336);
        state = {
            ...state,
            player: {
                ...state.player,
                previousX: 336,
                x: 336,
                previousY: lastLane.y,
                y: lastLane.y,
                laneIndex: lastLane.index,
                platformId: platform.id,
                platformOffsetX: 0
            }
        };

        const result = advanceHorsemaster(
            state,
            {horizontal: 0, forwardPressed: true},
            HORSEMASTER_HOP_DURATION_MS
        );

        expect(result.state.status).toBe('success');
        expect(result.state.player.laneIndex).toBe(course.lanes.length);
        expect(result.state.player.x).toBe(course.gym.x);
        expect(result.state.player.y).toBe(course.gym.y);
        expect(result.events.at(-1)).toEqual({kind: 'success'});
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

    it('buffers a forward press until the first fixed step', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(511));
        const platform = course.lanes[0]!.vehicles.find(
            vehicle => vehicle.opportunity === 'easy'
        )!;
        const initial = arrangeLanding(
            createHorsemasterState(course),
            -1,
            platform.id,
            336
        );
        const single = advanceHorsemaster(
            initial,
            {horizontal: 0, forwardPressed: true},
            HORSEMASTER_HOP_DURATION_MS
        ).state;
        const scheduled = advanceInSchedule(
            initial,
            HORSEMASTER_HOP_DURATION_MS,
            [7, 11, 3, 49],
            {horizontal: 0, forwardPressed: true}
        );

        expect(scheduled).toEqual(single);
        expect(single.player.platformId).toBe(platform.id);
    });

    it('exposes fixed-step interpolation without sweeping across a traffic wrap', () => {
        const course = createHorsemasterCourse(new Mulberry32Random(20));
        const platform = course.lanes[0]!.vehicles.find(
            vehicle => vehicle.direction === 1
        ) ?? course.lanes[1]!.vehicles.find(vehicle => vehicle.direction === 1)!;
        const initial = setVehicleCenter(
            createHorsemasterState(course),
            platform.id,
            HORSEMASTER_TRAFFIC_MAX_X - 0.2
        );
        const state = advanceHorsemaster(
            initial,
            IDLE,
            HORSEMASTER_FIXED_STEP_MS + HORSEMASTER_FIXED_STEP_MS / 2
        ).state;
        const snapshot = getHorsemasterRenderSnapshot(state);
        const rendered = snapshot.vehicles.find(vehicle => vehicle.id === platform.id)!;

        expect(snapshot.interpolation).toBe(0.5);
        expect(rendered.x < HORSEMASTER_TRAFFIC_MIN_X + 5 ||
            rendered.x > HORSEMASTER_TRAFFIC_MAX_X - 5).toBe(true);
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
