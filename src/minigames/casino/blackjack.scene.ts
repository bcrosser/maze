import Phaser from 'phaser';

import {Mulberry32Random} from '../../domain/random/random-source';
import {
    createBlackjackTable,
    doubleDownBlackjack,
    evaluateBlackjackHand,
    getBlackjackLegalActions,
    hitBlackjack,
    standBlackjack,
    startBlackjackHand,
    type BlackjackResult,
    type BlackjackTable
} from './blackjack-model';
import {
    addCasinoButton,
    addPlayingCard,
    CASINO_COLORS,
    CASINO_VIEW_SIZE
} from './casino-scene-ui';

export const BLACKJACK_SCENE_KEY = 'blackjack';

export interface BlackjackLaunchData {
    readonly seed: number;
    readonly bankroll: number;
    readonly onBankrollChanged: (bankroll: number, message: string) => void;
    readonly onExit: () => void;
}

function resultMessage(result: BlackjackResult): string {
    const amount = Math.abs(result.profit);
    switch (result.outcome) {
        case 'blackjack':
            return `BLACKJACK! You won $${amount}.`;
        case 'win':
            return `You won $${amount}.`;
        case 'push':
            return 'Push. Your wager was returned.';
        case 'loss':
            return `House wins. You lost $${amount}.`;
    }
}

function clampEvenWager(value: number, bankroll: number): number {
    const maximum = Math.floor(bankroll / 2) * 2;
    if (maximum < 2) return 0;
    return Phaser.Math.Clamp(Math.round(value / 2) * 2, 2, maximum);
}

export class BlackjackScene extends Phaser.Scene {
    private launchData!: BlackjackLaunchData;
    private table!: BlackjackTable;
    private random!: Mulberry32Random;
    private wager = 2;
    private tableContainer: Phaser.GameObjects.Container | null = null;
    private notifiedHand = 0;

    constructor() {
        super({key: BLACKJACK_SCENE_KEY});
    }

    create(data: BlackjackLaunchData): void {
        this.launchData = data;
        this.random = new Mulberry32Random(data.seed);
        this.table = createBlackjackTable({
            bankroll: data.bankroll,
            minimumWager: 2,
            maximumWager: 1_000_000
        });
        this.wager = clampEvenWager(Math.min(10, data.bankroll), data.bankroll);
        this.notifiedHand = 0;
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            delete this.game.canvas.dataset.casinoGame;
            delete this.game.canvas.dataset.casinoPhase;
            delete this.game.canvas.dataset.casinoBankroll;
            delete this.game.canvas.dataset.casinoResult;
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
            if (key === 'h') this.hit();
            if (key === 's') this.stand();
            if (key === 'd') this.doubleDown();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.deal();
        }
        if (event.key === 'ArrowLeft') this.adjustWager(-2);
        if (event.key === 'ArrowRight') this.adjustWager(2);
    };

    private deal(): void {
        if (this.table.phase === 'player-turn' || this.wager < 2) return;
        this.table = startBlackjackHand(this.table, this.random, this.wager);
        this.afterAction();
    }

    private hit(): void {
        if (!getBlackjackLegalActions(this.table).includes('hit')) return;
        this.table = hitBlackjack(this.table);
        this.afterAction();
    }

    private stand(): void {
        if (!getBlackjackLegalActions(this.table).includes('stand')) return;
        this.table = standBlackjack(this.table);
        this.afterAction();
    }

    private doubleDown(): void {
        if (!getBlackjackLegalActions(this.table).includes('double-down')) return;
        this.table = doubleDownBlackjack(this.table);
        this.afterAction();
    }

    private adjustWager(delta: number): void {
        if (this.table.phase === 'player-turn') return;
        this.wager = clampEvenWager(this.wager + delta, this.table.bankroll);
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
            this.wager = clampEvenWager(this.wager, this.table.bankroll);
        }
        this.render();
    }

    private exitTable(): void {
        const active = this.table.phase === 'player-turn';
        this.launchData.onBankrollChanged(
            this.table.bankroll,
            active
                ? `You left Blackjack and forfeited the active $${this.table.wager} wager.`
                : 'You left the Blackjack table.'
        );
        this.scene.stop();
        this.launchData.onExit();
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
        container.add(this.add.text(28, 22, 'BLACKJACK', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '29px',
            fontStyle: 'bold'
        }));
        container.add(this.add.text(28, 57,
            `Wallet $${this.table.bankroll}  ·  Wager $${
                this.table.phase === 'player-turn' ? this.table.wager : this.wager
            }`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px'
            }
        ));
        addCasinoButton(this, container, 603, 43, 'LEAVE', () => this.exitTable(), {
            color: '#806b4f',
            width: 100
        });

        const playerValue = evaluateBlackjackHand(this.table.playerCards);
        const dealerValue = evaluateBlackjackHand(this.table.dealerCards);
        const revealDealer = this.table.phase === 'settled';
        container.add(this.add.text(336, 116,
            revealDealer
                ? `DEALER · ${dealerValue.total}${dealerValue.busted ? ' BUST' : ''}`
                : 'DEALER',
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '18px'
            }
        ).setOrigin(0.5));
        const dealerSpacing = 70;
        const dealerStart = 336 - (this.table.dealerCards.length - 1) * dealerSpacing / 2;
        this.table.dealerCards.forEach((card, index) => addPlayingCard(
            this,
            container,
            dealerStart + index * dealerSpacing,
            176,
            card,
            !revealDealer && index === 1
        ));

        container.add(this.add.text(336, 296,
            this.table.playerCards.length > 0
                ? `YOUR HAND · ${playerValue.total}${playerValue.soft ? ' SOFT' : ''}`
                : 'YOUR HAND',
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '18px'
            }
        ).setOrigin(0.5));
        const playerSpacing = 70;
        const playerStart = 336 - (this.table.playerCards.length - 1) * playerSpacing / 2;
        this.table.playerCards.forEach((card, index) => addPlayingCard(
            this,
            container,
            playerStart + index * playerSpacing,
            357,
            card
        ));

        const status = this.table.result
            ? resultMessage(this.table.result)
            : this.table.phase === 'player-turn'
                ? 'Get close to 21 without going over. Dealer stands on 17.'
                : this.table.bankroll < 2
                    ? 'You need at least $2 to deal. Hunt monsters to earn more.'
                    : 'Choose an even wager, then deal. Blackjack pays 3:2.';
        container.add(this.add.text(336, 447, status, {
            color: this.table.result?.outcome === 'loss' ? '#ffb3b8' : '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            align: 'center',
            wordWrap: {width: 560}
        }).setOrigin(0.5));

        if (this.table.phase === 'player-turn') {
            const legal = getBlackjackLegalActions(this.table);
            addCasinoButton(this, container, 150, 526, 'H · HIT', () => this.hit(), {
                enabled: legal.includes('hit'),
                width: 130
            });
            addCasinoButton(this, container, 336, 526, 'S · STAND', () => this.stand(), {
                enabled: legal.includes('stand'),
                width: 150
            });
            addCasinoButton(this, container, 530, 526, 'D · DOUBLE', () => this.doubleDown(), {
                enabled: legal.includes('double-down'),
                width: 160
            });
            container.add(this.add.text(336, 586,
                'Leaving during a hand forfeits its wager.',
                {
                    color: '#d8d2c4',
                    fontFamily: 'Georgia, serif',
                    fontSize: '14px'
                }
            ).setOrigin(0.5));
        } else {
            addCasinoButton(this, container, 120, 526, '− $2', () => this.adjustWager(-2), {
                enabled: this.wager > 2,
                width: 110
            });
            addCasinoButton(this, container, 336, 526,
                this.table.handNumber === 0 ? `DEAL · $${this.wager}` : `DEAL AGAIN · $${this.wager}`,
                () => this.deal(),
                {
                    enabled: this.wager >= 2 && this.table.bankroll >= this.wager,
                    width: 230,
                    color: '#3b654a'
                }
            );
            addCasinoButton(this, container, 552, 526, '+ $2', () => this.adjustWager(2), {
                enabled: this.wager + 2 <= this.table.bankroll,
                width: 110
            });
            container.add(this.add.text(336, 586,
                `Hands ${this.table.handNumber}  ·  W ${this.table.wins}  L ${this.table.losses}  P ${this.table.pushes}`,
                {
                    color: '#d8d2c4',
                    fontFamily: 'Georgia, serif',
                    fontSize: '14px'
                }
            ).setOrigin(0.5));
        }

        this.game.canvas.dataset.casinoGame = 'blackjack';
        this.game.canvas.dataset.casinoPhase = this.table.phase;
        this.game.canvas.dataset.casinoBankroll = String(this.table.bankroll);
        this.game.canvas.dataset.casinoResult = this.table.result?.outcome ?? '';
        this.game.canvas.dataset.casinoHand = String(this.table.handNumber);
    }
}
