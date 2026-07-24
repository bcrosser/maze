import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    NEUTRAL_SHOOTER_INPUT,
    SHOOTER_BOUNDS,
    SHOOTER_ELITE_END_MS,
    SHOOTER_FIXED_STEP_MS,
    SHOOTER_MISSION_LIMIT_MS,
    advanceShooter,
    calculateHostileProjectileSpeedMultiplier,
    calculatePrimaryShot,
    calculateShooterScore,
    chooseShooterModule,
    createShooterMission,
    createShooterState,
    getShooterMissionLimitMs,
    getShooterGrade,
    reconcileShooterBossVictory,
    replayBaseWeaponBossWitness,
    rollShooterUnstableVariant,
    stepShooter,
    type ShooterEnemyState,
    type ShooterMission,
    type ShooterProjectileState,
    type ShooterState
} from '../../../src/minigames/shooter/shooter-model';

function mission(
    seed = 1,
    overrides: Partial<{
        powerRouting: number;
        archiveIntel: boolean;
        securityAlert: number;
        difficulty: 'story' | 'standard' | 'expert';
        levelTier: number;
    }> = {}
): ShooterMission {
    return createShooterMission(new Mulberry32Random(seed), {
        powerRouting: overrides.powerRouting ?? 50,
        archiveIntel: overrides.archiveIntel ?? false,
        securityAlert: overrides.securityAlert ?? 0,
        difficulty: overrides.difficulty ?? 'standard',
        levelTier: overrides.levelTier ?? 0
    });
}

function harmlessMission(seed = 1): ShooterMission {
    const generated = mission(seed);
    return {
        ...generated,
        waves: generated.waves.map(wave => ({...wave, drop: null})),
        hazards: [],
        pickupSpawns: []
    };
}

function armored(state: ShooterState): ShooterState {
    return {
        ...state,
        player: {...state.player, hull: 999, maxHull: 999}
    };
}

function missionLimitTicks(levelTier: number): number {
    return Math.round(getShooterMissionLimitMs(levelTier) / SHOOTER_FIXED_STEP_MS);
}

function enemyAt(
    id: string,
    x: number,
    y: number,
    health: number
): ShooterEnemyState {
    return {
        id,
        definitionId: id,
        archetype: 'carrier',
        path: 'carrier',
        position: {x, y},
        spawnY: y,
        speed: 0,
        pathAmplitude: 0,
        pathPeriodMs: 2_000,
        ageMs: 0,
        health,
        maxHealth: health,
        score: 400,
        radius: 25,
        fireIntervalMs: 99_000,
        shotTimerMs: 99_000,
        windupMs: 0,
        drop: null
    };
}

function projectile(
    id: string,
    allegiance: 'player' | 'hostile',
    x: number,
    y: number,
    damage = 1
): ShooterProjectileState {
    return {
        id,
        allegiance,
        position: {x, y},
        velocity: {x: 0, y: 0},
        damage,
        penetrationsRemaining: 1,
        radius: 5,
        source: allegiance === 'player' ? 'primary' : 'enemy',
        hitEntityIds: []
    };
}

describe('deterministic Space mission generation', () => {
    it('reproduces a mission and produces at least 90 signatures for seeds 0..99', () => {
        const first = mission(99);
        const second = mission(99);
        expect(first).toEqual(second);

        const signatures = new Set(
            Array.from({length: 100}, (_, seed) => {
                const generated = mission(seed);
                return JSON.stringify({
                    waves: generated.waves.map(wave => [
                        wave.spawnAtMs,
                        wave.archetype,
                        wave.path,
                        wave.spawnY,
                        wave.pathAmplitude,
                        wave.pathPeriodMs
                    ]),
                    hazards: generated.hazards,
                    pickups: generated.pickupSpawns,
                    bossPattern: generated.boss.patternVariant
                });
            })
        );
        expect(signatures.size).toBeGreaterThanOrEqual(90);
    });

    it('uses all enemy and pickup families and guarantees an elite upgrade', () => {
        const enemies = new Set<string>();
        const pickups = new Set<string>();
        for (let seed = 0; seed < 100; seed++) {
            const generated = mission(seed);
            generated.waves.forEach(wave => enemies.add(wave.archetype));
            generated.pickupSpawns.forEach(spawn => pickups.add(spawn.pickup.kind));
            generated.waves.forEach(wave => {
                if (wave.drop !== null) pickups.add(wave.drop.kind);
            });
            expect(generated.pickupSpawns.some(spawn =>
                spawn.id === 'spawn-elite-guaranteed' &&
                spawn.spawnAtMs < 65_000
            )).toBe(true);
        }
        expect(enemies).toEqual(new Set(['scout', 'fighter', 'turret', 'carrier', 'mine']));
        expect(pickups).toEqual(new Set([
            'splitter-core',
            'beam-coil',
            'companion-drone',
            'shield-cell',
            'bomb-refill'
        ]));
    });

    it('applies campaign modifiers without auto-fire or phase removal', () => {
        const linked = mission(4, {
            powerRouting: 65,
            archiveIntel: true,
            securityAlert: 100,
            levelTier: 5
        });
        const baseline = mission(4);
        expect(linked.startingShield).toBe(2);
        expect(linked.maximumShield).toBe(2);
        expect(baseline.startingShield).toBe(1);
        expect(linked.archiveHint).not.toBeNull();
        expect(linked.waves.length - baseline.waves.length).toBe(5);
        expect(linked.baseProjectileSpeedMultiplier).toBeCloseTo(1.35);

        const state = advanceShooter(
            createShooterState(linked),
            NEUTRAL_SHOOTER_INPUT,
            1_000
        );
        expect(state.projectiles.filter(shot => shot.allegiance === 'player')).toHaveLength(0);
    });

    it('scales mission time and boss health from the clamped level tier', () => {
        const expectedBossHealth = [
            {nodeHealth: 8, phaseTwoCoreHealth: 12, phaseThreeCoreHealth: 18},
            {nodeHealth: 9, phaseTwoCoreHealth: 14, phaseThreeCoreHealth: 20},
            {nodeHealth: 10, phaseTwoCoreHealth: 15, phaseThreeCoreHealth: 22},
            {nodeHealth: 11, phaseTwoCoreHealth: 16, phaseThreeCoreHealth: 24},
            {nodeHealth: 12, phaseTwoCoreHealth: 17, phaseThreeCoreHealth: 26},
            {nodeHealth: 12, phaseTwoCoreHealth: 18, phaseThreeCoreHealth: 27}
        ] as const;

        for (let tier = 0; tier <= 5; tier++) {
            const generated = mission(90 + tier, {levelTier: tier});
            const missionLimitMs = getShooterMissionLimitMs(tier);
            expect(missionLimitMs).toBe(300_000 + tier * 30_000);
            expect(generated.boss).toMatchObject(expectedBossHealth[tier]!);
            const totalBossHealth =
                generated.boss.nodeHealth * 2 +
                generated.boss.phaseTwoCoreHealth +
                generated.boss.phaseThreeCoreHealth;
            const bossSecondsPerTenHealth =
                ((missionLimitMs - SHOOTER_ELITE_END_MS) / 1_000) /
                (totalBossHealth / 10);
            expect(bossSecondsPerTenHealth).toBeGreaterThanOrEqual(50);
            expect(bossSecondsPerTenHealth).toBeLessThanOrEqual(60);
        }
        expect(getShooterMissionLimitMs(-10)).toBe(300_000);
        expect(getShooterMissionLimitMs(99)).toBe(450_000);
        expect(mission(99, {levelTier: 99}).levelTier).toBe(5);
        expect(() => getShooterMissionLimitMs(Number.NaN)).toThrow('finite number');
    });

    it('caps unstable offers by difficulty', () => {
        for (let seed = 0; seed < 250; seed++) {
            for (const difficulty of ['story', 'standard', 'expert'] as const) {
                const generated = mission(seed, {difficulty});
                const definitions = [
                    ...generated.pickupSpawns.map(spawn => spawn.pickup),
                    ...generated.waves.flatMap(wave => wave.drop === null ? [] : [wave.drop])
                ];
                const unstableCount = definitions.filter(definition => definition.unstable).length;
                expect(unstableCount).toBeLessThanOrEqual(difficulty === 'expert' ? 2 : 1);
            }
        }
    });

    it('uses an exact 10% unstable-roll boundary', () => {
        expect(rollShooterUnstableVariant({next: () => 0})).toBe(true);
        expect(rollShooterUnstableVariant({next: () => 0.099_999})).toBe(true);
        expect(rollShooterUnstableVariant({next: () => 0.1})).toBe(false);
        expect(rollShooterUnstableVariant({next: () => 0.999_999})).toBe(false);
    });
});

describe('Space controls and fixed-step primary fire', () => {
    it('moves continuously with acceleration and clamps to safe bounds', () => {
        const emptyMission = {...mission(), waves: [], hazards: [], pickupSpawns: []};
        let state = createShooterState(emptyMission);
        state = advanceShooter(state, {
            moveX: 0.43,
            moveY: -0.71,
            fireHeld: false
        }, 850);
        expect(state.player.position.x).toBeGreaterThan(116);
        expect(state.player.position.y).toBeLessThan(380);
        expect(state.player.position.x).not.toBe(Math.round(state.player.position.x));

        state = armored(state);
        state = advanceShooter(state, {
            moveX: 1,
            moveY: -1,
            fireHeld: false
        }, 5_000);
        expect(state.player.position.x).toBe(SHOOTER_BOUNDS.maxX);
        expect(state.player.position.y).toBe(SHOOTER_BOUNDS.minY);
    });

    it('keeps simulation timing stable across render schedules', () => {
        const generated = harmlessMission(8);
        const oneFrame = advanceShooter(
            createShooterState(generated),
            NEUTRAL_SHOOTER_INPUT,
            1_000
        );
        let manyFrames = createShooterState(generated);
        for (let frame = 0; frame < 10; frame++) {
            manyFrames = advanceShooter(manyFrames, NEUTRAL_SHOOTER_INPUT, 100);
        }
        expect(manyFrames.activeTicks).toBe(oneFrame.activeTicks);
        expect(manyFrames.phase).toBe(oneFrame.phase);
        expect(manyFrames.enemies).toEqual(oneFrame.enemies);
        expect(manyFrames.worldScroll).toBeCloseTo(oneFrame.worldScroll, 10);
    });

    it('preserves press/release edges until a 60 Hz step consumes them', () => {
        let state = createShooterState(mission());
        state = advanceShooter(state, {
            moveX: 0,
            moveY: 0,
            fireHeld: true,
            firePressed: true
        }, 8);
        expect(state.activeTicks).toBe(0);
        expect(state.projectiles).toHaveLength(0);

        state = advanceShooter(state, {
            moveX: 0,
            moveY: 0,
            fireHeld: false,
            fireReleased: true
        }, 9);
        const playerShots = state.projectiles.filter(shot => shot.allegiance === 'player');
        expect(playerShots).toHaveLength(1);
        expect(playerShots[0]?.damage).toBe(1);
        expect(state.player.cooldownMs).toBe(180);
    });

    it('uses exact tap, charge, Beam Coil, Splitter, and Drone math', () => {
        expect(calculatePrimaryShot(249, null, false)).toMatchObject({
            damage: 1,
            penetrations: 1,
            cooldownMs: 180
        });
        expect(calculatePrimaryShot(725, null, false)).toMatchObject({
            damage: 4,
            penetrations: 2,
            cooldownMs: 315
        });
        expect(calculatePrimaryShot(1_200, null, false)).toMatchObject({
            damage: 6,
            penetrations: 3,
            cooldownMs: 450
        });
        expect(calculatePrimaryShot(900, 'beam-coil', false)).toMatchObject({
            damage: 7,
            penetrations: 4,
            cooldownMs: 540
        });
        expect(calculatePrimaryShot(750, 'beam-coil', true)).toMatchObject({
            damage: 8,
            penetrations: 4,
            cooldownMs: 495
        });

        let state: ShooterState = {
            ...createShooterState(mission()),
            player: {
                ...createShooterState(mission()).player,
                weaponCore: 'splitter-core',
                weaponCoreUnstable: true,
                utilityModule: 'companion-drone',
                utilityModuleUnstable: true,
                droneBlocksRemaining: 2,
                chargeMs: 1_200
            }
        };
        state = stepShooter(state, {
            moveX: 0,
            moveY: 0,
            fireHeld: false,
            fireReleased: true
        });
        const damage = state.projectiles
            .filter(shot => shot.allegiance === 'player')
            .map(shot => shot.damage)
            .sort((left, right) => left - right);
        expect(damage).toEqual([3, 3, 4, 6]);
    });
});

describe('Space bombs, modules, and threat', () => {
    it('consumes one bomb, clears nearby hostile shots, damages enemies, and grants 750ms', () => {
        const initial = createShooterState(mission());
        const position = initial.player.position;
        const state: ShooterState = {
            ...initial,
            enemies: [
                enemyAt('near', position.x + 120, position.y, 7),
                enemyAt('far', position.x + 400, position.y, 7)
            ],
            projectiles: [
                projectile('near-shot', 'hostile', position.x + 100, position.y),
                projectile('far-shot', 'hostile', position.x + 400, position.y)
            ]
        };
        const bombed = stepShooter(state, {
            moveX: 0,
            moveY: 0,
            fireHeld: false,
            bombPressed: true
        });
        expect(bombed.player.bombs).toBe(1);
        expect(bombed.player.bombsUsed).toBe(1);
        expect(bombed.player.invulnerabilityMs).toBe(750);
        expect(bombed.projectiles.map(shot => shot.id)).toEqual(['far-shot']);
        expect(bombed.enemies.find(enemy => enemy.id === 'near')?.health).toBe(4);
        expect(bombed.enemies.find(enemy => enemy.id === 'far')?.health).toBe(7);
    });

    it('pauses on module choice and raises threat only when unstable gear is equipped', () => {
        const initial = createShooterState(mission());
        const choosing: ShooterState = {
            ...initial,
            moduleChoice: {
                pickup: {id: 'unstable-splitter', kind: 'splitter-core', unstable: true}
            }
        };
        expect(advanceShooter(choosing, NEUTRAL_SHOOTER_INPUT, 5_000).activeTicks).toBe(0);

        const equipped = chooseShooterModule(choosing, 'equip');
        expect(equipped.player.weaponCore).toBe('splitter-core');
        expect(equipped.player.weaponCoreUnstable).toBe(true);
        expect(equipped.threatRank).toBe(1);

        const converting: ShooterState = {
            ...equipped,
            moduleChoice: {
                pickup: {id: 'unstable-beam', kind: 'beam-coil', unstable: true}
            }
        };
        const converted = chooseShooterModule(converting, 'convert');
        expect(converted.rawScore).toBe(400);
        expect(converted.threatRank).toBe(1);
        expect(converted.player.weaponCore).toBe('splitter-core');
    });

    it('disables a Companion Drone after its final projectile block', () => {
        const initial = createShooterState(mission());
        const state: ShooterState = {
            ...initial,
            player: {
                ...initial.player,
                utilityModule: 'companion-drone',
                utilityModuleUnstable: false,
                droneBlocksRemaining: 1
            },
            projectiles: [
                projectile(
                    'incoming',
                    'hostile',
                    initial.player.position.x,
                    initial.player.position.y
                )
            ]
        };
        const blocked = stepShooter(state, NEUTRAL_SHOOTER_INPUT);
        expect(blocked.player.hull).toBe(3);
        expect(blocked.player.shield).toBe(initial.player.shield);
        expect(blocked.player.utilityModule).toBeNull();
        expect(blocked.player.droneBlocksRemaining).toBe(0);
        expect(blocked.projectiles).toHaveLength(0);
    });

    it('uses the exact final hostile-speed cap', () => {
        expect(calculateHostileProjectileSpeedMultiplier(0, 0, 0)).toBe(1);
        expect(calculateHostileProjectileSpeedMultiplier(5, 5, 0)).toBeCloseTo(1.35);
        expect(calculateHostileProjectileSpeedMultiplier(5, 5, 3)).toBe(1.5);
        expect(calculateHostileProjectileSpeedMultiplier(99, 99, 99)).toBe(1.5);
    });
});

describe('finite director and Corridor Warden', () => {
    it('transitions at 20/50/65 seconds and always enters the boss', () => {
        let state = armored(createShooterState(harmlessMission(14)));
        state = advanceShooter(state, NEUTRAL_SHOOTER_INPUT, 20_000);
        expect(state.phase).toBe('wreck');
        state = advanceShooter(state, NEUTRAL_SHOOTER_INPUT, 30_000);
        expect(state.phase).toBe('elite');
        state = advanceShooter(state, NEUTRAL_SHOOTER_INPUT, 15_000);
        expect(state.phase).toBe('boss');
        expect(state.boss?.phase).toBe(1);
    });

    it('reaches all boss phases and succeeds only after the final core', () => {
        const generated = mission(21);
        const base = armored(createShooterState(generated));
        const bossX = 586;
        const projectileTravel = 520 * SHOOTER_FIXED_STEP_MS / 1000;
        let state: ShooterState = {
            ...base,
            phase: 'boss',
            activeTicks: 3_900,
            boss: {
                phase: 1,
                position: {x: bossX, y: 380},
                nodeHealth: [1, 0],
                nodeMaxHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                coreHealth: 0,
                coreMaxHealth: 0,
                coreExposed: false,
                phaseElapsedMs: 0,
                attackTimerMs: 99_000,
                windupMs: 0,
                attackIndex: 0
            },
            projectiles: [
                {
                    ...projectile('node-hit', 'player', bossX - 8 - projectileTravel, 288),
                    velocity: {x: 520, y: 0}
                }
            ]
        };
        state = stepShooter(state, NEUTRAL_SHOOTER_INPUT);
        expect(state.boss?.phase).toBe(2);
        expect(state.terminal).toBeNull();

        state = {
            ...state,
            boss: {
                ...state.boss!,
                coreHealth: 1,
                coreMaxHealth: generated.boss.phaseTwoCoreHealth,
                phaseElapsedMs: 1_000,
                coreExposed: true
            },
            projectiles: [
                {
                    ...projectile('phase-two-hit', 'player', bossX - 18 - projectileTravel, 380),
                    velocity: {x: 520, y: 0}
                }
            ]
        };
        state = stepShooter(state, NEUTRAL_SHOOTER_INPUT);
        expect(state.boss?.phase).toBe(3);
        expect(state.terminal).toBeNull();

        state = {
            ...state,
            player: {
                ...state.player,
                position: {x: 300, y: 380}
            },
            boss: {
                ...state.boss!,
                position: {x: bossX, y: 380},
                coreHealth: 1,
                coreMaxHealth: generated.boss.phaseThreeCoreHealth,
                phaseElapsedMs: 1_000,
                coreExposed: true
            },
            projectiles: []
        };
        state = stepShooter(state, {
            ...NEUTRAL_SHOOTER_INPUT,
            bombPressed: true
        });
        expect(state.terminal).toBe('success');
        expect(state.terminalReason).toBe('boss-destroyed');
        expect(state.rawScore).toBe(5_500);
    });

    it('gives a final-core kill precedence on the exact tier-zero deadline tick', () => {
        expect(SHOOTER_MISSION_LIMIT_MS).toBe(300_000);
        const generated = mission(31);
        const missionLimitMs = getShooterMissionLimitMs(generated.levelTier);
        const deadlineTicks = missionLimitTicks(generated.levelTier);
        const initial = armored(createShooterState(generated));
        const state: ShooterState = {
            ...initial,
            phase: 'boss',
            activeTicks: deadlineTicks - 1,
            player: {
                ...initial.player,
                position: {x: 300, y: 380}
            },
            boss: {
                phase: 3,
                position: {x: 586, y: 380},
                nodeHealth: [0, 0],
                nodeMaxHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                coreHealth: 1,
                coreMaxHealth: generated.boss.phaseThreeCoreHealth,
                coreExposed: true,
                phaseElapsedMs: 1_000,
                attackTimerMs: 99_000,
                windupMs: 0,
                attackIndex: 0
            }
        };

        const ended = stepShooter(state, {
            ...NEUTRAL_SHOOTER_INPUT,
            bombPressed: true
        });

        expect(ended.activeTicks).toBe(18_000);
        expect(Math.round(ended.activeTicks * SHOOTER_FIXED_STEP_MS)).toBe(missionLimitMs);
        expect(ended.boss?.coreHealth).toBe(0);
        expect(ended.terminal).toBe('success');
        expect(ended.terminalReason).toBe('boss-destroyed');
    });

    it('resolves a real final player projectile on the exact capped-tier deadline tick', () => {
        const generated = mission(33, {levelTier: 5});
        const missionLimitMs = getShooterMissionLimitMs(generated.levelTier);
        const deadlineTicks = missionLimitTicks(generated.levelTier);
        const initial = armored(createShooterState(generated));
        // This is normally a closed-window boundary. A one-HP critical core
        // stays exposed so an arriving final shot cannot be silently discarded.
        const nextPhaseElapsedMs = 60_000;
        const nextBossPosition = {
            x: 565 + Math.sin(nextPhaseElapsedMs / 2_700 * Math.PI * 2) * 24,
            y: 380 + Math.sin(nextPhaseElapsedMs / 3_500 * Math.PI * 2) * 125
        };
        const state: ShooterState = {
            ...initial,
            phase: 'boss',
            activeTicks: deadlineTicks - 1,
            boss: {
                phase: 3,
                position: nextBossPosition,
                nodeHealth: [0, 0],
                nodeMaxHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                coreHealth: 1,
                coreMaxHealth: generated.boss.phaseThreeCoreHealth,
                coreExposed: true,
                phaseElapsedMs: nextPhaseElapsedMs - SHOOTER_FIXED_STEP_MS,
                attackTimerMs: 99_000,
                windupMs: 0,
                attackIndex: 0
            },
            projectiles: [
                projectile(
                    'last-player-shot',
                    'player',
                    nextBossPosition.x - 18,
                    nextBossPosition.y
                )
            ]
        };

        const ended = stepShooter(state, NEUTRAL_SHOOTER_INPUT);

        expect(ended.activeTicks).toBe(27_000);
        expect(Math.round(ended.activeTicks * SHOOTER_FIXED_STEP_MS)).toBe(missionLimitMs);
        expect(ended.player.hitsTaken).toBe(0);
        expect(ended.boss?.coreHealth).toBe(0);
        expect(ended.terminal).toBe('success');
        expect(ended.terminalReason).toBe('boss-destroyed');
    });

    it('registers the visible edge of a critical core and awards victory once', () => {
        const generated = mission(34);
        const initial = armored(createShooterState(generated));
        const nextPhaseElapsedMs = 1_000 + SHOOTER_FIXED_STEP_MS;
        const nextBossPosition = {
            x: 565 + Math.sin(nextPhaseElapsedMs / 2_700 * Math.PI * 2) * 24,
            y: 380 + Math.sin(nextPhaseElapsedMs / 3_500 * Math.PI * 2) * 125
        };
        const edgeX = nextBossPosition.x - 18 + 33;
        const state: ShooterState = {
            ...initial,
            phase: 'boss',
            activeTicks: 4_000,
            boss: {
                phase: 3,
                position: nextBossPosition,
                nodeHealth: [0, 0],
                nodeMaxHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                coreHealth: 1,
                coreMaxHealth: generated.boss.phaseThreeCoreHealth,
                coreExposed: true,
                phaseElapsedMs: 1_000,
                attackTimerMs: 99_000,
                windupMs: 0,
                attackIndex: 0
            },
            projectiles: [
                projectile('edge-finisher-a', 'player', edgeX, nextBossPosition.y),
                projectile('edge-finisher-b', 'player', edgeX, nextBossPosition.y)
            ]
        };

        const ended = stepShooter(state, NEUTRAL_SHOOTER_INPUT);

        expect(ended.boss?.coreHealth).toBe(0);
        expect(ended.terminal).toBe('success');
        expect(ended.rawScore).toBe(5_000);
    });

    it('repairs a stale failure whenever the final Warden core is destroyed', () => {
        const generated = mission(32);
        const initial = createShooterState(generated);
        const staleFailure: ShooterState = {
            ...initial,
            phase: 'boss',
            activeTicks: missionLimitTicks(initial.mission.levelTier),
            terminal: 'failure',
            terminalReason: 'warden-escaped',
            boss: {
                phase: 3,
                position: {x: 586, y: 380},
                nodeHealth: [0, 0],
                nodeMaxHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                coreHealth: 0,
                coreMaxHealth: generated.boss.phaseThreeCoreHealth,
                coreExposed: true,
                phaseElapsedMs: 60_000,
                attackTimerMs: 0,
                windupMs: 0,
                attackIndex: 0
            }
        };

        const reconciled = reconcileShooterBossVictory(staleFailure);
        expect(reconciled.terminal).toBe('success');
        expect(reconciled.terminalReason).toBe('boss-destroyed');
        expect(advanceShooter(
            staleFailure,
            NEUTRAL_SHOOTER_INPUT,
            SHOOTER_FIXED_STEP_MS
        )).toMatchObject({
            terminal: 'success',
            terminalReason: 'boss-destroyed'
        });
    });

    it('fails an untouched boss at each tier-derived hard deadline', () => {
        for (const tier of [0, 5]) {
            const generated = mission(9 + tier, {levelTier: tier});
            const missionLimitMs = getShooterMissionLimitMs(generated.levelTier);
            const deadlineTicks = missionLimitTicks(generated.levelTier);
            const state: ShooterState = {
                ...armored(createShooterState(generated)),
                phase: 'boss',
                activeTicks: deadlineTicks - 2,
                boss: {
                    phase: 1,
                    position: {x: 586, y: 380},
                    nodeHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                    nodeMaxHealth: [generated.boss.nodeHealth, generated.boss.nodeHealth],
                    coreHealth: 0,
                    coreMaxHealth: 0,
                    coreExposed: false,
                    phaseElapsedMs: 59_980,
                    attackTimerMs: 99_000,
                    windupMs: 0,
                    attackIndex: 0
                }
            };
            const beforeDeadline = stepShooter(state, NEUTRAL_SHOOTER_INPUT);
            expect(beforeDeadline.activeTicks).toBe(deadlineTicks - 1);
            expect(beforeDeadline.terminal).toBeNull();
            expect(beforeDeadline.terminalReason).toBeNull();

            const ended = stepShooter(beforeDeadline, NEUTRAL_SHOOTER_INPUT);
            expect(ended.activeTicks).toBe(deadlineTicks);
            expect(Math.round(ended.activeTicks * SHOOTER_FIXED_STEP_MS)).toBe(missionLimitMs);
            expect(ended.player.hull).toBe(ended.player.maxHull);
            expect(ended.player.hitsTaken).toBe(0);
            expect(ended.terminal).toBe('failure');
            expect(ended.terminalReason).toBe('warden-escaped');
        }
    });

    it('passes the no-module, no-bomb, 30%-miss witness at every tier', () => {
        for (let tier = 0; tier <= 5; tier++) {
            const result = replayBaseWeaponBossWitness(mission(tier, {levelTier: tier}));
            expect(result.success).toBe(true);
            expect(result.elapsedMs).toBeLessThanOrEqual(50_000);
            expect(result.missedOpportunities).toBeGreaterThan(0);
        }
    });
});

describe('Space score and grade', () => {
    it('applies completion bonuses and unstable multiplier exactly once', () => {
        const initial = createShooterState(mission());
        const success: ShooterState = {
            ...initial,
            terminal: 'success',
            terminalReason: 'boss-destroyed',
            rawScore: 6_000,
            threatRank: 1,
            activeTicks: 7_000,
            player: {
                ...initial.player,
                hull: 3,
                bombs: 1,
                bombsUsed: 1
            }
        };
        expect(calculateShooterScore(success)).toBe(Math.floor((6_000 + 1_500 + 250) * 1.25));
        expect(getShooterGrade(success)).toBe('s');
        expect(getShooterGrade({
            ...success,
            player: {...success.player, bombsUsed: 2}
        })).toBe('a');
        expect(getShooterGrade({...success, terminal: 'failure'})).toBe('none');
    });
});
