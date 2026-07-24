import type {
    CampaignState,
    EncounterHistoryEntry,
    ResourceKey,
    WorldSystemKey
} from '../domain/campaign/campaign-state';
import {PASSAGE_CELL, type MazeCell} from '../domain/overworld/maze-types';
import {parseEncounterResult, type EncounterResult, type OutcomeEffect} from './contracts';

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function changeResource(
    state: CampaignState,
    resource: ResourceKey,
    delta: number
): CampaignState {
    const currentValue = state.player[resource];
    const changedValue = currentValue + delta;
    if (!Number.isSafeInteger(changedValue)) throw new Error(`${resource} exceeded its safe range.`);

    const nextValue = resource === 'health'
        ? clamp(changedValue, 0, state.player.maxHealth)
        : changedValue;
    if (nextValue < 0) throw new Error(`${resource} cannot become negative.`);

    return {
        ...state,
        player: {...state.player, [resource]: nextValue}
    };
}

function adjustWorldSystem(
    state: CampaignState,
    system: WorldSystemKey,
    delta: number
): CampaignState {
    const nextValue = clamp(state.worldSystems[system] + delta, 0, 100);
    return {
        ...state,
        worldSystems: {...state.worldSystems, [system]: nextValue}
    };
}

function transformCell(
    state: CampaignState,
    position: {readonly x: number; readonly y: number},
    cell: MazeCell
): CampaignState {
    const {maze} = state.overworld;
    const {x, y} = position;
    if (x <= 0 || y <= 0 || y >= maze.length - 1 || x >= (maze[y]?.length ?? 0) - 1) {
        throw new Error('Encounter effects cannot transform the maze perimeter.');
    }

    const nextCell: MazeCell = cell.kind === 'passage'
        ? PASSAGE_CELL
        : Object.freeze({...cell});
    const nextRow = [...maze[y]!];
    nextRow[x] = nextCell;
    const nextMaze: (readonly MazeCell[])[] = [...maze];
    nextMaze[y] = nextRow;

    return {
        ...state,
        overworld: {...state.overworld, maze: nextMaze}
    };
}

function changeMoney(state: CampaignState, delta: number): CampaignState {
    const changedValue = state.player.money + delta;
    if (!Number.isSafeInteger(changedValue)) throw new Error('money exceeded its safe range.');
    if (changedValue < 0) throw new Error('money cannot become negative.');
    return {
        ...state,
        player: {...state.player, money: changedValue}
    };
}

function openPipeShortcut(
    state: CampaignState,
    position: {readonly x: number; readonly y: number}
): CampaignState {
    const expected = state.overworld.pipeShortcutWall;
    if (
        expected === null ||
        expected.x !== position.x ||
        expected.y !== position.y
    ) {
        throw new Error('Pipe shortcut result does not match the protected wall.');
    }
    const {maze} = state.overworld;
    const cell = maze[position.y]?.[position.x];
    const mixedParity = position.x % 2 !== position.y % 2;
    const horizontal = maze[position.y]?.[position.x - 1]?.kind === 'passage' &&
        maze[position.y]?.[position.x + 1]?.kind === 'passage';
    const vertical = maze[position.y - 1]?.[position.x]?.kind === 'passage' &&
        maze[position.y + 1]?.[position.x]?.kind === 'passage';
    if (
        cell?.kind !== 'wall' ||
        !mixedParity ||
        (!horizontal && !vertical)
    ) {
        throw new Error('Protected Pipe shortcut is not a valid passage connector.');
    }
    const opened = transformCell(state, position, PASSAGE_CELL);
    return {
        ...opened,
        flags: opened.flags.includes('coolant-routing-restored')
            ? opened.flags
            : [...opened.flags, 'coolant-routing-restored'],
        overworld: {...opened.overworld, pipeShortcutWall: null}
    };
}

function applyEffect(state: CampaignState, effect: OutcomeEffect): CampaignState {
    switch (effect.kind) {
        case 'change-resource':
            return changeResource(state, effect.resource, effect.delta);
        case 'change-money':
            return changeMoney(state, effect.delta);
        case 'adjust-world-system':
            return adjustWorldSystem(state, effect.system, effect.delta);
        case 'upgrade-mining-power':
            return {
                ...state,
                player: {
                    ...state.player,
                    miningPower: Math.max(state.player.miningPower, effect.minimum)
                }
            };
        case 'set-flag':
            if (state.flags.includes(effect.flag)) return state;
            return {...state, flags: [...state.flags, effect.flag]};
        case 'remove-flag':
            return {...state, flags: state.flags.filter(flag => flag !== effect.flag)};
        case 'install-module':
            if (state.player.installedModuleIds.includes(effect.moduleId)) return state;
            return {
                ...state,
                player: {
                    ...state.player,
                    installedModuleIds: [...state.player.installedModuleIds, effect.moduleId]
                }
            };
        case 'transform-cell':
            return transformCell(state, effect.position, effect.cell);
        case 'open-pipe-shortcut':
            return openPipeShortcut(state, effect.position);
        case 'set-trigger-state':
            return {
                ...state,
                overworld: {
                    ...state.overworld,
                    triggerStates: {
                        ...state.overworld.triggerStates,
                        [effect.triggerId]: effect.state
                    }
                }
            };
    }
}

function createHistoryEntry(result: EncounterResult): EncounterHistoryEntry {
    return {
        runId: result.runId,
        definitionId: result.definitionId,
        triggerId: result.triggerId,
        kind: result.kind,
        status: result.status,
        grade: result.grade,
        score: result.score,
        elapsedMs: result.elapsedMs
    };
}

export function applyEncounterResult(state: CampaignState, input: unknown): CampaignState {
    const result = parseEncounterResult(input);
    if (state.appliedEncounterRunIds.includes(result.runId)) return state;

    let nextState = state;
    for (const effect of result.effects) nextState = applyEffect(nextState, effect);

    return {
        ...nextState,
        appliedEncounterRunIds: [...nextState.appliedEncounterRunIds, result.runId],
        encounterHistory: [...nextState.encounterHistory, createHistoryEntry(result)]
    };
}
