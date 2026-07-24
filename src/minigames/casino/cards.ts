import {shuffle, type RandomSource} from '../../domain/random/random-source';

export const CARD_SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export const CARD_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export type CardSuit = (typeof CARD_SUITS)[number];
export type CardRank = (typeof CARD_RANKS)[number];

export interface PlayingCard {
    readonly id: string;
    readonly suit: CardSuit;
    readonly rank: CardRank;
}

const RANK_LABELS = Object.freeze({
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
    14: 'A'
} as const satisfies Record<CardRank, string>);

const SUIT_SYMBOLS = Object.freeze({
    clubs: '♣',
    diamonds: '♦',
    hearts: '♥',
    spades: '♠'
} as const satisfies Record<CardSuit, string>);

export function createPlayingCard(rank: CardRank, suit: CardSuit): PlayingCard {
    if (!CARD_RANKS.includes(rank)) throw new Error(`Invalid card rank: ${rank}.`);
    if (!CARD_SUITS.includes(suit)) throw new Error(`Invalid card suit: ${suit}.`);
    return Object.freeze({
        id: `${RANK_LABELS[rank]}-${suit}`,
        rank,
        suit
    });
}

export function createStandardDeck(): readonly PlayingCard[] {
    return Object.freeze(CARD_SUITS.flatMap(suit =>
        CARD_RANKS.map(rank => createPlayingCard(rank, suit))
    ));
}

export function shuffleStandardDeck(random: RandomSource): readonly PlayingCard[] {
    return Object.freeze(shuffle(createStandardDeck(), random));
}

export function formatPlayingCard(card: PlayingCard): string {
    return `${RANK_LABELS[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

export function assertUniqueCards(cards: readonly PlayingCard[]): void {
    const ids = new Set(cards.map(card => card.id));
    if (ids.size !== cards.length) {
        throw new Error('A card collection cannot contain duplicate cards.');
    }
}
