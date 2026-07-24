import type {Coordinate} from './maze-types';

/**
 * Optional, non-objective destinations that may be placed in a generated level.
 * Their persisted positions keep an unfinished level stable across save/resume.
 */
export const SERVICE_SITE_KINDS = ['shop', 'blackjack', 'holdem'] as const;
export type ServiceSiteKind = (typeof SERVICE_SITE_KINDS)[number];

export interface LevelServicePlacement {
    readonly id: string;
    readonly kind: ServiceSiteKind;
    readonly position: Coordinate;
}

export type WorldServiceSite = LevelServicePlacement;
