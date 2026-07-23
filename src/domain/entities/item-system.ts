import type {CampaignState} from '../campaign/campaign-state';
import {shuffle, type RandomSource} from '../random/random-source';
import type {Coordinate, MazeGrid} from '../overworld/maze-types';
import {
    ITEM_DEFINITIONS,
    ITEM_TYPE_IDS,
    type ItemState,
    type ItemTypeId
} from './item-types';

export interface ItemPickupEvent {
    readonly kind: 'item-picked-up';
    readonly itemId: string;
    readonly typeId: ItemTypeId;
    readonly message: string;
}

export interface ItemCollectionResult {
    readonly state: CampaignState;
    readonly event: ItemPickupEvent | null;
}

function coordinateKey(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

export function spawnInitialItems(
    maze: MazeGrid,
    random: RandomSource,
    reservedPositions: readonly Coordinate[] = []
): readonly ItemState[] {
    const size = maze.length;
    const reserved = new Set(reservedPositions.map(coordinateKey));
    reserved.add('1,1');
    reserved.add(`${size - 2},${size - 2}`);

    const positions: Coordinate[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < (maze[y]?.length ?? 0); x++) {
            if (maze[y]?.[x]?.kind !== 'passage' || reserved.has(`${x},${y}`)) continue;
            positions.push({x, y});
        }
    }

    const shuffledPositions = shuffle(positions, random);
    const itemCount = Math.min(Math.floor(size / 5), shuffledPositions.length);
    return Array.from({length: itemCount}, (_, index) => ({
        id: `item-${index + 1}`,
        typeId: ITEM_TYPE_IDS[index % ITEM_TYPE_IDS.length]!,
        position: shuffledPositions[index]!
    }));
}

export function initializeOverworldItems(
    state: CampaignState,
    random: RandomSource,
    reservedPositions: readonly Coordinate[] = []
): CampaignState {
    if (state.overworld.itemsInitialized) return state;
    return {
        ...state,
        overworld: {
            ...state.overworld,
            itemsInitialized: true,
            items: spawnInitialItems(state.overworld.maze, random, reservedPositions)
        }
    };
}

export function collectItemAtPlayer(state: CampaignState): ItemCollectionResult {
    const {playerPosition} = state.overworld;
    const item = state.overworld.items.find(candidate =>
        candidate.position.x === playerPosition.x && candidate.position.y === playerPosition.y
    );
    if (!item) return {state, event: null};

    const definition = ITEM_DEFINITIONS[item.typeId];
    let nextPlayer = state.player;
    let message: string;
    switch (item.typeId) {
        case 'health-potion': {
            const restoredHealth = Math.min(4, state.player.maxHealth - state.player.health);
            nextPlayer = {...state.player, health: state.player.health + restoredHealth};
            message = restoredHealth > 0
                ? `${definition.label} restored ${restoredHealth} health.`
                : `${definition.label} was consumed, but health was already full.`;
            break;
        }
        case 'mining-pick':
            nextPlayer = {
                ...state.player,
                miningPower: Math.max(state.player.miningPower, 2),
                toolCharge: state.player.toolCharge + 6
            };
            message = `${definition.label} granted 6 mining charges.`;
            break;
    }

    return {
        state: {
            ...state,
            player: nextPlayer,
            overworld: {
                ...state.overworld,
                items: state.overworld.items.filter(candidate => candidate.id !== item.id)
            }
        },
        event: {
            kind: 'item-picked-up',
            itemId: item.id,
            typeId: item.typeId,
            message
        }
    };
}