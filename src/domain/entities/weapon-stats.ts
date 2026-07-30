import type {PlayerProgress} from '../campaign/campaign-state';
import {
    ITEM_DEFINITIONS,
    type ItemDefinition,
    type ItemInstance,
    type ItemTypeId
} from './item-types';

export const IMPROVISED_WEAPON_LABEL = 'Improvised';
/** Hard ceiling on weapon damage, so affixes and quality cannot run away. */
export const MAX_WEAPON_DAMAGE = 4;

export interface WeaponStats {
    readonly typeId: ItemTypeId | 'improvised';
    readonly label: string;
    readonly damage: number;
    readonly range: number;
    readonly piercing: number;
    /** True when the weapon can fire down a corridor rather than only bumping. */
    readonly ranged: boolean;
    /** True when firing spends arrows from `bowAmmo`. */
    readonly usesAmmo: boolean;
}

const IMPROVISED_STATS: WeaponStats = Object.freeze({
    typeId: 'improvised',
    label: IMPROVISED_WEAPON_LABEL,
    damage: 1,
    range: 1,
    piercing: 0,
    ranged: false,
    usesAmmo: false
});

/**
 * The single source of truth for what a weapon actually does. Combat, the HUD,
 * the backpack, and the shop all read these numbers, so a displayed "3" is the
 * same 3 the reducer applies.
 */
export function getItemWeaponStats(weapon: ItemInstance | null): WeaponStats {
    if (!weapon) return IMPROVISED_STATS;
    const definition: ItemDefinition = ITEM_DEFINITIONS[weapon.baseTypeId];
    if (definition.category !== 'weapon') return IMPROVISED_STATS;
    const qualityBonus = weapon.quality === 'rare' ? 1 : 0;
    const ranged = weapon.baseTypeId === 'bow' || weapon.baseTypeId === 'spear';
    return {
        typeId: weapon.baseTypeId,
        label: definition.label,
        damage: Math.min(
            MAX_WEAPON_DAMAGE,
            (definition.baseDamage ?? 1) +
                (weapon.affixIds.includes('keen') ? 1 : 0) +
                qualityBonus
        ),
        range: (definition.baseRange ?? 1) +
            (weapon.affixIds.includes('extended') ? 1 : 0),
        piercing: weapon.affixIds.includes('piercing') ? 1 : 0,
        ranged,
        usesAmmo: weapon.baseTypeId === 'bow'
    };
}

export function getWeaponStats(player: PlayerProgress): WeaponStats {
    return getItemWeaponStats(player.equippedWeapon);
}

/** Compact HUD form, for example `Sword · 3 dmg · reach 1`. */
export function describeWeaponStats(
    stats: WeaponStats,
    options: {readonly ammo?: number} = {}
): string {
    const parts = [`${stats.damage} dmg`, `reach ${stats.range}`];
    if (stats.piercing > 0) parts.push(`pierce ${stats.piercing}`);
    if (stats.usesAmmo) parts.push(`${options.ammo ?? 0} arrows`);
    return `${stats.label} · ${parts.join(' · ')}`;
}

/**
 * How a candidate weapon compares with the equipped one, for pickup and shop
 * decisions. Positive numbers favour the candidate.
 */
export function compareWeaponStats(
    equipped: WeaponStats,
    candidate: WeaponStats
): {readonly damage: number; readonly range: number; readonly piercing: number} {
    return {
        damage: candidate.damage - equipped.damage,
        range: candidate.range - equipped.range,
        piercing: candidate.piercing - equipped.piercing
    };
}

/** One-line verdict such as `+1 dmg, -1 reach` or `no change`. */
export function describeWeaponComparison(
    equipped: WeaponStats,
    candidate: WeaponStats
): string {
    const delta = compareWeaponStats(equipped, candidate);
    const parts = ([
        ['dmg', delta.damage],
        ['reach', delta.range],
        ['pierce', delta.piercing]
    ] as const)
        .filter(([, value]) => value !== 0)
        .map(([label, value]) => `${value > 0 ? '+' : ''}${value} ${label}`);
    return parts.length === 0 ? 'no change' : parts.join(', ');
}
