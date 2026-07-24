import type {EncounterContext} from '../encounters/contracts';

export function getEncounterItemBonusLabel(context: EncounterContext): string | null {
    const value = context.modifiers.itemBonusLabel;
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getEncounterNumberModifier(
    context: EncounterContext,
    key: string,
    fallback = 0
): number {
    const value = context.modifiers[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
