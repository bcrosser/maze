import type {CampaignState} from '../domain/campaign/campaign-state';
import {
    OBJECTIVE_BY_ID,
    type ObjectiveId
} from '../domain/overworld/level-objectives';
import {applyEncounterResult} from '../encounters/apply-encounter-result';
import type {EncounterResult} from '../encounters/contracts';

/**
 * Objective completion belongs to campaign progression, not to an individual
 * minigame's optional reward-effect list. Keep the minigame effect for
 * compatibility, but seal the canonical flag here whenever success is accepted.
 */
export function commitObjectiveResult(
    campaign: CampaignState,
    objectiveId: ObjectiveId,
    result: EncounterResult
): CampaignState {
    const applied = applyEncounterResult(campaign, result);
    if (result.status !== 'success') return applied;

    const completionFlag = OBJECTIVE_BY_ID[objectiveId].completionFlag;
    if (applied.flags.includes(completionFlag)) return applied;
    return {...applied, flags: [...applied.flags, completionFlag]};
}
