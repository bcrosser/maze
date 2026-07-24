import type {PlayerProgress} from '../campaign/campaign-state';
import type {ItemTypeId} from '../entities/item-types';

export const MINIGAME_BONUS_TARGETS = [
    'pipe',
    'lock',
    'shooter',
    'platformer',
    'circuit',
    'horsemaster',
    'zapper',
    'casino-heist'
] as const;

export type MinigameBonusTarget = (typeof MINIGAME_BONUS_TARGETS)[number];

export interface MinigameItemBonus {
    readonly labels: readonly string[];
    readonly modifiers: Readonly<Record<string, number | string | boolean>>;
}

function ownedItemTypes(player: PlayerProgress): ReadonlySet<ItemTypeId> {
    return new Set([
        ...player.backpack
            .filter(item => item.quantity > 0)
            .map(item => item.baseTypeId),
        ...(player.equippedWeapon ? [player.equippedWeapon.baseTypeId] : []),
        ...(player.equippedUtility ? [player.equippedUtility.baseTypeId] : [])
    ]);
}

/**
 * Maze equipment is passive in minigames: it is never consumed or mutated by
 * entering an encounter. Each bonus is deliberately modest, deterministic,
 * and exposed through EncounterContext modifiers so the pure game models stay
 * independent from campaign persistence.
 */
export function getMinigameItemBonus(
    player: PlayerProgress,
    target: MinigameBonusTarget
): MinigameItemBonus {
    const owned = ownedItemTypes(player);
    const labels: string[] = [];
    const modifiers: Record<string, number | string | boolean> = {};

    if (target === 'pipe') {
        if (owned.has('multitool')) {
            labels.push('Multitool slows each liquid step');
            modifiers.pipeStepBonusMs = 2_000;
        }
        if (owned.has('mining-pick')) {
            labels.push('Mining Pick extends setup time');
            modifiers.pipeGraceBonusMs = 4_000;
        }
    } else if (target === 'lock') {
        if (owned.has('lantern')) {
            labels.push('Lantern widens tension bands');
            modifiers.lockBandBonus = 0.04;
        }
        if (owned.has('compass')) {
            labels.push('Compass delays the alarm');
            modifiers.lockAlarmBonusMs = 15_000;
        }
    } else if (target === 'shooter') {
        if (owned.has('shield')) {
            labels.push('Shield adds one flight shield charge');
            modifiers.spaceShieldBonus = 1;
        }
        if (owned.has('bomb')) {
            labels.push('Bomb adds one mission bomb');
            modifiers.spaceBombBonus = 1;
        }
    } else if (target === 'platformer') {
        if (owned.has('shield')) {
            labels.push('Shield starts with ten seconds of protection');
            modifiers.platformerShieldBonusMs = 10_000;
        }
        if (owned.has('ammo-bundle')) {
            labels.push('Ammo Bundle starts the pulse blaster charged');
            modifiers.platformerAmmoBonus = 6;
        }
    } else if (target === 'circuit') {
        if (owned.has('compass')) {
            labels.push('Compass adds two Trace charges');
            modifiers.circuitHintBonus = 2;
        }
        if (owned.has('multitool')) {
            labels.push('Multitool adds one Pulse charge');
            modifiers.circuitPulseBonus = 1;
        }
    } else if (target === 'horsemaster') {
        if (owned.has('map-scroll')) {
            labels.push('Map Scroll adds one recovery heart');
            modifiers.horsemasterLifeBonus = 1;
        }
    } else if (target === 'zapper') {
        if (owned.has('multitool')) {
            labels.push('Multitool fills blasters 25% faster');
            modifiers.zapperFillMultiplier = 1.25;
        }
        if (owned.has('lantern')) {
            labels.push('Lantern makes returned blasters easier to catch');
            modifiers.zapperCatchBonus = 10;
        }
    } else {
        if (owned.has('shield')) {
            labels.push('Shield reinforces the getaway car');
            modifiers.heistHullBonus = 1;
        }
        if (owned.has('compass')) {
            labels.push('Compass improves high-speed handling');
            modifiers.heistHandlingMultiplier = 1.15;
        }
    }

    if (labels.length > 0) modifiers.itemBonusLabel = labels.join(' · ');
    return {
        labels: Object.freeze(labels),
        modifiers: Object.freeze(modifiers)
    };
}
