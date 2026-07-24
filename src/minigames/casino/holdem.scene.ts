import Phaser from 'phaser';

import {Mulberry32Random} from '../../domain/random/random-source';
import {
    actHoldem,
    createHoldemTable,
    getHoldemLegalActions,
    startHoldemHand,
    type HoldemAction,
    type HoldemResult,
    type HoldemTable
} from './holdem-model';
import {
    addCasinoButton,
    addPlayingCard,
    CASINO_COLORS,
    CASINO_VIEW_SIZE
} from './casino-scene-ui';

export const HOLDEM_SCENE_KEY = 'holdem';

export interface HoldemLaunchData {
    readonly seed: number;
    readonly bankroll: number;
    readonly onBankrollChanged: (bankroll: number, message: string) => void;
    readonly onExit: () => void;
}

function readableCategory(category: string): string {
    return category.replaceAll('-', ' ').toUpperCase();
}

function resultMessage(result: HoldemResult): string {
    if (result.outcome === 'push') return 'Split pot. Your share was returned.';
    const amount = Math.abs(result.profit);
    if (result.reason === 'computer-folded') return `Computer folded. You won $${amount}.`;
    if (result.reason === 'player-folded') return `You folded and lost $${amount}.`;
    return result.outcome === 'win'
        ? `Showdown won! Profit $${amount}.`
        : `Computer wins the showdown. You lost $${amount}.`;
}

function clampAnte(value: number, bankroll: number): number {
    if (bankroll < 1) return 0;
    return Phaser.Math.Clamp(Math.round(value), 1, Math.floor(bankroll));
}

export class HoldemScene extends Phaser.Scene {
    private launchData!: HoldemLaunchData;
    private table!: HoldemTable;
    private random!: Mulberry32Random;
    private ante = 2;
    private tableContainer: Phaser.GameObjects.Container | null = null;
    private notifiedHand = 0;

    constructor() {
        super({key: HOLDEM_SCENE_KEY});
    }

    create(data: HoldemLaunchData): void {
        this.launchData = data;
        this.random = new Mulberry32Random(data.seed);
        this.table = createHoldemTable({
            bankroll: data.bankroll,
            minimumAnte: 1,
            maximumAnte: 1_000_000
        });
        this.ante = clampAnte(Math.min(5, data.bankroll), data.bankroll);
        this.notifiedHand = 0;
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            delete this.game.canvas.dataset.casinoGame;
            delete this.game.canvas.dataset.casinoPhase;
            delete this.game.canvas.dataset.casinoBankroll;
            delete this.game.canvas.dataset.casinoResult;
            delete this.game.canvas.dataset.casinoStreet;
            delete this.game.canvas.dataset.casinoLegalActions;
            delete this.game.canvas.dataset.casinoHand;
        });
        this.render();
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.exitTable();
            return;
        }
        const key = event.key.toLowerCase();
        if (this.table.phase === 'player-turn') {
            if (key === 'f') this.act('fold');
            if (key === 'c') {
                const legal = getHoldemLegalActions(this.table);
                if (legal.includes('call')) this.act('call');
                else if (legal.includes('check')) this.act('check');
            }
            if (key === 'b') this.act('bet');
            if (key === 'r') this.act('raise');
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.deal();
        }
        if (event.key === 'ArrowLeft') this.adjustAnte(-1);
        if (event.key === 'ArrowRight') this.adjustAnte(1);
    };

    private deal(): void {
        if (this.table.phase === 'player-turn' || this.ante < 1) return;
        this.table = startHoldemHand(this.table, this.random, this.ante);
        this.afterAction();
    }

    private act(action: HoldemAction): void {
        if (!getHoldemLegalActions(this.table).includes(action)) return;
        this.table = actHoldem(this.table, action);
        this.afterAction();
    }

    private adjustAnte(delta: number): void {
        if (this.table.phase === 'player-turn') return;
        this.ante = clampAnte(this.ante + delta, this.table.bankroll);
        this.render();
    }

    private afterAction(): void {
        if (
            this.table.phase === 'settled' &&
            this.table.result &&
            this.notifiedHand !== this.table.handNumber
        ) {
            this.notifiedHand = this.table.handNumber;
            this.launchData.onBankrollChanged(
                this.table.bankroll,
                resultMessage(this.table.result)
            );
            this.ante = clampAnte(this.ante, this.table.bankroll);
        }
        this.render();
    }

    private exitTable(): void {
        const active = this.table.phase === 'player-turn';
        this.launchData.onBankrollChanged(
            this.table.bankroll,
            active
                ? `You left Hold’em and forfeited $${this.table.playerContribution}.`
                : 'You left the Texas Hold’em table.'
        );
        this.scene.stop();
        this.launchData.onExit();
    }

    private recentActionText(): string {
        const event = this.table.actionLog.at(-1);
        if (!event) return 'Choose an ante and deal a heads-up hand.';
        const actor = event.actor === 'computer'
            ? 'Computer'
            : event.actor === 'player' ? 'You' : 'Dealer';
        const action = event.action.replaceAll('-', ' ');
        return `${actor}: ${action}${event.amount > 0 ? ` $${event.amount}` : ''}.`;
    }

    private render(): void {
        this.tableContainer?.destroy(true);
        const container = this.add.container(0, 0).setDepth(1);
        this.tableContainer = container;
        container.add(this.add.rectangle(
            0,
            0,
            CASINO_VIEW_SIZE,
            CASINO_VIEW_SIZE,
            CASINO_COLORS.background
        ).setOrigin(0));
        container.add(this.add.rectangle(
            CASINO_VIEW_SIZE / 2,
            CASINO_VIEW_SIZE / 2 + 10,
            620,
            590,
            CASINO_COLORS.felt
        ).setStrokeStyle(14, CASINO_COLORS.rail));
        container.add(this.add.text(28, 20, 'TEXAS HOLD’EM', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '28px',
            fontStyle: 'bold'
        }));
        container.add(this.add.text(28, 55,
            `Wallet $${this.table.bankroll}  ·  Pot $${this.table.pot}  ·  ${
                this.table.phase === 'player-turn'
                    ? this.table.street.toUpperCase()
                    : `Ante $${this.ante}`
            }`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '16px'
            }
        ));
        addCasinoButton(this, container, 603, 42, 'LEAVE', () => this.exitTable(), {
            color: '#806b4f',
            width: 100
        });

        const revealComputer = this.table.phase === 'settled';
        container.add(this.add.text(336, 102,
            revealComputer && this.table.result?.computerHand
                ? `COMPUTER · ${readableCategory(this.table.result.computerHand.category)}`
                : 'COMPUTER',
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '16px'
            }
        ).setOrigin(0.5));
        this.table.computerCards.forEach((card, index) => addPlayingCard(
            this,
            container,
            300 + index * 72,
            153,
            card,
            !revealComputer,
            0.82
        ));

        container.add(this.add.text(336, 219, 'COMMUNITY', {
            color: '#d8d2c4',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        }).setOrigin(0.5));
        for (let index = 0; index < 5; index++) {
            const card = this.table.communityCards[index] ?? null;
            addPlayingCard(
                this,
                container,
                186 + index * 75,
                267,
                card,
                card === null,
                0.88
            );
        }

        container.add(this.add.text(336, 340,
            this.table.result?.playerHand
                ? `YOUR HAND · ${readableCategory(this.table.result.playerHand.category)}`
                : 'YOUR HAND',
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '16px'
            }
        ).setOrigin(0.5));
        this.table.playerCards.forEach((card, index) => addPlayingCard(
            this,
            container,
            300 + index * 72,
            391,
            card,
            false,
            0.82
        ));

        const status = this.table.result
            ? resultMessage(this.table.result)
            : this.table.phase === 'player-turn'
                ? `${this.recentActionText()} ${
                    this.table.amountToCall > 0
                        ? `Call $${this.table.amountToCall}, raise, or fold.`
                        : 'Check or bet.'
                }`
                : this.table.bankroll < 1
                    ? 'You need $1 to deal. Monsters can replenish your wallet.'
                    : 'Heads-up fixed-limit Hold’em. Pick an ante, then deal.';
        container.add(this.add.text(336, 470, status, {
            color: this.table.result?.outcome === 'loss' ? '#ffb3b8' : '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            align: 'center',
            wordWrap: {width: 570}
        }).setOrigin(0.5));

        if (this.table.phase === 'player-turn') {
            const legal = getHoldemLegalActions(this.table);
            const buttonLabels: Readonly<Record<HoldemAction, string>> = {
                fold: 'F · FOLD',
                check: 'C · CHECK',
                call: `C · CALL $${this.table.amountToCall}`,
                bet: 'B · BET',
                raise: 'R · RAISE'
            };
            const spacing = Math.min(170, 520 / Math.max(1, legal.length));
            const start = 336 - spacing * (legal.length - 1) / 2;
            legal.forEach((action, index) => {
                addCasinoButton(
                    this,
                    container,
                    start + spacing * index,
                    548,
                    buttonLabels[action],
                    () => this.act(action),
                    {
                        width: Math.min(155, spacing - 10),
                        color: action === 'fold' ? '#806b4f' : '#382f54'
                    }
                );
            });
            container.add(this.add.text(336, 606,
                'The computer acts automatically. Leaving mid-hand forfeits your contribution.',
                {
                    color: '#d8d2c4',
                    fontFamily: 'Georgia, serif',
                    fontSize: '13px'
                }
            ).setOrigin(0.5));
        } else {
            addCasinoButton(this, container, 120, 548, '− $1', () => this.adjustAnte(-1), {
                enabled: this.ante > 1,
                width: 110
            });
            addCasinoButton(this, container, 336, 548,
                this.table.handNumber === 0 ? `DEAL · $${this.ante}` : `DEAL AGAIN · $${this.ante}`,
                () => this.deal(),
                {
                    enabled: this.ante >= 1 && this.table.bankroll >= this.ante,
                    width: 230,
                    color: '#3b654a'
                }
            );
            addCasinoButton(this, container, 552, 548, '+ $1', () => this.adjustAnte(1), {
                enabled: this.ante + 1 <= this.table.bankroll,
                width: 110
            });
            container.add(this.add.text(336, 606,
                `Hands ${this.table.handNumber}  ·  W ${this.table.wins}  L ${this.table.losses}  P ${this.table.pushes}`,
                {
                    color: '#d8d2c4',
                    fontFamily: 'Georgia, serif',
                    fontSize: '14px'
                }
            ).setOrigin(0.5));
        }

        this.game.canvas.dataset.casinoGame = 'holdem';
        this.game.canvas.dataset.casinoPhase = this.table.phase;
        this.game.canvas.dataset.casinoBankroll = String(this.table.bankroll);
        this.game.canvas.dataset.casinoResult = this.table.result?.outcome ?? '';
        this.game.canvas.dataset.casinoStreet = this.table.street;
        this.game.canvas.dataset.casinoLegalActions =
            getHoldemLegalActions(this.table).join(',');
        this.game.canvas.dataset.casinoHand = String(this.table.handNumber);
    }
}
