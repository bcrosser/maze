export type EncounterResultKeyAction = 'confirm' | 'cancel' | 'consume' | 'ignore';

/**
 * Result cards intentionally do not treat Space as confirmation. Space is a
 * primary action in several encounters, so its trailing/repeated keydowns must
 * not erase the result card or spill into overworld wait turns.
 */
export function encounterResultKeyAction(
    key: string,
    repeat: boolean
): EncounterResultKeyAction {
    if (key === ' ') return 'consume';
    if (repeat) return 'consume';
    if (key === 'Enter') return 'confirm';
    if (key === 'Escape') return 'cancel';
    return 'ignore';
}
