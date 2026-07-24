import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {
    EncounterContext,
    EncounterResult,
    OutcomeEffect
} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    activateCircuitBooster,
    applyCircuitSwap,
    areCircuitCellsAdjacent,
    canonicalCircuitSignature,
    createCircuitPuzzle,
    getCircuitLegalSwaps,
    getCircuitProgress,
    validateCircuitWitness,
    type CircuitColor,
    type CircuitPuzzleState,
    type CircuitSpecial
} from './circuit-model';

export const CIRCUIT_CRUSH_SCENE_KEY = 'circuit-crush';
export const CIRCUIT_BOARD_ORIGIN = Object.freeze({x: 18, y: 124});
export const CIRCUIT_TILE_SIZE = 57;

export interface CircuitCrushLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const BOARD_SIZE = CIRCUIT_TILE_SIZE * 8;
const PANEL_X = CIRCUIT_BOARD_ORIGIN.x + BOARD_SIZE + 13;
const PANEL_WIDTH = VIEW_SIZE - PANEL_X - 14;

const COLORS = Object.freeze({
    background: 0x07131c,
    grid: 0x102b38,
    gridAlternate: 0x0d2532,
    gridBorder: 0x4e8191,
    panel: 0x10212b,
    panelBorder: 0x3f7383,
    paper: 0xe8fbff,
    muted: 0x83aab5,
    accent: 0x72f4df,
    danger: 0xff694f,
    dangerDark: 0x6f1d28,
    warning: 0xffbf47,
    selection: 0xffffff,
    hint: 0xffe566,
    pulse: 0xff73c9
});

const CHIP_COLORS: Readonly<Record<CircuitColor, number>> = Object.freeze({
    cyan: 0x29d9ff,
    magenta: 0xff4fab,
    amber: 0xffbd3e,
    lime: 0x8eea42,
    violet: 0xa56cff
});

const CHIP_DARK_COLORS: Readonly<Record<CircuitColor, number>> = Object.freeze({
    cyan: 0x0e6c86,
    magenta: 0x862b62,
    amber: 0x805d1e,
    lime: 0x46751f,
    violet: 0x523680
});

const HELP_BODY =
    'CLEAR EVERY SHORT CIRCUIT BEFORE MOVES RUN OUT\n\n' +
    'Tap two neighboring chips to swap them. Match 3 or more of one color. ' +
    'Only a match uses a move; an invalid swap is free.\n\n' +
    'Matches touching a red lightning overlay repair that short. ' +
    'Clear every overlay to win.\n\n' +
    'Long and crossing matches build beam, burst, and spectrum chips. ' +
    'Swap a special to discharge it.\n\n' +
    'BOOSTERS: Overclock adds moves, Trace reveals a strong swap, ' +
    'Pulse clears a 3x3 area, and Reroute shuffles the board.';

type FinishStatus = 'success' | 'failure' | 'abandoned';
type BoosterKey = 'extra' | 'hint' | 'pulse' | 'shuffle';

function resolveAttemptNumber(runId: string): number {
    const lastSegment = runId.split('/').at(-1);
    const ordinal = Number(lastSegment);
    return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal + 1 : 1;
}

function gradeCircuit(state: CircuitPuzzleState): PerformanceGrade {
    if (state.terminalStatus !== 'success') return 'none';
    if (state.movesSpent <= state.certificate.requiredMoves) return 's';
    if (state.movesSpent <= state.certificate.requiredMoves + 3) return 'a';
    if (state.movesSpent <= state.certificate.requiredMoves + 7) return 'b';
    return 'c';
}

function specialName(special: CircuitSpecial): string {
    switch (special) {
        case 'none':
            return 'STANDARD';
        case 'row':
            return 'ROW BEAM';
        case 'column':
            return 'COLUMN BEAM';
        case 'burst':
            return 'BURST CORE';
        case 'color':
            return 'SPECTRUM CORE';
    }
}

export class CircuitCrushScene extends Phaser.Scene {
    private launchData!: CircuitCrushLaunchData;
    private state!: CircuitPuzzleState;
    private boardGraphics!: Phaser.GameObjects.Graphics;
    private meterGraphics!: Phaser.GameObjects.Graphics;
    private movesText!: Phaser.GameObjects.Text;
    private shortsText!: Phaser.GameObjects.Text;
    private scoreText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private boosterTexts = new Map<BoosterKey, Phaser.GameObjects.Text>();
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private selectedIndex: number | null = null;
    private cursorIndex = 0;
    private pulseTargeting = false;
    private helpOpen = false;
    private finishing = false;
    private finishTimer: Phaser.Time.TimerEvent | null = null;
    private activeElapsedMs = 0;
    private animationClockMs = 0;
    private flashIndices: readonly number[] = [];
    private flashUntilMs = 0;

    constructor() {
        super({key: CIRCUIT_CRUSH_SCENE_KEY});
    }

    create(data: CircuitCrushLaunchData): void {
        this.launchData = data;
        this.state = createCircuitPuzzle(new Mulberry32Random(data.context.seed), {
            size: 8,
            moveBudget: 18,
            witnessMoves: 6,
            boosterCharges: {
                extraMoves: 1,
                hints: 3 + Math.max(
                    0,
                    Math.floor(getEncounterNumberModifier(
                        data.context,
                        'circuitHintBonus'
                    ))
                ),
                pulses: 1 + Math.max(
                    0,
                    Math.floor(getEncounterNumberModifier(
                        data.context,
                        'circuitPulseBonus'
                    ))
                ),
                shuffles: 1
            },
            attemptNumber: resolveAttemptNumber(data.context.runId)
        });
        this.selectedIndex = null;
        this.cursorIndex = 0;
        this.pulseTargeting = false;
        this.helpOpen = false;
        this.finishing = false;
        this.finishTimer = null;
        this.activeElapsedMs = 0;
        this.animationClockMs = 0;
        this.flashIndices = [];
        this.flashUntilMs = 0;
        this.helpObjects = [];
        this.boosterTexts.clear();

        this.cameras.main.setBackgroundColor(COLORS.background);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 650, 650, COLORS.panel, 0.6)
            .setStrokeStyle(2, COLORS.panelBorder);
        this.add.text(18, 14, 'CIRCUIT CRUSH', {
            color: '#72f4df',
            fontFamily: 'Georgia, serif',
            fontSize: '28px',
            fontStyle: 'bold'
        });
        this.add.text(18, 49, 'Match colored signal chips. Repair every sparking short.', {
            color: '#9bc4cd',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });
        this.add.text(18, 76, 'SELECT', {
            color: '#83aab5',
            fontFamily: 'monospace',
            fontSize: '12px'
        });
        this.add.text(73, 76, 'TAP 2 CHIPS  /  ARROWS + ENTER', {
            color: '#e8fbff',
            fontFamily: 'monospace',
            fontSize: '12px'
        });
        const itemBonus = getEncounterItemBonusLabel(data.context);
        if (itemBonus) {
            this.add.text(18, 98, `ITEM BONUS · ${itemBonus}`, {
                color: '#72efb1',
                fontFamily: 'monospace',
                fontSize: '10px',
                wordWrap: {width: 445}
            });
        }
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';

        this.meterGraphics = this.add.graphics().setDepth(4);
        this.boardGraphics = this.add.graphics().setDepth(10);
        this.createBoardInput();
        this.createSidePanel();
        this.createHeaderButtons();

        this.statusText = this.add.text(18, 595, '', {
            color: '#72f4df',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            fontStyle: 'bold',
            wordWrap: {width: 444, useAdvancedWrap: true}
        });
        this.add.text(18, 644, 'Arrows/WASD move  ·  Enter/Space select  ·  1–4 boosters  ·  H help', {
            color: '#678b96',
            fontFamily: 'monospace',
            fontSize: '11px'
        });

        this.input.keyboard?.on('keydown', this.handleKeyDown);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown);
            this.finishTimer?.remove(false);
            this.clearTelemetry();
        });

        this.syncPresentation();
        if (data.context.runId.endsWith('/0')) this.showHelp();
    }

    override update(_time: number, delta: number): void {
        const safeDelta = Math.max(0, Math.min(delta, 100));
        this.animationClockMs += safeDelta;
        if (!this.helpOpen && !this.finishing && this.state.terminalStatus === 'active') {
            this.activeElapsedMs += safeDelta;
        }
        if (this.flashIndices.length > 0 && this.animationClockMs >= this.flashUntilMs) {
            this.flashIndices = [];
        }
        this.drawBoard();
    }

    private createBoardInput(): void {
        for (let index = 0; index < 64; index++) {
            const column = index % 8;
            const row = Math.floor(index / 8);
            this.add.rectangle(
                CIRCUIT_BOARD_ORIGIN.x + column * CIRCUIT_TILE_SIZE + CIRCUIT_TILE_SIZE / 2,
                CIRCUIT_BOARD_ORIGIN.y + row * CIRCUIT_TILE_SIZE + CIRCUIT_TILE_SIZE / 2,
                CIRCUIT_TILE_SIZE - 3,
                CIRCUIT_TILE_SIZE - 3,
                0xffffff,
                0.001
            ).setDepth(20)
                .setInteractive({useHandCursor: true})
                .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                    pointer.event.preventDefault();
                    this.chooseCell(index);
                });
        }
    }

    private createSidePanel(): void {
        this.add.rectangle(
            PANEL_X + PANEL_WIDTH / 2,
            CIRCUIT_BOARD_ORIGIN.y + BOARD_SIZE / 2,
            PANEL_WIDTH,
            BOARD_SIZE,
            COLORS.grid,
            0.96
        ).setStrokeStyle(2, COLORS.gridBorder).setDepth(3);

        this.movesText = this.add.text(PANEL_X + 10, 139, '', {
            color: '#e8fbff',
            fontFamily: 'Georgia, serif',
            fontSize: '20px',
            fontStyle: 'bold'
        }).setDepth(5);
        this.shortsText = this.add.text(PANEL_X + 10, 170, '', {
            color: '#ff8a71',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            fontStyle: 'bold'
        }).setDepth(5);
        this.scoreText = this.add.text(PANEL_X + 10, 199, '', {
            color: '#83aab5',
            fontFamily: 'monospace',
            fontSize: '12px'
        }).setDepth(5);

        this.add.text(PANEL_X + 10, 233, 'REPAIR LOAD', {
            color: '#83aab5',
            fontFamily: 'monospace',
            fontSize: '11px'
        }).setDepth(5);

        this.add.text(PANEL_X + 10, 276, 'BOOSTERS', {
            color: '#72f4df',
            fontFamily: 'Georgia, serif',
            fontSize: '14px',
            fontStyle: 'bold'
        }).setDepth(5);
        this.createBoosterButton(321, 'extra', '1  OVERCLOCK', 0x246278, () => {
            this.useImmediateBooster('extra');
        });
        this.createBoosterButton(374, 'hint', '2  TRACE', 0x65592b, () => {
            this.useImmediateBooster('hint');
        });
        this.createBoosterButton(427, 'pulse', '3  PULSE', 0x752e65, () => {
            this.togglePulseTargeting();
        });
        this.createBoosterButton(480, 'shuffle', '4  REROUTE', 0x3f3b75, () => {
            this.useImmediateBooster('shuffle');
        });

        this.add.text(PANEL_X + 10, 520,
            'SPECIALS\n━ row  ┃ column\n✦ burst  ◉ spectrum',
            {
                color: '#83aab5',
                fontFamily: 'monospace',
                fontSize: '11px',
                lineSpacing: 4
            }
        ).setDepth(5);
    }

    private createHeaderButtons(): void {
        this.createButton(628, 31, 58, 34, 'HELP', 0x245468, () => this.showHelp());
        this.createButton(558, 31, 68, 34, 'EXIT', 0x713443, () => {
            this.finish('abandoned');
        });
    }

    private createBoosterButton(
        y: number,
        key: BoosterKey,
        label: string,
        color: number,
        action: () => void
    ): void {
        const x = PANEL_X + PANEL_WIDTH / 2;
        const button = this.add.rectangle(x, y, PANEL_WIDTH - 16, 43, color, 0.95)
            .setStrokeStyle(2, 0x8ec4cf)
            .setDepth(5)
            .setInteractive({useHandCursor: true});
        const text = this.add.text(x, y, label, {
            color: '#e8fbff',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5).setDepth(6);
        button.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.preventDefault();
            if (!this.helpOpen && !this.finishing) action();
        });
        this.boosterTexts.set(key, text);
    }

    private createButton(
        x: number,
        y: number,
        width: number,
        height: number,
        label: string,
        color: number,
        action: () => void
    ): void {
        const button = this.add.rectangle(x, y, width, height, color, 0.97)
            .setStrokeStyle(2, 0x8ec4cf)
            .setDepth(30)
            .setInteractive({useHandCursor: true});
        this.add.text(x, y, label, {
            color: '#e8fbff',
            fontFamily: 'monospace',
            fontSize: '11px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(31);
        button.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.preventDefault();
            if (!this.finishing) action();
        });
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (this.finishing) return;
        const key = event.key.toLowerCase();
        if (this.helpOpen) {
            if (key === 'enter' || key === ' ' || key === 'h' || key === 'escape') {
                event.preventDefault();
                this.closeHelp();
            }
            return;
        }
        if (key === 'h') {
            event.preventDefault();
            this.showHelp();
            return;
        }
        if (key === 'escape') {
            event.preventDefault();
            if (this.pulseTargeting) {
                this.pulseTargeting = false;
                this.statusText.setText('PULSE TARGETING CANCELLED');
                this.syncPresentation();
            } else if (this.selectedIndex !== null) {
                this.selectedIndex = null;
                this.syncPresentation();
            }
            return;
        }
        if (this.state.terminalStatus !== 'active') return;

        switch (key) {
            case 'arrowleft':
            case 'a':
                event.preventDefault();
                this.moveCursor(-1, 0);
                break;
            case 'arrowright':
            case 'd':
                event.preventDefault();
                this.moveCursor(1, 0);
                break;
            case 'arrowup':
            case 'w':
                event.preventDefault();
                this.moveCursor(0, -1);
                break;
            case 'arrowdown':
            case 's':
                event.preventDefault();
                this.moveCursor(0, 1);
                break;
            case 'enter':
            case ' ':
                event.preventDefault();
                this.chooseCell(this.cursorIndex);
                break;
            case '1':
                event.preventDefault();
                this.useImmediateBooster('extra');
                break;
            case '2':
                event.preventDefault();
                this.useImmediateBooster('hint');
                break;
            case '3':
                event.preventDefault();
                this.togglePulseTargeting();
                break;
            case '4':
                event.preventDefault();
                this.useImmediateBooster('shuffle');
                break;
        }
    };

    private moveCursor(deltaX: number, deltaY: number): void {
        const x = this.cursorIndex % this.state.width;
        const y = Math.floor(this.cursorIndex / this.state.width);
        const nextX = Phaser.Math.Clamp(x + deltaX, 0, this.state.width - 1);
        const nextY = Phaser.Math.Clamp(y + deltaY, 0, this.state.height - 1);
        this.cursorIndex = nextY * this.state.width + nextX;
        this.publishTelemetry();
    }

    private chooseCell(index: number): void {
        if (
            this.helpOpen ||
            this.finishing ||
            this.state.terminalStatus !== 'active'
        ) {
            return;
        }
        this.cursorIndex = index;
        if (this.pulseTargeting) {
            this.state = activateCircuitBooster(this.state, {
                kind: 'pulse',
                cellIndex: index
            });
            this.pulseTargeting = false;
            this.selectedIndex = null;
            this.afterModelAction();
            return;
        }
        if (this.selectedIndex === null) {
            this.selectedIndex = index;
            this.statusText.setText(
                `${specialName(this.state.chips[index]!.special)} SELECTED · CHOOSE A NEIGHBOR`
            );
            this.publishTelemetry();
            return;
        }
        if (this.selectedIndex === index) {
            this.selectedIndex = null;
            this.statusText.setText('SELECTION CLEARED');
            this.publishTelemetry();
            return;
        }
        if (!areCircuitCellsAdjacent(
            this.selectedIndex,
            index,
            this.state.width,
            this.state.height
        )) {
            this.selectedIndex = index;
            this.statusText.setText('CHOOSE A NEIGHBORING CHIP TO SWAP');
            this.publishTelemetry();
            return;
        }

        const fromIndex = this.selectedIndex;
        this.selectedIndex = null;
        this.state = applyCircuitSwap(this.state, fromIndex, index);
        this.afterModelAction();
    }

    private useImmediateBooster(key: Exclude<BoosterKey, 'pulse'>): void {
        if (
            this.helpOpen ||
            this.finishing ||
            this.state.terminalStatus !== 'active'
        ) {
            return;
        }
        this.pulseTargeting = false;
        this.selectedIndex = null;
        switch (key) {
            case 'extra':
                this.state = activateCircuitBooster(this.state, {kind: 'extra-moves'});
                break;
            case 'hint':
                this.state = activateCircuitBooster(this.state, {kind: 'hint'});
                break;
            case 'shuffle':
                this.state = activateCircuitBooster(this.state, {kind: 'shuffle'});
                break;
        }
        this.afterModelAction();
    }

    private togglePulseTargeting(): void {
        if (
            this.helpOpen ||
            this.finishing ||
            this.state.terminalStatus !== 'active'
        ) {
            return;
        }
        this.selectedIndex = null;
        if (this.state.boosterCharges.pulses <= 0) {
            this.state = activateCircuitBooster(this.state, {
                kind: 'pulse',
                cellIndex: this.cursorIndex
            });
            this.pulseTargeting = false;
            this.afterModelAction();
            return;
        }
        this.pulseTargeting = !this.pulseTargeting;
        this.statusText.setText(
            this.pulseTargeting
                ? 'PULSE ARMED · TAP A CHIP TO CLEAR ITS 3×3 AREA'
                : 'PULSE TARGETING CANCELLED'
        );
        this.publishTelemetry();
    }

    private afterModelAction(): void {
        this.flashIndices = this.state.lastEvent.affectedIndices;
        this.flashUntilMs = this.animationClockMs + 560;
        this.syncPresentation();
        if (this.state.terminalStatus !== 'active' && !this.finishing) {
            this.finishing = true;
            const terminalStatus = this.state.terminalStatus;
            this.finishTimer = this.time.delayedCall(900, () => {
                this.finish(terminalStatus);
            });
        }
    }

    private syncPresentation(): void {
        const progress = getCircuitProgress(this.state);
        this.movesText.setText(`MOVES  ${this.state.movesRemaining}`);
        this.shortsText.setText(`SHORTS  ${this.state.blockersRemaining}`);
        this.scoreText.setText(`SCORE ${String(this.state.score).padStart(6, '0')}`);
        this.statusText.setText(this.state.lastEvent.message);
        this.statusText.setColor(
            this.state.terminalStatus === 'failure'
                ? '#ff8a71'
                : this.state.terminalStatus === 'success'
                    ? '#72f4df'
                    : this.state.lastEvent.kind === 'invalid-swap'
                        ? '#ffcf68'
                        : '#c7f6ff'
        );

        this.boosterTexts.get('extra')?.setText(
            `1  OVERCLOCK  ×${this.state.boosterCharges.extraMoves}`
        );
        this.boosterTexts.get('hint')?.setText(
            `2  TRACE      ×${this.state.boosterCharges.hints}`
        );
        this.boosterTexts.get('pulse')?.setText(
            `3  PULSE      ×${this.state.boosterCharges.pulses}`
        );
        this.boosterTexts.get('shuffle')?.setText(
            `4  REROUTE    ×${this.state.boosterCharges.shuffles}`
        );

        this.meterGraphics.clear();
        this.meterGraphics.fillStyle(0x07131c, 1);
        this.meterGraphics.fillRoundedRect(PANEL_X + 10, 250, PANEL_WIDTH - 20, 13, 5);
        this.meterGraphics.fillStyle(
            progress >= 1 ? COLORS.accent : COLORS.danger,
            1
        );
        this.meterGraphics.fillRoundedRect(
            PANEL_X + 12,
            252,
            Math.max(0, (PANEL_WIDTH - 24) * progress),
            9,
            4
        );
        this.drawBoard();
        this.publishTelemetry();
    }

    private drawBoard(): void {
        if (!this.boardGraphics) return;
        const graphics = this.boardGraphics;
        const pulse = 0.5 + 0.5 * Math.sin(this.animationClockMs / 160);
        const hintIndices = new Set<number>();
        if (this.state.lastHint !== null) {
            hintIndices.add(this.state.lastHint.swap.fromIndex);
            hintIndices.add(this.state.lastHint.swap.toIndex);
        }
        const flashing = new Set(this.flashIndices);

        graphics.clear();
        graphics.fillStyle(0x050d13, 1);
        graphics.fillRoundedRect(
            CIRCUIT_BOARD_ORIGIN.x - 5,
            CIRCUIT_BOARD_ORIGIN.y - 5,
            BOARD_SIZE + 10,
            BOARD_SIZE + 10,
            8
        );
        graphics.lineStyle(2, COLORS.gridBorder, 1);
        graphics.strokeRoundedRect(
            CIRCUIT_BOARD_ORIGIN.x - 5,
            CIRCUIT_BOARD_ORIGIN.y - 5,
            BOARD_SIZE + 10,
            BOARD_SIZE + 10,
            8
        );

        for (let index = 0; index < this.state.chips.length; index++) {
            const column = index % this.state.width;
            const row = Math.floor(index / this.state.width);
            const x = CIRCUIT_BOARD_ORIGIN.x + column * CIRCUIT_TILE_SIZE;
            const y = CIRCUIT_BOARD_ORIGIN.y + row * CIRCUIT_TILE_SIZE;
            const centerX = x + CIRCUIT_TILE_SIZE / 2;
            const centerY = y + CIRCUIT_TILE_SIZE / 2;
            const chip = this.state.chips[index]!;

            graphics.fillStyle(
                (column + row) % 2 === 0 ? COLORS.grid : COLORS.gridAlternate,
                1
            );
            graphics.fillRoundedRect(
                x + 2,
                y + 2,
                CIRCUIT_TILE_SIZE - 4,
                CIRCUIT_TILE_SIZE - 4,
                7
            );
            this.drawChip(graphics, centerX, centerY, chip.color, chip.special, pulse);

            if (this.state.blockers[index]! > 0) {
                this.drawShortCircuit(graphics, x, y, centerX, centerY, pulse);
            }
            if (flashing.has(index)) {
                graphics.fillStyle(COLORS.accent, Math.max(0.08, 0.28 * pulse));
                graphics.fillRoundedRect(
                    x + 3,
                    y + 3,
                    CIRCUIT_TILE_SIZE - 6,
                    CIRCUIT_TILE_SIZE - 6,
                    7
                );
            }
            if (hintIndices.has(index)) {
                graphics.lineStyle(4, COLORS.hint, 0.68 + pulse * 0.32);
                graphics.strokeRoundedRect(
                    x + 4,
                    y + 4,
                    CIRCUIT_TILE_SIZE - 8,
                    CIRCUIT_TILE_SIZE - 8,
                    7
                );
            }
            if (this.selectedIndex === index) {
                graphics.lineStyle(4, COLORS.selection, 1);
                graphics.strokeRoundedRect(
                    x + 3,
                    y + 3,
                    CIRCUIT_TILE_SIZE - 6,
                    CIRCUIT_TILE_SIZE - 6,
                    8
                );
            }
            if (this.cursorIndex === index) {
                const cursorColor = this.pulseTargeting ? COLORS.pulse : COLORS.accent;
                graphics.lineStyle(2, cursorColor, 0.55 + pulse * 0.45);
                graphics.strokeRoundedRect(
                    x + 7,
                    y + 7,
                    CIRCUIT_TILE_SIZE - 14,
                    CIRCUIT_TILE_SIZE - 14,
                    5
                );
            }
        }

        if (this.pulseTargeting) {
            const column = this.cursorIndex % this.state.width;
            const row = Math.floor(this.cursorIndex / this.state.width);
            graphics.lineStyle(3, COLORS.pulse, 0.66 + pulse * 0.34);
            graphics.strokeCircle(
                CIRCUIT_BOARD_ORIGIN.x + column * CIRCUIT_TILE_SIZE
                    + CIRCUIT_TILE_SIZE / 2,
                CIRCUIT_BOARD_ORIGIN.y + row * CIRCUIT_TILE_SIZE
                    + CIRCUIT_TILE_SIZE / 2,
                20 + pulse * 5
            );
        }
    }

    private drawChip(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        color: CircuitColor,
        special: CircuitSpecial,
        pulse: number
    ): void {
        const bright = CHIP_COLORS[color];
        const dark = CHIP_DARK_COLORS[color];
        graphics.fillStyle(dark, 0.96);
        graphics.fillRoundedRect(x - 19, y - 19, 38, 38, 9);
        graphics.lineStyle(2, bright, 0.92);
        graphics.strokeRoundedRect(x - 19, y - 19, 38, 38, 9);

        graphics.lineStyle(2, bright, 0.55);
        graphics.lineBetween(x - 24, y - 11, x - 16, y - 11);
        graphics.lineBetween(x - 24, y + 11, x - 16, y + 11);
        graphics.lineBetween(x + 16, y - 11, x + 24, y - 11);
        graphics.lineBetween(x + 16, y + 11, x + 24, y + 11);
        graphics.lineBetween(x - 11, y - 24, x - 11, y - 16);
        graphics.lineBetween(x + 11, y - 24, x + 11, y - 16);
        graphics.lineBetween(x - 11, y + 16, x - 11, y + 24);
        graphics.lineBetween(x + 11, y + 16, x + 11, y + 24);

        graphics.fillStyle(bright, 0.25 + pulse * 0.2);
        graphics.fillCircle(x, y, special === 'none' ? 12 : 15);
        graphics.fillStyle(bright, 1);

        switch (special) {
            case 'none':
                graphics.fillRoundedRect(x - 7, y - 7, 14, 14, 3);
                graphics.fillStyle(COLORS.paper, 0.8);
                graphics.fillCircle(x, y, 3);
                break;
            case 'row':
                graphics.fillRoundedRect(x - 16, y - 4, 32, 8, 3);
                graphics.fillTriangle(x - 18, y, x - 9, y - 9, x - 9, y + 9);
                graphics.fillTriangle(x + 18, y, x + 9, y - 9, x + 9, y + 9);
                break;
            case 'column':
                graphics.fillRoundedRect(x - 4, y - 16, 8, 32, 3);
                graphics.fillTriangle(x, y - 18, x - 9, y - 9, x + 9, y - 9);
                graphics.fillTriangle(x, y + 18, x - 9, y + 9, x + 9, y + 9);
                break;
            case 'burst':
                graphics.lineStyle(4, COLORS.paper, 0.95);
                graphics.strokeCircle(x, y, 11);
                graphics.lineBetween(x - 15, y, x + 15, y);
                graphics.lineBetween(x, y - 15, x, y + 15);
                graphics.fillStyle(bright, 1);
                graphics.fillCircle(x, y, 5);
                break;
            case 'color': {
                const spectrum: readonly CircuitColor[] = [
                    'cyan',
                    'magenta',
                    'amber',
                    'lime',
                    'violet'
                ];
                graphics.fillStyle(COLORS.paper, 0.96);
                graphics.fillCircle(x, y, 15);
                for (let dot = 0; dot < spectrum.length; dot++) {
                    const angle = -Math.PI / 2 + dot * Math.PI * 2 / spectrum.length;
                    graphics.fillStyle(CHIP_COLORS[spectrum[dot]!], 1);
                    graphics.fillCircle(
                        x + Math.cos(angle) * 9,
                        y + Math.sin(angle) * 9,
                        4
                    );
                }
                graphics.fillStyle(0x07131c, 1);
                graphics.fillCircle(x, y, 3);
                break;
            }
        }
    }

    private drawShortCircuit(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        centerX: number,
        centerY: number,
        pulse: number
    ): void {
        graphics.fillStyle(COLORS.dangerDark, 0.15 + pulse * 0.12);
        graphics.fillRoundedRect(
            x + 3,
            y + 3,
            CIRCUIT_TILE_SIZE - 6,
            CIRCUIT_TILE_SIZE - 6,
            8
        );
        graphics.lineStyle(3, COLORS.danger, 0.72 + pulse * 0.28);
        graphics.strokeRoundedRect(
            x + 4,
            y + 4,
            CIRCUIT_TILE_SIZE - 8,
            CIRCUIT_TILE_SIZE - 8,
            7
        );
        graphics.lineStyle(4, COLORS.warning, 1);
        graphics.beginPath();
        graphics.moveTo(centerX + 4, centerY - 22);
        graphics.lineTo(centerX - 8, centerY - 5);
        graphics.lineTo(centerX + 2, centerY - 4);
        graphics.lineTo(centerX - 7, centerY + 20);
        graphics.lineTo(centerX + 14, centerY - 6);
        graphics.lineTo(centerX + 4, centerY - 6);
        graphics.closePath();
        graphics.strokePath();
    }

    private showHelp(): void {
        if (this.helpOpen || this.finishing) return;
        this.helpOpen = true;
        this.pulseTargeting = false;
        const depth = 100;
        const shade = this.add.rectangle(
            VIEW_SIZE / 2,
            VIEW_SIZE / 2,
            VIEW_SIZE,
            VIEW_SIZE,
            0x02070a,
            0.8
        ).setDepth(depth).setInteractive();
        const panel = this.add.rectangle(
            VIEW_SIZE / 2,
            VIEW_SIZE / 2,
            586,
            478,
            0x10212b,
            0.99
        ).setStrokeStyle(4, COLORS.accent).setDepth(depth + 1)
            .setInteractive({useHandCursor: true});
        const title = this.add.text(VIEW_SIZE / 2, 132, 'HOW TO CRUSH A CIRCUIT', {
            color: '#72f4df',
            fontFamily: 'Georgia, serif',
            fontSize: '25px',
            fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(depth + 2);
        const body = this.add.text(VIEW_SIZE / 2, 338, HELP_BODY, {
            color: '#e8fbff',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            align: 'center',
            lineSpacing: 3,
            wordWrap: {width: 522, useAdvancedWrap: true}
        }).setOrigin(0.5).setDepth(depth + 2);
        const close = this.add.text(VIEW_SIZE / 2, 548, 'TAP OR ENTER · POWER ON', {
            color: '#07131c',
            backgroundColor: '#72f4df',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            fontStyle: 'bold',
            padding: {x: 18, y: 10}
        }).setOrigin(0.5).setDepth(depth + 2).setInteractive({useHandCursor: true});
        const closeHelp = (): void => this.closeHelp();
        shade.on('pointerdown', closeHelp);
        panel.on('pointerdown', closeHelp);
        close.on('pointerdown', closeHelp);
        this.helpObjects = [shade, panel, title, body, close];
        this.publishTelemetry();
    }

    private closeHelp(): void {
        if (!this.helpOpen) return;
        for (const object of this.helpObjects) object.destroy();
        this.helpObjects = [];
        this.helpOpen = false;
        this.publishTelemetry();
    }

    private publishTelemetry(): void {
        const canvas = this.game.canvas;
        const hint = this.state.lastHint;
        const witness = validateCircuitWitness(this.state);
        canvas.dataset.circuitStatus = this.state.terminalStatus;
        canvas.dataset.circuitMoves = String(this.state.movesRemaining);
        canvas.dataset.circuitMovesSpent = String(this.state.movesSpent);
        canvas.dataset.circuitBlockers = String(this.state.blockersRemaining);
        canvas.dataset.circuitProgress = getCircuitProgress(this.state).toFixed(3);
        canvas.dataset.circuitScore = String(this.state.score);
        canvas.dataset.circuitSelected = this.selectedIndex === null
            ? ''
            : String(this.selectedIndex);
        canvas.dataset.circuitCursor = String(this.cursorIndex);
        canvas.dataset.circuitHintFrom = hint === null ? '' : String(hint.swap.fromIndex);
        canvas.dataset.circuitHintTo = hint === null ? '' : String(hint.swap.toIndex);
        canvas.dataset.circuitPulseTargeting = String(this.pulseTargeting);
        canvas.dataset.circuitLegalMoves = String(getCircuitLegalSwaps(this.state).length);
        canvas.dataset.circuitSeed = String(this.launchData.context.seed);
        canvas.dataset.circuitGenerationSeed = String(this.state.generationSeed);
        canvas.dataset.circuitGenerationAttempt = String(this.state.generationAttempt);
        canvas.dataset.circuitAttempt = String(this.state.attemptNumber);
        canvas.dataset.circuitBoardSignature = canonicalCircuitSignature(this.state);
        canvas.dataset.circuitWitnessValid = String(witness.valid);
        canvas.dataset.circuitWitness = this.state.certificate.swaps
            .map(swap => `${swap.fromIndex}-${swap.toIndex}`)
            .join(',');
        canvas.dataset.circuitEvent = this.state.lastEvent.kind;
        canvas.dataset.circuitHelpOpen = String(this.helpOpen);
        canvas.dataset.circuitBoosterExtraMoves =
            String(this.state.boosterCharges.extraMoves);
        canvas.dataset.circuitBoosterHints = String(this.state.boosterCharges.hints);
        canvas.dataset.circuitBoosterPulses = String(this.state.boosterCharges.pulses);
        canvas.dataset.circuitBoosterShuffles =
            String(this.state.boosterCharges.shuffles);
        canvas.dataset.circuitBoardOriginX = String(CIRCUIT_BOARD_ORIGIN.x);
        canvas.dataset.circuitBoardOriginY = String(CIRCUIT_BOARD_ORIGIN.y);
        canvas.dataset.circuitTileSize = String(CIRCUIT_TILE_SIZE);
        canvas.dataset.circuitBoardWidth = String(this.state.width);
    }

    private clearTelemetry(): void {
        const canvas = this.game.canvas;
        delete canvas.dataset.circuitStatus;
        delete canvas.dataset.circuitMoves;
        delete canvas.dataset.circuitMovesSpent;
        delete canvas.dataset.circuitBlockers;
        delete canvas.dataset.circuitProgress;
        delete canvas.dataset.circuitScore;
        delete canvas.dataset.circuitSelected;
        delete canvas.dataset.circuitCursor;
        delete canvas.dataset.circuitHintFrom;
        delete canvas.dataset.circuitHintTo;
        delete canvas.dataset.circuitPulseTargeting;
        delete canvas.dataset.circuitLegalMoves;
        delete canvas.dataset.circuitSeed;
        delete canvas.dataset.circuitGenerationSeed;
        delete canvas.dataset.circuitGenerationAttempt;
        delete canvas.dataset.circuitAttempt;
        delete canvas.dataset.circuitBoardSignature;
        delete canvas.dataset.circuitWitnessValid;
        delete canvas.dataset.circuitWitness;
        delete canvas.dataset.circuitEvent;
        delete canvas.dataset.circuitHelpOpen;
        delete canvas.dataset.circuitBoosterExtraMoves;
        delete canvas.dataset.circuitBoosterHints;
        delete canvas.dataset.circuitBoosterPulses;
        delete canvas.dataset.circuitBoosterShuffles;
        delete canvas.dataset.circuitBoardOriginX;
        delete canvas.dataset.circuitBoardOriginY;
        delete canvas.dataset.circuitTileSize;
        delete canvas.dataset.circuitBoardWidth;
        delete canvas.dataset.itemBonus;
    }

    private finish(status: FinishStatus): void {
        if (!this.scene.isActive()) return;
        this.finishing = true;
        this.finishTimer?.remove(false);
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: FinishStatus): EncounterResult {
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'change-resource', resource: 'scrap', delta: 5},
                {kind: 'adjust-world-system', system: 'powerRouting', delta: 10}
            ]
            : [];
        const score = status === 'success'
            ? Math.max(1_000, this.state.score + this.state.movesRemaining * 125)
            : 0;
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'circuit',
            status,
            grade: status === 'success' ? gradeCircuit(this.state) : 'none',
            score,
            elapsedMs: Math.round(this.activeElapsedMs),
            effects
        };
    }
}
