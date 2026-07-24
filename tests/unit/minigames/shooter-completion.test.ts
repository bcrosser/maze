import {describe, expect, it} from 'vitest';

import {createInitialCampaignState} from '../../../src/domain/campaign/campaign-state';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    parseEncounterResult,
    type EncounterContext
} from '../../../src/encounters/contracts';
import {
    SHOOTER_FIXED_STEP_MS,
    advanceShooter,
    createShooterMission,
    createShooterState,
    type ShooterState
} from '../../../src/minigames/shooter/shooter-model';
import {resolveShooterEncounter} from '../../../src/minigames/shooter/shooter-result';
import {commitObjectiveResult} from '../../../src/scenes/commit-objective-result';
import {encounterResultKeyAction} from '../../../src/scenes/encounter-result-input';
import {getEncounterResultPresentation} from '../../../src/scenes/encounter-result-presentation';

function campaign() {
    return createInitialCampaignState({
        campaignSeed: 0x5eed,
        maze: generateMaze({size: 21, random: new Mulberry32Random(77)})
    });
}

function destroyedWardenState(): ShooterState {
    const mission = createShooterMission(new Mulberry32Random(19), {
        powerRouting: 50,
        archiveIntel: true,
        securityAlert: 0,
        difficulty: 'standard',
        levelTier: 0
    });
    const initial = createShooterState(mission);
    return {
        ...initial,
        phase: 'boss',
        terminal: 'failure',
        terminalReason: 'warden-escaped',
        boss: {
            phase: 3,
            position: {x: 586, y: 380},
            nodeHealth: [0, 0],
            nodeMaxHealth: [mission.boss.nodeHealth, mission.boss.nodeHealth],
            coreHealth: 0,
            coreMaxHealth: mission.boss.phaseThreeCoreHealth,
            coreExposed: true,
            phaseElapsedMs: 60_000,
            attackTimerMs: 0,
            windupMs: 0,
            attackIndex: 0
        }
    };
}

function context(snapshot: ReturnType<typeof campaign>): EncounterContext {
    return {
        runId: 'level-1/hangar-uplink/0',
        definitionId: 'orbital-corridor',
        kind: 'shooter',
        act: 1,
        seed: 19,
        difficulty: 'standard',
        campaignSnapshot: snapshot,
        trigger: {
            triggerId: 'hangar-uplink',
            position: {x: 3, y: 3},
            nearbyMaterialIds: [],
            nearbyMaterialTags: []
        },
        modifiers: {}
    };
}

describe('Space terminal completion boundary', () => {
    it('keeps a destroyed boss successful while Space repeats and commits progression once', () => {
        const original = campaign();
        let state = destroyedWardenState();

        // Browser Space keydown/repeat maps to held + pressed primary fire.
        for (let repeat = 0; repeat < 12; repeat++) {
            state = advanceShooter(state, {
                moveX: 0,
                moveY: 0,
                fireHeld: true,
                firePressed: true
            }, SHOOTER_FIXED_STEP_MS);
        }

        const completion = resolveShooterEncounter(context(original), state, 'failure');
        expect(completion.state.terminal).toBe('success');
        expect(completion.state.terminalReason).toBe('boss-destroyed');
        expect(completion.result.status).toBe('success');
        expect(completion.result.failureReason).toBeUndefined();

        const committed = commitObjectiveResult(original, 'space', completion.result);
        const duplicate = commitObjectiveResult(committed, 'space', completion.result);
        expect(duplicate).toBe(committed);
        expect(
            duplicate.flags.filter(flag => flag === 'orbital-corridor-cleared')
        ).toHaveLength(1);
        expect(
            duplicate.appliedEncounterRunIds.filter(id => id === completion.result.runId)
        ).toHaveLength(1);
        expect(
            duplicate.encounterHistory.filter(entry =>
                entry.runId === completion.result.runId &&
                entry.status === 'success'
            )
        ).toHaveLength(1);
    });

    it('makes the campaign completion flag authoritative even if a scene omits its effect', () => {
        const original = campaign();
        const completion = resolveShooterEncounter(
            context(original),
            destroyedWardenState(),
            'failure'
        );
        const withoutCompletionEffect = {
            ...completion.result,
            effects: completion.result.effects.filter(effect =>
                effect.kind !== 'set-flag' ||
                effect.flag !== 'orbital-corridor-cleared'
            )
        };

        const committed = commitObjectiveResult(
            original,
            'space',
            withoutCompletionEffect
        );
        expect(committed.flags).toContain('orbital-corridor-cleared');
        expect(committed.encounterHistory).toHaveLength(1);
    });

    it('consumes held fire on the result card and requires a deliberate Enter', () => {
        expect(encounterResultKeyAction(' ', false)).toBe('consume');
        expect(encounterResultKeyAction(' ', true)).toBe('consume');
        expect(encounterResultKeyAction('Enter', true)).toBe('consume');
        expect(encounterResultKeyAction('Enter', false)).toBe('confirm');
        expect(encounterResultKeyAction('Escape', false)).toBe('cancel');
    });

    it('carries an expired Warden deadline into explicit retry-card copy', () => {
        const original = campaign();
        const destroyed = destroyedWardenState();
        const timedOut: ShooterState = {
            ...destroyed,
            boss: {
                ...destroyed.boss!,
                coreHealth: 1
            }
        };

        const completion = resolveShooterEncounter(context(original), timedOut, 'failure');
        expect(completion.result).toMatchObject({
            status: 'failure',
            failureReason: 'warden-escaped'
        });
        expect(parseEncounterResult(completion.result).failureReason).toBe('warden-escaped');
        const presentation = getEncounterResultPresentation('Space', completion.result);
        expect(presentation).toEqual({
            title: 'TIME EXPIRED',
            detail: 'The mission timer reached zero.\n' +
                'The Warden escaped; Space remains available.',
            returnMessage: 'Time expired. The Corridor Warden escaped; Space remains available.'
        });
        expect(presentation.detail.split('\n')).toEqual([
            'The mission timer reached zero.',
            'The Warden escaped; Space remains available.'
        ]);
        expect(Math.max(...presentation.detail.split('\n').map(line => line.length)))
            .toBeLessThanOrEqual(44);
    });
});
