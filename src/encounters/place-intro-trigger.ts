import {MATERIALS, type MaterialId, type MaterialTag} from '../domain/materials/materials';
import type {Coordinate, MazeGrid} from '../domain/overworld/maze-types';

const DIRECTIONS = Object.freeze([
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: 1, y: 0}),
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: -1, y: 0})
]);

export interface IntroTriggerPlacement {
    readonly position: Coordinate;
    readonly benefitWallPosition: Coordinate;
    readonly nearbyMaterialIds: readonly MaterialId[];
    readonly nearbyMaterialTags: readonly MaterialTag[];
}

function isInterior(position: Coordinate, maze: MazeGrid): boolean {
    return position.x > 0 && position.y > 0 &&
        position.y < maze.length - 1 && position.x < (maze[position.y]?.length ?? 0) - 1;
}

export function placeIntroTrigger(maze: MazeGrid, origin: Coordinate): IntroTriggerPlacement {
    const position = DIRECTIONS
        .map(direction => ({x: origin.x + direction.x, y: origin.y + direction.y}))
        .find(candidate => maze[candidate.y]?.[candidate.x]?.kind === 'passage');
    if (!position) throw new Error('Could not place an encounter beside the overworld spawn.');

    const nearbyWalls = DIRECTIONS
        .map(direction => ({x: position.x + direction.x, y: position.y + direction.y}))
        .filter(candidate => isInterior(candidate, maze))
        .filter(candidate => maze[candidate.y]?.[candidate.x]?.kind === 'wall');
    const benefitWallPosition = nearbyWalls[0];
    if (!benefitWallPosition) {
        throw new Error('Intro encounter requires a nearby interior wall reward.');
    }

    const nearbyMaterialIds = [...new Set(nearbyWalls.map(wall => {
        const cell = maze[wall.y]?.[wall.x];
        if (!cell || cell.kind !== 'wall') throw new Error('Expected a nearby wall.');
        return cell.materialId;
    }))];
    const nearbyMaterialTags = [...new Set(nearbyMaterialIds.flatMap(materialId =>
        MATERIALS[materialId].tags
    ))];

    return {position, benefitWallPosition, nearbyMaterialIds, nearbyMaterialTags};
}