import {describe, expect, it} from 'vitest';

import {
    createActOnePlatformerLevel,
    createPlatformerState,
    stepPlatformer,
    type PlatformerState
} from '../../../src/minigames/platformer/platformer-model';

const FULLY_LINKED = {powerRouting: 65, miningPower: 2, airspaceControl: 70};

describe('platformer model', () => {
    it('adds bridges and a checkpoint from prior genre outcomes', () => {
        const linked = createActOnePlatformerLevel(FULLY_LINKED);
        const isolated = createActOnePlatformerLevel({
            powerRouting: 50,
            miningPower: 0,
            airspaceControl: 50
        });

        expect(linked.platforms.map(platform => platform.id)).toContain('tool-bridge');
        expect(linked.platforms.map(platform => platform.id)).toContain('supply-drone-bridge');
        expect(linked.platforms.map(platform => platform.id)).toContain('powered-lift');
        expect(linked.checkpoints).toHaveLength(1);
        expect(isolated.platforms.map(platform => platform.id)).not.toContain('tool-bridge');
        expect(isolated.checkpoints).toHaveLength(0);
    });

    it('buffers a jump shortly before landing', () => {
        const level = createActOnePlatformerLevel(FULLY_LINKED);
        let state: PlatformerState = {
            ...createPlatformerState(level),
            y: 545,
            velocityY: 100,
            grounded: false
        };
        state = stepPlatformer(state, {horizontal: 0, jumpPressed: true, jumpHeld: true}, level, 16);
        for (let frame = 0; frame < 8 && state.velocityY >= 0; frame++) {
            state = stepPlatformer(
                state,
                {horizontal: 0, jumpPressed: false, jumpHeld: true},
                level,
                16
            );
        }

        expect(state.velocityY).toBeLessThan(0);
        expect(state.jumpBufferMs).toBe(0);
    });

    it('allows a coyote-time jump just after leaving a platform', () => {
        const level = createActOnePlatformerLevel(FULLY_LINKED);
        const state: PlatformerState = {
            ...createPlatformerState(level),
            x: 370,
            y: 520,
            grounded: false,
            coyoteMs: 70
        };
        const jumped = stepPlatformer(
            state,
            {horizontal: 1, jumpPressed: true, jumpHeld: true},
            level,
            16
        );

        expect(jumped.velocityY).toBeLessThan(-300);
    });

    it('respawns at the latest checkpoint after touching a hazard', () => {
        const level = createActOnePlatformerLevel(FULLY_LINKED);
        const state: PlatformerState = {
            ...createPlatformerState(level),
            x: 1012,
            y: 540,
            checkpoint: {x: 875, y: 520}
        };
        const respawned = stepPlatformer(
            state,
            {horizontal: 0, jumpPressed: false, jumpHeld: false},
            level,
            16
        );

        expect(respawned.deaths).toBe(1);
        expect(respawned.x).toBe(875);
        expect(respawned.y).toBe(480);
    });

    it('allows the fully linked Act I route with one held jump', () => {
        const level = createActOnePlatformerLevel(FULLY_LINKED);
        let state = createPlatformerState(level);
        let jumpStarted = false;

        for (let frame = 0; frame < 700 && !state.completed; frame++) {
            const shouldJump = state.x >= 920 && state.x < 1100;
            const jumpPressed = shouldJump && !jumpStarted;
            if (shouldJump) jumpStarted = true;
            state = stepPlatformer(state, {
                horizontal: 1,
                jumpPressed,
                jumpHeld: shouldJump
            }, level, 16);
        }

        expect(state.completed).toBe(true);
        expect(state.deaths).toBe(0);
    });
});