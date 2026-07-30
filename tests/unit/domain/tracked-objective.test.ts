import {describe, expect, it} from 'vitest';

import {
    createInitialCampaignState,
    type CampaignState
} from '../../../src/domain/campaign/campaign-state';
import {initializeLevelContent} from '../../../src/domain/overworld/level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getClosestObjective,
    getNextTrackedObjectiveId,
    getSelectableObjectives,
    getTrackedObjective,
    OBJECTIVE_BY_ID
} from '../../../src/domain/overworld/level-objectives';
import {generateMaze} from '../../../src/domain/overworld/maze-generator';
import {getPassageDistances} from '../../../src/domain/overworld/maze-distances';
import {resolveOverworldAction} from '../../../src/domain/overworld/resolve-overworld-action';
import {Mulberry32Random} from '../../../src/domain/random/random-source';

function campaign(seed = 4_242): CampaignState {
    return initializeLevelContent(createInitialCampaignState({
        campaignSeed: seed,
        maze: generateMaze({
            size: 21,
            topologyRandom: new Mulberry32Random(seed),
            materialRandom: new Mulberry32Random(seed ^ 0x55aa)
        })
    }));
}

function distanceTo(
    state: CampaignState,
    objectiveId: string
): number {
    const placement = state.overworld.objectives.find(candidate =>
        candidate.objectiveId === objectiveId
    );
    if (!placement) throw new Error(`Level does not offer ${objectiveId}.`);
    const distances = getPassageDistances(
        state.overworld.maze,
        state.overworld.playerPosition
    );
    return distances.get(`${placement.position.x},${placement.position.y}`) ??
        Number.POSITIVE_INFINITY;
}

describe('tracked objective', () => {
    it('tracks the closest available objective by walkable distance', () => {
        const state = campaign();
        const tracked = getTrackedObjective(state);

        expect(tracked).not.toBeNull();
        if (!tracked) return;
        const trackedDistance = distanceTo(state, tracked.id);
        for (const placement of getSelectableObjectives(state)) {
            expect(distanceTo(state, placement.objectiveId))
                .toBeGreaterThanOrEqual(trackedDistance);
        }
        expect(getClosestObjective(state)?.id).toBe(tracked.id);
    });

    it('never tracks a locked objective the player cannot start', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const state = campaign(seed);
            const offersLockedHeist = state.overworld.objectives.some(placement =>
                placement.objectiveId === 'casino-heist'
            ) && !state.flags.includes(CASINO_HEIST_UNLOCK_FLAG);
            if (!offersLockedHeist) continue;
            expect(getSelectableObjectives(state).map(placement => placement.objectiveId))
                .not.toContain('casino-heist');
            expect(getTrackedObjective(state)?.id).not.toBe('casino-heist');
            return;
        }
        throw new Error('The seed corpus never offered a locked Casino Heist.');
    });

    it('cycles through every available objective and wraps around', () => {
        const state = campaign();
        const available = getSelectableObjectives(state)
            .map(placement => placement.objectiveId);
        expect(available.length).toBeGreaterThan(1);

        const visited: string[] = [];
        let current = state;
        for (let step = 0; step < available.length; step++) {
            const result = resolveOverworldAction(current, {kind: 'cycle-objective'});
            expect(result.consumedTurn).toBe(false);
            expect(result.state.overworld.turn).toBe(state.overworld.turn);
            current = result.state;
            const selected = current.overworld.selectedObjectiveId;
            expect(selected).not.toBeNull();
            if (selected === null) return;
            visited.push(selected);
            expect(getTrackedObjective(current)?.id).toBe(selected);
        }

        expect(new Set(visited).size).toBe(available.length);
        // One more step returns to where the cycle started.
        const wrapped = resolveOverworldAction(current, {kind: 'cycle-objective'});
        expect(wrapped.state.overworld.selectedObjectiveId).toBe(visited[0]);
    });

    it('falls back to the closest objective once the pinned one is completed', () => {
        const state = campaign();
        const pinned = getSelectableObjectives(state)[1];
        expect(pinned).toBeDefined();
        if (!pinned) return;
        const tracking: CampaignState = {
            ...state,
            overworld: {...state.overworld, selectedObjectiveId: pinned.objectiveId}
        };
        expect(getTrackedObjective(tracking)?.id).toBe(pinned.objectiveId);

        const completed: CampaignState = {
            ...tracking,
            flags: [...tracking.flags, OBJECTIVE_BY_ID[pinned.objectiveId].completionFlag]
        };
        const fallback = getTrackedObjective(completed);
        expect(fallback?.id).not.toBe(pinned.objectiveId);
        expect(fallback?.id).toBe(getClosestObjective(completed)?.id);
    });

    it('reports no objective and refuses to cycle once the level is cleared', () => {
        const state = campaign();
        const cleared: CampaignState = {
            ...state,
            flags: [
                ...state.flags,
                ...state.overworld.objectives.map(placement =>
                    OBJECTIVE_BY_ID[placement.objectiveId].completionFlag
                )
            ]
        };

        expect(getSelectableObjectives(cleared)).toEqual([]);
        expect(getTrackedObjective(cleared)).toBeNull();
        expect(getNextTrackedObjectiveId(cleared)).toBeNull();

        const result = resolveOverworldAction(cleared, {kind: 'cycle-objective'});
        expect(result.state).toBe(cleared);
        expect(result.consumedTurn).toBe(false);
        expect(result.events[0]?.message).toMatch(/stairs down/i);
    });
});
