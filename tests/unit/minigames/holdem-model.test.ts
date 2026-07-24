import {describe, expect, it} from 'vitest';

import {Mulberry32Random} from '../../../src/domain/random/random-source';
import {
    actHoldem,
    comparePokerHandRanks,
    createHoldemTable,
    evaluateTexasHoldemHand,
    getHoldemBetUnit,
    getHoldemLegalActions,
    startHoldemHand,
    type HoldemTable,
    type PokerHandCategory
} from '../../../src/minigames/casino/holdem-model';
import {
    createPlayingCard,
    type CardRank,
    type CardSuit,
    type PlayingCard
} from '../../../src/minigames/casino/cards';

function card(rank: CardRank, suit: CardSuit): PlayingCard {
    return createPlayingCard(rank, suit);
}

const CATEGORY_HANDS = Object.freeze({
    'high-card': [
        card(14, 'spades'), card(13, 'diamonds'), card(12, 'hearts'),
        card(9, 'clubs'), card(7, 'spades'), card(4, 'diamonds'), card(2, 'clubs')
    ],
    'one-pair': [
        card(14, 'spades'), card(14, 'hearts'), card(13, 'clubs'),
        card(12, 'diamonds'), card(9, 'spades'), card(4, 'clubs'), card(2, 'diamonds')
    ],
    'two-pair': [
        card(14, 'spades'), card(14, 'hearts'), card(13, 'clubs'),
        card(13, 'diamonds'), card(12, 'spades'), card(4, 'clubs'), card(2, 'diamonds')
    ],
    'three-of-a-kind': [
        card(7, 'spades'), card(7, 'hearts'), card(7, 'diamonds'),
        card(14, 'clubs'), card(13, 'spades'), card(4, 'clubs'), card(2, 'diamonds')
    ],
    straight: [
        card(9, 'spades'), card(8, 'hearts'), card(7, 'diamonds'),
        card(6, 'clubs'), card(5, 'spades'), card(14, 'hearts'), card(2, 'diamonds')
    ],
    flush: [
        card(14, 'spades'), card(11, 'spades'), card(8, 'spades'),
        card(4, 'spades'), card(2, 'spades'), card(13, 'diamonds'), card(12, 'clubs')
    ],
    'full-house': [
        card(10, 'spades'), card(10, 'hearts'), card(10, 'diamonds'),
        card(4, 'clubs'), card(4, 'diamonds'), card(14, 'spades'), card(2, 'clubs')
    ],
    'four-of-a-kind': [
        card(9, 'spades'), card(9, 'hearts'), card(9, 'diamonds'),
        card(9, 'clubs'), card(14, 'spades'), card(3, 'hearts'), card(2, 'clubs')
    ],
    'straight-flush': [
        card(14, 'spades'), card(13, 'spades'), card(12, 'spades'),
        card(11, 'spades'), card(10, 'spades'), card(3, 'hearts'), card(2, 'clubs')
    ]
} as const satisfies Readonly<Record<PokerHandCategory, readonly PlayingCard[]>>);

function startedTable(seed = 1, bankroll = 200, ante = 10): HoldemTable {
    return startHoldemHand(
        createHoldemTable({bankroll}),
        new Mulberry32Random(seed),
        ante
    );
}

function passiveToShowdown(initial: HoldemTable): HoldemTable {
    let state = initial;
    while (state.phase === 'player-turn') {
        const legal = getHoldemLegalActions(state);
        state = actHoldem(
            state,
            legal.includes('check') ? 'check' : legal.includes('call') ? 'call' : 'fold'
        );
    }
    return state;
}

function riverScenario(
    playerCards: readonly PlayingCard[],
    computerCards: readonly PlayingCard[],
    communityCards: readonly PlayingCard[]
): HoldemTable {
    const state = startedTable(82);
    return {
        ...state,
        phase: 'player-turn',
        bankroll: 60,
        street: 'river',
        playerCards: Object.freeze([...playerCards]),
        computerCards: Object.freeze([...computerCards]),
        communityCards: Object.freeze([...communityCards]),
        pot: 80,
        playerContribution: 40,
        computerContribution: 40,
        amountToCall: 0,
        result: null
    };
}

describe('Texas Hold’em hand evaluation', () => {
    it.each(Object.entries(CATEGORY_HANDS))(
        'recognizes %s from seven cards',
        (category, cards) => {
            expect(evaluateTexasHoldemHand(cards).category).toBe(category);
        }
    );

    it('orders categories, pair kickers, and equal board hands correctly', () => {
        const highCard = evaluateTexasHoldemHand(CATEGORY_HANDS['high-card']);
        const pair = evaluateTexasHoldemHand(CATEGORY_HANDS['one-pair']);
        const aceKickerPair = evaluateTexasHoldemHand([
            card(8, 'spades'), card(8, 'hearts'), card(14, 'clubs'),
            card(12, 'diamonds'), card(10, 'spades'), card(4, 'clubs'), card(2, 'diamonds')
        ]);
        const kingKickerPair = evaluateTexasHoldemHand([
            card(8, 'clubs'), card(8, 'diamonds'), card(13, 'spades'),
            card(12, 'hearts'), card(10, 'clubs'), card(4, 'diamonds'), card(2, 'hearts')
        ]);
        const sharedRoyal = evaluateTexasHoldemHand(CATEGORY_HANDS['straight-flush']);

        expect(comparePokerHandRanks(pair, highCard)).toBe(1);
        expect(comparePokerHandRanks(aceKickerPair, kingKickerPair)).toBe(1);
        expect(comparePokerHandRanks(sharedRoyal, sharedRoyal)).toBe(0);
    });

    it('handles an ace-low wheel as a five-high straight', () => {
        const wheel = evaluateTexasHoldemHand([
            card(14, 'spades'), card(5, 'hearts'), card(4, 'diamonds'),
            card(3, 'clubs'), card(2, 'spades'), card(12, 'hearts'), card(9, 'diamonds')
        ]);
        const sixHigh = evaluateTexasHoldemHand([
            card(6, 'spades'), card(5, 'clubs'), card(4, 'hearts'),
            card(3, 'diamonds'), card(2, 'clubs'), card(12, 'spades'), card(9, 'hearts')
        ]);

        expect(wheel).toMatchObject({category: 'straight', tiebreakers: [5]});
        expect(comparePokerHandRanks(wheel, sixHigh)).toBe(-1);
    });

    it('rejects invalid card counts and duplicate cards', () => {
        expect(() => evaluateTexasHoldemHand(CATEGORY_HANDS.flush.slice(0, 4)))
            .toThrow(/five to seven/);
        const duplicate = card(14, 'spades');
        expect(() => evaluateTexasHoldemHand([
            duplicate,
            duplicate,
            card(13, 'hearts'),
            card(12, 'diamonds'),
            card(11, 'clubs')
        ])).toThrow(/duplicate/);
    });
});

describe('deterministic Hold’em dealing and betting', () => {
    it('replays cards and computer decisions while varying across seeds', () => {
        expect(startedTable(91)).toEqual(startedTable(91));
        const signatures = new Set(
            Array.from({length: 100}, (_, seed) => {
                const state = startedTable(seed);
                return JSON.stringify({
                    cards: [...state.playerCards, ...state.computerCards]
                        .map(candidate => candidate.id),
                    decisions: state.computerDecisionRolls
                });
            })
        );

        expect(signatures.size).toBeGreaterThanOrEqual(95);
        expect(new Set([
            ...startedTable(91).playerCards,
            ...startedTable(91).computerCards
        ].map(candidate => candidate.id)).size).toBe(4);
    });

    it('burns and reveals 3/1/1 community cards over all four streets', () => {
        const ended = passiveToShowdown(startedTable(17, 1_000));

        expect(ended.phase).toBe('settled');
        expect(ended.communityCards).toHaveLength(5);
        expect(ended.deckPosition).toBe(12);
        expect(ended.actionLog.filter(entry => entry.action.startsWith('deal-')))
            .toMatchObject([
                {street: 'flop', action: 'deal-flop'},
                {street: 'turn', action: 'deal-turn'},
                {street: 'river', action: 'deal-river'}
            ]);
        expect(ended.result?.reason).toBe('showdown');
        expect(ended.bankroll).toBe(1_000 + ended.result!.profit);
    });

    it('offers fold/call/raise against a bet and check/bet against a check', () => {
        const state = startedTable(2);
        const facingBet = {
            ...state,
            bankroll: 100,
            amountToCall: getHoldemBetUnit(state)
        };
        const facingCheck = {...state, bankroll: 100, amountToCall: 0};
        const broke = {...facingBet, bankroll: 0};

        expect(getHoldemLegalActions(facingBet)).toEqual(['fold', 'call', 'raise']);
        expect(getHoldemLegalActions(facingCheck)).toEqual(['check', 'bet']);
        expect(getHoldemLegalActions(broke)).toEqual(['fold']);
    });

    it('lets the player fold immediately and lose only committed credits', () => {
        const state = {
            ...startedTable(4),
            amountToCall: 10,
            pot: 30,
            computerContribution: 20
        };
        const folded = actHoldem(state, 'fold');

        expect(folded).toMatchObject({
            phase: 'settled',
            bankroll: 190,
            losses: 1,
            result: {
                outcome: 'loss',
                reason: 'player-folded',
                payout: 0,
                profit: -10,
                playerHand: null,
                computerHand: null
            }
        });
    });

    it('settles a computer fold after a fixed raise with exact pot accounting', () => {
        const state: HoldemTable = {
            ...startedTable(5, 100),
            bankroll: 90,
            computerCards: Object.freeze([
                card(7, 'clubs'),
                card(2, 'diamonds')
            ]),
            pot: 30,
            playerContribution: 10,
            computerContribution: 20,
            amountToCall: 10,
            computerDecisionRolls: Object.freeze([1, 1, 1, 1, 1, 1, 1, 1])
        };
        const raised = actHoldem(state, 'raise');

        expect(raised).toMatchObject({
            phase: 'settled',
            bankroll: 120,
            pot: 50,
            playerContribution: 30,
            computerContribution: 20,
            wins: 1,
            result: {
                outcome: 'win',
                reason: 'computer-folded',
                payout: 50,
                profit: 20
            }
        });
    });

    it('makes a strong computer hand call a player bet, then advances', () => {
        const state: HoldemTable = {
            ...startedTable(6, 100),
            bankroll: 90,
            computerCards: Object.freeze([
                card(14, 'clubs'),
                card(14, 'diamonds')
            ]),
            pot: 20,
            playerContribution: 10,
            computerContribution: 10,
            amountToCall: 0,
            computerDecisionRolls: Object.freeze([1, 1, 1, 1, 1, 1, 1, 1])
        };
        const called = actHoldem(state, 'bet');

        expect(called).toMatchObject({
            phase: 'player-turn',
            bankroll: 80,
            street: 'flop',
            pot: 50,
            playerContribution: 20,
            computerContribution: 30,
            amountToCall: 10
        });
        expect(called.communityCards).toHaveLength(3);
        expect(called.actionLog.some(entry =>
            entry.actor === 'computer' && entry.action === 'call'
        )).toBe(true);
    });
});

describe('Hold’em showdown, payouts, and repeated hands', () => {
    it('awards the whole pot to the better seven-card hand', () => {
        const state = riverScenario(
            [card(14, 'spades'), card(13, 'spades')],
            [card(9, 'clubs'), card(9, 'diamonds')],
            [
                card(12, 'spades'),
                card(11, 'spades'),
                card(10, 'spades'),
                card(2, 'hearts'),
                card(3, 'clubs')
            ]
        );
        const ended = actHoldem(state, 'check');

        expect(ended).toMatchObject({
            phase: 'settled',
            bankroll: 140,
            wins: 1,
            result: {
                outcome: 'win',
                reason: 'showdown',
                payout: 80,
                profit: 40,
                playerHand: {category: 'straight-flush'},
                computerHand: {category: 'one-pair'}
            }
        });
    });

    it('splits a tied pot and returns the player contribution', () => {
        const state = riverScenario(
            [card(2, 'clubs'), card(3, 'diamonds')],
            [card(4, 'clubs'), card(5, 'diamonds')],
            [
                card(14, 'hearts'),
                card(13, 'hearts'),
                card(12, 'hearts'),
                card(11, 'hearts'),
                card(10, 'hearts')
            ]
        );
        const ended = actHoldem(state, 'check');

        expect(ended).toMatchObject({
            bankroll: 100,
            pushes: 1,
            result: {
                outcome: 'push',
                payout: 40,
                profit: 0
            }
        });
    });

    it('keeps bankroll and statistics across as many hands as desired', () => {
        const first = passiveToShowdown(startedTable(33, 1_000, 10));
        const second = startHoldemHand(first, new Mulberry32Random(34), 5);

        expect(second.handNumber).toBe(2);
        expect(second.wins + second.losses + second.pushes).toBe(1);
        expect(second.bankroll).toBe(first.bankroll - 5);
        expect(second.result).toBeNull();
    });

    it('rejects illegal stakes, overlapping hands, and unavailable actions', () => {
        const table = createHoldemTable({
            bankroll: 20,
            minimumAnte: 5,
            maximumAnte: 15
        });
        expect(() => startHoldemHand(
            table,
            new Mulberry32Random(1),
            4
        )).toThrow(/between 5 and 15/);
        const active = startHoldemHand(table, new Mulberry32Random(2), 5);
        expect(() => startHoldemHand(
            active,
            new Mulberry32Random(3),
            5
        )).toThrow(/active/);
        expect(() => actHoldem({...active, amountToCall: 0}, 'call'))
            .toThrow(/Illegal/);
    });
});
