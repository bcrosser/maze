import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    createBlackjackTable,
    doubleDownBlackjack,
    evaluateBlackjackHand,
    getBlackjackLegalActions,
    hitBlackjack,
    standBlackjack,
    startBlackjackHand,
    type BlackjackTable
} from '../../../src/minigames/casino/blackjack-model';
import {
    createPlayingCard,
    createStandardDeck,
    formatPlayingCard,
    shuffleStandardDeck,
    type CardRank,
    type CardSuit,
    type PlayingCard
} from '../../../src/minigames/casino/cards';

function card(rank: CardRank, suit: CardSuit): PlayingCard {
    return createPlayingCard(rank, suit);
}

function activeScenario(
    playerCards: readonly PlayingCard[],
    dealerCards: readonly PlayingCard[],
    draws: readonly PlayingCard[],
    wager = 10
): BlackjackTable {
    const started = startBlackjackHand(
        createBlackjackTable({bankroll: 100}),
        new Mulberry32Random(37),
        wager
    );
    return {
        ...started,
        phase: 'player-turn',
        bankroll: 100 - wager,
        deck: Object.freeze([
            ...started.deck.slice(0, 4),
            ...draws,
            ...started.deck.slice(4 + draws.length)
        ]),
        deckPosition: 4,
        playerCards: Object.freeze([...playerCards]),
        dealerCards: Object.freeze([...dealerCards]),
        wager,
        playerActions: 0,
        lastAction: null,
        result: null,
        wins: 0,
        losses: 0,
        pushes: 0
    };
}

function findSeed(
    predicate: (state: BlackjackTable) => boolean
): number {
    for (let seed = 0; seed < 10_000; seed++) {
        const state = startBlackjackHand(
            createBlackjackTable({bankroll: 100}),
            new Mulberry32Random(seed),
            10
        );
        if (predicate(state)) return seed;
    }
    throw new Error('No matching deterministic blackjack seed was found.');
}

describe('shared casino cards', () => {
    it('builds a canonical 52-card deck with stable labels', () => {
        const deck = createStandardDeck();

        expect(deck).toHaveLength(52);
        expect(new Set(deck.map(candidate => candidate.id)).size).toBe(52);
        expect(formatPlayingCard(card(14, 'spades'))).toBe('A♠');
        expect(formatPlayingCard(card(11, 'diamonds'))).toBe('J♦');
    });

    it('shuffles deterministically while varying across seeds', () => {
        const first = shuffleStandardDeck(new Mulberry32Random(928));
        const replay = shuffleStandardDeck(new Mulberry32Random(928));
        const different = shuffleStandardDeck(new Mulberry32Random(929));

        expect(first).toEqual(replay);
        expect(first).not.toEqual(different);
        expect(new Set(first.map(candidate => candidate.id)).size).toBe(52);
    });
});

describe('blackjack hands and dealing', () => {
    it('scores hard, soft, multi-ace, blackjack, and busted hands', () => {
        expect(evaluateBlackjackHand([
            card(14, 'spades'),
            card(6, 'hearts')
        ])).toEqual({
            total: 17,
            soft: true,
            blackjack: false,
            busted: false
        });
        expect(evaluateBlackjackHand([
            card(14, 'spades'),
            card(14, 'hearts'),
            card(9, 'clubs')
        ])).toEqual({
            total: 21,
            soft: true,
            blackjack: false,
            busted: false
        });
        expect(evaluateBlackjackHand([
            card(14, 'spades'),
            card(13, 'hearts')
        ])).toMatchObject({total: 21, blackjack: true, busted: false});
        expect(evaluateBlackjackHand([
            card(13, 'spades'),
            card(12, 'hearts'),
            card(2, 'clubs')
        ])).toMatchObject({total: 22, soft: false, busted: true});
    });

    it('replays the same deal and produces broad seed variety', () => {
        const deal = (seed: number): BlackjackTable => startBlackjackHand(
            createBlackjackTable({bankroll: 100}),
            new Mulberry32Random(seed),
            10
        );
        expect(deal(42)).toEqual(deal(42));

        const signatures = new Set(
            Array.from({length: 100}, (_, seed) => {
                const state = deal(seed);
                return [...state.playerCards, ...state.dealerCards]
                    .map(candidate => candidate.id)
                    .join(',');
            })
        );
        expect(signatures.size).toBeGreaterThanOrEqual(95);
    });

    it('settles naturals immediately with a 3:2 player payout', () => {
        const playerNaturalSeed = findSeed(state =>
            state.result?.reason === 'player-blackjack'
        );
        const dealerNaturalSeed = findSeed(state =>
            state.result?.reason === 'dealer-blackjack'
        );
        const playerNatural = startBlackjackHand(
            createBlackjackTable({bankroll: 100}),
            new Mulberry32Random(playerNaturalSeed),
            10
        );
        const dealerNatural = startBlackjackHand(
            createBlackjackTable({bankroll: 100}),
            new Mulberry32Random(dealerNaturalSeed),
            10
        );

        expect(playerNatural).toMatchObject({
            phase: 'settled',
            bankroll: 115,
            wins: 1,
            result: {
                outcome: 'blackjack',
                returned: 25,
                profit: 15
            }
        });
        expect(dealerNatural).toMatchObject({
            phase: 'settled',
            bankroll: 90,
            losses: 1,
            result: {
                outcome: 'loss',
                returned: 0,
                profit: -10
            }
        });
    });
});

describe('blackjack actions, payouts, and repeated hands', () => {
    it('busts immediately after a hit and records the lost stake', () => {
        const state = activeScenario(
            [card(13, 'spades'), card(9, 'hearts')],
            [card(8, 'clubs'), card(7, 'diamonds')],
            [card(5, 'clubs')]
        );
        const ended = hitBlackjack(state);

        expect(ended).toMatchObject({
            phase: 'settled',
            bankroll: 90,
            losses: 1,
            playerActions: 1,
            lastAction: 'hit',
            result: {
                outcome: 'loss',
                reason: 'player-bust',
                profit: -10,
                playerValue: {total: 24, busted: true}
            }
        });
        expect(getBlackjackLegalActions(ended)).toEqual([]);
    });

    it('makes the dealer stand on soft 17 and resolves wins, losses, and pushes', () => {
        const push = standBlackjack(activeScenario(
            [card(10, 'spades'), card(7, 'hearts')],
            [card(14, 'clubs'), card(6, 'diamonds')],
            [card(10, 'clubs')]
        ));
        const dealerBust = standBlackjack(activeScenario(
            [card(10, 'spades'), card(7, 'hearts')],
            [card(10, 'clubs'), card(6, 'diamonds')],
            [card(10, 'hearts')]
        ));
        const lowerHand = standBlackjack(activeScenario(
            [card(10, 'spades'), card(7, 'hearts')],
            [card(10, 'clubs'), card(8, 'diamonds')],
            []
        ));

        expect(push).toMatchObject({
            bankroll: 100,
            pushes: 1,
            result: {outcome: 'push', profit: 0}
        });
        expect(push.dealerCards).toHaveLength(2);
        expect(dealerBust).toMatchObject({
            bankroll: 110,
            wins: 1,
            result: {outcome: 'win', reason: 'dealer-bust', profit: 10}
        });
        expect(lowerHand).toMatchObject({
            bankroll: 90,
            losses: 1,
            result: {outcome: 'loss', reason: 'lower-hand', profit: -10}
        });
    });

    it('doubles the stake, deals exactly once, and then forces the dealer turn', () => {
        const state = activeScenario(
            [card(5, 'spades'), card(6, 'hearts')],
            [card(10, 'clubs'), card(6, 'diamonds')],
            [card(10, 'hearts'), card(10, 'diamonds')]
        );
        expect(getBlackjackLegalActions(state)).toEqual([
            'hit',
            'stand',
            'double-down'
        ]);

        const ended = doubleDownBlackjack(state);
        expect(ended).toMatchObject({
            phase: 'settled',
            bankroll: 120,
            wager: 20,
            playerActions: 1,
            lastAction: 'double-down',
            playerCards: {length: 3},
            result: {
                outcome: 'win',
                returned: 40,
                profit: 20,
                playerValue: {total: 21}
            }
        });
    });

    it('removes double down after a hit or when the reserve cannot cover it', () => {
        const state = activeScenario(
            [card(2, 'spades'), card(3, 'hearts')],
            [card(10, 'clubs'), card(7, 'diamonds')],
            [card(4, 'clubs')]
        );
        const hit = hitBlackjack(state);
        const broke = {...state, bankroll: 9};

        expect(getBlackjackLegalActions(hit)).toEqual(['hit', 'stand']);
        expect(getBlackjackLegalActions(broke)).toEqual(['hit', 'stand']);
        expect(() => doubleDownBlackjack(hit)).toThrow(/first action/);
    });

    it('preserves table statistics when a player deals another hand', () => {
        const ended = hitBlackjack(activeScenario(
            [card(13, 'spades'), card(9, 'hearts')],
            [card(8, 'clubs'), card(7, 'diamonds')],
            [card(5, 'clubs')]
        ));
        const next = startBlackjackHand(ended, new Mulberry32Random(902), 5);

        expect(next.handNumber).toBe(ended.handNumber + 1);
        expect(next.losses).toBe(1);
        expect(next.wager).toBe(5);
        expect(next.bankroll).toBeLessThanOrEqual(ended.bankroll);
    });

    it('rejects unavailable wagers and actions outside an active hand', () => {
        const table = createBlackjackTable({
            bankroll: 20,
            minimumWager: 5,
            maximumWager: 15
        });
        expect(() => startBlackjackHand(
            table,
            new Mulberry32Random(1),
            4
        )).toThrow(/between 5 and 15/);
        expect(() => startBlackjackHand(
            table,
            new Mulberry32Random(1),
            21
        )).toThrow(/between 5 and 15/);
        expect(() => hitBlackjack(table)).toThrow(/not awaiting/);
    });
});
