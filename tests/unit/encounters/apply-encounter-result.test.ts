import {describe, expect, it} from 'vitest';

import {createInitialCampaignState} from '../../../src/domain/campaign/campaign-state';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {applyEncounterResult} from '../../../src/encounters/apply-encounter-result';
import type {EncounterResult} from '../../../src/encounters/contracts';

function createCampaign(seed = 42) {
    const maze = generateMaze({size: 21, random: new Mulberry32Random(seed)});
    return createInitialCampaignState({campaignSeed: seed, maze});
}

const successfulPipeResult = {
    runId: 'run-pipe-001',
    definitionId: 'act-1-coolant-routing',
    triggerId: 'coolant-terminal',
    kind: 'pipe',
    status: 'success',
    grade: 'a',
    score: 4200,
    elapsedMs: 31_500,
    effects: [
        {kind: 'change-resource', resource: 'scrap', delta: 8},
        {kind: 'upgrade-mining-power', minimum: 2},
        {kind: 'adjust-world-system', system: 'powerRouting', delta: 20},
        {kind: 'set-flag', flag: 'coolant-restored'},
        {kind: 'install-module', moduleId: 'pressure-bypass'},
        {
            kind: 'transform-cell',
            position: {x: 2, y: 2},
            cell: {kind: 'passage', materialId: null}
        },
        {kind: 'set-trigger-state', triggerId: 'coolant-terminal', state: 'resolved'}
    ]
} satisfies EncounterResult;

describe('applyEncounterResult', () => {
    it('commits cross-system and overworld effects as one result', () => {
        const nextState = applyEncounterResult(createCampaign(), successfulPipeResult);

        expect(nextState.player.scrap).toBe(8);
        expect(nextState.player.miningPower).toBe(2);
        expect(nextState.player.installedModuleIds).toContain('pressure-bypass');
        expect(nextState.worldSystems.powerRouting).toBe(70);
        expect(nextState.flags).toContain('coolant-restored');
        expect(nextState.overworld.maze[2]?.[2]?.kind).toBe('passage');
        expect(nextState.overworld.triggerStates['coolant-terminal']).toBe('resolved');
        expect(nextState.encounterHistory).toHaveLength(1);
    });

    it('does not apply the same encounter run twice', () => {
        const committed = applyEncounterResult(createCampaign(), successfulPipeResult);
        const duplicate = applyEncounterResult(committed, successfulPipeResult);

        expect(duplicate).toBe(committed);
        expect(duplicate.player.scrap).toBe(8);
        expect(duplicate.encounterHistory).toHaveLength(1);
    });

    it('awards money atomically and never applies the same payout twice', () => {
        const result: EncounterResult = {
            ...successfulPipeResult,
            runId: 'run-casino-heist-payout',
            kind: 'casino-heist',
            effects: [{kind: 'change-money', delta: 1_000}]
        };

        const paid = applyEncounterResult(createCampaign(), result);
        const duplicate = applyEncounterResult(paid, result);

        expect(paid.player.money).toBe(createCampaign().player.money + 1_000);
        expect(duplicate).toBe(paid);
    });

    it('rejects a money effect that would make the wallet negative', () => {
        const result: EncounterResult = {
            ...successfulPipeResult,
            runId: 'run-invalid-money',
            effects: [{kind: 'change-money', delta: -1_000}]
        };

        expect(() => applyEncounterResult(createCampaign(), result)).toThrow(
            'money cannot become negative.'
        );
    });

    it('opens only the persisted protected Pipe connector and clears it atomically', () => {
        const original = Array.from({length: 64}, (_, index) =>
            initializeLevelContent(createCampaign(42 + index))
        ).find(candidate => candidate.overworld.pipeShortcutWall !== null)!;
        const position = original.overworld.pipeShortcutWall;
        expect(position).not.toBeNull();
        if (!position) return;
        const result: EncounterResult = {
            ...successfulPipeResult,
            runId: 'run-pipe-shortcut',
            effects: [{kind: 'open-pipe-shortcut', position}]
        };

        const committed = applyEncounterResult(original, result);
        expect(committed.overworld.maze[position.y]?.[position.x]?.kind).toBe('passage');
        expect(committed.overworld.pipeShortcutWall).toBeNull();
        expect(committed.flags).toContain('coolant-routing-restored');
        expect(() => applyEncounterResult(original, {
            ...result,
            runId: 'run-wrong-shortcut',
            effects: [{
                kind: 'open-pipe-shortcut',
                position: {x: position.x + 1, y: position.y}
            }]
        })).toThrow(/does not match/);
    });

    it('leaves the original state untouched when a later effect is invalid', () => {
        const original = createCampaign();
        const invalidResult: EncounterResult = {
            ...successfulPipeResult,
            runId: 'run-invalid-001',
            effects: [
                {kind: 'set-flag', flag: 'should-not-commit'},
                {kind: 'change-resource', resource: 'scrap', delta: -1}
            ]
        };

        expect(() => applyEncounterResult(original, invalidResult)).toThrow(
            'scrap cannot become negative.'
        );
        expect(original.flags).not.toContain('should-not-commit');
        expect(original.appliedEncounterRunIds).toHaveLength(0);
    });

    it('rejects malformed results at the runtime boundary', () => {
        const malformed = {
            ...successfulPipeResult,
            runId: 'run-malformed-001',
            effects: [{kind: 'transform-cell', position: {x: 2, y: 2}, cell: {
                kind: 'wall',
                materialId: 'unobtainium'
            }}]
        };

        expect(() => applyEncounterResult(createCampaign(), malformed)).toThrow();
    });

    it('clamps bounded world systems and health', () => {
        const result: EncounterResult = {
            ...successfulPipeResult,
            runId: 'run-bounds-001',
            effects: [
                {kind: 'adjust-world-system', system: 'securityAlert', delta: 200},
                {kind: 'change-resource', resource: 'health', delta: -200}
            ]
        };
        const nextState = applyEncounterResult(createCampaign(), result);

        expect(nextState.worldSystems.securityAlert).toBe(100);
        expect(nextState.player.health).toBe(0);
    });
});
