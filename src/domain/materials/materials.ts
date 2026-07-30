export type MaterialTag =
    | 'cold'
    | 'conductive'
    | 'earth'
    | 'elemental'
    | 'flammable'
    | 'hot'
    | 'magical'
    | 'mineral'
    | 'organic'
    | 'poisonous'
    | 'sharp'
    | 'wet';

export interface MaterialDefinition {
    readonly name: string;
    readonly color: `#${string}`;
    readonly tags: readonly MaterialTag[];
    readonly hardness?: number;
}

const materialRegistry = {
    stone: {name: 'Stone', color: '#73777d', tags: ['mineral'], hardness: 1},
    granite: {name: 'Granite', color: '#8a6662', tags: ['mineral'], hardness: 2},
    marble: {name: 'Marble', color: '#d9d7cf', tags: ['mineral'], hardness: 2},
    obsidian: {name: 'Obsidian', color: '#211b2d', tags: ['mineral', 'magical'], hardness: 4},
    crystal: {name: 'Crystal', color: '#67d5e8', tags: ['mineral', 'magical'], hardness: 3},
    ice: {name: 'Ice', color: '#a8e5f2', tags: ['cold'], hardness: 1},
    glass: {name: 'Glass', color: '#b9ded8', tags: ['mineral'], hardness: 1},
    metal: {name: 'Metal', color: '#59636e', tags: ['mineral', 'conductive'], hardness: 3},
    copper: {name: 'Copper', color: '#b66a3c', tags: ['mineral', 'conductive'], hardness: 2},
    gold: {name: 'Gold', color: '#e8b923', tags: ['mineral', 'conductive'], hardness: 2},
    clay: {name: 'Clay', color: '#a85f49', tags: ['earth'], hardness: 1},
    earth: {name: 'Earth', color: '#66503a', tags: ['earth', 'organic'], hardness: 1},
    sand: {name: 'Sand', color: '#d8be72', tags: ['earth'], hardness: 1},
    wood: {name: 'Wood', color: '#81502f', tags: ['organic', 'flammable']},
    plants: {name: 'Plants', color: '#3c9b45', tags: ['organic', 'flammable']},
    vines: {name: 'Vines', color: '#23713b', tags: ['organic', 'flammable']},
    thorns: {name: 'Thorns', color: '#56752d', tags: ['organic', 'flammable', 'sharp']},
    fungus: {name: 'Fungus', color: '#a45aa5', tags: ['organic', 'poisonous']},
    bone: {name: 'Bone', color: '#e5dfbd', tags: ['organic'], hardness: 1},
    water: {name: 'Water', color: '#287ec7', tags: ['wet']},
    fire: {name: 'Fire', color: '#ff6a00', tags: ['hot', 'elemental']},
    lava: {name: 'Lava', color: '#df2b0b', tags: ['hot', 'elemental']},
    lightning: {name: 'Lightning', color: '#f4ed45', tags: ['conductive', 'elemental']},
    shadow: {name: 'Shadow', color: '#382f54', tags: ['magical']}
} as const satisfies Record<string, MaterialDefinition>;

export type MaterialId = keyof typeof materialRegistry;

export const MATERIALS: Readonly<typeof materialRegistry> = Object.freeze(materialRegistry);
export const MATERIAL_IDS: readonly MaterialId[] = Object.freeze(
    Object.keys(materialRegistry) as MaterialId[]
);

/** Minimal grid shape these helpers need, so materials stay maze-agnostic. */
interface MaterialCellGrid {
    readonly [row: number]: {
        readonly [column: number]: {
            readonly kind: 'passage' | 'wall';
            readonly materialId: MaterialId | null;
        } | undefined;
    } | undefined;
}

export interface WallMaterialView {
    readonly id: MaterialId;
    readonly definition: MaterialDefinition;
    /** Undefined for materials that no mining tool can cut. */
    readonly hardness: number | undefined;
}

const ADJACENT_OFFSETS: readonly {readonly x: number; readonly y: number}[] = Object.freeze([
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: 1, y: 0}),
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: -1, y: 0})
]);

export function getMaterialHardness(id: MaterialId): number | undefined {
    const definition: MaterialDefinition = MATERIALS[id];
    return 'hardness' in definition ? definition.hardness : undefined;
}

/**
 * The wall material at a cell, or `null` for a passage or an out-of-bounds
 * coordinate. Gameplay should read materials through this rather than comparing
 * rendered colors.
 */
export function getWallMaterial(
    maze: MaterialCellGrid,
    position: {readonly x: number; readonly y: number}
): WallMaterialView | null {
    const cell = maze[position.y]?.[position.x];
    if (!cell || cell.kind !== 'wall' || cell.materialId === null) return null;
    return {
        id: cell.materialId,
        definition: MATERIALS[cell.materialId],
        hardness: getMaterialHardness(cell.materialId)
    };
}

/** Distinct wall materials orthogonally touching a cell, in reading order. */
export function getAdjacentWallMaterials(
    maze: MaterialCellGrid,
    position: {readonly x: number; readonly y: number}
): readonly WallMaterialView[] {
    const seen = new Set<MaterialId>();
    const found: WallMaterialView[] = [];
    for (const offset of ADJACENT_OFFSETS) {
        const material = getWallMaterial(maze, {
            x: position.x + offset.x,
            y: position.y + offset.y
        });
        if (!material || seen.has(material.id)) continue;
        seen.add(material.id);
        found.push(material);
    }
    return found;
}

/** True when the given mining power can cut through the material at all. */
export function canMineMaterial(id: MaterialId, miningPower: number): boolean {
    const hardness = getMaterialHardness(id);
    return hardness !== undefined && miningPower >= hardness;
}