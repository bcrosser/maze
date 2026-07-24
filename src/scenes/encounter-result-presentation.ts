import type {EncounterResult} from '../encounters/contracts';

export interface EncounterResultPresentation {
    readonly title: string;
    readonly detail: string;
    readonly returnMessage: string;
}

type ResultSummary = Pick<EncounterResult, 'status' | 'failureReason'>;

export function getEncounterResultPresentation(
    objectiveLabel: string,
    result: ResultSummary,
    exitReady = false
): EncounterResultPresentation {
    if (result.status === 'success') {
        const rewardPrefix = objectiveLabel === 'Casino Heist'
            ? '$1,000 stolen from the casino. '
            : '';
        return {
            title: 'OBJECTIVE COMPLETE',
            detail: rewardPrefix + (
                exitReady
                    ? `${objectiveLabel} complete. The level exit is ready.`
                    : `${objectiveLabel} complete. Progress toward the exit was recorded.`
            ),
            returnMessage: rewardPrefix + (
                exitReady
                    ? `${objectiveLabel} complete. You may head for the level exit.`
                    : `${objectiveLabel} complete. Continue through the maze.`
            )
        };
    }
    if (result.failureReason === 'warden-escaped') {
        return {
            title: 'TIME EXPIRED',
            detail: 'The mission timer reached zero.\n' +
                'The Warden escaped; Space remains available.',
            returnMessage: 'Time expired. The Corridor Warden escaped; Space remains available.'
        };
    }
    return {
        title: 'ATTEMPT ENDED',
        detail: `${objectiveLabel} remains available for another attempt.`,
        returnMessage: `${objectiveLabel} attempt ended. You may return when ready.`
    };
}
