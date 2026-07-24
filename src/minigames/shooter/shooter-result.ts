import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    calculateShooterScore,
    getShooterActiveElapsedMs,
    getShooterGrade,
    reconcileShooterBossVictory,
    type ShooterState
} from './shooter-model';

export type ShooterFinishStatus = EncounterResult['status'];

export interface ResolvedShooterEncounter {
    readonly state: ShooterState;
    readonly result: EncounterResult;
}

/**
 * Resolves the authoritative shooter state and its campaign result together.
 *
 * A final projectile can destroy the Warden on the same simulation tick as a
 * player hit or legacy stale terminal marker. Reconcile here and in the model so
 * no scene/input ordering can commit a failure after the final core reached 0.
 */
export function resolveShooterEncounter(
    context: EncounterContext,
    state: ShooterState,
    fallbackStatus: ShooterFinishStatus
): ResolvedShooterEncounter {
    const resolvedState = reconcileShooterBossVictory(state);
    const status = resolvedState.terminal ?? fallbackStatus;
    let effects: OutcomeEffect[];
    if (status === 'success') {
        effects = [
            {kind: 'change-resource', resource: 'scrap', delta: 5},
            {kind: 'adjust-world-system', system: 'airspaceControl', delta: 20},
            {kind: 'adjust-world-system', system: 'securityAlert', delta: -5},
            {kind: 'set-flag', flag: 'orbital-corridor-cleared'}
        ];
    } else if (status === 'failure') {
        effects = [
            {kind: 'change-resource', resource: 'health', delta: -2},
            {kind: 'adjust-world-system', system: 'airspaceControl', delta: -10},
            {kind: 'set-flag', flag: 'raider-patrol-alerted'}
        ];
    } else {
        effects = [
            {kind: 'change-resource', resource: 'health', delta: -1},
            {kind: 'adjust-world-system', system: 'airspaceControl', delta: -5},
            {kind: 'set-flag', flag: 'raider-patrol-alerted'}
        ];
    }

    return {
        state: resolvedState,
        result: {
            runId: context.runId,
            definitionId: context.definitionId,
            triggerId: context.trigger.triggerId,
            kind: 'shooter',
            status,
            grade: status === 'success' ? getShooterGrade(resolvedState) : 'none',
            score: calculateShooterScore(resolvedState),
            elapsedMs: getShooterActiveElapsedMs(resolvedState),
            ...(status === 'failure' && resolvedState.terminalReason === 'warden-escaped'
                ? {failureReason: 'warden-escaped' as const}
                : {}),
            effects
        }
    };
}
