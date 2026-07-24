import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    CASINO_HEIST_BASE_HEALTH,
    CASINO_HEIST_FIXED_STEP_MS,
    CASINO_HEIST_MAX_AMMO,
    CASINO_HEIST_PLAYER_SCREEN_Y,
    CASINO_HEIST_RECOVERY_MS,
    CASINO_HEIST_REWARD_CREDITS,
    NEUTRAL_CASINO_HEIST_INPUT,
    advanceCasinoHeist,
    canonicalCasinoHeistCourseSignature,
    chooseCasinoHeistWitnessInput,
    createCasinoHeistCourse,
    createCasinoHeistState,
    getCasinoHeistRenderSnapshot,
    hasCasinoHeistSafeRoute,
    replayCasinoHeistWitness,
    setCasinoHeistPaused,
    stepCasinoHeist,
    validateCasinoHeistCourse,
    type CasinoHeistCourse,
    type CasinoHeistGenerationConfig,
    type CasinoHeistState
} from '../../../src/minigames/heist/casino-heist-model';

function course(
    seed: number,
    config: CasinoHeistGenerationConfig = {}
): CasinoHeistCourse {
    return createCasinoHeistCourse(new Mulberry32Random(seed), config);
}

function allEnemyIds(generated: CasinoHeistCourse): string[] {
    return generated.segments.flatMap(segment =>
        segment.enemies.map(enemy => enemy.id)
    );
}

describe('Casino Heist road generation', () => {
    it('reproduces seeds, varies roads, and validates 160 constructive routes', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 160; seed++) {
            const generated = course(seed);
            const duplicate = course(seed);

            expect(generated).toEqual(duplicate);
            expect(validateCasinoHeistCourse(generated)).toEqual({
                valid: true,
                errors: []
            });
            expect(hasCasinoHeistSafeRoute(generated)).toBe(true);
            expect(generated.segments[0]?.pickups[0]?.kind).toBe('weapon');
            signatures.add(canonicalCasinoHeistCourseSignature(generated));
        }
        expect(signatures.size).toBeGreaterThanOrEqual(158);
    });

    it('has a real automated survivor across many seeds', () => {
        for (let seed = 0; seed < 80; seed++) {
            const result = replayCasinoHeistWitness(course(seed * 977 + 31));
            expect(result.state.status, `seed ${seed}`).toBe('success');
            expect(result.state.creditsStolen, `seed ${seed}`).toBe(
                CASINO_HEIST_REWARD_CREDITS
            );
            expect(result.state.player.health, `seed ${seed}`).toBeGreaterThan(0);
            expect(result.state.telemetry.powerupsCollected, `seed ${seed}`)
                .toBeGreaterThan(0);
        }
    });

    it('rejects a road whose declared safe lane is actually blocked', () => {
        const generated = course(44);
        const first = generated.segments[0]!;
        const obstacle = first.obstacles[0]!;
        const malformed: CasinoHeistCourse = {
            ...generated,
            segments: [{
                ...first,
                obstacles: [{
                    ...obstacle,
                    x:
                        first.centerStartX +
                        (
                            (obstacle.distance - first.startDistance) /
                            (first.endDistance - first.startDistance)
                        ) *
                        (first.centerEndX - first.centerStartX) +
                        first.safeLane * 120
                }]
            }, ...generated.segments.slice(1)]
        };

        const validation = validateCasinoHeistCourse(malformed);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join(' ')).toMatch(/safe-lane route/i);
        expect(() => createCasinoHeistState(malformed)).toThrow(/invalid Casino Heist road/i);
    });

    it('applies item bonuses without importing campaign or inventory types', () => {
        const base = course(99);
        const boosted = course(99, {
            bonuses: {
                armor: 2,
                handling: 1,
                powerupChance: 1,
                startAmmo: 9
            }
        });
        const baseState = createCasinoHeistState(base);
        const boostedState = createCasinoHeistState(boosted);

        expect(baseState.player.health).toBe(CASINO_HEIST_BASE_HEALTH);
        expect(baseState.player.weapon).toBe('none');
        expect(baseState.player.ammo).toBe(0);
        expect(boostedState.player.health).toBe(CASINO_HEIST_BASE_HEALTH + 2);
        expect(boostedState.player.weapon).toBe('pulse-cannon');
        expect(boostedState.player.ammo).toBe(9);
        expect(boosted.segments.flatMap(segment => segment.pickups)).toHaveLength(
            boosted.segments.length
        );

        const baseSteered = advanceCasinoHeist(baseState, {steer: 1, fire: false}, 400).state;
        const boostedSteered = advanceCasinoHeist(
            boostedState,
            {steer: 1, fire: false},
            400
        ).state;
        expect(boostedSteered.player.x).toBeGreaterThan(baseSteered.player.x);
    });

    it('makes the powerup chance monotonic while preserving the same road geometry', () => {
        let basePickupCount = 0;
        let boostedPickupCount = 0;
        for (let seed = 0; seed < 40; seed++) {
            const base = course(seed, {bonuses: {powerupChance: 0}});
            const boosted = course(seed, {bonuses: {powerupChance: 0.6}});
            expect(boosted.segments.map(segment => [
                segment.centerStartX,
                segment.centerEndX,
                segment.safeLane,
                segment.obstacles,
                segment.enemies
            ])).toEqual(base.segments.map(segment => [
                segment.centerStartX,
                segment.centerEndX,
                segment.safeLane,
                segment.obstacles,
                segment.enemies
            ]));
            basePickupCount += base.segments.flatMap(segment => segment.pickups).length;
            boostedPickupCount += boosted.segments.flatMap(segment => segment.pickups).length;
        }
        expect(boostedPickupCount).toBeGreaterThan(basePickupCount);
    });
});

describe('Casino Heist fixed-step driving', () => {
    it('advances continuously, accepts analog steering, and is schedule invariant', () => {
        const generated = course(8);
        const initial = createCasinoHeistState(generated);
        const input = {steer: 0.35, fire: false};
        const single = advanceCasinoHeist(initial, input, 1_000).state;
        let chunked = initial;
        for (const delta of [7, 13, 41, 5, 89, 211, 17, 97, 103, 417]) {
            chunked = advanceCasinoHeist(chunked, input, delta).state;
        }

        expect(single).toEqual(chunked);
        expect(single.activeTicks).toBe(1_000 / CASINO_HEIST_FIXED_STEP_MS);
        expect(single.player.distance).toBeGreaterThan(0);
        expect(single.player.x).toBeGreaterThan(initial.player.x);
    });

    it('freezes every simulation counter while paused and clears partial time', () => {
        const initial = advanceCasinoHeist(
            createCasinoHeistState(course(17)),
            NEUTRAL_CASINO_HEIST_INPUT,
            13
        ).state;
        expect(initial.accumulatorMs).toBe(13);
        const paused = setCasinoHeistPaused(initial, true);
        const frozen = advanceCasinoHeist(
            paused,
            {steer: 1, fire: true},
            10_000
        );

        expect(paused.accumulatorMs).toBe(0);
        expect(frozen).toEqual({state: paused, events: []});
        const resumed = setCasinoHeistPaused(paused, false);
        expect(stepCasinoHeist(resumed, NEUTRAL_CASINO_HEIST_INPUT).state.activeTicks)
            .toBe(initial.activeTicks + 1);
    });

    it('provides a deterministic neutral input and witness control for any input surface', () => {
        const state = createCasinoHeistState(course(50));
        expect(NEUTRAL_CASINO_HEIST_INPUT).toEqual({steer: 0, fire: false});
        const witness = chooseCasinoHeistWitnessInput(state);
        expect(witness.steer).toBeGreaterThanOrEqual(-1);
        expect(witness.steer).toBeLessThanOrEqual(1);
        expect(typeof witness.fire).toBe('boolean');
        expect(() => stepCasinoHeist(state, {steer: Number.NaN, fire: false}))
            .toThrow(/steering input/i);
    });
});

describe('Casino Heist pickups, weapons, and threats', () => {
    it('starts unarmed, collects the construction-lab gun, spends finite ammo, and refills', () => {
        const generated = course(3);
        const firstPickup = generated.segments[0]!.pickups[0]!;
        let state: CasinoHeistState = {
            ...createCasinoHeistState(generated),
            player: {
                ...createCasinoHeistState(generated).player,
                previousX: firstPickup.x,
                x: firstPickup.x,
                previousDistance: firstPickup.distance - 3,
                distance: firstPickup.distance - 3
            }
        };
        const collected = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT);
        state = collected.state;
        expect(collected.events).toContainEqual(expect.objectContaining({
            kind: 'pickup-collected',
            pickupKind: 'weapon'
        }));
        expect(state.player.weapon).toBe('pulse-cannon');
        expect(state.player.ammo).toBe(firstPickup.ammo);

        state = {
            ...state,
            player: {...state.player, ammo: 1, fireCooldownTicks: 0}
        };
        const fired = stepCasinoHeist(state, {steer: 0, fire: true});
        expect(fired.state.player.ammo).toBe(0);
        expect(fired.state.telemetry.shotsFired).toBe(1);
        expect(fired.events).toContainEqual(expect.objectContaining({kind: 'player-fired'}));
        const dry = advanceCasinoHeist(fired.state, {steer: 0, fire: true}, 500).state;
        expect(dry.telemetry.shotsFired).toBe(1);

        const ammoPickup = generated.segments
            .flatMap(segment => segment.pickups)
            .find(pickup => pickup.kind === 'ammo')!;
        const beforeAmmo = 2;
        state = {
            ...dry,
            player: {
                ...dry.player,
                previousX: ammoPickup.x,
                x: ammoPickup.x,
                previousDistance: ammoPickup.distance - 3,
                distance: ammoPickup.distance - 3,
                ammo: beforeAmmo
            },
            spawnedEnemyIds: allEnemyIds(generated)
        };
        const refilled = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT).state;
        expect(refilled.player.ammo).toBe(
            Math.min(CASINO_HEIST_MAX_AMMO, beforeAmmo + ammoPickup.ammo)
        );
        expect(refilled.telemetry.ammoCollected).toBeGreaterThan(
            state.telemetry.ammoCollected
        );
    });

    it('spawns deterministic luxury cars whose machine guns fire from the front only', () => {
        const generated = course(12);
        const definition = generated.segments
            .flatMap(segment => segment.enemies)[0]!;
        let state: CasinoHeistState = {
            ...createCasinoHeistState(generated),
            player: {
                ...createCasinoHeistState(generated).player,
                previousDistance: definition.triggerDistance - 2,
                distance: definition.triggerDistance - 2
            },
            spawnedEnemyIds: allEnemyIds(generated).filter(id => id !== definition.id)
        };
        const spawned = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT);
        expect(spawned.events).toContainEqual({
            kind: 'enemy-spawned',
            tick: spawned.state.activeTicks,
            enemyId: definition.id
        });
        const enemy = spawned.state.enemies.find(
            candidate => candidate.definitionId === definition.id
        )!;
        state = {
            ...spawned.state,
            player: {
                ...spawned.state.player,
                previousX: enemy.x,
                x: enemy.x
            },
            enemies: [{
                ...enemy,
                previousX: enemy.x,
                previousDistance: spawned.state.player.distance - 110,
                distance: spawned.state.player.distance - 110,
                fireCooldownTicks: 0
            }]
        };
        const fired = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT);
        const shotEvent = fired.events.find(event => event.kind === 'enemy-fired');
        expect(shotEvent).toBeDefined();
        const projectile = fired.state.projectiles.find(
            candidate => candidate.allegiance === 'enemy'
        )!;
        const movedEnemy = fired.state.enemies[0]!;
        expect(projectile.forwardVelocity).toBeGreaterThan(0);
        expect(projectile.previousDistance).toBeGreaterThan(
            movedEnemy.previousDistance + 25
        );
    });

    it('takes spike contact damage, grants recovery immunity, then recovers', () => {
        const generated = course(12);
        const definition = generated.segments.flatMap(segment => segment.enemies)[0]!;
        const initial = createCasinoHeistState(generated);
        const distance = definition.triggerDistance + 10;
        let state: CasinoHeistState = {
            ...initial,
            player: {
                ...initial.player,
                previousX: 360,
                x: 360,
                previousDistance: distance,
                distance
            },
            spawnedEnemyIds: allEnemyIds(generated),
            enemies: [{
                definitionId: definition.id,
                previousX: 360,
                x: 360,
                previousDistance: distance,
                distance,
                health: definition.health,
                fireCooldownTicks: 999,
                contactCooldownMs: 0
            }]
        };
        const spiked = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT);
        state = spiked.state;
        expect(spiked.events).toContainEqual(expect.objectContaining({
            kind: 'damage',
            source: 'spikes'
        }));
        expect(state.player.health).toBe(initial.player.health - 1);
        expect(state.player.recoveryMs).toBe(CASINO_HEIST_RECOVERY_MS);

        const hostileShot = {
            id: 'test-hostile-shot',
            allegiance: 'enemy' as const,
            sourceId: definition.id,
            x: state.player.x,
            previousDistance: state.player.distance,
            distance: state.player.distance,
            forwardVelocity: 350,
            damage: 1
        };
        const protectedState: CasinoHeistState = {
            ...state,
            enemies: [],
            projectiles: [hostileShot]
        };
        const protectedStep = stepCasinoHeist(
            protectedState,
            NEUTRAL_CASINO_HEIST_INPUT
        );
        expect(protectedStep.state.player.health).toBe(state.player.health);

        const almostRecovered = advanceCasinoHeist(
            {...protectedStep.state, projectiles: []},
            NEUTRAL_CASINO_HEIST_INPUT,
            CASINO_HEIST_RECOVERY_MS - 40
        ).state;
        const recovered = advanceCasinoHeist(
            almostRecovered,
            NEUTRAL_CASINO_HEIST_INPUT,
            40
        );
        expect(recovered.state.player.recoveryMs).toBe(0);
        expect(recovered.events).toContainEqual(expect.objectContaining({
            kind: 'recovered'
        }));
    });
});

describe('Casino Heist terminal and rendering contract', () => {
    it('awards exactly 1000 at the finish and gives finish success final-tick precedence', () => {
        const generated = course(71);
        const initial = createCasinoHeistState(generated);
        const startDistance = generated.finishDistance - 3;
        const x = generated.segments.at(-1)!.centerEndX;
        const state: CasinoHeistState = {
            ...initial,
            player: {
                ...initial.player,
                previousX: x,
                x,
                previousDistance: startDistance,
                distance: startDistance,
                health: 1
            },
            spawnedEnemyIds: allEnemyIds(generated),
            projectiles: [{
                id: 'finish-line-shot',
                allegiance: 'enemy',
                sourceId: 'test-enemy',
                x,
                previousDistance: startDistance - 4,
                distance: startDistance - 4,
                forwardVelocity: 350,
                damage: 1
            }]
        };
        const ended = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT);

        expect(ended.state.player.health).toBe(0);
        expect(ended.state.status).toBe('success');
        expect(ended.state.terminalReason).toBe('casino-reached');
        expect(ended.state.creditsStolen).toBe(CASINO_HEIST_REWARD_CREDITS);
        expect(ended.events.map(event => event.kind)).toContain('damage');
        expect(ended.events.map(event => event.kind)).toContain('success');
        expect(ended.events.map(event => event.kind)).not.toContain('failure');
        expect(stepCasinoHeist(ended.state, {steer: 1, fire: true}))
            .toEqual({state: ended.state, events: []});
    });

    it('fails on hull depletion before the finish', () => {
        const generated = course(72);
        const initial = createCasinoHeistState(generated);
        const state: CasinoHeistState = {
            ...initial,
            player: {...initial.player, health: 1},
            projectiles: [{
                id: 'fatal-shot',
                allegiance: 'enemy',
                sourceId: 'test-enemy',
                x: initial.player.x,
                previousDistance: initial.player.distance - 4,
                distance: initial.player.distance - 4,
                forwardVelocity: 350,
                damage: 1
            }]
        };
        const ended = stepCasinoHeist(state, NEUTRAL_CASINO_HEIST_INPUT);
        expect(ended.state.status).toBe('failure');
        expect(ended.state.terminalReason).toBe('car-destroyed');
        expect(ended.state.creditsStolen).toBe(0);
    });

    it('returns render-ready road, entities, interpolation, and HUD state', () => {
        const generated = course(101);
        const initial = createCasinoHeistState(generated);
        const partial = advanceCasinoHeist(
            initial,
            NEUTRAL_CASINO_HEIST_INPUT,
            CASINO_HEIST_FIXED_STEP_MS + 10
        ).state;
        const snapshot = getCasinoHeistRenderSnapshot(partial);

        expect(snapshot.interpolation).toBe(0.5);
        expect(snapshot.road.length).toBeGreaterThan(0);
        expect(snapshot.player.y).toBe(CASINO_HEIST_PLAYER_SCREEN_Y);
        expect(snapshot.player.health).toBe(initial.player.health);
        expect(snapshot.obstacles.length).toBeGreaterThan(0);
        expect(snapshot.powerups.length).toBeGreaterThan(0);
        expect(snapshot.finishDistance).toBe(generated.finishDistance);
        expect(snapshot.status).toBe('active');
    });
});
