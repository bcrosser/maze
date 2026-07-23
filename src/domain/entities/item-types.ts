import type {Coordinate} from '../overworld/maze-types';

export const ITEM_TYPE_IDS = ['health-potion', 'mining-pick'] as const;
export type ItemTypeId = (typeof ITEM_TYPE_IDS)[number];

export interface ItemDefinition {
    readonly label: string;
    readonly spriteFrame: number;
    readonly fallbackColor: number;
}

export interface ItemState {
    readonly id: string;
    readonly typeId: ItemTypeId;
    readonly position: Coordinate;
}

export const ITEM_DEFINITIONS = Object.freeze({
    'health-potion': Object.freeze({
        label: 'Health Potion',
        spriteFrame: 0,
        fallbackColor: 0xd83847
    }),
    'mining-pick': Object.freeze({
        label: 'Mining Pick',
        spriteFrame: 1,
        fallbackColor: 0xd7a64a
    })
} as const satisfies Record<ItemTypeId, ItemDefinition>);