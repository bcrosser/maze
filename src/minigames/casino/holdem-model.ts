import type {RandomSource} from '../../domain/random/random-source';
import {
    assertUniqueCards,
    shuffleStandardDeck,
    type PlayingCard
} from './cards';

export const POKER_HAND_CATEGORIES = [
    'high-card',
    'one-pair',
    'two-pair',
    'three-of-a-kind',
    'straight',
    'flush',
    'full-house',
    'four-of-a-kind',
    'straight-flush'
] as const;
export const HOLDEM_STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export const HOLDEM_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise'] as const;

export type PokerHandCategory = (typeof POKER_HAND_CATEGORIES)[number];
export type HoldemStreet = (typeof HOLDEM_STREETS)[number];
export type HoldemAction = (typeof HOLDEM_ACTIONS)[number];
export type HoldemPhase = 'betting' | 'player-turn' | 'settled';
export type HoldemOutcome = 'win' | 'push' | 'loss';
export type HoldemResultReason = 'showdown' | 'computer-folded' | 'player-folded';
export type HoldemActor = 'player' | 'computer' | 'dealer';
export type HoldemEventAction =
    | HoldemAction
    | 'ante'
    | 'deal-flop'
    | 'deal-turn'
    | 'deal-river'
    | 'showdown';

export interface PokerHandRank {
    readonly category: PokerHandCategory;
    /** Zero (high card) through eight (straight flush). */
    readonly categoryRank: number;
    readonly tiebreakers: readonly number[];
    readonly bestFive: readonly PlayingCard[];
}

export interface HoldemActionEvent {
    readonly street: HoldemStreet;
    readonly actor: HoldemActor;
    readonly action: HoldemEventAction;
    readonly amount: number;
}

export interface HoldemResult {
    readonly outcome: HoldemOutcome;
    readonly reason: HoldemResultReason;
    readonly payout: number;
    readonly profit: number;
    readonly playerContribution: number;
    readonly computerContribution: number;
    readonly playerHand: PokerHandRank | null;
    readonly computerHand: PokerHandRank | null;
}

export interface HoldemTableConfig {
    readonly bankroll: number;
    readonly minimumAnte?: number;
    readonly maximumAnte?: number;
}

export interface HoldemTable {
    readonly phase: HoldemPhase;
    readonly bankroll: number;
    readonly minimumAnte: number;
    readonly maximumAnte: number;
    readonly handNumber: number;
    readonly ante: number;
    readonly street: HoldemStreet;
    readonly deck: readonly PlayingCard[];
    readonly deckPosition: number;
    readonly playerCards: readonly PlayingCard[];
    readonly computerCards: readonly PlayingCard[];
    readonly communityCards: readonly PlayingCard[];
    readonly pot: number;
    readonly playerContribution: number;
    readonly computerContribution: number;
    readonly amountToCall: number;
    readonly computerDecisionRolls: readonly number[];
    readonly actionLog: readonly HoldemActionEvent[];
    readonly result: HoldemResult | null;
    readonly wins: number;
    readonly losses: number;
    readonly pushes: number;
}

const CATEGORY_RANK = Object.freeze(
    Object.fromEntries(
        POKER_HAND_CATEGORIES.map((category, index) => [category, index])
    ) as Record<PokerHandCategory, number>
);

function signedMoney(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite amount.`);
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number, label: string): number {
    if (value < 0) throw new Error(`${label} must be a non-negative amount.`);
    return signedMoney(value, label);
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return Math.sign(difference);
    }
    return 0;
}

function straightHighCard(ranks: readonly number[]): number | null {
    const unique = [...new Set(ranks)].sort((left, right) => right - left);
    if (unique.includes(14)) unique.push(1);
    for (let index = 0; index <= unique.length - 5; index++) {
        const high = unique[index]!;
        if (
            unique[index + 1] === high - 1 &&
            unique[index + 2] === high - 2 &&
            unique[index + 3] === high - 3 &&
            unique[index + 4] === high - 4
        ) {
            return high;
        }
    }
    return null;
}

function rankFiveCards(cards: readonly PlayingCard[]): PokerHandRank {
    const descending = [...cards].sort((left, right) =>
        right.rank - left.rank || left.suit.localeCompare(right.suit)
    );
    const ranks = descending.map(card => card.rank);
    const counts = new Map<number, number>();
    for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
    const groups = [...counts.entries()].sort((left, right) =>
        right[1] - left[1] || right[0] - left[0]
    );
    const flush = new Set(cards.map(card => card.suit)).size === 1;
    const straightHigh = straightHighCard(ranks);

    let category: PokerHandCategory;
    let tiebreakers: readonly number[];
    if (flush && straightHigh !== null) {
        category = 'straight-flush';
        tiebreakers = [straightHigh];
    } else if (groups[0]?.[1] === 4) {
        category = 'four-of-a-kind';
        tiebreakers = [groups[0][0], groups[1]![0]];
    } else if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
        category = 'full-house';
        tiebreakers = [groups[0][0], groups[1][0]];
    } else if (flush) {
        category = 'flush';
        tiebreakers = ranks;
    } else if (straightHigh !== null) {
        category = 'straight';
        tiebreakers = [straightHigh];
    } else if (groups[0]?.[1] === 3) {
        category = 'three-of-a-kind';
        tiebreakers = [
            groups[0][0],
            ...groups.slice(1).map(group => group[0]).sort((left, right) => right - left)
        ];
    } else if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
        const pairRanks = [groups[0][0], groups[1][0]].sort((left, right) => right - left);
        category = 'two-pair';
        tiebreakers = [pairRanks[0]!, pairRanks[1]!, groups[2]![0]];
    } else if (groups[0]?.[1] === 2) {
        category = 'one-pair';
        tiebreakers = [
            groups[0][0],
            ...groups.slice(1).map(group => group[0]).sort((left, right) => right - left)
        ];
    } else {
        category = 'high-card';
        tiebreakers = ranks;
    }

    return Object.freeze({
        category,
        categoryRank: CATEGORY_RANK[category],
        tiebreakers: Object.freeze(tiebreakers),
        bestFive: Object.freeze(descending)
    });
}

function fiveCardCombinations(cards: readonly PlayingCard[]): readonly PlayingCard[][] {
    const combinations: PlayingCard[][] = [];
    for (let a = 0; a < cards.length - 4; a++) {
        for (let b = a + 1; b < cards.length - 3; b++) {
            for (let c = b + 1; c < cards.length - 2; c++) {
                for (let d = c + 1; d < cards.length - 1; d++) {
                    for (let e = d + 1; e < cards.length; e++) {
                        combinations.push([
                            cards[a]!,
                            cards[b]!,
                            cards[c]!,
                            cards[d]!,
                            cards[e]!
                        ]);
                    }
                }
            }
        }
    }
    return combinations;
}

export function comparePokerHandRanks(
    left: PokerHandRank,
    right: PokerHandRank
): -1 | 0 | 1 {
    const categoryDifference = left.categoryRank - right.categoryRank;
    if (categoryDifference !== 0) return Math.sign(categoryDifference) as -1 | 1;
    return Math.sign(compareNumberArrays(left.tiebreakers, right.tiebreakers)) as -1 | 0 | 1;
}

export function evaluateTexasHoldemHand(
    cards: readonly PlayingCard[]
): PokerHandRank {
    if (cards.length < 5 || cards.length > 7) {
        throw new Error('Texas Hold’em evaluation requires five to seven cards.');
    }
    assertUniqueCards(cards);
    const combinations = fiveCardCombinations(cards);
    let best = rankFiveCards(combinations[0]!);
    for (let index = 1; index < combinations.length; index++) {
        const candidate = rankFiveCards(combinations[index]!);
        if (comparePokerHandRanks(candidate, best) > 0) best = candidate;
    }
    return best;
}

function validateTableConfig(config: HoldemTableConfig): {
    readonly bankroll: number;
    readonly minimumAnte: number;
    readonly maximumAnte: number;
} {
    const bankroll = money(config.bankroll, 'Hold’em bankroll');
    const minimumAnte = money(config.minimumAnte ?? 1, 'Hold’em minimum ante');
    const maximumAnte = money(
        config.maximumAnte ?? Math.max(bankroll, minimumAnte),
        'Hold’em maximum ante'
    );
    if (minimumAnte <= 0) throw new Error('Hold’em minimum ante must be positive.');
    if (maximumAnte < minimumAnte) {
        throw new Error('Hold’em maximum ante cannot be below the minimum.');
    }
    return {bankroll, minimumAnte, maximumAnte};
}

export function createHoldemTable(config: HoldemTableConfig): HoldemTable {
    const resolved = validateTableConfig(config);
    return {
        phase: 'betting',
        bankroll: resolved.bankroll,
        minimumAnte: resolved.minimumAnte,
        maximumAnte: resolved.maximumAnte,
        handNumber: 0,
        ante: 0,
        street: 'preflop',
        deck: Object.freeze([]),
        deckPosition: 0,
        playerCards: Object.freeze([]),
        computerCards: Object.freeze([]),
        communityCards: Object.freeze([]),
        pot: 0,
        playerContribution: 0,
        computerContribution: 0,
        amountToCall: 0,
        computerDecisionRolls: Object.freeze([]),
        actionLog: Object.freeze([]),
        result: null,
        wins: 0,
        losses: 0,
        pushes: 0
    };
}

function event(
    street: HoldemStreet,
    actor: HoldemActor,
    action: HoldemEventAction,
    amount = 0
): HoldemActionEvent {
    return Object.freeze({street, actor, action, amount});
}

export function getHoldemBetUnit(state: HoldemTable): number {
    return state.street === 'turn' || state.street === 'river'
        ? money(state.ante * 2, 'Hold’em bet')
        : state.ante;
}

function streetIndex(street: HoldemStreet): number {
    return HOLDEM_STREETS.indexOf(street);
}

function computerStrength(state: HoldemTable): number {
    if (state.communityCards.length < 3) {
        const [first, second] = state.computerCards;
        if (!first || !second) return 0;
        const high = Math.max(first.rank, second.rank);
        const low = Math.min(first.rank, second.rank);
        let strength = (high - 2) / 24 + (low - 2) / 48;
        if (first.rank === second.rank) strength += 0.38 + high / 100;
        if (first.suit === second.suit) strength += 0.08;
        if (Math.abs(first.rank - second.rank) <= 2) strength += 0.06;
        return Math.min(1, strength);
    }
    const rank = evaluateTexasHoldemHand([
        ...state.computerCards,
        ...state.communityCards
    ]);
    return Math.min(
        1,
        rank.categoryRank / 8 + (rank.tiebreakers[0] ?? 2) / 112
    );
}

function computerOpens(state: HoldemTable): boolean {
    const index = streetIndex(state.street);
    const roll = state.computerDecisionRolls[index * 2] ?? 1;
    const thresholds = [0.57, 0.48, 0.52, 0.56] as const;
    const bluffChance = [0.1, 0.08, 0.06, 0.04] as const;
    return computerStrength(state) >= thresholds[index]! || roll < bluffChance[index]!;
}

function computerCalls(state: HoldemTable, raised: boolean): boolean {
    const index = streetIndex(state.street);
    const roll = state.computerDecisionRolls[index * 2 + 1] ?? 1;
    const threshold = (raised ? 0.5 : 0.37) + index * 0.025;
    const looseCallChance = raised ? 0.1 : 0.2;
    return computerStrength(state) >= threshold || roll < looseCallChance;
}

function openComputerAction(state: HoldemTable): HoldemTable {
    if (state.phase !== 'player-turn' || !computerOpens(state)) {
        return {
            ...state,
            amountToCall: 0,
            actionLog: Object.freeze([
                ...state.actionLog,
                event(state.street, 'computer', 'check')
            ])
        };
    }
    const amount = getHoldemBetUnit(state);
    return {
        ...state,
        pot: money(state.pot + amount, 'Hold’em pot'),
        computerContribution: money(
            state.computerContribution + amount,
            'Computer contribution'
        ),
        amountToCall: amount,
        actionLog: Object.freeze([
            ...state.actionLog,
            event(state.street, 'computer', 'bet', amount)
        ])
    };
}

export function startHoldemHand(
    state: HoldemTable,
    random: RandomSource,
    ante: number
): HoldemTable {
    if (state.phase === 'player-turn') {
        throw new Error('Finish the active Hold’em hand before dealing another.');
    }
    const normalizedAnte = money(ante, 'Hold’em ante');
    if (normalizedAnte < state.minimumAnte || normalizedAnte > state.maximumAnte) {
        throw new Error(
            `Hold’em ante must be between ${state.minimumAnte} and ${state.maximumAnte}.`
        );
    }
    if (normalizedAnte > state.bankroll) {
        throw new Error('Hold’em ante cannot exceed the available bankroll.');
    }
    const deck = shuffleStandardDeck(random);
    const decisionRolls = Object.freeze(
        Array.from({length: 8}, () => {
            const value = random.next();
            if (!Number.isFinite(value) || value < 0 || value >= 1) {
                throw new Error('RandomSource.next() must return a number in [0, 1).');
            }
            return value;
        })
    );
    const dealt: HoldemTable = {
        ...state,
        phase: 'player-turn',
        bankroll: money(state.bankroll - normalizedAnte, 'Hold’em bankroll'),
        handNumber: state.handNumber + 1,
        ante: normalizedAnte,
        street: 'preflop',
        deck,
        deckPosition: 4,
        playerCards: Object.freeze([deck[0]!, deck[2]!]),
        computerCards: Object.freeze([deck[1]!, deck[3]!]),
        communityCards: Object.freeze([]),
        pot: money(normalizedAnte * 2, 'Hold’em pot'),
        playerContribution: normalizedAnte,
        computerContribution: normalizedAnte,
        amountToCall: 0,
        computerDecisionRolls: decisionRolls,
        actionLog: Object.freeze([
            event('preflop', 'player', 'ante', normalizedAnte),
            event('preflop', 'computer', 'ante', normalizedAnte)
        ]),
        result: null
    };
    return openComputerAction(dealt);
}

export function getHoldemLegalActions(state: HoldemTable): readonly HoldemAction[] {
    if (state.phase !== 'player-turn') return Object.freeze([]);
    const unit = getHoldemBetUnit(state);
    if (state.amountToCall > 0) {
        const actions: HoldemAction[] = ['fold'];
        if (state.bankroll >= state.amountToCall) actions.push('call');
        if (state.bankroll >= state.amountToCall + unit) actions.push('raise');
        return Object.freeze(actions);
    }
    const actions: HoldemAction[] = ['check'];
    if (state.bankroll >= unit) actions.push('bet');
    return Object.freeze(actions);
}

function settle(
    state: HoldemTable,
    outcome: HoldemOutcome,
    reason: HoldemResultReason,
    payout: number,
    showdown: boolean
): HoldemTable {
    const normalizedPayout = money(payout, 'Hold’em payout');
    const playerHand = showdown
        ? evaluateTexasHoldemHand([...state.playerCards, ...state.communityCards])
        : null;
    const computerHand = showdown
        ? evaluateTexasHoldemHand([...state.computerCards, ...state.communityCards])
        : null;
    const result: HoldemResult = Object.freeze({
        outcome,
        reason,
        payout: normalizedPayout,
        profit: signedMoney(
            normalizedPayout - state.playerContribution,
            'Hold’em result'
        ),
        playerContribution: state.playerContribution,
        computerContribution: state.computerContribution,
        playerHand,
        computerHand
    });
    return {
        ...state,
        phase: 'settled',
        bankroll: money(state.bankroll + normalizedPayout, 'Hold’em bankroll'),
        amountToCall: 0,
        result,
        wins: state.wins + (outcome === 'win' ? 1 : 0),
        losses: state.losses + (outcome === 'loss' ? 1 : 0),
        pushes: state.pushes + (outcome === 'push' ? 1 : 0)
    };
}

function showdown(state: HoldemTable): HoldemTable {
    const playerHand = evaluateTexasHoldemHand([
        ...state.playerCards,
        ...state.communityCards
    ]);
    const computerHand = evaluateTexasHoldemHand([
        ...state.computerCards,
        ...state.communityCards
    ]);
    const comparison = comparePokerHandRanks(playerHand, computerHand);
    const withEvent = {
        ...state,
        actionLog: Object.freeze([
            ...state.actionLog,
            event('river', 'dealer', 'showdown')
        ])
    };
    if (comparison > 0) return settle(withEvent, 'win', 'showdown', state.pot, true);
    if (comparison < 0) return settle(withEvent, 'loss', 'showdown', 0, true);
    return settle(withEvent, 'push', 'showdown', state.pot / 2, true);
}

function dealNextStreet(state: HoldemTable): HoldemTable {
    if (state.street === 'river') return showdown(state);
    const nextStreet: HoldemStreet =
        state.street === 'preflop'
            ? 'flop'
            : state.street === 'flop'
                ? 'turn'
                : 'river';
    // Standard Hold’em burns one card before every community deal.
    const revealCount = nextStreet === 'flop' ? 3 : 1;
    const revealStart = state.deckPosition + 1;
    const revealed = state.deck.slice(revealStart, revealStart + revealCount);
    if (revealed.length !== revealCount) throw new Error('The Hold’em deck ran out of cards.');
    const action: HoldemEventAction =
        nextStreet === 'flop'
            ? 'deal-flop'
            : nextStreet === 'turn'
                ? 'deal-turn'
                : 'deal-river';
    const next: HoldemTable = {
        ...state,
        street: nextStreet,
        deckPosition: revealStart + revealCount,
        communityCards: Object.freeze([...state.communityCards, ...revealed]),
        amountToCall: 0,
        actionLog: Object.freeze([
            ...state.actionLog,
            event(nextStreet, 'dealer', action)
        ])
    };
    return openComputerAction(next);
}

function contributePlayer(
    state: HoldemTable,
    amount: number,
    action: HoldemAction
): HoldemTable {
    return {
        ...state,
        bankroll: money(state.bankroll - amount, 'Hold’em bankroll'),
        pot: money(state.pot + amount, 'Hold’em pot'),
        playerContribution: money(
            state.playerContribution + amount,
            'Player contribution'
        ),
        actionLog: Object.freeze([
            ...state.actionLog,
            event(state.street, 'player', action, amount)
        ])
    };
}

function computerRespondsToBet(
    state: HoldemTable,
    amount: number,
    raised: boolean
): HoldemTable {
    if (!computerCalls(state, raised)) {
        const folded = {
            ...state,
            actionLog: Object.freeze([
                ...state.actionLog,
                event(state.street, 'computer', 'fold')
            ])
        };
        return settle(folded, 'win', 'computer-folded', state.pot, false);
    }
    const called = {
        ...state,
        pot: money(state.pot + amount, 'Hold’em pot'),
        computerContribution: money(
            state.computerContribution + amount,
            'Computer contribution'
        ),
        amountToCall: 0,
        actionLog: Object.freeze([
            ...state.actionLog,
            event(state.street, 'computer', 'call', amount)
        ])
    };
    return dealNextStreet(called);
}

export function actHoldem(
    state: HoldemTable,
    action: HoldemAction
): HoldemTable {
    if (!getHoldemLegalActions(state).includes(action)) {
        throw new Error(`Illegal Hold’em action: ${action}.`);
    }
    const unit = getHoldemBetUnit(state);
    switch (action) {
        case 'fold': {
            const folded = {
                ...state,
                actionLog: Object.freeze([
                    ...state.actionLog,
                    event(state.street, 'player', 'fold')
                ])
            };
            return settle(folded, 'loss', 'player-folded', 0, false);
        }
        case 'check':
            return dealNextStreet({
                ...state,
                actionLog: Object.freeze([
                    ...state.actionLog,
                    event(state.street, 'player', 'check')
                ])
            });
        case 'call':
            return dealNextStreet(contributePlayer(state, state.amountToCall, 'call'));
        case 'bet':
            return computerRespondsToBet(
                contributePlayer(state, unit, 'bet'),
                unit,
                false
            );
        case 'raise': {
            const total = money(state.amountToCall + unit, 'Hold’em raise');
            return computerRespondsToBet(
                contributePlayer(state, total, 'raise'),
                unit,
                true
            );
        }
    }
}
