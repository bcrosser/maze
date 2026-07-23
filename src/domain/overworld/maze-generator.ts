import {MATERIAL_IDS, type MaterialId} from '../materials/materials';
import {chooseRandom, shuffle, type RandomSource} from '../random/random-source';
import {
    PASSAGE_CELL,
    type Coordinate,
    type MazeGrid,
    type MazeTopology,
    type TopologyCell,
    type WallCell
} from './maze-types';

export const MAZE_GENERATOR_VERSION = 1;

export interface MazeGenerationOptions {
    readonly size: number;
    readonly random: RandomSource;
    readonly materialIds?: readonly MaterialId[];
}

function coordinateKey(x: number, y: number): string {
    return `${x},${y}`;
}

function assertMazeSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 5 || size % 2 === 0) {
        throw new Error('Maze size must be an odd safe integer of at least 5.');
    }
}

function getWalkCandidates(x: number, y: number, size: number): Coordinate[] {
    const candidates: Coordinate[] = [];
    if (x > 1) candidates.push({x: x - 2, y});
    if (x < size - 2) candidates.push({x: x + 2, y});
    if (y > 1) candidates.push({x, y: y - 2});
    if (y < size - 2) candidates.push({x, y: y + 2});
    return candidates;
}

export function generateMazeTopology(size: number, random: RandomSource): MazeTopology {
    assertMazeSize(size);
    const grid: TopologyCell[][] = Array.from({length: size}, () =>
        Array<TopologyCell>(size).fill(1)
    );

    for (let y = 1; y < size; y += 2) {
        for (let x = 1; x < size; x += 2) grid[y]![x] = 0;
    }

    const visited = new Set<string>([coordinateKey(1, 1)]);

    for (let y = 1; y < size; y += 2) {
        for (let x = 1; x < size; x += 2) {
            if (visited.has(coordinateKey(x, y))) continue;

            let current: Coordinate = {x, y};
            const path: Coordinate[] = [current];

            while (!visited.has(coordinateKey(current.x, current.y))) {
                current = chooseRandom(getWalkCandidates(current.x, current.y, size), random);
                const loopIndex = path.findIndex(cell =>
                    cell.x === current.x && cell.y === current.y
                );
                if (loopIndex >= 0) path.length = loopIndex + 1;
                else path.push(current);
            }

            for (let index = 0; index < path.length; index++) {
                const cell = path[index]!;
                visited.add(coordinateKey(cell.x, cell.y));
                grid[cell.y]![cell.x] = 0;

                if (index === 0) continue;
                const previous = path[index - 1]!;
                const wallX = (cell.x + previous.x) / 2;
                const wallY = (cell.y + previous.y) / 2;
                grid[wallY]![wallX] = 0;
            }
        }
    }

    return grid;
}

export function assignWallMaterials(
    topology: MazeTopology,
    random: RandomSource,
    materialIds: readonly MaterialId[] = MATERIAL_IDS
): MazeGrid {
    const size = topology.length;
    assertMazeSize(size);
    if (topology.some(row => row.length !== size)) throw new Error('Maze topology must be square.');
    if (materialIds.length === 0) throw new Error('At least one wall material is required.');

    const wallPositions: Coordinate[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (topology[y]![x] === 1) wallPositions.push({x, y});
        }
    }
    if (wallPositions.length === 0) throw new Error('Maze topology must contain walls.');

    const seeds = shuffle(wallPositions, random)
        .slice(0, materialIds.length)
        .map((position, index) => ({...position, materialId: materialIds[index]!}));

    return topology.map((row, y) => row.map((value, x) => {
        if (value === 0) return PASSAGE_CELL;

        let nearestSeed = seeds[0]!;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const seed of seeds) {
            const distance = Math.abs(seed.x - x) + Math.abs(seed.y - y);
            if (distance >= nearestDistance) continue;
            nearestSeed = seed;
            nearestDistance = distance;
        }

        return Object.freeze({kind: 'wall', materialId: nearestSeed.materialId}) satisfies WallCell;
    }));
}

export function generateMaze(options: MazeGenerationOptions): MazeGrid {
    const topology = generateMazeTopology(options.size, options.random);
    return assignWallMaterials(topology, options.random, options.materialIds ?? MATERIAL_IDS);
}