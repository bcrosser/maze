import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    CASINO_HEIST_BASE_HEALTH,
    CASINO_HEIST_DRAIN_HALF_WIDTH,
    CASINO_HEIST_FIXED_STEP_MS,
    CASINO_HEIST_MAX_AMMO,
    CASINO_HEIST_PLAYER_MAX_SCREEN_Y,
    CASINO_HEIST_PLAYER_MIN_SCREEN_Y,
    CASINO_HEIST_PLAYER_SCREEN_Y,
    CASINO_HEIST_LANES,
    CASINO_HEIST_LANE_WIDTH,
    CASINO_HEIST_MAX_ROAD_WIDTH,
    CASINO_HEIST_MIN_ROAD_WIDTH,
    CASINO_HEIST_PLAYER_SPEED,
    CASINO_HEIST_REWARD_CREDITS,
    CASINO_HEIST_ROAD_WIDTH,
    NEUTRAL_CASINO_HEIST_INPUT,
    advanceCasinoHeist,
    casinoHeistLaneX,
    canonicalCasinoHeistCourseSignature,
    chooseCasinoHeistWitnessInput,
    createCasinoHeistCourse,
    createCasinoHeistState,
    getCasinoHeistDrainX,
    getCasinoHeistRenderSnapshot,
    getCasinoHeistRoadGeometry,
    hasCasinoHeistDrivableCorridor,
    hasCasinoHeistSafeRoute,
    setCasinoHeistPaused,
    stepCasinoHeist,
    validateCasinoHeistCourse,
    withoutCasinoHeistPursuit,
    type CasinoHeistCourse,
    type CasinoHeistDeviceKind,
    type CasinoHeistInput,
    type CasinoHeistPursuerDefinition,
    type CasinoHeistState,
    type CasinoHeistTrafficKind
} from '../../../src/minigames/heist/casino-heist-model';

function course(seed = 7, segmentCount = 10): CasinoHeistCourse {
    return createCasinoHeistCourse(new Mulberry32Random(seed), {segmentCount});
}

function input(overrides: Partial<CasinoHeistInput> = {}): CasinoHeistInput {
    return {...NEUTRAL_CASINO_HEIST_INPUT, ...overrides};
}

/** A bus abreast in every lane, which is the one thing the road may not do. */
function sealedBand(startDistance: number) {
    return CASINO_HEIST_LANES.map((lane, index) => ({
        id: `blocking-${index}`,
        kind: 'bus' as const,
        lane,
        distance: startDistance + 100,
        speed: 90,
        width: 56,
        length: 124,
        health: 2
    }));
}

function stepFor(
    initial: CasinoHeistState,
    ticks: number,
    control: CasinoHeistInput = NEUTRAL_CASINO_HEIST_INPUT
): {readonly state: CasinoHeistState; readonly events: readonly string[]} {
    let state = initial;
    const events: string[] = [];
    for (let tick = 0; tick < ticks && state.status === 'active'; tick++) {
        const result = stepCasinoHeist(state, control);
        state = result.state;
        events.push(...result.events.map(event => event.kind));
    }
    return {state, events};
}

/** Steps until one of the named events fires, and reports whether it did. */
function stepUntilEvent(
    initial: CasinoHeistState,
    control: CasinoHeistInput,
    eventKind: string,
    maximumTicks = 200
): {readonly state: CasinoHeistState; readonly fired: boolean} {
    let state = initial;
    for (let tick = 0; tick < maximumTicks && state.status === 'active'; tick++) {
        const result = stepCasinoHeist(state, control);
        state = result.state;
        if (result.events.some(event => event.kind === eventKind)) {
            return {state, fired: true};
        }
    }
    return {state, fired: false};
}

/** Places a single pursuer relative to the player for a focused interaction. */
function withPursuer(
    state: CasinoHeistState,
    definition: CasinoHeistPursuerDefinition,
    placement: {
        readonly x: number;
        readonly distance: number;
        readonly fireCooldownTicks?: number;
        readonly contactCooldownMs?: number;
    }
): CasinoHeistState {
    return {
        ...state,
        spawnedPursuerIds: [definition.id],
        pursuers: [{
            definitionId: definition.id,
            previousX: placement.x,
            x: placement.x,
            previousDistance: placement.distance,
            distance: placement.distance,
            health: definition.health,
            fireCooldownTicks: placement.fireCooldownTicks ?? 999,
            contactCooldownMs: placement.contactCooldownMs ?? 999,
            blindedMs: 0,
            spinOutMs: 0,
            wreckMs: 0,
            driftX: 0,
            spin: 0
        }]
    };
}

function courseWithPursuer(
    predicate: (pursuer: CasinoHeistPursuerDefinition) => boolean
): {readonly course: CasinoHeistCourse; readonly pursuer: CasinoHeistPursuerDefinition} {
    for (let seed = 0; seed < 60; seed++) {
        const escape = course(seed);
        const pursuer = escape.segments
            .flatMap(segment => segment.pursuers)
            .find(predicate);
        if (pursuer) return {course: escape, pursuer};
    }
    throw new Error('No generated escape offered the requested pursuer.');
}

describe('Casino Heist escape generation', () => {
    it('reproduces seeds and validates every generated escape', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 80; seed++) {
            const first = createCasinoHeistCourse(new Mulberry32Random(seed));
            const second = createCasinoHeistCourse(new Mulberry32Random(seed));

            expect(first).toEqual(second);
            expect(validateCasinoHeistCourse(first)).toEqual({valid: true, errors: []});
            expect(hasCasinoHeistSafeRoute(first)).toBe(true);
            signatures.add(canonicalCasinoHeistCourseSignature(first));
        }
        expect(signatures.size).toBeGreaterThanOrEqual(78);
    });

    it('runs away from the casino toward a marked turn-off and a storm drain', () => {
        const escape = course();

        expect(escape.generatorId).toBe('casino-heist-escape-v2');
        expect(escape.turnoffDistance).toBeLessThan(escape.drainDistance);
        expect(escape.drainDistance).toBeLessThan(escape.overshootDistance);
        const drainX = getCasinoHeistDrainX(escape);
        const geometry = getCasinoHeistRoadGeometry(escape, escape.drainDistance);
        expect(drainX).toBeGreaterThan(geometry.leftX);
        expect(drainX).toBeLessThan(geometry.rightX);
    });

    it('fills the road with ordinary traffic the getaway car can outrun', () => {
        for (let seed = 0; seed < 20; seed++) {
            const traffic = course(seed).segments.flatMap(segment => segment.traffic);
            expect(traffic.length).toBeGreaterThan(0);
            for (const vehicle of traffic) {
                expect(vehicle.speed).toBeLessThan(CASINO_HEIST_PLAYER_SPEED);
            }
        }
        const allKinds = new Set(
            Array.from({length: 40}, (_unused, seed) => course(seed))
                .flatMap(escape => escape.segments)
                .flatMap(segment => segment.traffic)
                .map(vehicle => vehicle.kind)
        );
        expect(allKinds).toEqual(new Set(['car', 'bus', 'truck', 'motorcycle']));
    });

    it('sends cop cars and swat vans that can actually catch the player', () => {
        const pursuers = Array.from({length: 40}, (_unused, seed) => course(seed))
            .flatMap(escape => escape.segments)
            .flatMap(segment => segment.pursuers);

        expect(pursuers.length).toBeGreaterThan(0);
        expect(new Set(pursuers.map(pursuer => pursuer.kind)))
            .toEqual(new Set(['cop-car', 'swat-van']));
        for (const pursuer of pursuers) {
            expect(pursuer.speed).toBeGreaterThan(CASINO_HEIST_PLAYER_SPEED);
        }
        const swat = pursuers.find(pursuer => pursuer.kind === 'swat-van')!;
        const cop = pursuers.find(pursuer => pursuer.kind === 'cop-car')!;
        expect(swat.health).toBeGreaterThan(cop.health);
    });

    it('divides the road around a median that tapers in and out of the tarmac', () => {
        let sawSplit = false;
        for (let seed = 0; seed < 40; seed++) {
            const escape = course(seed, 20);
            for (const split of escape.shape.splits) {
                sawSplit = true;
                // The median starts and ends flush with the road, and reaches its
                // full width somewhere in between.
                expect(
                    getCasinoHeistRoadGeometry(escape, split.startDistance).dividerHalfWidth
                ).toBe(0);
                expect(
                    getCasinoHeistRoadGeometry(escape, split.endDistance).dividerHalfWidth
                ).toBe(0);
                const middle = (split.startDistance + split.endDistance) / 2;
                const centre = getCasinoHeistRoadGeometry(escape, middle);
                expect(centre.dividerHalfWidth).toBeGreaterThan(0);
                expect(centre.split).toBe(true);
                // Both carriageways stay wide enough to drive down.
                expect(centre.width / 2).toBeGreaterThan(CASINO_HEIST_LANE_WIDTH * 2);
                // Medians never reach the run-in to the drain.
                expect(split.endDistance).toBeLessThan(escape.turnoffDistance);
            }
        }
        expect(sawSplit).toBe(true);
    });

    it('draws a road that turns and changes width without ever kinking', () => {
        for (let seed = 0; seed < 20; seed++) {
            const escape = course(seed, 20);
            const step = 8;
            const centres: number[] = [];
            const widths: number[] = [];
            for (let distance = 0; distance <= escape.overshootDistance; distance += step) {
                const geometry = getCasinoHeistRoadGeometry(escape, distance);
                centres.push(geometry.centerX);
                widths.push(geometry.width);
                expect(geometry.leftX).toBeGreaterThanOrEqual(0);
                expect(geometry.rightX).toBeLessThanOrEqual(escape.width);
            }
            // A kink is a jump in slope. Bounding the change of slope between
            // samples is what rules the old per-segment corners out.
            let maximumSlopeChange = 0;
            for (let index = 2; index < centres.length; index++) {
                const before = (centres[index - 1]! - centres[index - 2]!) / step;
                const after = (centres[index]! - centres[index - 1]!) / step;
                maximumSlopeChange = Math.max(maximumSlopeChange, Math.abs(after - before));
            }
            // The old per-segment road jumped by around 0.4 here.
            expect(maximumSlopeChange).toBeLessThan(0.05);
            // The road really does turn, and really does breathe.
            expect(Math.max(...centres) - Math.min(...centres)).toBeGreaterThan(60);
            expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(60);
            expect(Math.min(...widths)).toBeGreaterThanOrEqual(CASINO_HEIST_MIN_ROAD_WIDTH - 1);
            expect(Math.max(...widths)).toBeLessThanOrEqual(CASINO_HEIST_MAX_ROAD_WIDTH + 1);
        }
    });

    it('lays out six lanes the default road can take side by side', () => {
        expect(CASINO_HEIST_LANES).toHaveLength(6);
        expect(CASINO_HEIST_ROAD_WIDTH).toBe(CASINO_HEIST_LANE_WIDTH * 6);
        const escape = course();
        // Sample the narrowest road this course reaches and check every lane
        // still holds a bus without leaving the tarmac.
        let narrowest = getCasinoHeistRoadGeometry(escape, 0);
        for (let distance = 0; distance <= escape.overshootDistance; distance += 16) {
            const geometry = getCasinoHeistRoadGeometry(escape, distance);
            if (geometry.width < narrowest.width) narrowest = geometry;
        }
        const positions = CASINO_HEIST_LANES.map(lane =>
            casinoHeistLaneX(narrowest, lane, 28)
        );
        for (const position of positions) {
            expect(position).toBeGreaterThanOrEqual(narrowest.leftX);
            expect(position).toBeLessThanOrEqual(narrowest.rightX);
        }
        // Lanes stay in order across the road and never coincide.
        for (let index = 1; index < positions.length; index++) {
            expect(positions[index]!).toBeGreaterThan(positions[index - 1]!);
        }
    });

    it('never lets a dropped spike strip cover the whole road', () => {
        const helicopters = Array.from({length: 40}, (_unused, seed) => course(seed, 20))
            .flatMap(escape => escape.segments)
            .flatMap(segment => segment.helicopters);

        expect(helicopters.length).toBeGreaterThan(0);
        for (const helicopter of helicopters) {
            expect(helicopter.stripHalfWidth * 2).toBeLessThan(CASINO_HEIST_ROAD_WIDTH);
            expect(helicopter.health).toBeGreaterThanOrEqual(1);
        }
    });

    it('rejects a course whose traffic outruns the player', () => {
        const escape = course();
        const target = escape.segments.find(segment => segment.traffic.length > 0)!;
        const broken: CasinoHeistCourse = {
            ...escape,
            segments: escape.segments.map(segment =>
                segment === target
                    ? {
                        ...segment,
                        traffic: segment.traffic.map(vehicle => ({
                            ...vehicle,
                            speed: CASINO_HEIST_PLAYER_SPEED + 30
                        }))
                    }
                    : segment
            )
        };

        const result = validateCasinoHeistCourse(broken);
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(/not slower than the getaway car/);
    });

    it('rejects a course whose segments leave no drivable lane', () => {
        const escape = course();
        const target = escape.segments[3]!;
        const blocked: CasinoHeistCourse = {
            ...escape,
            segments: escape.segments.map(segment =>
                segment === target ? {...segment, traffic: sealedBand(segment.startDistance)} : segment
            )
        };

        expect(hasCasinoHeistSafeRoute(blocked)).toBe(false);
        expect(validateCasinoHeistCourse(blocked).valid).toBe(false);
    });

    it('rejects segment counts outside the supported range', () => {
        expect(() => createCasinoHeistCourse(new Mulberry32Random(1), {segmentCount: 7}))
            .toThrow(/8 through 40/);
        expect(() => createCasinoHeistCourse(new Mulberry32Random(1), {segmentCount: 41}))
            .toThrow(/8 through 40/);
    });
});

describe('Casino Heist driving', () => {
    it('moves up and down the screen as well as side to side', () => {
        const state = createCasinoHeistState(course());
        expect(state.player.screenY).toBe(CASINO_HEIST_PLAYER_SCREEN_Y);

        expect(stepFor(state, 60, input({vertical: 1})).state.player.screenY)
            .toBeLessThan(CASINO_HEIST_PLAYER_SCREEN_Y);
        expect(stepFor(state, 60, input({vertical: -1})).state.player.screenY)
            .toBeGreaterThan(CASINO_HEIST_PLAYER_SCREEN_Y);
        expect(stepFor(state, 30, input({steer: 1})).state.player.x)
            .toBeGreaterThan(state.player.x);
    });

    it('clamps the vertical band so the car cannot leave the screen', () => {
        const state = createCasinoHeistState(course());

        expect(stepFor(state, 600, input({vertical: 1})).state.player.screenY)
            .toBe(CASINO_HEIST_PLAYER_MIN_SCREEN_Y);
        expect(stepFor(state, 600, input({vertical: -1})).state.player.screenY)
            .toBe(CASINO_HEIST_PLAYER_MAX_SCREEN_Y);
    });

    it('closes on the road ahead faster when driven up the screen', () => {
        const state = createCasinoHeistState(course());
        const reach = (candidate: CasinoHeistState): number =>
            candidate.player.distance +
            (CASINO_HEIST_PLAYER_SCREEN_Y - candidate.player.screenY);

        expect(reach(stepFor(state, 90, input({vertical: 1})).state))
            .toBeGreaterThan(reach(stepFor(state, 90).state));
    });

    it('starts unarmed and needs a road pickup before it can fire', () => {
        const state = createCasinoHeistState(course());
        expect(state.player.weapon).toBe('none');
        expect(state.player.ammo).toBe(0);

        // Stop short of the first segment's weapon crate.
        const fired = stepFor(state, 8, input({fire: true}));
        expect(fired.events).not.toContain('player-fired');
        expect(fired.state.projectiles).toHaveLength(0);
    });

    it('starts with a fitted weapon and shop devices when the maze supplied them', () => {
        const equipped = createCasinoHeistCourse(new Mulberry32Random(11), {
            bonuses: {
                armor: 1,
                startAmmo: 8,
                installedDevices: ['oil-slick', 'flamethrower']
            }
        });
        const state = createCasinoHeistState(equipped);

        expect(state.player.weapon).toBe('pulse-cannon');
        expect(state.player.ammo).toBe(8);
        expect(state.player.maxHealth).toBe(CASINO_HEIST_BASE_HEALTH + 1);
        expect(state.player.devices['oil-slick']).toBeGreaterThan(0);
        expect(state.player.devices.flamethrower).toBeGreaterThan(0);
        expect(state.player.devices['smoke-screen']).toBe(0);
        expect(state.player.armedDevice).toBe('oil-slick');
    });

    it('keeps collected ammunition inside its cap', () => {
        const state = createCasinoHeistState(course());
        const stocked: CasinoHeistState = {
            ...state,
            player: {...state.player, weapon: 'pulse-cannon', ammo: CASINO_HEIST_MAX_AMMO}
        };
        const driven = stepFor(stocked, 400).state;

        expect(driven.player.ammo).toBeLessThanOrEqual(CASINO_HEIST_MAX_AMMO);
        expect(driven.player.weapon).toBe('pulse-cannon');
    });

    it('pauses and resumes without advancing the escape', () => {
        const state = createCasinoHeistState(course());
        const paused = setCasinoHeistPaused(state, true);

        expect(stepCasinoHeist(paused, NEUTRAL_CASINO_HEIST_INPUT).state).toBe(paused);
        expect(advanceCasinoHeist(paused, NEUTRAL_CASINO_HEIST_INPUT, 400).state).toBe(paused);
        expect(setCasinoHeistPaused(paused, false).paused).toBe(false);
        expect(() => advanceCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT, -1))
            .toThrow(/non-negative/);
    });
});

describe('Casino Heist devices', () => {
    function armedState(
        devices: Partial<Record<CasinoHeistDeviceKind, number>>,
        source = course()
    ): CasinoHeistState {
        const state = createCasinoHeistState(source);
        const charged = {
            'oil-slick': 0,
            'smoke-screen': 0,
            flamethrower: 0,
            ...devices
        };
        const armed = (['oil-slick', 'smoke-screen', 'flamethrower'] as const)
            .find(device => charged[device] > 0) ?? 'oil-slick';
        return {...state, player: {...state.player, devices: charged, armedDevice: armed}};
    }

    it('lays an oil slick behind the car and wrecks a pursuer that hits it', () => {
        const state = armedState({'oil-slick': 1});
        const deployed = stepCasinoHeist(state, input({deploy: true}));

        expect(deployed.events.map(event => event.kind)).toContain('device-deployed');
        const slick = deployed.state.hazards.find(hazard => hazard.kind === 'oil-slick');
        expect(slick).toBeDefined();
        if (!slick) return;
        expect(slick.distance).toBeLessThan(deployed.state.player.distance);

        const definition = deployed.state.course.segments
            .flatMap(segment => segment.pursuers)[0]!;
        const wrecked = stepCasinoHeist(
            withPursuer(deployed.state, definition, {x: slick.x, distance: slick.distance}),
            NEUTRAL_CASINO_HEIST_INPUT
        );

        expect(wrecked.events).toContainEqual(expect.objectContaining({
            kind: 'pursuer-wrecked',
            cause: 'oil-slick'
        }));
        // The wreck stays on screen long enough to slide off the road.
        expect(wrecked.state.pursuers.every(pursuer => pursuer.health === 0)).toBe(true);
        expect(wrecked.state.telemetry.pursuersWrecked).toBe(1);
    });

    it('blinds trailing pursuers with a smoke screen so they peel away', () => {
        const state = armedState({'smoke-screen': 1});
        const definition = state.course.segments.flatMap(segment => segment.pursuers)[0]!;
        const chased = withPursuer(state, definition, {
            x: state.player.x,
            distance: state.player.distance - 120
        });
        const smoked = stepCasinoHeist(chased, input({deploy: true}));

        expect(smoked.events.map(event => event.kind)).toContain('pursuer-blinded');
        expect(smoked.state.pursuers[0]?.blindedMs).toBeGreaterThan(0);

        const drifted = stepFor(smoked.state, 40).state;
        const geometry = getCasinoHeistRoadGeometry(
            drifted.course,
            drifted.pursuers[0]?.distance ?? 0
        );
        const drift = Math.abs((drifted.pursuers[0]?.x ?? geometry.centerX) - geometry.centerX);
        expect(drift).toBeGreaterThan(Math.abs(chased.pursuers[0]!.x - geometry.centerX));
    });

    it('burns a cop car with the flamethrower but only swerves a swat van', () => {
        const flaming = (
            source: CasinoHeistCourse,
            definition: CasinoHeistPursuerDefinition
        ): CasinoHeistState => {
            const base = armedState({flamethrower: 2}, source);
            return withPursuer(base, definition, {
                x: base.player.x + 40,
                distance: base.player.distance
            });
        };

        const cop = courseWithPursuer(pursuer => pursuer.kind === 'cop-car');
        const burned = stepCasinoHeist(
            flaming(cop.course, cop.pursuer),
            input({deploy: true})
        );
        expect(burned.events).toContainEqual(expect.objectContaining({
            kind: 'pursuer-wrecked',
            cause: 'flamethrower'
        }));

        const swat = courseWithPursuer(pursuer => pursuer.kind === 'swat-van');
        const swerved = stepCasinoHeist(
            flaming(swat.course, swat.pursuer),
            input({deploy: true})
        );
        expect(swerved.state.pursuers[0]?.spinOutMs).toBeGreaterThan(0);
        expect(swerved.state.pursuers[0]?.health).toBeGreaterThan(0);
    });

    it('arms the next stocked device and refuses to spend an empty one', () => {
        const state = armedState({'smoke-screen': 1, flamethrower: 1});
        expect(state.player.armedDevice).toBe('smoke-screen');

        const switched = stepCasinoHeist(state, input({switchDevice: true}));
        expect(switched.state.player.armedDevice).toBe('flamethrower');

        const attempted = stepCasinoHeist(armedState({}), input({deploy: true}));
        expect(attempted.events.map(event => event.kind)).not.toContain('device-deployed');
        expect(attempted.state.telemetry.devicesUsed).toBe(0);
    });

    it('spends a device only once per frame however long the frame is', () => {
        const state = armedState({'oil-slick': 3});
        const advanced = advanceCasinoHeist(state, input({deploy: true}), 200);

        expect(advanced.state.player.devices['oil-slick']).toBe(2);
        expect(advanced.events.filter(event => event.kind === 'device-deployed'))
            .toHaveLength(1);
    });
});

describe('Casino Heist pursuit', () => {
    it('shoves the player toward the shoulder instead of simply hitting them', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const definition = escape.segments.flatMap(segment => segment.pursuers)[0]!;
        const contact = stepCasinoHeist(
            withPursuer(base, definition, {
                x: base.player.x - 30,
                distance: base.player.distance,
                contactCooldownMs: 0
            }),
            NEUTRAL_CASINO_HEIST_INPUT
        );

        expect(contact.events).toContainEqual(expect.objectContaining({kind: 'rammed'}));
        expect(contact.state.player.x).toBeGreaterThan(base.player.x);
        // The shove itself costs no hull; being shoved somewhere lethal does.
        expect(contact.state.player.health).toBe(base.player.health);
    });

    it('damages the car when a ram pins it against the road edge', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const geometry = getCasinoHeistRoadGeometry(escape, 0);
        const definition = escape.segments.flatMap(segment => segment.pursuers)[0]!;
        const pinned: CasinoHeistState = {
            ...base,
            player: {...base.player, x: geometry.rightX - 20, previousX: geometry.rightX - 20}
        };
        const result = stepFor(
            withPursuer(pinned, definition, {
                x: geometry.rightX - 70,
                distance: pinned.player.distance,
                contactCooldownMs: 0
            }),
            50
        );

        // Grinding the verge only wrecks panels after a sustained scrape.
        expect(result.events).toContain('rammed');
        expect(result.events).toContain('damage');
    });

    it('wrecks both vehicles when a pursuer piles into ordinary traffic', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const pursuer = escape.segments.flatMap(segment => segment.pursuers)[0]!;
        const vehicle = escape.segments.flatMap(segment => segment.traffic)[0]!;
        const collided: CasinoHeistState = {
            ...withPursuer(base, pursuer, {x: 300, distance: 500}),
            spawnedTrafficIds: [vehicle.id],
            traffic: [{
                definitionId: vehicle.id,
                previousX: 300,
                x: 300,
                previousDistance: 500,
                distance: 500,
                health: vehicle.health,
                wrecked: false,
                wreckMs: 0,
                driftX: 0,
                spin: 0
            }]
        };
        const result = stepCasinoHeist(collided, NEUTRAL_CASINO_HEIST_INPUT);

        expect(result.events).toContainEqual(expect.objectContaining({
            kind: 'pursuer-wrecked',
            cause: 'traffic'
        }));
        expect(result.state.pursuers.every(pursuer => pursuer.health === 0)).toBe(true);
        expect(result.state.traffic.find(candidate =>
            candidate.definitionId === vehicle.id
        )?.wrecked).toBe(true);
    });

    it('fires sideways out of a rolled-down window rather than forwards', () => {
        const cop = courseWithPursuer(pursuer => pursuer.kind === 'cop-car');
        const base = createCasinoHeistState(cop.course);
        const fired = stepCasinoHeist(
            withPursuer(base, cop.pursuer, {
                x: base.player.x - 120,
                distance: base.player.distance,
                fireCooldownTicks: 0
            }),
            NEUTRAL_CASINO_HEIST_INPUT
        );

        expect(fired.events.map(event => event.kind)).toContain('enemy-fired');
        const shot = fired.state.projectiles.find(projectile =>
            projectile.allegiance === 'enemy'
        );
        expect(shot).toBeDefined();
        // Positive lateral velocity means the shot travels toward the player.
        expect(shot?.lateralVelocity ?? 0).toBeGreaterThan(0);
    });

    it('destroys a pursuer with sustained gunfire', () => {
        const cop = courseWithPursuer(pursuer => pursuer.kind === 'cop-car');
        const base = createCasinoHeistState(cop.course);
        const target = withPursuer(base, cop.pursuer, {
            x: base.player.x,
            distance: base.player.distance + 60
        });
        const result = stepFor(
            {...target, player: {...target.player, weapon: 'pulse-cannon', ammo: 20}},
            160,
            input({fire: true})
        );

        expect(result.events).toContain('pursuer-wrecked');
        expect(result.state.telemetry.pursuersDestroyed).toBeGreaterThan(0);
    });

    /**
     * An otherwise empty road with one vehicle of the requested kind directly in
     * front of the player, so a shot can only ever hit that one.
     */
    function withTrafficAhead(kind: CasinoHeistTrafficKind): CasinoHeistState {
        for (let seed = 0; seed < 80; seed++) {
            const escape = course(seed);
            const definition = escape.segments
                .flatMap(segment => segment.traffic)
                .find(vehicle => vehicle.kind === kind);
            if (!definition) continue;
            // Put it in the lane the player starts in so it stays in the line of
            // fire instead of steering out of it.
            const solo: CasinoHeistCourse = {
                ...escape,
                segments: escape.segments.map(segment => ({
                    ...segment,
                    traffic: segment.traffic
                        .filter(vehicle => vehicle.id === definition.id)
                        .map(vehicle => ({...vehicle, lane: escape.segments[0]!.safeLane})),
                    pursuers: [],
                    helicopters: []
                }))
            };
            const base = createCasinoHeistState(solo);
            return {
                ...base,
                player: {...base.player, weapon: 'pulse-cannon', ammo: 20},
                spawnedTrafficIds: [definition.id],
                traffic: [{
                    definitionId: definition.id,
                    previousX: base.player.x,
                    x: base.player.x,
                    previousDistance: base.player.distance + 150,
                    distance: base.player.distance + 150,
                    health: definition.health,
                    wrecked: false,
                    wreckMs: 0,
                    driftX: 0,
                    spin: 0
                }]
            };
        }
        throw new Error(`No generated escape offered a ${kind}.`);
    }

    it('destroys an ordinary car with a single shot', () => {
        const result = stepUntilEvent(
            withTrafficAhead('car'),
            input({fire: true}),
            'traffic-wrecked'
        );

        expect(result.fired).toBe(true);
        expect(result.state.telemetry.trafficWrecked).toBe(1);
    });

    it('needs two shots to bring down something as big as a bus', () => {
        const start = withTrafficAhead('bus');
        const vehicle = start.traffic[0]!;
        expect(vehicle.health).toBe(2);

        // One hit only dents it: it is still driving, and marked as damaged.
        let state = start;
        let wrecked = false;
        let sawDamagedButDriving = false;
        for (let tick = 0; tick < 200 && !wrecked && state.status === 'active'; tick++) {
            const result = stepCasinoHeist(state, input({fire: true}));
            state = result.state;
            const target = state.traffic.find(candidate =>
                candidate.definitionId === vehicle.definitionId
            );
            if (target && !target.wrecked && target.health === 1) sawDamagedButDriving = true;
            wrecked = result.events.some(event => event.kind === 'traffic-wrecked');
        }

        expect(sawDamagedButDriving).toBe(true);
        expect(wrecked).toBe(true);
        expect(state.telemetry.shotsFired).toBeGreaterThanOrEqual(2);
    });

    it('sends a wreck sliding off the road instead of parking it in a lane', () => {
        const start = withTrafficAhead('car');
        const vehicleId = start.traffic[0]!.definitionId;
        const hit = stepUntilEvent(start, input({fire: true}), 'traffic-wrecked');
        expect(hit.fired).toBe(true);
        let state = hit.state;
        const wreck = state.traffic.find(candidate => candidate.definitionId === vehicleId)!;
        expect(wreck.wrecked).toBe(true);
        expect(Math.abs(wreck.driftX)).toBeGreaterThan(0);

        // It keeps moving sideways, turns as it goes, and is gone before long.
        let previousOffset = Math.abs(
            wreck.x - getCasinoHeistRoadGeometry(state.course, wreck.distance).centerX
        );
        let turned = false;
        for (let tick = 0; tick < 200; tick++) {
            state = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT).state;
            const sliding = state.traffic.find(candidate =>
                candidate.definitionId === vehicleId
            );
            if (!sliding) break;
            const offset = Math.abs(
                sliding.x - getCasinoHeistRoadGeometry(state.course, sliding.distance).centerX
            );
            expect(offset).toBeGreaterThan(previousOffset - 1);
            previousOffset = offset;
            if (Math.abs(sliding.spin) > 0.5) turned = true;
        }

        expect(turned).toBe(true);
        expect(state.traffic.some(candidate => candidate.definitionId === vehicleId)).toBe(false);
    });

    it('sends a wrecked pursuer off the road too rather than deleting it', () => {
        const cop = courseWithPursuer(pursuer => pursuer.kind === 'cop-car');
        // Clear the road so the only thing that can be shot is this one cruiser.
        const solo: CasinoHeistCourse = {
            ...cop.course,
            segments: cop.course.segments.map(segment => ({
                ...segment,
                traffic: [],
                pursuers: segment.pursuers.filter(pursuer => pursuer.id === cop.pursuer.id),
                helicopters: []
            }))
        };
        const base = createCasinoHeistState(solo);
        const target = withPursuer(base, cop.pursuer, {
            x: base.player.x,
            distance: base.player.distance + 60
        });
        const hit = stepUntilEvent(
            {...target, player: {...target.player, weapon: 'pulse-cannon', ammo: 20}},
            input({fire: true}),
            'pursuer-wrecked'
        );
        expect(hit.fired).toBe(true);
        const wreck = hit.state.pursuers.find(candidate =>
            candidate.definitionId === cop.pursuer.id
        );

        expect(wreck).toBeDefined();
        expect(wreck!.health).toBe(0);
        expect(Math.abs(wreck!.driftX)).toBeGreaterThan(0);
        expect(wreck!.wreckMs).toBeGreaterThan(0);
    });
});

describe('Casino Heist helicopter', () => {
    function helicopterState(): CasinoHeistState {
        for (let seed = 0; seed < 60; seed++) {
            const escape = course(seed, 20);
            const definition = escape.segments.flatMap(segment => segment.helicopters)[0];
            if (!definition) continue;
            const base = createCasinoHeistState(escape);
            return {
                ...base,
                player: {
                    ...base.player,
                    previousDistance: definition.triggerDistance,
                    distance: definition.triggerDistance
                }
            };
        }
        throw new Error('No generated escape offered a helicopter.');
    }

    it('holds station ahead, drops a partial spike strip, and leaves', () => {
        const spawned = stepFor(helicopterState(), 4);
        expect(spawned.events).toContain('helicopter-spawned');
        expect(spawned.state.helicopters[0]!.distance)
            .toBeGreaterThan(spawned.state.player.distance);

        const dropped = stepFor(spawned.state, 400);
        expect(dropped.events).toContain('spike-strip-dropped');
        expect(dropped.events).toContain('helicopter-escaped');
    });

    it('can be shot down before it releases anything', () => {
        const spawned = stepFor(helicopterState(), 4).state;
        const airborne = spawned.helicopters[0]!;
        const armed: CasinoHeistState = {
            ...spawned,
            player: {...spawned.player, weapon: 'pulse-cannon', ammo: 20},
            projectiles: Array.from({length: 3}, (_unused, index) => ({
                id: `test-shot-${index}`,
                allegiance: 'player' as const,
                sourceId: 'player',
                x: airborne.x,
                previousDistance: airborne.distance,
                distance: airborne.distance,
                forwardVelocity: 0,
                lateralVelocity: 0,
                damage: 1
            }))
        };
        const result = stepCasinoHeist(armed, NEUTRAL_CASINO_HEIST_INPUT);

        expect(result.events.map(event => event.kind)).toContain('helicopter-downed');
        expect(result.state.helicopters).toHaveLength(0);
        expect(result.state.telemetry.helicoptersDowned).toBe(1);
    });

    it('spikes the car that drives over a dropped strip', () => {
        const spawned = stepFor(helicopterState(), 4).state;
        const result = stepFor({
            ...spawned,
            // Clear the road so the strip is the only thing that can hurt the car,
            // and clear any recovery window that would absorb the hit.
            player: {...spawned.player, recoveryMs: 0},
            traffic: [],
            hazards: [{
                id: 'test-strip',
                kind: 'spike-strip' as const,
                x: spawned.player.x,
                halfWidth: 74,
                distance: spawned.player.distance + 20,
                remainingMs: 5_000
            }]
        }, 30);

        expect(result.events).toContain('damage');
    });
});

describe('Casino Heist escape resolution', () => {
    it('pays the reward for dropping into the drain', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const escaped = stepFor({
            ...base,
            player: {
                ...base.player,
                x: getCasinoHeistDrainX(escape),
                previousDistance: escape.drainDistance - 6,
                distance: escape.drainDistance - 6
            }
        }, 20);

        expect(escaped.state.status).toBe('success');
        expect(escaped.state.terminalReason).toBe('drain-reached');
        expect(escaped.state.creditsStolen).toBe(CASINO_HEIST_REWARD_CREDITS);
        expect(escaped.events).toContain('success');
    });

    it('fails the escape when the drain is missed and the road runs out', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const drainX = getCasinoHeistDrainX(escape);
        const geometry = getCasinoHeistRoadGeometry(escape, escape.drainDistance);
        const wideX = Math.abs(geometry.rightX - 40 - drainX) >
            CASINO_HEIST_DRAIN_HALF_WIDTH + 30
            ? geometry.rightX - 40
            : geometry.leftX + 40;
        const overshot = stepFor({
            ...base,
            player: {
                ...base.player,
                x: wideX,
                health: 99,
                maxHealth: 99,
                previousDistance: escape.drainDistance - 6,
                distance: escape.drainDistance - 6
            }
        }, 4_000);

        expect(overshot.state.status).toBe('failure');
        expect(overshot.state.terminalReason).toBe('missed-turnoff');
    });

    it('announces the turn-off before it arrives', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const warned = stepFor({
            ...base,
            player: {
                ...base.player,
                previousDistance: escape.turnoffDistance - 700,
                distance: escape.turnoffDistance - 700
            }
        }, 400);

        expect(warned.events).toContain('turnoff-ahead');
    });

    it('ends the escape when the hull is destroyed', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);
        const vehicle = escape.segments.flatMap(segment => segment.traffic)[0]!;
        const destroyed = stepCasinoHeist({
            ...base,
            player: {...base.player, health: 1, recoveryMs: 0},
            spawnedTrafficIds: [vehicle.id],
            traffic: [{
                definitionId: vehicle.id,
                previousX: base.player.x,
                x: base.player.x,
                previousDistance: base.player.distance,
                distance: base.player.distance,
                health: vehicle.health,
                wrecked: false,
                wreckMs: 0,
                driftX: 0,
                spin: 0
            }]
        }, NEUTRAL_CASINO_HEIST_INPUT);

        expect(destroyed.state.status).toBe('failure');
        expect(destroyed.state.terminalReason).toBe('car-destroyed');
    });

    it('certifies a steerable corridor from the start line to the drain mouth', () => {
        // The guarantee is geometric: at every point of the road there is a
        // position clear of the tarmac edge, the divider, and the traffic the
        // car meets there, reachable at the car's own steering speed.
        for (let seed = 0; seed < 60; seed++) {
            const escape = course(seed, 10);
            expect(
                hasCasinoHeistDrivableCorridor(escape),
                `seed ${seed} has no corridor`
            ).toBe(true);
        }
    });

    it('refuses a course whose corridor is walled off by parked traffic', () => {
        const escape = course();
        const target = escape.segments[4]!;
        // Stalled, oversized buses abreast seal the whole carriageway.
        const walled: CasinoHeistCourse = {
            ...escape,
            segments: escape.segments.map(segment =>
                segment === target
                    ? {
                        ...segment,
                        traffic: CASINO_HEIST_LANES.map((lane, index) => ({
                            id: `wall-${index}`,
                            kind: 'bus' as const,
                            lane,
                            distance: target.startDistance + 120,
                            speed: 0,
                            width: 220,
                            length: 124,
                            health: 2
                        }))
                    }
                    : segment
            )
        };

        expect(hasCasinoHeistDrivableCorridor(walled)).toBe(false);
        expect(validateCasinoHeistCourse(walled).valid).toBe(false);
    });

    it('drives a pursuit-free road to the drain with no weapon or device', () => {
        const escape = withoutCasinoHeistPursuit(course(11, 10));
        let state = createCasinoHeistState(escape);
        for (let tick = 0; tick < 20_000 && state.status === 'active'; tick++) {
            const chosen = chooseCasinoHeistWitnessInput(state);
            expect(chosen.fire).toBe(false);
            expect(chosen.deploy).toBe(false);
            state = stepCasinoHeist(state, chosen).state;
        }

        expect(state.status).toBe('success');
        expect(state.creditsStolen).toBe(CASINO_HEIST_REWARD_CREDITS);
        expect(state.telemetry.shotsFired).toBe(0);
        expect(state.telemetry.devicesUsed).toBe(0);
    });

    it('keeps a full pursuit dangerous rather than instantly lethal', () => {
        // A driver who only dodges traffic and never fights back should still
        // get most of the way down the road before the police stop them.
        const reached: number[] = [];
        for (let seed = 0; seed < 16; seed++) {
            const escape = course(seed, 10);
            let state = createCasinoHeistState(escape);
            for (let tick = 0; tick < 20_000 && state.status === 'active'; tick++) {
                state = stepCasinoHeist(state, chooseCasinoHeistWitnessInput(state)).state;
            }
            reached.push(state.player.distance / escape.drainDistance);
        }

        const median = [...reached].sort((left, right) => left - right)[
            Math.floor(reached.length / 2)
        ]!;
        expect(median).toBeGreaterThan(0.5);
        expect(reached.filter(fraction => fraction >= 1).length)
            .toBeLessThan(reached.length);
    });
});

describe('Casino Heist presentation', () => {
    it('projects the road, the drain, and every entity into screen space', () => {
        const escape = course();
        const state = stepFor(createCasinoHeistState(escape), 200).state;
        const snapshot = getCasinoHeistRenderSnapshot(state);

        expect(snapshot.road.length).toBeGreaterThan(0);
        expect(snapshot.player.y).toBe(state.player.screenY);
        expect(snapshot.drainHalfWidth).toBe(CASINO_HEIST_DRAIN_HALF_WIDTH);
        expect(snapshot.drainX).toBe(getCasinoHeistDrainX(escape));
        expect(snapshot.turnoffVisible).toBe(false);
        for (const vehicle of snapshot.traffic) {
            expect(Number.isFinite(vehicle.y)).toBe(true);
            expect(vehicle.width).toBeGreaterThan(0);
        }
    });

    it('shows the turn-off marker only once it is close', () => {
        const escape = course();
        const base = createCasinoHeistState(escape);

        expect(getCasinoHeistRenderSnapshot({
            ...base,
            player: {
                ...base.player,
                previousDistance: escape.turnoffDistance - 100,
                distance: escape.turnoffDistance - 100
            }
        }).turnoffVisible).toBe(true);
    });

    it('advances the same distance per frame however the frame is chopped up', () => {
        const escape = course();
        const single = advanceCasinoHeist(
            createCasinoHeistState(escape),
            NEUTRAL_CASINO_HEIST_INPUT,
            CASINO_HEIST_FIXED_STEP_MS * 5
        ).state;
        let chopped = createCasinoHeistState(escape);
        for (let frame = 0; frame < 5; frame++) {
            chopped = advanceCasinoHeist(
                chopped,
                NEUTRAL_CASINO_HEIST_INPUT,
                CASINO_HEIST_FIXED_STEP_MS
            ).state;
        }

        expect(chopped.player.distance).toBeCloseTo(single.player.distance, 6);
        expect(chopped.activeTicks).toBe(single.activeTicks);
    });
});
