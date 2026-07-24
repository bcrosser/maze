import {describe, expect, it} from 'vitest';

import {MATERIALS} from '../../../src/domain/materials/materials';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    advancePlatformer,
    canonicalPlatformerSignature,
    createGeneratedPlatformerLevel,
    createPlatformerState,
    platformerGrade,
    platformerOutcome,
    platformerScore,
    setPlatformerPaused,
    validatePlatformerLevel,
    type PlatformRect,
    type PlatformerCollectible,
    type PlatformerEnemyDefinition,
    type PlatformerInput,
    type PlatformerLevel,
    type PlatformerState,
    type PlatformerSurfaceKind
} from '../../../src/minigames/platformer/platformer-model';

const MODIFIERS = {
    powerRouting: 50,
    miningPower: 0,
    airspaceControl: 50
};
const LINKED_MODIFIERS = {
    powerRouting: 65,
    miningPower: 2,
    airspaceControl: 70
};
const IDLE: PlatformerInput = {
    horizontal: 0,
    jumpPressed: false,
    jumpHeld: false,
    firePressed: false
};

function platform(
    id: string,
    surfaceKind: PlatformerSurfaceKind = 'normal',
    options: {
        readonly conveyorVelocity?: number;
        readonly liftStartY?: number;
        readonly liftEndY?: number;
    } = {}
): PlatformRect {
    return {
        id,
        x: 0,
        y: 500,
        width: 800,
        height: 172,
        materialId: surfaceKind,
        surfaceKind,
        conveyorVelocity: options.conveyorVelocity ?? 0,
        liftStartY: options.liftStartY ?? 500,
        liftEndY: options.liftEndY ?? 500
    };
}

function flatLevel(
    surfaceKind: PlatformerSurfaceKind = 'normal',
    options: {
        readonly collectibles?: readonly PlatformerCollectible[];
        readonly enemies?: readonly PlatformerEnemyDefinition[];
        readonly conveyorVelocity?: number;
        readonly deathLimit?: number;
    } = {}
): PlatformerLevel {
    const ground = platform('ground-0', surfaceKind, {
        ...(options.conveyorVelocity === undefined
            ? {}
            : {conveyorVelocity: options.conveyorVelocity}),
        liftStartY: 500,
        liftEndY: surfaceKind === 'lift' ? 400 : 500
    });
    const cores = options.collectibles?.filter(item => item.kind === 'core').length ?? 0;
    const salvage = options.collectibles?.filter(item => item.kind === 'salvage').length ?? 0;
    return {
        generatorId: 'platformer-sections-v1',
        width: 800,
        height: 672,
        difficulty: 'standard',
        levelTier: 0,
        deathLimit: options.deathLimit ?? 5,
        spawn: {x: 100, y: 500},
        sections: [{
            templateId: 'test',
            x: 0,
            width: 800,
            entryY: 500,
            exitY: 500,
            difficultyCost: 0,
            traversalTags: ['main']
        }],
        platforms: [ground],
        hazards: [{
            ...platform('lower-void'),
            x: 0,
            y: 666,
            width: 800,
            height: 6,
            hazardKind: 'pit'
        }],
        checkpoints: [],
        goal: {
            ...platform('maintenance-exit'),
            x: 730,
            y: 390,
            width: 48,
            height: 110
        },
        collectibles: options.collectibles ?? [],
        enemies: options.enemies ?? [],
        requiredCoreTotal: cores,
        optionalSalvageTotal: salvage,
        fallbackUsed: false
    };
}

function groundedState(level: PlatformerLevel): PlatformerState {
    return {
        ...createPlatformerState(level),
        x: 100,
        y: 460,
        grounded: true,
        groundedPlatformId: 'ground-0',
        coyoteMs: 100
    };
}

function stepFrames(
    initial: PlatformerState,
    level: PlatformerLevel,
    frames: number,
    input: PlatformerInput = IDLE
): {readonly state: PlatformerState; readonly events: readonly string[]} {
    let state = initial;
    const events: string[] = [];
    for (let frame = 0; frame < frames && state.status === 'active'; frame++) {
        const result = advancePlatformer(state, input, level, 16);
        state = result.state;
        events.push(...result.events.map(event => event.kind));
    }
    return {state, events};
}

describe('seeded platformer generation', () => {
    it('reproduces full levels and creates at least ninety signatures for seeds 0..99', () => {
        const signatures = new Set<string>();
        for (let seed = 0; seed < 100; seed++) {
            const level = createGeneratedPlatformerLevel(
                new Mulberry32Random(seed),
                {difficulty: 'standard', levelTier: 2, modifiers: MODIFIERS}
            );
            const duplicate = createGeneratedPlatformerLevel(
                new Mulberry32Random(seed),
                {difficulty: 'standard', levelTier: 2, modifiers: MODIFIERS}
            );
            expect(level).toEqual(duplicate);
            expect(level.width).toBeGreaterThanOrEqual(2_400);
            expect(level.width).toBeLessThanOrEqual(3_200);
            signatures.add(canonicalPlatformerSignature(level));
        }

        expect(signatures.size).toBeGreaterThanOrEqual(90);
    });

    it('validates hundreds of seeds and modifier combinations', () => {
        for (let seed = 0; seed < 200; seed++) {
            const level = createGeneratedPlatformerLevel(
                new Mulberry32Random(seed * 97 + 11),
                {
                    difficulty: seed % 3 === 0 ? 'story' : seed % 3 === 1 ? 'standard' : 'expert',
                    levelTier: seed % 6,
                    modifiers: seed % 2 === 0 ? MODIFIERS : LINKED_MODIFIERS
                }
            );
            expect(validatePlatformerLevel(level)).toEqual({valid: true, errors: []});
            expect(level.requiredCoreTotal).toBeGreaterThanOrEqual(3);
            expect(level.requiredCoreTotal).toBeLessThanOrEqual(5);
            expect(level.enemies.length).toBeLessThanOrEqual(14);
            expect(level.sections.length).toBeLessThanOrEqual(10);
        }
    });

    it('adds reward routes without replacing the baseline checkpoint or core route', () => {
        const linked = createGeneratedPlatformerLevel(
            new Mulberry32Random(44),
            {difficulty: 'standard', modifiers: LINKED_MODIFIERS}
        );
        const ids = linked.platforms.map(candidate => candidate.id);

        expect(ids).toContain('tool-bridge');
        expect(ids).toContain('powered-lift');
        expect(ids).toContain('supply-drone-bridge');
        expect(linked.checkpoints.some(checkpoint => checkpoint.baseline)).toBe(true);
        expect(linked.checkpoints).toHaveLength(2);
        expect(linked.collectibles.filter(item => item.kind === 'core')
            .every(item => item.platformId !== 'powered-lift')).toBe(true);
    });

    it('maps generated conveyor surfaces to the registered metal material', () => {
        const conveyors = Array.from({length: 16}, (_, seed) =>
            createGeneratedPlatformerLevel(
                new Mulberry32Random(seed),
                {difficulty: 'standard', levelTier: 2, modifiers: MODIFIERS}
            )
        ).flatMap(level =>
            level.platforms.filter(platform => platform.surfaceKind === 'conveyor')
        );

        expect(conveyors.length).toBeGreaterThan(0);
        expect(conveyors.every(platform => platform.materialId === 'metal')).toBe(true);
        expect(MATERIALS.metal.tags).toContain('conductive');
    });
});

describe('movement and material surfaces', () => {
    it('uses baseline acceleration, jump impulse, gravity, and early-release clamp', () => {
        const level = flatLevel();
        const accelerated = advancePlatformer(
            groundedState(level),
            {horizontal: 1, jumpPressed: false, jumpHeld: false},
            level,
            16
        ).state;
        const jumped = advancePlatformer(
            groundedState(level),
            {horizontal: 0, jumpPressed: true, jumpHeld: true},
            level,
            16
        ).state;
        const released = advancePlatformer(
            jumped,
            {horizontal: 0, jumpPressed: false, jumpHeld: false},
            level,
            16
        ).state;

        expect(accelerated.velocityX).toBeCloseTo(22.4, 4);
        expect(jumped.velocityY).toBeCloseTo(-414, 4);
        expect(released.velocityY).toBeCloseTo(-164, 4);
    });

    it('gives ice 35% acceleration and 15% braking', () => {
        const normal = flatLevel('normal');
        const ice = flatLevel('ice');
        const normalMoving = advancePlatformer(
            groundedState(normal),
            {horizontal: 1, jumpPressed: false, jumpHeld: false},
            normal,
            16
        ).state;
        const iceMoving = advancePlatformer(
            groundedState(ice),
            {horizontal: 1, jumpPressed: false, jumpHeld: false},
            ice,
            16
        ).state;
        const normalStopped = advancePlatformer(
            {...groundedState(normal), velocityX: 100},
            IDLE,
            normal,
            16
        ).state;
        const iceStopped = advancePlatformer(
            {...groundedState(ice), velocityX: 100},
            IDLE,
            ice,
            16
        ).state;

        expect(iceMoving.velocityX).toBeCloseTo(normalMoving.velocityX * 0.35, 4);
        expect(100 - iceStopped.velocityX).toBeCloseTo((100 - normalStopped.velocityX) * 0.15, 4);
    });

    it('adds the declared conveyor velocity while grounded', () => {
        const normal = flatLevel('normal');
        const conveyor = flatLevel('conveyor', {conveyorVelocity: 70});
        const normalStep = advancePlatformer(groundedState(normal), IDLE, normal, 16).state;
        const conveyorStep = advancePlatformer(
            groundedState(conveyor),
            IDLE,
            conveyor,
            16
        ).state;

        expect(conveyorStep.x - normalStep.x).toBeCloseTo(70 * 0.016, 5);
    });

    it('warns for 600ms, disables, then resets a crumbling surface', () => {
        const base = flatLevel('crumbling');
        const crumble = {...base.platforms[0]!, width: 300};
        const safe = {
            ...platform('safe-ground'),
            x: 400,
            width: 400
        };
        const level = {...base, platforms: [crumble, safe]};
        const collapsed = stepFrames({
            ...createPlatformerState(level),
            x: 100,
            y: 460,
            grounded: true,
            groundedPlatformId: 'ground-0',
            coyoteMs: 100
        }, level, 38).state;
        const collapsedSurface = collapsed.surfaceStates[0]!;
        const reset = stepFrames(
            {
                ...collapsed,
                x: 500,
                y: 460,
                velocityY: 0,
                grounded: true,
                groundedPlatformId: 'safe-ground'
            },
            level,
            126
        ).state;

        expect(collapsedSurface.crumbleDisabledMs).toBeGreaterThan(0);
        expect(reset.surfaceStates[0]?.crumbleDisabledMs).toBe(0);
    });

    it('applies the bounce impulse and moves/carries with an 80px/s lift', () => {
        const bounce = flatLevel('bounce');
        const landed = stepFrames(
            {...createPlatformerState(bounce), x: 100, y: 450, velocityY: 100},
            bounce,
            8
        ).state;
        const lift = flatLevel('lift');
        const lifted = stepFrames(groundedState(lift), lift, 63).state;

        expect(landed.velocityY).toBeLessThan(-500);
        expect(lifted.surfaceStates[0]?.liftOffsetY).toBeLessThan(-40);
        expect(lifted.y).toBeLessThan(430);
    });

    it('is invariant to batching because the model owns a 16ms accumulator', () => {
        const level = flatLevel();
        const state = groundedState(level);
        const batched = advancePlatformer(
            state,
            {horizontal: 1, jumpPressed: false, jumpHeld: false},
            level,
            160
        ).state;
        const stepped = stepFrames(
            state,
            level,
            10,
            {horizontal: 1, jumpPressed: false, jumpHeld: false}
        ).state;

        expect(batched).toEqual(stepped);
    });
});

describe('collection, combat, checkpoints, and failure', () => {
    it('keeps the exit locked until every required core is collected', () => {
        const cores: PlatformerCollectible[] = [0, 1, 2].map(index => ({
            id: `core-${index}`,
            kind: 'core',
            x: 150 + index * 80,
            y: 480,
            platformId: 'ground-0',
            required: true
        }));
        const level = flatLevel('normal', {collectibles: cores});
        let state = {
            ...groundedState(level),
            x: level.goal.x,
            y: level.goal.y + 60
        };
        const locked = advancePlatformer(state, IDLE, level, 16);

        expect(locked.state.status).toBe('active');
        expect(locked.events).toContainEqual({kind: 'exit-locked', missing: 3});

        state = groundedState(level);
        for (const core of cores) {
            state = advancePlatformer(
                {...state, x: core.x - 14, y: 460},
                IDLE,
                level,
                16
            ).state;
        }
        const success = advancePlatformer(
            {...state, x: level.goal.x, y: level.goal.y + 60},
            IDLE,
            level,
            16
        );
        expect(success.state.status).toBe('success');
        expect(success.events).toContainEqual({kind: 'success'});
    });

    it('collects the guaranteed blaster, consumes ammo, and defeats enemies', () => {
        const weapon: PlatformerCollectible = {
            id: 'pulse-blaster',
            kind: 'pulse-blaster',
            x: 118,
            y: 480,
            platformId: 'ground-0',
            required: false
        };
        const enemy: PlatformerEnemyDefinition = {
            id: 'target',
            kind: 'patroller',
            x: 220,
            y: 500,
            platformId: 'ground-0',
            patrolMinimumX: 218,
            patrolMaximumX: 222,
            health: 1
        };
        const level = flatLevel('normal', {collectibles: [weapon], enemies: [enemy]});
        let state = advancePlatformer(groundedState(level), IDLE, level, 16).state;
        expect(state).toMatchObject({weaponOwned: true, ammo: 6});

        const fired = advancePlatformer(
            state,
            {horizontal: 0, jumpPressed: false, jumpHeld: false, firePressed: true},
            level,
            16
        );
        state = stepFrames(fired.state, level, 24).state;

        expect(fired.events).toContainEqual({kind: 'shot-fired'});
        expect(fired.state.ammo).toBe(5);
        expect(state.defeatedEnemyIds).toContain('target');
    });

    it('applies contact damage, knockback, and at least 800ms invulnerability', () => {
        const enemy: PlatformerEnemyDefinition = {
            id: 'contact',
            kind: 'turret',
            x: 120,
            y: 500,
            platformId: 'ground-0',
            patrolMinimumX: 120,
            patrolMaximumX: 120,
            health: 2
        };
        const level = flatLevel('normal', {enemies: [enemy]});
        const first = advancePlatformer(
            {...groundedState(level), x: 110},
            IDLE,
            level,
            16
        ).state;
        const protectedHit = advancePlatformer(
            {...first, x: 110, y: 460},
            IDLE,
            level,
            16
        ).state;

        expect(first.health).toBe(2);
        expect(first.damageEvents).toBe(1);
        expect(Math.abs(first.velocityX)).toBe(140);
        expect(first.velocityY).toBe(-180);
        expect(first.invulnerableMs).toBe(800);
        expect(protectedHit.health).toBe(2);
        expect(protectedHit.damageEvents).toBe(1);
    });

    it('runs each enemy archetype with its specified movement or attack telegraph', () => {
        const definition = (
            id: string,
            kind: PlatformerEnemyDefinition['kind'],
            x: number
        ): PlatformerEnemyDefinition => ({
            id,
            kind,
            x,
            y: kind === 'drone' ? 390 : 500,
            platformId: 'ground-0',
            patrolMinimumX: x - 20,
            patrolMaximumX: x,
            health: kind === 'patroller' ? 1 : kind === 'sentry' ? 4 : 2
        });
        const level = flatLevel('normal', {
            enemies: [
                definition('patroller', 'patroller', 220),
                definition('hopper', 'hopper', 340),
                definition('turret', 'turret', 460),
                definition('drone', 'drone', 570),
                definition('sentry', 'sentry', 680)
            ]
        });
        let state = groundedState(level);
        state = advancePlatformer(state, IDLE, level, 16).state;
        expect(state.enemies.find(enemy => enemy.id === 'patroller')).toMatchObject({
            facing: -1,
            velocityX: -70
        });
        expect(state.enemies.find(enemy => enemy.id === 'sentry')?.velocityX).toBe(-35);
        expect(state.enemies.find(enemy => enemy.id === 'turret')?.mode).toBe('aim');

        state = stepFrames(state, level, 124).state;
        expect(state.enemies.find(enemy => enemy.id === 'hopper')?.mode).toBe('crouch');
        expect(state.enemies.find(enemy => enemy.id === 'drone')?.mode).toBe('warn');

        state = stepFrames(state, level, 32).state;
        expect(state.enemies.find(enemy => enemy.id === 'hopper')?.mode).toBe('airborne');
        expect(state.enemies.find(enemy => enemy.id === 'drone')?.mode).toBe('dive');
        expect(state.projectiles.some(projectile => projectile.owner === 'enemy')).toBe(true);
    });

    it('lets a ten-second shield absorb exactly one hit', () => {
        const shield: PlatformerCollectible = {
            id: 'shield',
            kind: 'shield',
            x: 110,
            y: 480,
            platformId: 'ground-0',
            required: false
        };
        const enemy: PlatformerEnemyDefinition = {
            id: 'contact',
            kind: 'patroller',
            x: 240,
            y: 500,
            platformId: 'ground-0',
            patrolMinimumX: 238,
            patrolMaximumX: 242,
            health: 1
        };
        const level = flatLevel('normal', {collectibles: [shield], enemies: [enemy]});
        const protectedState = advancePlatformer(
            groundedState(level),
            IDLE,
            level,
            16
        ).state;
        const absorbed = advancePlatformer(
            {...protectedState, x: 230, y: 460, invulnerableMs: 0},
            IDLE,
            level,
            16
        );

        expect(protectedState.shieldMs).toBe(10_000);
        expect(absorbed.events).toContainEqual({kind: 'shield-absorbed'});
        expect(absorbed.state.health).toBe(3);
        expect(absorbed.state.shieldMs).toBe(0);
    });

    it('activates checkpoints and preserves cores, kills, weapon, and minimum ammo on respawn', () => {
        const level = {
            ...flatLevel(),
            checkpoints: [{
                ...platform('checkpoint'),
                id: 'midpoint',
                x: 90,
                y: 430,
                width: 40,
                height: 70,
                respawnX: 100,
                respawnY: 500,
                baseline: true
            }]
        };
        let state = advancePlatformer(
            {...groundedState(level), weaponOwned: true, ammo: 0},
            IDLE,
            level,
            16
        ).state;
        state = {
            ...state,
            y: 680,
            collectedCoreIds: ['core-kept'],
            collectedIds: ['core-kept'],
            defeatedEnemyIds: ['enemy-kept']
        };
        const respawned = advancePlatformer(state, IDLE, level, 16).state;

        expect(respawned).toMatchObject({
            x: 100,
            y: 460,
            health: 3,
            ammo: 6,
            deaths: 1,
            collectedCoreIds: ['core-kept'],
            defeatedEnemyIds: ['enemy-kept']
        });
    });

    it('uses Story, Standard, and Expert death caps exactly', () => {
        for (const [difficulty, limit] of [
            ['story', 7],
            ['standard', 5],
            ['expert', 3]
        ] as const) {
            const generated = createGeneratedPlatformerLevel(
                new Mulberry32Random(limit),
                {difficulty, modifiers: MODIFIERS}
            );
            const failed = advancePlatformer(
                {...createPlatformerState(generated), y: 680, deaths: limit - 1},
                IDLE,
                generated,
                16
            ).state;
            expect(generated.deathLimit).toBe(limit);
            expect(failed.status).toBe('failure');
            expect(failed.deaths).toBe(limit);
        }
    });

    it('applies EMP, shield, and ammo pickups without creating a required-route dependency', () => {
        const pickups: PlatformerCollectible[] = [
            {id: 'emp', kind: 'emp', x: 110, y: 480, platformId: 'ground-0', required: false},
            {id: 'shield', kind: 'shield', x: 110, y: 480, platformId: 'ground-0', required: false},
            {id: 'ammo', kind: 'ammo', x: 110, y: 480, platformId: 'ground-0', required: false}
        ];
        const enemies: PlatformerEnemyDefinition[] = [
            {
                id: 'light',
                kind: 'hopper',
                x: 180,
                y: 500,
                platformId: 'ground-0',
                patrolMinimumX: 180,
                patrolMaximumX: 180,
                health: 2
            },
            {
                id: 'armor',
                kind: 'sentry',
                x: 220,
                y: 500,
                platformId: 'ground-0',
                patrolMinimumX: 220,
                patrolMaximumX: 220,
                health: 4
            }
        ];
        const level = flatLevel('normal', {collectibles: pickups, enemies});
        const picked = advancePlatformer(
            {...groundedState(level), weaponOwned: true, ammo: 9},
            IDLE,
            level,
            16
        ).state;

        expect(picked.defeatedEnemyIds).toContain('light');
        expect(picked.enemies.find(enemy => enemy.id === 'armor')?.stunMs).toBe(3_000);
        expect(picked.shieldMs).toBe(10_000);
        expect(picked.ammo).toBe(12);
    });

    it('freezes physics and active time while paused', () => {
        const level = flatLevel();
        const state = setPlatformerPaused(groundedState(level), true);
        expect(advancePlatformer(state, {
            horizontal: 1,
            jumpPressed: true,
            jumpHeld: true,
            firePressed: true
        }, level, 5_000).state).toEqual(state);
    });
});

describe('platformer result math', () => {
    const resultLevel = {
        ...flatLevel(),
        optionalSalvageTotal: 4
    };
    const successful = {
        ...createPlatformerState(resultLevel),
        status: 'success' as const,
        completed: true,
        collectedCoreIds: ['a', 'b', 'c'],
        collectedIds: ['a', 'b', 'c'],
        collectedSalvageIds: ['s1', 's2', 's3', 's4'],
        defeatedEnemyIds: ['e1', 'e2']
    };

    it('applies exact grade boundaries', () => {
        expect(platformerGrade({
            ...successful,
            activeElapsedMs: 105_000,
            deaths: 0,
            damageEvents: 1
        }, resultLevel)).toBe('s');
        expect(platformerGrade({
            ...successful,
            activeElapsedMs: 130_000,
            deaths: 1,
            collectedSalvageIds: ['s1', 's2']
        }, resultLevel)).toBe('a');
        expect(platformerGrade({
            ...successful,
            activeElapsedMs: 131_000,
            deaths: 3,
            collectedSalvageIds: []
        }, resultLevel)).toBe('b');
        expect(platformerGrade({...successful, deaths: 4}, resultLevel)).toBe('c');
        expect(platformerGrade({...successful, status: 'active'}, resultLevel)).toBe('none');
    });

    it('uses exact score terms and the 500-point floor', () => {
        const state = {
            ...successful,
            activeElapsedMs: 12_900,
            deaths: 1,
            damageEvents: 2
        };
        expect(platformerScore(state)).toBe(
            3_000 + 4 * 250 + 2 * 150 - 300 - 2 * 100 - 5 * 12
        );
        expect(platformerScore({
            ...state,
            activeElapsedMs: 900_000,
            deaths: 20,
            damageEvents: 20,
            collectedSalvageIds: [],
            defeatedEnemyIds: []
        })).toBe(500);
        expect(platformerScore({...state, status: 'failure'})).toBe(0);
    });

    it('returns exact success, failure, and abandonment economy summaries', () => {
        expect(platformerOutcome('success', successful)).toEqual({
            scrapDelta: 7,
            campaignHealthDelta: 2,
            structuralStabilityDelta: 20,
            flags: ['sublevel-nine-stabilized', 'memory-cartridges-3']
        });
        expect(platformerOutcome('failure', successful)).toEqual({
            scrapDelta: 0,
            campaignHealthDelta: -2,
            structuralStabilityDelta: -5,
            flags: ['sublevel-nine-awaits-repairs']
        });
        expect(platformerOutcome('abandoned', successful)).toEqual({
            scrapDelta: 0,
            campaignHealthDelta: -1,
            structuralStabilityDelta: -5,
            flags: ['sublevel-nine-awaits-repairs']
        });
    });
});
