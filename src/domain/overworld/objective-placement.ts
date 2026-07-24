import {shuffle, type RandomSource} from '../random/random-source';
import {
    LEVEL_OBJECTIVE_COUNT,
    MAX_LEVEL_OBJECTIVE_COUNT,
    OBJECTIVE_BY_ID,
    OBJECTIVE_IDS,
    type LevelObjectivePlacement,
    type ObjectiveId
} from './level-objectives';
import type {Coordinate, MazeGrid} from './maze-types';

const DIRECTIONS = Object.freeze([
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: 1, y: 0}),
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: -1, y: 0})
]);

const BANDS: Readonly<Record<ObjectiveId, readonly [number, number]>> = Object.freeze({
    pipe: [0.2, 0.5] as const,
    lock: [0.35, 0.7] as const,
    space: [0.5, 0.85] as const,
    platformer: [0.65, 1] as const,
    circuit: [0.25, 0.75] as const,
    horsemaster: [0.45, 1] as const,
    zapper: [0.3, 0.8] as const,
    'casino-heist': [0.55, 1] as const
});

export interface ObjectivePlacementDiagnostics {
    readonly preferredSeparation: number;
    readonly acceptedSeparation: number;
    readonly usedBroadBands: boolean;
    readonly candidatesExamined: number;
}

export interface LevelObjectiveGeneration {
    readonly objectives: readonly LevelObjectivePlacement[];
    readonly pipeShortcutWall: Coordinate | null;
    readonly diagnostics: ObjectivePlacementDiagnostics;
}

function key(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function isPassage(maze: MazeGrid, position: Coordinate): boolean {
    return maze[position.y]?.[position.x]?.kind === 'passage';
}

function passageNeighbors(maze: MazeGrid, position: Coordinate): Coordinate[] {
    return DIRECTIONS
        .map(direction => ({x: position.x + direction.x, y: position.y + direction.y}))
        .filter(candidate => isPassage(maze, candidate));
}

export function getPassageDistances(
    maze: MazeGrid,
    origin: Coordinate,
    blocked: ReadonlySet<string> = new Set()
): ReadonlyMap<string, number> {
    if (!isPassage(maze, origin)) return new Map();
    const distances = new Map<string, number>([[key(origin), 0]]);
    const queue: Coordinate[] = [origin];
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index]!;
        const distance = distances.get(key(current))!;
        for (const next of passageNeighbors(maze, current)) {
            const nextKey = key(next);
            if (blocked.has(nextKey) || distances.has(nextKey)) continue;
            distances.set(nextKey, distance + 1);
            queue.push(next);
        }
    }
    return distances;
}

function graphDistance(maze: MazeGrid, from: Coordinate, to: Coordinate): number {
    return getPassageDistances(maze, from).get(key(to)) ?? Number.POSITIVE_INFINITY;
}

function chooseObjectiveSites(
    maze: MazeGrid,
    candidates: readonly Coordinate[],
    distancesFromSpawn: ReadonlyMap<string, number>,
    maximumDistance: number,
    random: RandomSource,
    preferredFloor: number,
    objectiveIds: readonly ObjectiveId[]
): {
    readonly positions: readonly Coordinate[];
    readonly acceptedFloor: number;
    readonly broad: boolean;
    readonly examined: number;
} {
    let examined = 0;
    const pairDistances = new Map<string, number>();
    const distanceBetween = (left: Coordinate, right: Coordinate): number => {
        const leftKey = key(left);
        const rightKey = key(right);
        const pairKey = leftKey < rightKey
            ? `${leftKey}|${rightKey}`
            : `${rightKey}|${leftKey}`;
        const cached = pairDistances.get(pairKey);
        if (cached !== undefined) return cached;
        const distance = graphDistance(maze, left, right);
        pairDistances.set(pairKey, distance);
        return distance;
    };
    const shuffled = shuffle(candidates, random);
    const deadEnds = new Set(
        candidates.filter(position => passageNeighbors(maze, position).length === 1).map(key)
    );

    const orderedFor = (objectiveId: ObjectiveId, broad: boolean): Coordinate[] => {
        const [minimumRatio, maximumRatio] = BANDS[objectiveId];
        return shuffled
            .filter(position => {
                if (broad) return true;
                const ratio = (distancesFromSpawn.get(key(position)) ?? 0) / maximumDistance;
                return ratio >= minimumRatio && ratio <= maximumRatio;
            })
            .sort((left, right) => {
                const leftDead = deadEnds.has(key(left)) ? 1 : 0;
                const rightDead = deadEnds.has(key(right)) ? 1 : 0;
                return rightDead - leftDead;
            });
    };

    for (const broad of [false, true]) {
        const lists = objectiveIds.map(objectiveId =>
            orderedFor(objectiveId, broad)
        );
        if (lists.some(list => list.length === 0)) continue;
        for (let floor = preferredFloor; floor >= 1; floor--) {
            const chosen: Coordinate[] = [];
            const search = (objectiveIndex: number): boolean => {
                if (objectiveIndex === lists.length) return true;
                for (const candidate of lists[objectiveIndex]!) {
                    examined++;
                    if (chosen.some(position => key(position) === key(candidate))) continue;
                    if (chosen.some(position => distanceBetween(position, candidate) < floor)) {
                        continue;
                    }
                    chosen.push(candidate);
                    if (search(objectiveIndex + 1)) return true;
                    chosen.pop();
                }
                return false;
            };
            if (search(0)) {
                return {
                    positions: [...chosen],
                    acceptedFloor: floor,
                    broad,
                    examined
                };
            }
        }
    }
    throw new Error(`Could not place ${objectiveIds.length} reachable maze objectives.`);
}

function wallConnectorCandidates(maze: MazeGrid): {
    readonly position: Coordinate;
    readonly a: Coordinate;
    readonly b: Coordinate;
    readonly existingDistance: number;
}[] {
    const candidates: {
        position: Coordinate;
        a: Coordinate;
        b: Coordinate;
        existingDistance: number;
    }[] = [];
    for (let y = 1; y < maze.length - 1; y++) {
        for (let x = 1; x < maze.length - 1; x++) {
            if (maze[y]?.[x]?.kind !== 'wall') continue;
            // A shortcut removes one edge between adjacent maze cells. An
            // even/even wall intersection may also have two passage neighbors,
            // but opening it would cut across the wall lattice.
            if (x % 2 === y % 2) continue;
            const horizontalA = {x: x - 1, y};
            const horizontalB = {x: x + 1, y};
            const verticalA = {x, y: y - 1};
            const verticalB = {x, y: y + 1};
            const endpoints = isPassage(maze, horizontalA) && isPassage(maze, horizontalB)
                ? [horizontalA, horizontalB] as const
                : isPassage(maze, verticalA) && isPassage(maze, verticalB)
                    ? [verticalA, verticalB] as const
                    : null;
            if (!endpoints) continue;
            candidates.push({
                position: {x, y},
                a: endpoints[0],
                b: endpoints[1],
                existingDistance: graphDistance(maze, endpoints[0], endpoints[1])
            });
        }
    }
    return candidates;
}

function chooseShortcutWall(maze: MazeGrid, random: RandomSource): Coordinate {
    const candidates = wallConnectorCandidates(maze);
    for (const [minimumPath, minimumSaving] of [[8, 5], [4, 2], [2, 0]] as const) {
        const valid = candidates.filter(candidate =>
            candidate.existingDistance >= minimumPath &&
            candidate.existingDistance - 2 >= minimumSaving
        );
        if (valid.length > 0) return shuffle(valid, random)[0]!.position;
    }
    throw new Error('Maze has no valid interior shortcut wall.');
}

export function placeLevelObjectives(
    maze: MazeGrid,
    random: RandomSource,
    reservedPositions: readonly Coordinate[] = [],
    selectedObjectiveIds?: readonly ObjectiveId[]
): LevelObjectiveGeneration {
    const size = maze.length;
    if (!Number.isSafeInteger(size) || size < 21 || size > 99 || size % 2 === 0) {
        throw new Error('Objective-bearing mazes must use an odd size from 21 through 99.');
    }
    if (maze.some(row => row.length !== size)) throw new Error('Maze must be square.');
    const objectiveIds = selectedObjectiveIds === undefined
        ? shuffle(OBJECTIVE_IDS, random).slice(0, LEVEL_OBJECTIVE_COUNT)
        : [...selectedObjectiveIds];
    if (
        objectiveIds.length < LEVEL_OBJECTIVE_COUNT ||
        objectiveIds.length > MAX_LEVEL_OBJECTIVE_COUNT ||
        new Set(objectiveIds).size !== objectiveIds.length ||
        objectiveIds.some(objectiveId => !OBJECTIVE_IDS.includes(objectiveId))
    ) {
        throw new Error(
            `Objective placement requires ${LEVEL_OBJECTIVE_COUNT}–` +
            `${MAX_LEVEL_OBJECTIVE_COUNT} distinct registered objectives.`
        );
    }

    const spawn = {x: 1, y: 1};
    const exit = {x: size - 2, y: size - 2};
    const distances = getPassageDistances(maze, spawn);
    if (!distances.has(key(exit))) throw new Error('Maze exit is unreachable.');
    const exitDistances = getPassageDistances(maze, exit);
    const maximumDistance = Math.max(...distances.values());
    const reserved = new Set(reservedPositions.map(key));
    const candidates: Coordinate[] = [];
    for (const [coordinateKey, distance] of distances) {
        const [x, y] = coordinateKey.split(',').map(Number);
        const position = {x: x!, y: y!};
        const exitDistance = exitDistances.get(coordinateKey) ?? Number.POSITIVE_INFINITY;
        if (distance <= 3 || exitDistance <= 3 || reserved.has(coordinateKey)) continue;
        candidates.push(position);
    }

    const preferredSeparation = Math.max(6, Math.floor(maximumDistance / 10));
    const result = chooseObjectiveSites(
        maze,
        candidates,
        distances,
        maximumDistance,
        random,
        preferredSeparation,
        objectiveIds
    );
    const objectives = objectiveIds.map((objectiveId, index) => ({
        objectiveId,
        triggerId: OBJECTIVE_BY_ID[objectiveId].triggerId,
        position: result.positions[index]!
    }));

    return {
        objectives,
        pipeShortcutWall: objectiveIds.includes('pipe')
            ? chooseShortcutWall(maze, random)
            : null,
        diagnostics: {
            preferredSeparation,
            acceptedSeparation: result.acceptedFloor,
            usedBroadBands: result.broad,
            candidatesExamined: result.examined
        }
    };
}
