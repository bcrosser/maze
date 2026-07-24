import type {RandomSource} from '../../domain/random/random-source';
import {
    assertUniqueCards,
    shuffleStandardDeck,
    type PlayingCard
} from './cards';

export const BLACKJACK_ACTIONS = ['hit', 'stand', 'double-down'] as const;
export type BlackjackAction = (typeof BLACKJACK_ACTIONS)[number];
export type BlackjackPhase = 'betting' | 'player-turn' | 'settled';
export type BlackjackOutcome = 'blackjack' | 'win' | 'push' | 'loss';
export type BlackjackReason =
    | 'player-blackjack'
    | 'dealer-blackjack'
    | 'player-bust'
    | 'dealer-bust'
    | 'higher-hand'
    | 'equal-hand'
    | 'lower-hand';

export interface BlackjackHandValue {
    readonly total: number;
    readonly soft: boolean;
    readonly blackjack: boolean;
    readonly busted: boolean;
}

export interface BlackjackResult {
    readonly outcome: BlackjackOutcome;
    readonly reason: BlackjackReason;
    readonly wager: number;
    /** Total credits returned to the player, including the original stake. */
    readonly returned: number;
    /** Net change from this hand after accounting for the stake. */
    readonly profit: number;
    readonly playerValue: BlackjackHandValue;
    readonly dealerValue: BlackjackHandValue;
}

export interface BlackjackTableConfig {
    readonly bankroll: number;
    readonly minimumWager?: number;
    readonly maximumWager?: number;
}

export interface BlackjackTable {
    readonly phase: BlackjackPhase;
    readonly bankroll: number;
    readonly minimumWager: number;
    readonly maximumWager: number;
    readonly handNumber: number;
    readonly deck: readonly PlayingCard[];
    readonly deckPosition: number;
    readonly playerCards: readonly PlayingCard[];
    readonly dealerCards: readonly PlayingCard[];
    readonly wager: number;
    readonly playerActions: number;
    readonly lastAction: BlackjackAction | null;
    readonly result: BlackjackResult | null;
    readonly wins: number;
    readonly losses: number;
    readonly pushes: number;
}

function signedMoney(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite amount.`);
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number, label: string): number {
    if (value < 0) throw new Error(`${label} must be a non-negative amount.`);
    return signedMoney(value, label);
}

function validateTableConfig(config: BlackjackTableConfig): {
    readonly bankroll: number;
    readonly minimumWager: number;
    readonly maximumWager: number;
} {
    const bankroll = money(config.bankroll, 'Blackjack bankroll');
    const minimumWager = money(config.minimumWager ?? 1, 'Blackjack minimum wager');
    const maximumWager = money(
        config.maximumWager ?? Math.max(bankroll, minimumWager),
        'Blackjack maximum wager'
    );
    if (minimumWager <= 0) throw new Error('Blackjack minimum wager must be positive.');
    if (maximumWager < minimumWager) {
        throw new Error('Blackjack maximum wager cannot be below the minimum.');
    }
    return {bankroll, minimumWager, maximumWager};
}

export function createBlackjackTable(config: BlackjackTableConfig): BlackjackTable {
    const resolved = validateTableConfig(config);
    return {
        phase: 'betting',
        bankroll: resolved.bankroll,
        minimumWager: resolved.minimumWager,
        maximumWager: resolved.maximumWager,
        handNumber: 0,
        deck: Object.freeze([]),
        deckPosition: 0,
        playerCards: Object.freeze([]),
        dealerCards: Object.freeze([]),
        wager: 0,
        playerActions: 0,
        lastAction: null,
        result: null,
        wins: 0,
        losses: 0,
        pushes: 0
    };
}

export function evaluateBlackjackHand(cards: readonly PlayingCard[]): BlackjackHandValue {
    assertUniqueCards(cards);
    let total = 0;
    let aces = 0;
    for (const card of cards) {
        if (card.rank === 14) {
            total += 11;
            aces++;
        } else {
            total += Math.min(card.rank, 10);
        }
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return Object.freeze({
        total,
        soft: aces > 0,
        blackjack: cards.length === 2 && total === 21,
        busted: total > 21
    });
}

function resultFor(
    state: BlackjackTable,
    outcome: BlackjackOutcome,
    reason: BlackjackReason,
    returned: number,
    playerCards = state.playerCards,
    dealerCards = state.dealerCards
): BlackjackTable {
    const normalizedReturn = money(returned, 'Blackjack return');
    const result: BlackjackResult = Object.freeze({
        outcome,
        reason,
        wager: state.wager,
        returned: normalizedReturn,
        profit: signedMoney(normalizedReturn - state.wager, 'Blackjack result'),
        playerValue: evaluateBlackjackHand(playerCards),
        dealerValue: evaluateBlackjackHand(dealerCards)
    });
    return {
        ...state,
        phase: 'settled',
        bankroll: money(state.bankroll + normalizedReturn, 'Blackjack bankroll'),
        playerCards: Object.freeze([...playerCards]),
        dealerCards: Object.freeze([...dealerCards]),
        result,
        wins: state.wins + (outcome === 'win' || outcome === 'blackjack' ? 1 : 0),
        losses: state.losses + (outcome === 'loss' ? 1 : 0),
        pushes: state.pushes + (outcome === 'push' ? 1 : 0)
    };
}

function resolveNaturals(state: BlackjackTable): BlackjackTable {
    const player = evaluateBlackjackHand(state.playerCards);
    const dealer = evaluateBlackjackHand(state.dealerCards);
    if (player.blackjack && dealer.blackjack) {
        return resultFor(state, 'push', 'equal-hand', state.wager);
    }
    if (player.blackjack) {
        return resultFor(state, 'blackjack', 'player-blackjack', state.wager * 2.5);
    }
    if (dealer.blackjack) {
        return resultFor(state, 'loss', 'dealer-blackjack', 0);
    }
    return state;
}

export function startBlackjackHand(
    state: BlackjackTable,
    random: RandomSource,
    wager: number
): BlackjackTable {
    if (state.phase === 'player-turn') {
        throw new Error('Finish the active blackjack hand before dealing another.');
    }
    const normalizedWager = money(wager, 'Blackjack wager');
    if (normalizedWager < state.minimumWager || normalizedWager > state.maximumWager) {
        throw new Error(
            `Blackjack wager must be between ${state.minimumWager} and ${state.maximumWager}.`
        );
    }
    if (normalizedWager > state.bankroll) {
        throw new Error('Blackjack wager cannot exceed the available bankroll.');
    }

    const deck = shuffleStandardDeck(random);
    const playerCards = Object.freeze([deck[0]!, deck[2]!]);
    const dealerCards = Object.freeze([deck[1]!, deck[3]!]);
    const dealt: BlackjackTable = {
        ...state,
        phase: 'player-turn',
        bankroll: money(state.bankroll - normalizedWager, 'Blackjack bankroll'),
        handNumber: state.handNumber + 1,
        deck,
        deckPosition: 4,
        playerCards,
        dealerCards,
        wager: normalizedWager,
        playerActions: 0,
        lastAction: null,
        result: null
    };
    return resolveNaturals(dealt);
}

function requirePlayerTurn(state: BlackjackTable, action: BlackjackAction): void {
    if (state.phase !== 'player-turn') {
        throw new Error(`Cannot ${action} when blackjack is not awaiting the player.`);
    }
}

function drawCard(state: BlackjackTable): {
    readonly card: PlayingCard;
    readonly deckPosition: number;
} {
    const card = state.deck[state.deckPosition];
    if (!card) throw new Error('The blackjack deck ran out of cards.');
    return {card, deckPosition: state.deckPosition + 1};
}

export function getBlackjackLegalActions(
    state: BlackjackTable
): readonly BlackjackAction[] {
    if (state.phase !== 'player-turn') return Object.freeze([]);
    const actions: BlackjackAction[] = ['hit', 'stand'];
    if (
        state.playerCards.length === 2 &&
        state.playerActions === 0 &&
        state.bankroll >= state.wager
    ) {
        actions.push('double-down');
    }
    return Object.freeze(actions);
}

export function hitBlackjack(state: BlackjackTable): BlackjackTable {
    requirePlayerTurn(state, 'hit');
    const draw = drawCard(state);
    const playerCards = Object.freeze([...state.playerCards, draw.card]);
    const next: BlackjackTable = {
        ...state,
        deckPosition: draw.deckPosition,
        playerCards,
        playerActions: state.playerActions + 1,
        lastAction: 'hit'
    };
    return evaluateBlackjackHand(playerCards).busted
        ? resultFor(next, 'loss', 'player-bust', 0)
        : next;
}

function finishDealerTurn(state: BlackjackTable): BlackjackTable {
    let dealerCards = [...state.dealerCards];
    let deckPosition = state.deckPosition;
    let dealerValue = evaluateBlackjackHand(dealerCards);
    // The house stands on every 17, including soft 17.
    while (dealerValue.total < 17) {
        const card = state.deck[deckPosition];
        if (!card) throw new Error('The blackjack deck ran out of cards.');
        dealerCards.push(card);
        deckPosition++;
        dealerValue = evaluateBlackjackHand(dealerCards);
    }

    const playerValue = evaluateBlackjackHand(state.playerCards);
    const dealerHand = Object.freeze(dealerCards);
    const next = {...state, deckPosition, dealerCards: dealerHand};
    if (dealerValue.busted) {
        return resultFor(next, 'win', 'dealer-bust', state.wager * 2);
    }
    if (playerValue.total > dealerValue.total) {
        return resultFor(next, 'win', 'higher-hand', state.wager * 2);
    }
    if (playerValue.total === dealerValue.total) {
        return resultFor(next, 'push', 'equal-hand', state.wager);
    }
    return resultFor(next, 'loss', 'lower-hand', 0);
}

export function standBlackjack(state: BlackjackTable): BlackjackTable {
    requirePlayerTurn(state, 'stand');
    return finishDealerTurn({
        ...state,
        playerActions: state.playerActions + 1,
        lastAction: 'stand'
    });
}

export function doubleDownBlackjack(state: BlackjackTable): BlackjackTable {
    requirePlayerTurn(state, 'double-down');
    if (!getBlackjackLegalActions(state).includes('double-down')) {
        throw new Error('Double down is only legal as the first action with enough bankroll.');
    }
    const draw = drawCard(state);
    const doubledWager = money(state.wager * 2, 'Blackjack wager');
    const playerCards = Object.freeze([...state.playerCards, draw.card]);
    const doubled: BlackjackTable = {
        ...state,
        bankroll: money(state.bankroll - state.wager, 'Blackjack bankroll'),
        wager: doubledWager,
        deckPosition: draw.deckPosition,
        playerCards,
        playerActions: 1,
        lastAction: 'double-down'
    };
    return evaluateBlackjackHand(playerCards).busted
        ? resultFor(doubled, 'loss', 'player-bust', 0)
        : finishDealerTurn(doubled);
}
