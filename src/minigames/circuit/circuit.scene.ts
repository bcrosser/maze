import Phaser from 'phaser';

import {getControlDeck} from '../../app/control-deck-host';
import {CIRCUIT_CONTROL_SCHEME, type ControlEvent} from '../../app/control-scheme';
import {createHelpOverlay, type HelpOverlay} from '../help-overlay';
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
    type CircuitChip,
    type CircuitColor,
    type CircuitPuzzleState,
    type CircuitSpecial
} from './circuit-model';

export const CIRCUIT_CRASH_SCENE_KEY = 'circuit-crash';
export const CIRCUIT_BOARD_ORIGIN = Object.freeze({x: 18, y: 124});
export const CIRCUIT_TILE_SIZE = 57;

export interface CircuitCrashLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const BOARD_SIZE = CIRCUIT_TILE_SIZE * 8;
const PANEL_X = CIRCUIT_BOARD_ORIGIN.x + BOARD_SIZE + 13;
const PANEL_WIDTH = VIEW_SIZE - PANEL_X - 14;

const SWAP_MS = 170;
const CLEAR_MS = 250;
const DROP_MS = 340;
const INVALID_MS = 340;
const MAX_SPARKS = 420;

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
    pulse: 0xff73c9,
    ink: 0x061019
});

const CHIP_COLORS: Readonly<Record<CircuitColor, number>> = Object.freeze({
    cyan: 0x29d9ff,
    magenta: 0xff4fab,
    amber: 0xffbd3e,
    lime: 0x8eea42,
    violet: 0xa56cff
});

const CHIP_DARK_COLORS: Readonly<Record<CircuitColor, number>> = Object.freeze({
    cyan: 0x0d3f52,
    magenta: 0x4d1b3c,
    amber: 0x4a3714,
    lime: 0x2b471a,
    violet: 0x33234d
});

interface PcbPattern {
    /** Copper trace segments as [x1, y1, x2, y2], relative to the chip center. */
    readonly lines: ReadonlyArray<readonly [number, number, number, number]>;
    /** Solder pads as [x, y] dots at trace ends. */
    readonly pads: ReadonlyArray<readonly [number, number]>;
}

/** Every color gets its own printed-circuit trace layout. */
const PCB_PATTERNS: Readonly<Record<CircuitColor, PcbPattern>> = Object.freeze({
    cyan: {
        lines: [
            [-22, -9, -13, -9], [-22, 0, -16, 0], [-22, 9, -13, 9],
            [13, -9, 22, -9], [16, 0, 22, 0], [13, 9, 22, 9]
        ],
        pads: [[-13, -9], [-16, 0], [-13, 9], [13, -9], [16, 0], [13, 9]]
    },
    magenta: {
        lines: [
            [-20, -20, -11, -11], [20, -20, 11, -11],
            [-20, 20, -11, 11], [20, 20, 11, 11]
        ],
        pads: [[-11, -11], [11, -11], [-11, 11], [11, 11]]
    },
    amber: {
        lines: [
            [-22, -11, -14, -11], [-14, -11, -14, -22],
            [22, 11, 14, 11], [14, 11, 14, 22],
            [-22, 13, -17, 13], [22, -13, 17, -13]
        ],
        pads: [[-14, -11], [14, 11], [-17, 13], [17, -13]]
    },
    lime: {
        lines: [
            [-9, -22, -9, -13], [0, -22, 0, -16], [9, -22, 9, -13],
            [-9, 13, -9, 22], [0, 16, 0, 22], [9, 13, 9, 22]
        ],
        pads: [[-9, -13], [0, -16], [9, -13], [-9, 13], [0, 16], [9, 13]]
    },
    violet: {
        lines: [
            [-14, -14, 14, -14], [14, -14, 14, 14],
            [14, 14, -14, 14], [-14, 14, -14, -14],
            [-22, 0, -14, 0], [14, 0, 22, 0], [0, -22, 0, -14], [0, 14, 0, 22]
        ],
        pads: [[-14, -14], [14, -14], [14, 14], [-14, 14]]
    }
});

const HELP_LINES: readonly string[] = Object.freeze([
    'Repair every sparking short',
    'before the moves run out.',
    '',
    'Swap two neighbours to match 3 or more.',
    'Only a real match spends a move.',
    '',
    'A short rides its board. Match that board',
    'to repair it.',
    '',
    'Long matches forge special boards.',
    'Boosters are 1–4, or the deck buttons.'
]);

type FinishStatus = 'success' | 'failure' | 'abandoned';
type BoosterKey = 'extra' | 'hint' | 'pulse' | 'shuffle';

interface Spark {
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    lifeMs: number;
    maxLifeMs: number;
    color: number;
    size: number;
}

interface RemovedChipVisual {
    readonly chip: CircuitChip;
    readonly index: number;
}

interface MovedChipVisual {
    readonly chip: CircuitChip;
    readonly fromIndex: number;
    readonly toIndex: number;
}

interface SpawnedChipVisual {
    readonly chip: CircuitChip;
    readonly toIndex: number;
    readonly spawnRow: number;
}

interface BoardAnimation {
    readonly startMs: number;
    readonly invalid: boolean;
    readonly swapFrom: number | null;
    readonly swapTo: number | null;
    readonly previousChips: readonly CircuitChip[];
    readonly swappedChips: readonly CircuitChip[];
    readonly removed: readonly RemovedChipVisual[];
    readonly moved: readonly MovedChipVisual[];
    readonly spawned: readonly SpawnedChipVisual[];
    readonly swapMs: number;
    readonly clearMs: number;
    readonly dropMs: number;
    sparksSpawned: boolean;
}

interface ChipVisual {
    readonly chip: CircuitChip;
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly alpha: number;
}

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

function hash01(first: number, second: number): number {
    let value = (Math.imul(first + 1, 0x9e3779b1) ^ Math.imul(second + 1, 0x85ebca6b)) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d) >>> 0;
    return ((value ^ (value >>> 12)) >>> 0) / 0x1_0000_0000;
}

function easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/** Fall fast, then settle with a small dip past the target and back. */
function dropEase(t: number): number {
    if (t < 0.72) return (t / 0.72) ** 2;
    const settle = (t - 0.72) / 0.28;
    return 1 + Math.sin(settle * Math.PI) * 0.05;
}

export class CircuitCrashScene extends Phaser.Scene {
    private launchData!: CircuitCrashLaunchData;
    private state!: CircuitPuzzleState;
    private boardGraphics!: Phaser.GameObjects.Graphics;
    private meterGraphics!: Phaser.GameObjects.Graphics;
    private movesText!: Phaser.GameObjects.Text;
    private shortsText!: Phaser.GameObjects.Text;
    private scoreText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private tooltipPanel!: Phaser.GameObjects.Rectangle;
    private tooltipText!: Phaser.GameObjects.Text;
    private boosterTexts = new Map<BoosterKey, Phaser.GameObjects.Text>();
    private helpObjects: Phaser.GameObjects.GameObject[] = [];
    private helpOverlay: HelpOverlay | null = null;
    private selectedIndex: number | null = null;
    private cursorIndex = 0;
    private pulseTargeting = false;
    private helpOpen = false;
    private finishing = false;
    private finishTimer: Phaser.Time.TimerEvent | null = null;
    private activeElapsedMs = 0;
    private animationClockMs = 0;
    private animation: BoardAnimation | null = null;
    private sparks: Spark[] = [];
    private shortSparkBands = new Map<number, number>();

    constructor() {
        super({key: CIRCUIT_CRASH_SCENE_KEY});
    }

    create(data: CircuitCrashLaunchData): void {
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
        this.animation = null;
        this.sparks = [];
        this.shortSparkBands.clear();
        this.helpObjects = [];
        this.boosterTexts.clear();

        this.cameras.main.setBackgroundColor(COLORS.background);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 650, 650, COLORS.panel, 0.6)
            .setStrokeStyle(2, COLORS.panelBorder);
        this.add.text(18, 14, 'CIRCUIT CRASH', {
            color: '#72f4df',
            fontFamily: 'Georgia, serif',
            fontSize: '28px',
            fontStyle: 'bold'
        });
        this.add.text(18, 49, 'Match colored circuit boards. Repair every sparking short.', {
            color: '#9bc4cd',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });
        this.add.text(18, 76, 'SELECT', {
            color: '#83aab5',
            fontFamily: 'monospace',
            fontSize: '12px'
        });
        this.add.text(73, 76, 'TAP 2 BOARDS  /  ARROWS + ENTER', {
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
        this.createTooltip();

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
        getControlDeck(this)?.setScheme(CIRCUIT_CONTROL_SCHEME, this.handleControlEvent);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown);
            getControlDeck(this)?.clearScheme(CIRCUIT_CONTROL_SCHEME.id);
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
        this.updateSparks(safeDelta);
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
        this.createBoosterButton(321, 'extra', 'OVERCLOCK', 0x246278, () => {
            this.useImmediateBooster('extra');
        });
        this.createBoosterButton(374, 'hint', 'TRACE', 0x65592b, () => {
            this.useImmediateBooster('hint');
        });
        this.createBoosterButton(427, 'pulse', 'PULSE', 0x752e65, () => {
            this.togglePulseTargeting();
        });
        this.createBoosterButton(480, 'shuffle', 'REROUTE', 0x3f3b75, () => {
            this.useImmediateBooster('shuffle');
        });
        this.drawBoosterIcons();

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
        const text = this.add.text(PANEL_X + 42, y, label, {
            color: '#e8fbff',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(6);
        button.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            pointer.event.preventDefault();
            if (!this.helpOpen && !this.finishing) action();
        });
        button.on('pointerover', () => {
            if (!this.helpOpen && !this.finishing) {
                button.setStrokeStyle(2, 0xe8fbff);
                this.showBoosterTooltip(key, y);
            }
        });
        button.on('pointerout', () => {
            button.setStrokeStyle(2, 0x8ec4cf);
            this.hideBoosterTooltip();
        });
        this.boosterTexts.set(key, text);
    }

    /** Small pictograms that read at a glance: what each booster does. */
    private drawBoosterIcons(): void {
        const graphics = this.add.graphics().setDepth(7);
        const iconX = PANEL_X + 24;

        // Overclock: a lightning bolt — instant extra power (moves).
        let y = 321;
        graphics.fillStyle(COLORS.warning, 1);
        graphics.fillTriangle(iconX + 2, y - 12, iconX - 8, y + 3, iconX - 1, y + 3);
        graphics.fillTriangle(iconX - 2, y + 12, iconX + 8, y - 3, iconX + 1, y - 3);

        // Trace: a magnifying glass — it finds the best swap for you.
        y = 374;
        graphics.lineStyle(3, COLORS.hint, 1);
        graphics.strokeCircle(iconX - 2, y - 3, 7);
        graphics.lineBetween(iconX + 3, y + 2, iconX + 9, y + 9);

        // Pulse: a crosshair — aim it, then zap a 3×3 area.
        y = 427;
        graphics.lineStyle(2.5, COLORS.pulse, 1);
        graphics.strokeCircle(iconX, y, 8);
        graphics.lineBetween(iconX - 12, y, iconX - 5, y);
        graphics.lineBetween(iconX + 5, y, iconX + 12, y);
        graphics.lineBetween(iconX, y - 12, iconX, y - 5);
        graphics.lineBetween(iconX, y + 5, iconX, y + 12);
        graphics.fillStyle(COLORS.pulse, 1);
        graphics.fillCircle(iconX, y, 2);

        // Reroute: crossing arrows — every board gets shuffled somewhere new.
        y = 480;
        graphics.lineStyle(3, 0xb9a5ff, 1);
        graphics.lineBetween(iconX - 10, y - 6, iconX + 6, y + 6);
        graphics.lineBetween(iconX - 10, y + 6, iconX + 6, y - 6);
        graphics.fillStyle(0xb9a5ff, 1);
        graphics.fillTriangle(iconX + 11, y + 8, iconX + 3, y + 7, iconX + 8, y + 1);
        graphics.fillTriangle(iconX + 11, y - 8, iconX + 3, y - 7, iconX + 8, y - 1);
    }

    private createTooltip(): void {
        this.tooltipPanel = this.add.rectangle(0, 0, 296, 86, 0x061019, 0.97)
            .setStrokeStyle(2, COLORS.accent)
            .setDepth(60)
            .setVisible(false);
        this.tooltipText = this.add.text(0, 0, '', {
            color: '#e8fbff',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineSpacing: 4,
            wordWrap: {width: 272}
        }).setOrigin(0, 0.5).setDepth(61).setVisible(false);
    }

    private boosterTooltipCopy(key: BoosterKey): string {
        switch (key) {
            case 'extra':
                return `OVERCLOCK · +${this.state.config.extraMoveAmount} MOVES\n` +
                    `Instantly adds ${this.state.config.extraMoveAmount} moves ` +
                    'to your budget.';
            case 'hint':
                return 'TRACE · REVEALS THE BEST SWAP\n' +
                    'Highlights the two boards of the strongest move, ' +
                    'prioritizing short repairs. Costs no move.';
            case 'pulse':
                return 'PULSE · TARGETED 3×3 ZAP\n' +
                    'Arms a zap: tap any cell to clear its 3×3 area and ' +
                    'repair any shorts riding those boards. Costs no move.';
            case 'shuffle':
                return 'REROUTE · RESHUFFLES THE GRID\n' +
                    'Deals a fresh solvable layout. Shorts keep their ' +
                    'cells and ride the new boards. Costs no move.';
        }
    }

    private showBoosterTooltip(key: BoosterKey, buttonY: number): void {
        const copy = this.boosterTooltipCopy(key);
        this.tooltipText.setText(copy);
        const height = this.tooltipText.height + 18;
        const x = PANEL_X - 316;
        this.tooltipPanel
            .setSize(296, height)
            .setPosition(x + 148, buttonY)
            .setVisible(true);
        this.tooltipText.setPosition(x + 12, buttonY).setVisible(true);
    }

    private hideBoosterTooltip(): void {
        this.tooltipPanel.setVisible(false);
        this.tooltipText.setVisible(false);
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

    /**
     * The board keeps its tap-a-chip interaction; the shared deck adds a cursor
     * and one button per booster so the same gestures work in every game.
     */
    private readonly handleControlEvent = (event: ControlEvent): void => {
        if (this.finishing) return;
        if (this.helpOpen) {
            if (event.kind === 'button' && event.phase === 'press') this.closeHelp();
            return;
        }
        if (this.state.terminalStatus !== 'active') return;
        if (event.kind === 'direction') {
            if (event.phase !== 'press') return;
            this.moveCursor(
                event.direction === 'left' ? -1 : event.direction === 'right' ? 1 : 0,
                event.direction === 'up' ? -1 : event.direction === 'down' ? 1 : 0
            );
            return;
        }
        if (event.kind !== 'button' || event.phase !== 'press') return;
        switch (event.id) {
            case 'swap':
                this.chooseCell(this.cursorIndex);
                break;
            case 'extra':
                this.useImmediateBooster('extra');
                break;
            case 'hint':
                this.useImmediateBooster('hint');
                break;
            case 'pulse':
                this.togglePulseTargeting();
                break;
            case 'shuffle':
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
            const before = this.state;
            this.state = activateCircuitBooster(this.state, {
                kind: 'pulse',
                cellIndex: index
            });
            this.pulseTargeting = false;
            this.selectedIndex = null;
            this.afterModelAction(before);
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
            this.statusText.setText('CHOOSE A NEIGHBORING BOARD TO SWAP');
            this.publishTelemetry();
            return;
        }

        const fromIndex = this.selectedIndex;
        this.selectedIndex = null;
        const before = this.state;
        this.state = applyCircuitSwap(this.state, fromIndex, index);
        this.afterModelAction(before);
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
        const before = this.state;
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
        this.afterModelAction(before);
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
            const before = this.state;
            this.state = activateCircuitBooster(this.state, {
                kind: 'pulse',
                cellIndex: this.cursorIndex
            });
            this.pulseTargeting = false;
            this.afterModelAction(before);
            return;
        }
        this.pulseTargeting = !this.pulseTargeting;
        this.statusText.setText(
            this.pulseTargeting
                ? 'PULSE ARMED · TAP A BOARD TO CLEAR ITS 3×3 AREA'
                : 'PULSE TARGETING CANCELLED'
        );
        this.publishTelemetry();
    }

    private afterModelAction(before: CircuitPuzzleState): void {
        this.startBoardAnimation(before);
        this.celebrateEvent(before);
        this.syncPresentation();
        if (this.state.terminalStatus !== 'active' && !this.finishing) {
            this.finishing = true;
            const terminalStatus = this.state.terminalStatus;
            this.finishTimer = this.time.delayedCall(1_000, () => {
                this.finish(terminalStatus);
            });
        }
    }

    /**
     * Builds a purely visual timeline by diffing chip ids between the board
     * before and after the action: survivors slide, casualties pop, and
     * refills rain in from above. Telemetry stays synchronous.
     */
    private startBoardAnimation(before: CircuitPuzzleState): void {
        const event = this.state.lastEvent;
        if (event.kind === 'invalid-swap'
            && event.fromIndex !== null
            && event.toIndex !== null) {
            this.animation = {
                startMs: this.animationClockMs,
                invalid: true,
                swapFrom: event.fromIndex,
                swapTo: event.toIndex,
                previousChips: this.state.chips,
                swappedChips: this.state.chips,
                removed: [],
                moved: [],
                spawned: [],
                swapMs: INVALID_MS,
                clearMs: 0,
                dropMs: 0,
                sparksSpawned: true
            };
            return;
        }

        const animatable = event.kind === 'swap-resolved'
            || event.kind === 'success'
            || event.kind === 'failure'
            || event.kind === 'booster-pulse'
            || event.kind === 'booster-shuffle'
            || event.kind === 'no-move-shuffle';
        if (!animatable) return;

        const isSwap = event.fromIndex !== null && event.toIndex !== null;
        let swappedChips = before.chips;
        if (isSwap) {
            const exchanged = [...before.chips];
            const first = exchanged[event.fromIndex!]!;
            exchanged[event.fromIndex!] = exchanged[event.toIndex!]!;
            exchanged[event.toIndex!] = first;
            swappedChips = exchanged;
        }

        const nextIndexById = new Map<number, number>();
        this.state.chips.forEach((chip, index) => nextIndexById.set(chip.id, index));
        const previousIds = new Set(swappedChips.map(chip => chip.id));

        const removed: RemovedChipVisual[] = [];
        const moved: MovedChipVisual[] = [];
        swappedChips.forEach((chip, index) => {
            const nextIndex = nextIndexById.get(chip.id);
            if (nextIndex === undefined) {
                removed.push({chip, index});
            } else if (nextIndex !== index) {
                moved.push({chip: this.state.chips[nextIndex]!, fromIndex: index, toIndex: nextIndex});
            }
        });

        const spawnedByColumn = new Map<number, SpawnedChipVisual[]>();
        this.state.chips.forEach((chip, index) => {
            if (previousIds.has(chip.id)) return;
            const column = index % this.state.width;
            const list = spawnedByColumn.get(column) ?? [];
            list.push({chip, toIndex: index, spawnRow: 0});
            spawnedByColumn.set(column, list);
        });
        const spawned: SpawnedChipVisual[] = [];
        for (const list of spawnedByColumn.values()) {
            list.sort((first, second) => first.toIndex - second.toIndex);
            list.forEach((entry, position) => {
                spawned.push({...entry, spawnRow: -(list.length - position)});
            });
        }

        this.animation = {
            startMs: this.animationClockMs,
            invalid: false,
            swapFrom: isSwap ? event.fromIndex : null,
            swapTo: isSwap ? event.toIndex : null,
            previousChips: before.chips,
            swappedChips,
            removed,
            moved,
            spawned,
            swapMs: isSwap ? SWAP_MS : 0,
            clearMs: removed.length > 0 ? CLEAR_MS : 0,
            dropMs: moved.length > 0 || spawned.length > 0 ? DROP_MS : 0,
            sparksSpawned: false
        };
    }

    /** Score popups, cascade callouts, repair labels, and a little shake. */
    private celebrateEvent(before: CircuitPuzzleState): void {
        const event = this.state.lastEvent;
        const scoreGain = this.state.score - before.score;
        if (scoreGain > 0) {
            const centroid = this.affectedCentroid(event.affectedIndices);
            this.spawnFloatingLabel(centroid.x, centroid.y, `+${scoreGain}`, '#72f4df', 20);
        }
        if (event.cascades >= 2) {
            this.spawnFloatingLabel(
                CIRCUIT_BOARD_ORIGIN.x + BOARD_SIZE / 2,
                CIRCUIT_BOARD_ORIGIN.y + BOARD_SIZE / 2 + 44,
                `CASCADE ×${event.cascades}`,
                '#ffe566',
                24
            );
        }
        if (event.blockersCleared > 0) {
            before.chips.forEach((chip, index) => {
                if (!chip.shorted) return;
                const survives = this.state.chips.some(candidate =>
                    candidate.id === chip.id && candidate.shorted
                );
                if (survives) return;
                const position = this.cellCenter(index);
                this.spawnFloatingLabel(position.x, position.y - 10, 'SHORT REPAIRED', '#ffbf47', 13);
                this.spawnSparkBurst(position.x, position.y, COLORS.warning, 16);
            });
            this.cameras.main.shake(150, 0.0035);
        } else if (event.cascades >= 2 || event.specialsActivated > 0) {
            this.cameras.main.shake(110, 0.002);
        }
        if (event.kind === 'success') {
            this.cameras.main.flash(320, 40, 220, 190);
        }
    }

    private affectedCentroid(indices: readonly number[]): {x: number; y: number} {
        if (indices.length === 0) {
            return {
                x: CIRCUIT_BOARD_ORIGIN.x + BOARD_SIZE / 2,
                y: CIRCUIT_BOARD_ORIGIN.y + BOARD_SIZE / 2
            };
        }
        let sumX = 0;
        let sumY = 0;
        for (const index of indices) {
            const center = this.cellCenter(index);
            sumX += center.x;
            sumY += center.y;
        }
        return {x: sumX / indices.length, y: sumY / indices.length};
    }

    private cellCenter(index: number): {x: number; y: number} {
        return {
            x: CIRCUIT_BOARD_ORIGIN.x + (index % this.state.width) * CIRCUIT_TILE_SIZE
                + CIRCUIT_TILE_SIZE / 2,
            y: CIRCUIT_BOARD_ORIGIN.y + Math.floor(index / this.state.width) * CIRCUIT_TILE_SIZE
                + CIRCUIT_TILE_SIZE / 2
        };
    }

    private spawnFloatingLabel(
        x: number,
        y: number,
        message: string,
        color: string,
        fontSize: number
    ): void {
        const label = this.add.text(x, y, message, {
            color,
            fontFamily: 'monospace',
            fontSize: `${fontSize}px`,
            fontStyle: 'bold',
            stroke: '#061019',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(50);
        this.tweens.add({
            targets: label,
            y: y - 34,
            alpha: 0,
            scale: 1.12,
            duration: 950,
            ease: 'Cubic.easeOut',
            onComplete: () => label.destroy()
        });
    }

    private spawnSparkBurst(x: number, y: number, color: number, count: number): void {
        for (let index = 0; index < count; index++) {
            if (this.sparks.length >= MAX_SPARKS) return;
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 190;
            this.sparks.push({
                x,
                y,
                velocityX: Math.cos(angle) * speed,
                velocityY: Math.sin(angle) * speed - 60,
                lifeMs: 0,
                maxLifeMs: 380 + Math.random() * 320,
                color: Math.random() < 0.3 ? 0xffffff : color,
                size: 1.5 + Math.random() * 2.5
            });
        }
    }

    private updateSparks(deltaMs: number): void {
        const seconds = deltaMs / 1_000;
        this.sparks = this.sparks.filter(spark => {
            spark.lifeMs += deltaMs;
            if (spark.lifeMs >= spark.maxLifeMs) return false;
            spark.x += spark.velocityX * seconds;
            spark.y += spark.velocityY * seconds;
            spark.velocityY += 540 * seconds;
            return true;
        });
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
            `1 OVERCLOCK ×${this.state.boosterCharges.extraMoves}`
        );
        this.boosterTexts.get('hint')?.setText(
            `2 TRACE    ×${this.state.boosterCharges.hints}`
        );
        this.boosterTexts.get('pulse')?.setText(
            `3 PULSE    ×${this.state.boosterCharges.pulses}`
        );
        this.boosterTexts.get('shuffle')?.setText(
            `4 REROUTE  ×${this.state.boosterCharges.shuffles}`
        );

        const deck = getControlDeck(this);
        const charges: readonly [string, number][] = [
            ['extra', this.state.boosterCharges.extraMoves],
            ['hint', this.state.boosterCharges.hints],
            ['pulse', this.state.boosterCharges.pulses],
            ['shuffle', this.state.boosterCharges.shuffles]
        ];
        for (const [id, remaining] of charges) {
            deck?.setButtonState(id, {disabled: remaining <= 0});
        }
        deck?.setButtonState('pulse', {pressed: this.pulseTargeting});

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

    /**
     * Resolves what to draw this frame: the resting board, or a snapshot of
     * the swap → pop → drop timeline that follows every resolved action.
     */
    private computeChipVisuals(): ChipVisual[] {
        const animation = this.animation;
        if (animation !== null) {
            const elapsed = this.animationClockMs - animation.startMs;
            const swapEnd = animation.swapMs;
            const clearEnd = swapEnd + animation.clearMs;
            const dropEnd = clearEnd + animation.dropMs;
            if (elapsed >= dropEnd) {
                this.animation = null;
            } else if (animation.invalid) {
                return this.computeSwapVisuals(
                    animation,
                    elapsed < swapEnd / 2
                        ? elapsed / (swapEnd / 2)
                        : Math.max(0, 1 - (elapsed - swapEnd / 2) / (swapEnd / 2))
                );
            } else if (elapsed < swapEnd) {
                return this.computeSwapVisuals(animation, elapsed / swapEnd);
            } else if (elapsed < clearEnd) {
                return this.computeClearVisuals(animation, (elapsed - swapEnd) / animation.clearMs);
            } else {
                return this.computeDropVisuals(animation, (elapsed - clearEnd) / animation.dropMs);
            }
        }
        return this.state.chips.map((chip, index) => {
            const center = this.cellCenter(index);
            return {chip, x: center.x, y: center.y, scale: 1, alpha: 1};
        });
    }

    private computeSwapVisuals(animation: BoardAnimation, progress: number): ChipVisual[] {
        const eased = easeInOutQuad(Math.min(1, Math.max(0, progress)));
        return animation.previousChips.map((chip, index) => {
            let x: number;
            let y: number;
            if (index === animation.swapFrom || index === animation.swapTo) {
                const partner = index === animation.swapFrom
                    ? animation.swapTo!
                    : animation.swapFrom!;
                const from = this.cellCenter(index);
                const to = this.cellCenter(partner);
                x = from.x + (to.x - from.x) * eased;
                y = from.y + (to.y - from.y) * eased;
            } else {
                const center = this.cellCenter(index);
                x = center.x;
                y = center.y;
            }
            return {chip, x, y, scale: 1, alpha: 1};
        });
    }

    private computeClearVisuals(animation: BoardAnimation, progress: number): ChipVisual[] {
        if (!animation.sparksSpawned) {
            animation.sparksSpawned = true;
            for (const removal of animation.removed) {
                const center = this.cellCenter(removal.index);
                this.spawnSparkBurst(
                    center.x,
                    center.y,
                    CHIP_COLORS[removal.chip.color],
                    removal.chip.shorted ? 14 : 8
                );
            }
        }
        const removedIndices = new Map(
            animation.removed.map(removal => [removal.index, removal])
        );
        return animation.swappedChips.map((chip, index) => {
            const center = this.cellCenter(index);
            if (!removedIndices.has(index)) {
                return {chip, x: center.x, y: center.y, scale: 1, alpha: 1};
            }
            // Pop: briefly swell, then collapse to nothing.
            const scale = progress < 0.3
                ? 1 + (progress / 0.3) * 0.28
                : Math.max(0, 1.28 * (1 - (progress - 0.3) / 0.7));
            return {chip, x: center.x, y: center.y, scale, alpha: Math.max(0, 1 - progress * 0.85)};
        });
    }

    private computeDropVisuals(animation: BoardAnimation, progress: number): ChipVisual[] {
        const eased = dropEase(Math.min(1, Math.max(0, progress)));
        const movedByTarget = new Map(animation.moved.map(move => [move.toIndex, move]));
        const spawnedByTarget = new Map(animation.spawned.map(spawn => [spawn.toIndex, spawn]));
        return this.state.chips.map((chip, index) => {
            const target = this.cellCenter(index);
            const move = movedByTarget.get(index);
            if (move !== undefined) {
                const from = this.cellCenter(move.fromIndex);
                return {
                    chip,
                    x: from.x + (target.x - from.x) * eased,
                    y: from.y + (target.y - from.y) * eased,
                    scale: 1,
                    alpha: 1
                };
            }
            const spawn = spawnedByTarget.get(index);
            if (spawn !== undefined) {
                const fromY = CIRCUIT_BOARD_ORIGIN.y
                    + spawn.spawnRow * CIRCUIT_TILE_SIZE
                    + CIRCUIT_TILE_SIZE / 2;
                const y = fromY + (target.y - fromY) * eased;
                // There is no render mask, so refills fade in as they cross
                // the top edge instead of drawing over the header.
                const alpha = Phaser.Math.Clamp(
                    (y - (CIRCUIT_BOARD_ORIGIN.y + 8)) / 26,
                    0,
                    1
                );
                return {chip, x: target.x, y, scale: 1, alpha};
            }
            return {chip, x: target.x, y: target.y, scale: 1, alpha: 1};
        });
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
            graphics.fillStyle(
                (column + row) % 2 === 0 ? COLORS.grid : COLORS.gridAlternate,
                1
            );
            graphics.fillRoundedRect(
                CIRCUIT_BOARD_ORIGIN.x + column * CIRCUIT_TILE_SIZE + 2,
                CIRCUIT_BOARD_ORIGIN.y + row * CIRCUIT_TILE_SIZE + 2,
                CIRCUIT_TILE_SIZE - 4,
                CIRCUIT_TILE_SIZE - 4,
                7
            );
        }

        for (const visual of this.computeChipVisuals()) {
            if (visual.scale <= 0.01 || visual.alpha <= 0.01) continue;
            this.drawChip(graphics, visual, pulse);
        }

        for (const spark of this.sparks) {
            const fade = 1 - spark.lifeMs / spark.maxLifeMs;
            graphics.fillStyle(spark.color, fade);
            graphics.fillCircle(spark.x, spark.y, spark.size * fade + 0.6);
        }

        for (let index = 0; index < this.state.chips.length; index++) {
            const column = index % this.state.width;
            const row = Math.floor(index / this.state.width);
            const x = CIRCUIT_BOARD_ORIGIN.x + column * CIRCUIT_TILE_SIZE;
            const y = CIRCUIT_BOARD_ORIGIN.y + row * CIRCUIT_TILE_SIZE;
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
            const center = this.cellCenter(this.cursorIndex);
            graphics.lineStyle(3, COLORS.pulse, 0.66 + pulse * 0.34);
            graphics.strokeCircle(center.x, center.y, 20 + pulse * 5);
        }
    }

    /** Draws one chip as a small printed circuit board in its color family. */
    private drawChip(
        graphics: Phaser.GameObjects.Graphics,
        visual: ChipVisual,
        pulse: number
    ): void {
        const {chip, x, y, scale, alpha} = visual;
        const bright = CHIP_COLORS[chip.color];
        const dark = CHIP_DARK_COLORS[chip.color];

        graphics.save();
        graphics.translateCanvas(x, y);
        graphics.scaleCanvas(scale, scale);

        // PCB substrate with a soft inner glow and copper border.
        graphics.fillStyle(dark, 0.97 * alpha);
        graphics.fillRoundedRect(-22, -22, 44, 44, 6);
        graphics.fillStyle(bright, 0.08 * alpha);
        graphics.fillRoundedRect(-18, -18, 36, 36, 5);
        graphics.lineStyle(2, bright, 0.92 * alpha);
        graphics.strokeRoundedRect(-22, -22, 44, 44, 6);

        // Copper traces and solder pads — each color family has its own layout.
        const pattern = PCB_PATTERNS[chip.color];
        graphics.lineStyle(2, bright, 0.72 * alpha);
        for (const [x1, y1, x2, y2] of pattern.lines) {
            graphics.lineBetween(x1, y1, x2, y2);
        }
        graphics.fillStyle(bright, 0.95 * alpha);
        for (const [padX, padY] of pattern.pads) {
            graphics.fillCircle(padX, padY, 2);
        }

        if (chip.special !== 'none') {
            graphics.fillStyle(bright, (0.22 + pulse * 0.22) * alpha);
            graphics.fillCircle(0, 0, 16);
        }

        switch (chip.special) {
            case 'none': {
                // Center component: a little IC with legs.
                graphics.fillStyle(bright, 0.28 * alpha);
                graphics.lineStyle(1.5, bright, 0.85 * alpha);
                for (const side of [-1, 1]) {
                    for (const leg of [-6, 0, 6]) {
                        graphics.lineBetween(side * 9, leg, side * 13, leg);
                    }
                }
                graphics.fillStyle(COLORS.ink, 0.95 * alpha);
                graphics.fillRoundedRect(-9, -8, 18, 16, 2);
                graphics.lineStyle(1.5, bright, 0.9 * alpha);
                graphics.strokeRoundedRect(-9, -8, 18, 16, 2);
                graphics.fillStyle(bright, 0.9 * alpha);
                graphics.fillCircle(-5, -4, 1.6);
                break;
            }
            case 'row':
                graphics.fillStyle(bright, alpha);
                graphics.fillRoundedRect(-16, -4, 32, 8, 3);
                graphics.fillTriangle(-18, 0, -9, -9, -9, 9);
                graphics.fillTriangle(18, 0, 9, -9, 9, 9);
                graphics.fillStyle(COLORS.paper, 0.85 * alpha);
                graphics.fillRoundedRect(-12, -1.5, 24, 3, 1);
                break;
            case 'column':
                graphics.fillStyle(bright, alpha);
                graphics.fillRoundedRect(-4, -16, 8, 32, 3);
                graphics.fillTriangle(0, -18, -9, -9, 9, -9);
                graphics.fillTriangle(0, 18, -9, 9, 9, 9);
                graphics.fillStyle(COLORS.paper, 0.85 * alpha);
                graphics.fillRoundedRect(-1.5, -12, 3, 24, 1);
                break;
            case 'burst':
                graphics.lineStyle(4, COLORS.paper, 0.95 * alpha);
                graphics.strokeCircle(0, 0, 11);
                graphics.lineBetween(-15, 0, 15, 0);
                graphics.lineBetween(0, -15, 0, 15);
                graphics.fillStyle(bright, alpha);
                graphics.fillCircle(0, 0, 5);
                break;
            case 'color': {
                const spectrum: readonly CircuitColor[] = [
                    'cyan',
                    'magenta',
                    'amber',
                    'lime',
                    'violet'
                ];
                graphics.fillStyle(COLORS.paper, 0.96 * alpha);
                graphics.fillCircle(0, 0, 15);
                for (let dot = 0; dot < spectrum.length; dot++) {
                    const angle = -Math.PI / 2 + dot * Math.PI * 2 / spectrum.length;
                    graphics.fillStyle(CHIP_COLORS[spectrum[dot]!], alpha);
                    graphics.fillCircle(Math.cos(angle) * 9, Math.sin(angle) * 9, 4);
                }
                graphics.fillStyle(0x07131c, alpha);
                graphics.fillCircle(0, 0, 3);
                break;
            }
        }

        graphics.restore();

        if (chip.shorted) {
            this.drawShortEffect(graphics, x, y, scale, alpha, chip.id);
        }
    }

    /**
     * The sparking short rides its chip: the arcs are drawn at the chip's
     * animated position, flickering to a new jagged shape every few frames.
     */
    private drawShortEffect(
        graphics: Phaser.GameObjects.Graphics,
        x: number,
        y: number,
        scale: number,
        alpha: number,
        chipId: number
    ): void {
        const band = Math.floor(this.animationClockMs / 90);
        const flicker = 0.55 + hash01(chipId, band) * 0.45;

        graphics.save();
        graphics.translateCanvas(x, y);
        graphics.scaleCanvas(scale, scale);

        graphics.fillStyle(COLORS.danger, 0.14 * flicker * alpha);
        graphics.fillCircle(0, 0, 27);
        graphics.lineStyle(3, COLORS.danger, (0.5 + 0.5 * flicker) * alpha);
        graphics.strokeRoundedRect(-24, -24, 48, 48, 7);

        // Two electric arcs crawl across the board, re-shaping every band.
        for (let arc = 0; arc < 2; arc++) {
            const seed = chipId * 7 + arc * 131;
            const vertical = hash01(seed, band) < 0.5;
            const points: Array<{x: number; y: number}> = [];
            const segments = 4;
            for (let step = 0; step <= segments; step++) {
                const along = -22 + (44 * step) / segments;
                const jitter = step === 0 || step === segments
                    ? 0
                    : (hash01(seed + step, band) - 0.5) * 26;
                points.push(vertical
                    ? {x: jitter, y: along}
                    : {x: along, y: jitter});
            }
            graphics.lineStyle(3, COLORS.warning, 0.95 * flicker * alpha);
            graphics.beginPath();
            graphics.moveTo(points[0]!.x, points[0]!.y);
            for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
            graphics.strokePath();
            graphics.lineStyle(1.2, 0xffffff, 0.9 * flicker * alpha);
            graphics.beginPath();
            graphics.moveTo(points[0]!.x, points[0]!.y);
            for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
            graphics.strokePath();
        }

        graphics.restore();

        // The short spits the occasional stray spark from wherever it now sits.
        const lastBand = this.shortSparkBands.get(chipId);
        if (lastBand !== band) {
            this.shortSparkBands.set(chipId, band);
            if (hash01(chipId + 977, band) > 0.72) {
                this.spawnSparkBurst(x, y - 10, COLORS.warning, 2);
            }
        }
    }

    private showHelp(): void {
        if (this.helpOpen || this.finishing) return;
        this.helpOpen = true;
        this.pulseTargeting = false;
        this.hideBoosterTooltip();
        const depth = 100;
        const shade = this.add.rectangle(
            VIEW_SIZE / 2,
            VIEW_SIZE / 2,
            VIEW_SIZE,
            VIEW_SIZE,
            0x02070a,
            0.8
        ).setDepth(depth).setInteractive();
        const closeHelp = (): void => this.closeHelp();
        shade.on('pointerdown', closeHelp);
        this.helpOverlay = createHelpOverlay(this, {
            title: 'CRASH THE CIRCUIT',
            lines: HELP_LINES,
            closeLabel: 'TAP OR ENTER · POWER ON',
            accentColor: COLORS.accent,
            titleColor: '#72f4df',
            bodyColor: '#e8fbff',
            closeTextColor: '#07131c',
            panelColor: 0x10212b,
            viewSize: VIEW_SIZE,
            onClose: closeHelp
        });
        this.helpObjects = [shade, ...this.helpOverlay.objects];
        this.publishTelemetry();
    }

    private closeHelp(): void {
        if (!this.helpOpen) return;
        this.helpOverlay?.destroy();
        this.helpOverlay = null;
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
