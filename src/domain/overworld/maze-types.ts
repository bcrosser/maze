import type {MaterialId} from '../materials/materials';

export interface Coordinate {
    readonly x: number;
    readonly y: number;
}

export interface PassageCell {
    readonly kind: 'passage';
    readonly materialId: null;
}

export interface WallCell {
    readonly kind: 'wall';
    readonly materialId: MaterialId;
}

export type MazeCell = PassageCell | WallCell;
export type MazeGrid = readonly (readonly MazeCell[])[];
export type TopologyCell = 0 | 1;
export type MazeTopology = readonly (readonly TopologyCell[])[];

export const PASSAGE_CELL: PassageCell = Object.freeze({kind: 'passage', materialId: null});