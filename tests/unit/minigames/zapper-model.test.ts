import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    ZAPPER_ALIEN_SPAWN_X,
    ZAPPER_DANGER_X,
    ZAPPER_FIXED_STEP_MS,
    ZAPPER_IDLE_INPUT,
    ZAPPER_LANE_COUNT,
    ZAPPER_RETURN_MISS_X,
    ZAPPER_SERVICE_X,
    advanceZapper,
    canonicalZapperCourseSignature,
    createZapperCourse,
    createZapperState,
    getZapperRenderSnapshot,
    getZapperTelemetry,
    hasZapperConstructiveServiceRoute,
    recommendZapperInput,
    setZapperPaused,
    stepZapper,
    validateZapperCourse,
    type ZapperCourse,
    type ZapperEvent,
    type ZapperInput,
    type ZapperState
} from '../../../src/minigames/zapper/zapper-model';

function autoplay(
    initial: ZapperState,
    maximumMs = 180_000
): {readonly state: ZapperState; readonly events: readonly ZapperEvent[]} {
    let state = initial;
    const events: ZapperEvent[] = [];
    for (
        let elapsedMs = 0;
        elapsedMs < maximumMs && state.status === 'active';
        elapsedMs += ZAPPER_FIXED_STEP_MS
    ) {
        const result = advanceZapper(
            state,
            recommendZapperInput(state),
            ZAPPER_FIXED_STEP_MS
        );
        state = result.state;
        events.push(...result.events);
    }
    return {state, events};
}

function advanceFor(
    initial: ZapperState,
    milliseconds: number,
    input: ZapperInput = ZAPPER_IDLE_INPUT
): {readonly state: ZapperState; readonly events: readonly ZapperEvent[]} {
    let state = initial;
    const events: ZapperEvent[] = [];
    for (
        let elapsedMs = 0;
        elapsedMs < milliseconds && state.status === 'active';
        elapsedMs += ZAPPER_FIXED_STEP_MS
    ) {
        const result = advanceZapper(state, input, ZAPPER_FIXED_STEP_MS);
        state = result.state;
        events.push(...result.events);
    }
    return {state, events};
}

describe('Zapper course generation', () => {
    it('reproduces seeds, varies alien schedules, and validates 160 courses', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 160; seed++) {
            const config = {difficulty: seed % 6};
            const course = createZapperCourse(new Mulberry32Random(seed), config);
            const duplicate = createZapperCourse(new Mulberry32Random(seed), config);

            expect(course).toEqual(duplicate);
            expect(course.laneCount).toBe(ZAPPER_LANE_COUNT);
            expect(course.orders.length).toBeGreaterThan(course.completionQuota);
            expect(new Set(course.orders.map(order => order.laneIndex)).size).toBe(4);
            expect(validateZapperCourse(course)).toEqual({valid: true, errors: []});
            expect(hasZapperConstructiveServiceRoute(course)).toBe(true);
            signatures.add(canonicalZapperCourseSignature(course));
        }

        expect(signatures.size).toBeGreaterThanOrEqual(158);
    });

    it('bounds difficulty and exposes varied strange aliens and lab equipment', () => {
        const species = new Set<string>();
        const blasters = new Set<string>();
        const slimes = new Set<string>();
        for (let seed = 0; seed < 48; seed++) {
            const course = createZapperCourse(new Mulberry32Random(seed), {
                difficulty: seed % 6
            });
            for (const order of course.orders) {
                species.add(order.appearance.species);
                blasters.add(order.appearance.blasterStyle);
                slimes.add(order.appearance.slimeFlavor);
                expect(order.approachSpeed).toBeGreaterThanOrEqual(23);
                expect(order.approachSpeed).toBeLessThanOrEqual(42);
                expect(
                    (ZAPPER_ALIEN_SPAWN_X - ZAPPER_DANGER_X) /
                    order.approachSpeed *
                    1_000
                ).toBeGreaterThanOrEqual(12_000);
            }
        }

        expect(species.size).toBe(6);
        expect(blasters.size).toBe(4);
        expect(slimes.size).toBe(4);
    });

    it('rejects invalid generation options and catches broken schedules', () => {
        expect(() => createZapperCourse(new Mulberry32Random(1), {
            difficulty: 6
        })).toThrow(/difficulty/i);
        expect(() => createZapperCourse(new Mulberry32Random(1), {
            completionQuota: 0
        })).toThrow(/quota/i);
        expect(() => createZapperCourse(new Mulberry32Random(1), {
            bonuses: {fillSpeedMultiplier: 3}
        })).toThrow(/fill speed/i);
        expect(() => createZapperCourse(new Mulberry32Random(1), {
            bonuses: {catchTolerancePx: -1}
        })).toThrow(/catch tolerance/i);

        const course = createZapperCourse(new Mulberry32Random(4));
        const broken: ZapperCourse = {
            ...course,
            orders: course.orders.map((order, index) =>
                index === 1
                    ? {...order, spawnAtMs: course.orders[0]!.spawnAtMs}
                    : order
            )
        };
        const result = validateZapperCourse(broken);
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toMatch(/spawn time|constructive/i);
        expect(() => createZapperState(broken)).toThrow(/invalid Zapper course/i);
    });
});

describe('Zapper service loop', () => {
    it('constructively completes varied schedules without losing a life', () => {
        for (let seed = 0; seed < 72; seed++) {
            const course = createZapperCourse(new Mulberry32Random(seed), {
                difficulty: seed % 6
            });
            const result = autoplay(createZapperState(course));

            expect(
                result.state.status,
                `seed ${seed}: ${JSON.stringify(getZapperTelemetry(result.state))}`
            ).toBe('success');
            expect(result.state.completedOrders).toBe(course.completionQuota);
            expect(result.state.lives).toBe(course.startingLives);
        }
    });

    it('runs the full charge, slide, assembly, catch, and handoff sequence', () => {
        const course = createZapperCourse(new Mulberry32Random(44), {
            completionQuota: 1
        });
        const result = autoplay(createZapperState(course));
        const kinds = result.events.map(event => event.kind);

        expect(result.state.status).toBe('success');
        expect(result.state.score).toBeGreaterThan(0);
        expect(kinds).toContain('alien-spawned');
        expect(kinds).toContain('blaster-ready');
        expect(kinds).toContain('outgoing-launched');
        expect(kinds).toContain('alien-received');
        expect(kinds).toContain('return-launched');
        expect(kinds).toContain('return-caught');
        expect(kinds).toContain('handoff-complete');
        expect(kinds.at(-1)).toBe('success');
    });

    it('does not launch a half-filled blaster', () => {
        const initial = createZapperState(
            createZapperCourse(new Mulberry32Random(2), {completionQuota: 1})
        );
        const result = stepZapper(initial, {
            laneDelta: 0,
            chargeHeld: false,
            actionPressed: true
        });

        expect(result.state.projectiles).toHaveLength(0);
        expect(result.state.player.fillProgress).toBe(0);
        expect(result.events).toContainEqual({
            kind: 'action-rejected',
            reason: 'blaster-not-full'
        });
    });

    it('charges only while held and launches from the selected counter', () => {
        const course = createZapperCourse(new Mulberry32Random(8), {
            completionQuota: 1
        });
        let state = createZapperState(course);
        state = advanceFor(state, course.tuning.fillDurationMs / 2, {
            laneDelta: 0,
            chargeHeld: true,
            actionPressed: false
        }).state;
        const halfFill = state.player.fillProgress;
        state = advanceFor(state, 400).state;
        expect(state.player.fillProgress).toBeCloseTo(halfFill);
        state = advanceFor(state, course.tuning.fillDurationMs, {
            laneDelta: 0,
            chargeHeld: true,
            actionPressed: false
        }).state;
        expect(state.player.fillProgress).toBe(1);

        state = advanceZapper(state, {
            laneDelta: 1,
            chargeHeld: false,
            actionPressed: false
        }, ZAPPER_FIXED_STEP_MS).state;
        const launch = advanceZapper(state, {
            laneDelta: 0,
            chargeHeld: false,
            actionPressed: true
        }, ZAPPER_FIXED_STEP_MS);

        expect(launch.state.player.laneIndex).toBe(1);
        expect(launch.state.player.fillProgress).toBe(0);
        expect(launch.state.projectiles).toContainEqual(
            expect.objectContaining({kind: 'outgoing', laneIndex: 1})
        );
    });

    it('loses a life when an outgoing blaster falls off an empty counter', () => {
        const course = createZapperCourse(new Mulberry32Random(18), {
            completionQuota: 1
        });
        let state = createZapperState(course);
        state = advanceFor(state, course.tuning.fillDurationMs + 40, {
            laneDelta: 0,
            chargeHeld: true,
            actionPressed: false
        }).state;
        const firstOrdersByLane = new Map<number, number>();
        for (const order of course.orders) {
            if (!firstOrdersByLane.has(order.laneIndex)) {
                firstOrdersByLane.set(order.laneIndex, order.spawnAtMs);
            }
        }
        const emptyLane = [...firstOrdersByLane.entries()]
            .sort((left, right) => right[1] - left[1])[0]![0];
        while (state.player.laneIndex !== emptyLane) {
            const laneDelta = emptyLane > state.player.laneIndex ? 1 : -1;
            state = advanceZapper(state, {
                laneDelta,
                chargeHeld: false,
                actionPressed: false
            }, ZAPPER_FIXED_STEP_MS).state;
        }
        state = advanceZapper(state, {
            laneDelta: 0,
            chargeHeld: false,
            actionPressed: true
        }, ZAPPER_FIXED_STEP_MS).state;
        const result = advanceFor(state, 2_100);

        expect(result.events).toContainEqual({
            kind: 'life-lost',
            reason: 'outgoing-missed',
            lives: course.startingLives - 1,
            orderId: null
        });
        expect(result.state.lives).toBe(course.startingLives - 1);
        expect(result.state.failedOrders).toBe(0);
    });

    it('loses a life and dismisses the customer when a return is not caught', () => {
        const course = createZapperCourse(new Mulberry32Random(6), {
            completionQuota: 1
        });
        let state = createZapperState(course);
        let returningOrderId: string | null = null;
        for (let ticks = 0; ticks < 2_000 && returningOrderId === null; ticks++) {
            const result = advanceZapper(
                state,
                recommendZapperInput(state),
                ZAPPER_FIXED_STEP_MS
            );
            state = result.state;
            const returnEvent = result.events.find(
                event => event.kind === 'return-launched'
            );
            if (returnEvent?.kind === 'return-launched') {
                returningOrderId = returnEvent.orderId;
            }
        }
        expect(returningOrderId).not.toBeNull();
        const returnProjectile = state.projectiles.find(
            projectile => projectile.orderId === returningOrderId
        )!;
        const safeOtherLane = (returnProjectile.laneIndex + 2) % ZAPPER_LANE_COUNT;
        while (state.player.laneIndex !== safeOtherLane) {
            state = advanceZapper(state, {
                laneDelta: safeOtherLane > state.player.laneIndex ? 1 : -1,
                chargeHeld: false,
                actionPressed: false
            }, ZAPPER_FIXED_STEP_MS).state;
        }
        const result = advanceFor(state, 3_000);

        expect(result.events).toContainEqual({
            kind: 'life-lost',
            reason: 'return-missed',
            lives: course.startingLives - 1,
            orderId: returningOrderId
        });
        expect(result.state.aliens.some(
            alien => alien.orderId === returningOrderId
        )).toBe(false);
    });

    it('lets an unserved alien breach the service end and eventually ends the attempt', () => {
        const course = createZapperCourse(new Mulberry32Random(3), {
            completionQuota: 1,
            startingLives: 1
        });
        const result = advanceFor(createZapperState(course), 30_000);

        expect(result.state.status).toBe('failure');
        expect(result.state.failureReason).toBe('alien-breached');
        expect(result.events).toContainEqual(
            expect.objectContaining({
                kind: 'life-lost',
                reason: 'alien-breached',
                lives: 0
            })
        );
        expect(result.events.at(-1)).toEqual({
            kind: 'failure',
            reason: 'alien-breached'
        });
    });
});

describe('Zapper item bonuses and deterministic timing', () => {
    it('applies maze-item bonuses without changing the framework-neutral API', () => {
        const ordinary = createZapperCourse(new Mulberry32Random(50), {
            completionQuota: 4
        });
        const boosted = createZapperCourse(new Mulberry32Random(50), {
            completionQuota: 4,
            bonuses: {
                fillSpeedMultiplier: 1.5,
                extraStartingLives: 2,
                catchTolerancePx: 48
            }
        });

        expect(boosted.tuning.fillDurationMs).toBeLessThan(
            ordinary.tuning.fillDurationMs
        );
        expect(boosted.startingLives).toBe(ordinary.startingLives + 2);
        expect(boosted.tuning.catchTolerancePx).toBe(
            ordinary.tuning.catchTolerancePx + 48
        );
        expect(validateZapperCourse(boosted)).toEqual({valid: true, errors: []});
        expect(autoplay(createZapperState(boosted)).state.status).toBe('success');
    });

    it('produces identical state across different render-delta schedules', () => {
        const course = createZapperCourse(new Mulberry32Random(71), {
            completionQuota: 2
        });
        const initial = createZapperState(course);
        const oneChunk = advanceZapper(initial, {
            laneDelta: 1,
            chargeHeld: true,
            actionPressed: false
        }, 1_000).state;
        let varied = initial;
        let elapsedMs = 0;
        const schedule = [7, 13, 31, 5, 44, 20, 9, 51];
        for (let index = 0; elapsedMs < 1_000; index++) {
            const deltaMs = Math.min(
                schedule[index % schedule.length]!,
                1_000 - elapsedMs
            );
            varied = advanceZapper(varied, {
                laneDelta: index === 0 ? 1 : 0,
                chargeHeld: true,
                actionPressed: false
            }, deltaMs).state;
            elapsedMs += deltaMs;
        }

        expect(varied).toEqual(oneChunk);
        expect(varied.activeTicks).toBe(1_000 / ZAPPER_FIXED_STEP_MS);
    });

    it('buffers presses to the next step and consumes them only once', () => {
        const state = createZapperState(
            createZapperCourse(new Mulberry32Random(72), {completionQuota: 1})
        );
        const buffered = advanceZapper(state, {
            laneDelta: 1,
            chargeHeld: false,
            actionPressed: true
        }, ZAPPER_FIXED_STEP_MS / 2);
        expect(buffered.state.player.laneIndex).toBe(0);
        expect(buffered.events).toEqual([]);

        const consumed = advanceZapper(buffered.state, ZAPPER_IDLE_INPUT, 50);
        expect(consumed.state.player.laneIndex).toBe(1);
        expect(consumed.events.filter(event => event.kind === 'lane-changed')).toHaveLength(1);
        expect(consumed.events.filter(event => event.kind === 'action-rejected')).toHaveLength(1);
    });

    it('freezes all simulation and clears buffered input while paused', () => {
        const initial = createZapperState(
            createZapperCourse(new Mulberry32Random(80), {completionQuota: 1})
        );
        const partiallyBuffered = advanceZapper(initial, {
            laneDelta: 1,
            chargeHeld: true,
            actionPressed: true
        }, 10).state;
        const paused = setZapperPaused(partiallyBuffered, true);
        const whilePaused = advanceZapper(paused, {
            laneDelta: 1,
            chargeHeld: true,
            actionPressed: true
        }, 4_000);

        expect(whilePaused.state).toBe(paused);
        expect(whilePaused.events).toEqual([]);
        const resumed = setZapperPaused(whilePaused.state, false);
        const stepped = advanceZapper(resumed, ZAPPER_IDLE_INPUT, ZAPPER_FIXED_STEP_MS);
        expect(stepped.state.player.laneIndex).toBe(0);
        expect(stepped.state.player.fillProgress).toBe(0);
        expect(stepped.events.some(event => event.kind === 'action-rejected')).toBe(false);
    });

    it('provides scene-ready telemetry and interpolated render positions', () => {
        const course = createZapperCourse(new Mulberry32Random(90), {
            completionQuota: 2
        });
        const stepped = advanceZapper(
            createZapperState(course),
            {laneDelta: 0, chargeHeld: true, actionPressed: false},
            ZAPPER_FIXED_STEP_MS + ZAPPER_FIXED_STEP_MS / 2
        ).state;
        const telemetry = getZapperTelemetry(stepped);
        const snapshot = getZapperRenderSnapshot(stepped);

        expect(telemetry.elapsedMs).toBe(ZAPPER_FIXED_STEP_MS);
        expect(telemetry.activeAliens).toBe(1);
        expect(telemetry.approachingAliens).toBe(1);
        expect(telemetry.nearestThreatMs).not.toBeNull();
        expect(telemetry.fillProgress).toBeGreaterThan(0);
        expect(telemetry.score).toBe(0);
        expect(snapshot.interpolation).toBeCloseTo(0.5);
        expect(snapshot.player.fillProgress).toBe(telemetry.fillProgress);
        expect(snapshot.lives).toBe(telemetry.lives);
        expect(snapshot.score).toBe(telemetry.score);
        expect(snapshot.completionQuota).toBe(course.completionQuota);
        expect(snapshot.aliens).toHaveLength(1);
        expect(snapshot.aliens[0]!.x).toBeLessThan(ZAPPER_ALIEN_SPAWN_X);
        expect(snapshot.aliens[0]!.x).toBeGreaterThan(stepped.aliens[0]!.x);
        expect(snapshot.aliens[0]!.appearance.species).toBe(
            course.orders[0]!.appearance.species
        );
        expect(ZAPPER_SERVICE_X).toBeGreaterThan(ZAPPER_RETURN_MISS_X);
    });
});
