import {shuffle, type RandomSource} from '../random/random-source';
import type {LevelObjectivePlacement} from './level-objectives';
import type {LevelServicePlacement, ServiceSiteKind} from './level-service-sites';
import type {Coordinate, MazeGrid} from './maze-types';
import {getPassageDistances} from './objective-placement';

export const SHOP_APPEARANCE_CHANCE = 0.6;
export const SERVICE_SITE_MINIMUM_SEPARATION = 4;

export interface LevelServicePlacementOptions {
    readonly forceShop?: boolean;
}

export const SERVICE_SITE_DEFINITIONS = Object.freeze({
    shop: Object.freeze({
        label: 'Wandering Shop',
        shortLabel: 'SHOP',
        marker: '$',
        color: 0xd7a64a
    }),
    blackjack: Object.freeze({
        label: 'Blackjack Table',
        shortLabel: '21',
        marker: '21',
        color: 0x3b9c58
    }),
    holdem: Object.freeze({
        label: 'Texas Hold’em Table',
        shortLabel: 'POKER',
        marker: '♠',
        color: 0x9b5de5
    })
} as const satisfies Record<ServiceSiteKind, {
    readonly label: string;
    readonly shortLabel: string;
    readonly marker: string;
    readonly color: number;
}>);

function positionKey(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function graphDistance(
    maze: MazeGrid,
    origin: Coordinate,
    target: Coordinate
): number {
    return getPassageDistances(maze, origin).get(positionKey(target)) ??
        Number.POSITIVE_INFINITY;
}

function chooseSitePosition(
    maze: MazeGrid,
    candidates: Coordinate[],
    chosen: readonly Coordinate[]
): Coordinate {
    for (let minimum = SERVICE_SITE_MINIMUM_SEPARATION; minimum >= 1; minimum--) {
        const index = candidates.findIndex(candidate =>
            chosen.every(position => graphDistance(maze, position, candidate) >= minimum)
        );
        if (index >= 0) return candidates.splice(index, 1)[0]!;
    }
    const fallback = candidates.shift();
    if (!fallback) throw new Error('Not enough reachable passages for optional service sites.');
    return fallback;
}

/**
 * Places optional economy activities without changing the required objective chain.
 * Both card games are available on every level; the shop independently rolls per
 * level. Callers persist the result so resuming an unfinished level never rerolls it.
 */
export function placeLevelServiceSites(
    maze: MazeGrid,
    levelId: string,
    objectives: readonly LevelObjectivePlacement[],
    random: RandomSource,
    options: LevelServicePlacementOptions = {}
): readonly LevelServicePlacement[] {
    const size = maze.length;
    const spawn = {x: 1, y: 1};
    const exit = {x: size - 2, y: size - 2};
    const distancesFromSpawn = getPassageDistances(maze, spawn);
    const distancesFromExit = getPassageDistances(maze, exit);
    const reserved = new Set([
        positionKey(spawn),
        positionKey(exit),
        ...objectives.map(objective => positionKey(objective.position))
    ]);
    const candidates: Coordinate[] = [];
    for (const [candidateKey, spawnDistance] of distancesFromSpawn) {
        if (
            reserved.has(candidateKey) ||
            spawnDistance <= 4 ||
            (distancesFromExit.get(candidateKey) ?? 0) <= 4
        ) {
            continue;
        }
        const [x, y] = candidateKey.split(',').map(Number);
        candidates.push({x: x!, y: y!});
    }

    const includeShop = random.next() < SHOP_APPEARANCE_CHANCE ||
        options.forceShop === true;
    const kinds: ServiceSiteKind[] = [
        'blackjack',
        'holdem',
        ...(includeShop ? ['shop' as const] : [])
    ];
    const shuffled = shuffle(candidates, random);
    const chosenPositions: Coordinate[] = objectives.map(objective => objective.position);
    const sites: LevelServicePlacement[] = [];
    for (const kind of kinds) {
        const position = chooseSitePosition(maze, shuffled, chosenPositions);
        chosenPositions.push(position);
        sites.push({
            id: `${levelId}/service/${kind}`,
            kind,
            position
        });
    }
    return sites;
}
