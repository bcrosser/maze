import type {Coordinate} from '../overworld/maze-types';

export const TRAP_TYPE_IDS = [
    'spike-plate',
    'snare',
    'gas-vent',
    'arc-plate',
    'flame-jet'
] as const;
export type TrapTypeId = (typeof TRAP_TYPE_IDS)[number];

export interface TrapState {
    readonly id: string;
    readonly typeId: TrapTypeId;
    readonly position: Coordinate;
    readonly owner: 'world' | 'player';
    readonly revealed: boolean;
    readonly disabled: boolean;
    readonly phase: number;
    readonly nextPhaseTurn: number;
}

export interface PendingHazardState {
    readonly id: string;
    readonly typeId: 'volatile-explosion';
    readonly origin: Coordinate;
    readonly targetPositions: readonly Coordinate[];
    readonly executeAfterTurn: number;
}

export const TRAP_DEFINITIONS = Object.freeze({
    'spike-plate': Object.freeze({label: 'Spike Plate', cost: 1, damage: 2}),
    snare: Object.freeze({label: 'Snare', cost: 1, damage: 0}),
    'gas-vent': Object.freeze({label: 'Gas Vent', cost: 2, damage: 0}),
    'arc-plate': Object.freeze({label: 'Arc Plate', cost: 2, damage: 2}),
    'flame-jet': Object.freeze({label: 'Flame Jet', cost: 2, damage: 2})
} as const satisfies Record<TrapTypeId, {
    readonly label: string;
    readonly cost: number;
    readonly damage: number;
}>);
