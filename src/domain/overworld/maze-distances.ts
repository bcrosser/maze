import type {Coordinate, MazeGrid} from './maze-types';

const DIRECTIONS = Object.freeze([
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: 1, y: 0}),
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: -1, y: 0})
]);

export function passageKey(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

export function isPassage(maze: MazeGrid, position: Coordinate): boolean {
    return maze[position.y]?.[position.x]?.kind === 'passage';
}

export function passageNeighbors(maze: MazeGrid, position: Coordinate): Coordinate[] {
    return DIRECTIONS
        .map(direction => ({x: position.x + direction.x, y: position.y + direction.y}))
        .filter(candidate => isPassage(maze, candidate));
}

/**
 * Breadth-first walkable distance from `origin` to every reachable passage,
 * keyed by `"x,y"`. Objective placement, compass guidance, monster pathing, and
 * the tracked-objective picker all measure distance this way, so it lives apart
 * from any of them.
 */
export function getPassageDistances(
    maze: MazeGrid,
    origin: Coordinate,
    blocked: ReadonlySet<string> = new Set()
): ReadonlyMap<string, number> {
    if (!isPassage(maze, origin)) return new Map();
    const distances = new Map<string, number>([[passageKey(origin), 0]]);
    const queue: Coordinate[] = [origin];
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index]!;
        const distance = distances.get(passageKey(current))!;
        for (const next of passageNeighbors(maze, current)) {
            const nextKey = passageKey(next);
            if (blocked.has(nextKey) || distances.has(nextKey)) continue;
            distances.set(nextKey, distance + 1);
            queue.push(next);
        }
    }
    return distances;
}
