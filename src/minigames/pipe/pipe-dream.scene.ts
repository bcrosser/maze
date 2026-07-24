import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    advancePipeFlow,
    createPipePuzzle,
    finishPipePlacement,
    getPipeConnections,
    getPipeFlowVisualState,
    getPipeGrade,
    getPipeScore,
    PIPE_FINISHED_FLOW_MULTIPLIER,
    placeQueuedPiece,
    setPipePaused,
    type PipeDirection,
    type PipePuzzleState,
    type PipeQueuePiece
} from './pipe-model';

export const PIPE_DREAM_SCENE_KEY = 'pipe-dream';
export const PIPE_BOARD_ORIGIN = Object.freeze({x: 46, y: 142});
export const PIPE_TILE_SIZE = 72;

export interface PipeDreamLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const PIPE_COLORS = Object.freeze({
    background: 0x0c1112,
    panel: 0x171d1d,
    panelBorder: 0x667272,
    tile: 0x293232,
    tileWet: 0x244d55,
    tileFailure: 0x653c39,
    obstacle: 0x1d2222,
    pipe: 0xa9afa8,
    pipeWet: 0x55d9ed,
    accent: 0xefc75e,
    selected: 0xf5f0df,
    warning: 0xee715f
});

const HELP_STEPS = Object.freeze([
    Object.freeze({
        title: '1 / 3  FIXED ORIENTATION',
        body: 'Each piece arrives already turned.\nTap a dry cell to place it exactly as shown.'
    }),
    Object.freeze({
        title: '2 / 3  STAY AHEAD',
        body: 'Coolant starts slowly when this guide closes.\nWhen your route is ready, press FINISH PLACING to lock it\nand run the coolant four times faster.'
    }),
    Object.freeze({
        title: '3 / 3  OVERWRITE COST',
        body: 'You may replace dry pipe, but every overwrite pushes\nliquid forward by one full flow step.'
    })
]);

function endpoint(
    centerX: number,
    centerY: number,
    direction: PipeDirection,
    distance: number
): {readonly x: number; readonly y: number} {
    switch (direction) {
        case 'up':
            return {x: centerX, y: centerY - distance};
        case 'right':
            return {x: centerX + distance, y: centerY};
        case 'down':
            return {x: centerX, y: centerY + distance};
        case 'left':
            return {x: centerX - distance, y: centerY};
    }
}

function pieceGlyph(piece: PipeQueuePiece | undefined): string {
    if (piece === undefined) return 'EMPTY';
    if (piece.kind === 'straight') return piece.rotation % 2 === 0 ? '│' : '─';
    switch (piece.rotation) {
        case 0:
            return '└';
        case 1:
            return '┌';
        case 2:
            return '┐';
        case 3:
            return '┘';
    }
}

function lerp(start: number, end: number, amount: number): number {
    return start + (end - start) * amount;
}

export class PipeDreamScene extends Phaser.Scene {
    private launchData!: PipeDreamLaunchData;
    private state!: PipePuzzleState;
    private boardGraphics!: Phaser.GameObjects.Graphics;
    private meterGraphics!: Phaser.GameObjects.Graphics;
    private queueGraphics!: Phaser.GameObjects.Graphics;
    private placementsText!: Phaser.GameObjects.Text;
    private clockText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private finishPlacementButton!: Phaser.GameObjects.Rectangle;
    private finishPlacementLabel!: Phaser.GameObjects.Text;
    private queueTexts: Phaser.GameObjects.Text[] = [];
    private helpBackdrop!: Phaser.GameObjects.Rectangle;
    private helpTitle!: Phaser.GameObjects.Text;
    private helpBody!: Phaser.GameObjects.Text;
    private helpFooter!: Phaser.GameObjects.Text;
    private selectedTileIndex = 0;
    private helpPage = -1;
    private wasPausedBeforeHelp = false;
    private keyboardReady = false;
    private finishing = false;
    private terminalHandled = false;

    constructor() {
        super({key: PIPE_DREAM_SCENE_KEY});
    }

    create(data: PipeDreamLaunchData): void {
        this.launchData = data;
        const baseStepMs = data.context.difficulty === 'story'
            ? 10_000
            : data.context.difficulty === 'expert'
                ? 6_000
                : 8_000;
        this.state = createPipePuzzle(new Mulberry32Random(data.context.seed), {
            difficulty: data.context.difficulty,
            graceMs: getEncounterNumberModifier(data.context, 'pipeGraceBonusMs'),
            stepMs: baseStepMs +
                getEncounterNumberModifier(data.context, 'pipeStepBonusMs')
        });
        this.selectedTileIndex = this.firstEligibleCell();
        this.helpPage = -1;
        this.wasPausedBeforeHelp = false;
        this.keyboardReady = false;
        this.finishing = false;
        this.terminalHandled = false;

        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, PIPE_COLORS.background).setOrigin(0);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 620, 638, PIPE_COLORS.panel)
            .setStrokeStyle(2, PIPE_COLORS.panelBorder);
        this.add.text(30, 22, 'EMERGENCY COOLANT ROUTING', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '24px'
        });
        const itemBonus = getEncounterItemBonusLabel(data.context);
        this.add.text(30, 51,
            'The slow blue coolant is your timer. Build ahead of it.' +
            (itemBonus ? `\nITEM BONUS · ${itemBonus}` : ''),
        {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: itemBonus ? '12px' : '15px',
            lineSpacing: 1
        });
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';

        this.placementsText = this.add.text(30, 80, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        });
        this.clockText = this.add.text(472, 80, '', {
            color: '#67d5e8',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            align: 'right'
        }).setOrigin(0, 0);
        this.meterGraphics = this.add.graphics();
        this.boardGraphics = this.add.graphics();
        this.queueGraphics = this.add.graphics();

        this.add.text(510, 139, 'QUEUE', {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '17px'
        });
        for (let previewIndex = 0; previewIndex < 4; previewIndex++) {
            const text = this.add.text(558, 202 + previewIndex * 88, '', {
                color: previewIndex === 0 ? '#67d5e8' : '#b6b09f',
                fontFamily: 'Georgia, serif',
                fontSize: previewIndex === 0 ? '42px' : '31px'
            }).setOrigin(0.5);
            this.queueTexts.push(text);
        }

        this.statusText = this.add.text(30, 594, '', {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            wordWrap: {width: 610}
        });
        this.add.text(30, 625, 'Tap/click • Arrows + Enter • F fast flow • P pause • H help', {
            color: '#8e9992',
            fontFamily: 'Georgia, serif',
            fontSize: '14px'
        });

        this.createUtilityButton(617, 35, 'X', () => this.finish('abandoned'));
        this.createUtilityButton(567, 35, '?', () => this.openHelp());
        this.createUtilityButton(517, 35, 'Ⅱ', () => this.togglePause());
        this.createFinishPlacementButton();

        for (let tileIndex = 0; tileIndex < this.state.tiles.length; tileIndex++) {
            const tileX = tileIndex % this.state.width;
            const tileY = Math.floor(tileIndex / this.state.width);
            this.add.rectangle(
                PIPE_BOARD_ORIGIN.x + tileX * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2,
                PIPE_BOARD_ORIGIN.y + tileY * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2,
                PIPE_TILE_SIZE - 5,
                PIPE_TILE_SIZE - 5,
                0xffffff,
                0.001
            ).setInteractive({useHandCursor: true})
                .on('pointerdown', () => this.placeAt(tileIndex));
        }

        this.helpBackdrop = this.add.rectangle(
            VIEW_SIZE / 2,
            VIEW_SIZE / 2,
            574,
            286,
            0x111919,
            0.98
        ).setStrokeStyle(3, PIPE_COLORS.accent)
            .setDepth(20)
            .setInteractive({useHandCursor: true});
        this.helpTitle = this.add.text(VIEW_SIZE / 2, 248, '', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '24px',
            align: 'center'
        }).setOrigin(0.5).setDepth(21);
        this.helpBody = this.add.text(VIEW_SIZE / 2, 333, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '18px',
            align: 'center',
            lineSpacing: 9
        }).setOrigin(0.5).setDepth(21);
        this.helpFooter = this.add.text(VIEW_SIZE / 2, 420, '', {
            color: '#67d5e8',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5).setDepth(21);
        this.helpBackdrop.on('pointerdown', () => this.advanceHelp());

        const keyboard = this.input.keyboard;
        const launchedByHeldConfirm = Boolean(
            keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).isDown ||
            keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).isDown
        );
        this.keyboardReady = !launchedByHeldConfirm;
        keyboard?.on('keydown', this.handleKeyDown, this);
        if (launchedByHeldConfirm) {
            // A persisted encounter can be launched by an Overworld confirm.
            // Wait for that physical key to be released so it cannot also
            // advance this scene's help overlay.
            keyboard?.once('keyup', () => {
                this.keyboardReady = true;
            });
        }
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.queueTexts = [];
            delete this.game.canvas.dataset.pipeTurns;
            delete this.game.canvas.dataset.pipeSelectedTile;
            delete this.game.canvas.dataset.pipeQueueIndex;
            delete this.game.canvas.dataset.pipeFlowClock;
            delete this.game.canvas.dataset.pipeStatus;
            delete this.game.canvas.dataset.pipeOverwrites;
            delete this.game.canvas.dataset.pipeHelpPage;
            delete this.game.canvas.dataset.pipeStepMs;
            delete this.game.canvas.dataset.pipeFinishReady;
            delete this.game.canvas.dataset.pipePlacementFinished;
            delete this.game.canvas.dataset.pipeFlowMultiplier;
            delete this.game.canvas.dataset.itemBonus;
        });

        this.openHelp();
        this.draw();
    }

    override update(_time: number, delta: number): void {
        if (!this.finishing && this.helpPage < 0) {
            this.state = advancePipeFlow(this.state, delta);
        }
        this.draw();
        if (this.state.terminalStatus !== 'active' && !this.terminalHandled) {
            this.terminalHandled = true;
            const status = this.state.terminalStatus;
            this.finish(status === 'success' ? 'success' : 'failure');
        }
    }

    private createUtilityButton(
        x: number,
        y: number,
        label: string,
        action: () => void
    ): void {
        const button = this.add.circle(x, y, 17, 0x293232)
            .setStrokeStyle(2, PIPE_COLORS.panelBorder)
            .setInteractive({useHandCursor: true});
        this.add.text(x, y, label, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5);
        button.on('pointerdown', action);
    }

    private createFinishPlacementButton(): void {
        this.finishPlacementButton = this.add.rectangle(
            558,
            542,
            126,
            54,
            0x252d2d
        ).setStrokeStyle(2, PIPE_COLORS.panelBorder)
            .setInteractive({useHandCursor: true});
        this.finishPlacementLabel = this.add.text(
            558,
            542,
            'FINISH PLACING\nFAST FLOW [F]',
            {
                color: '#8e9992',
                fontFamily: 'Georgia, serif',
                fontSize: '12px',
                fontStyle: 'bold',
                align: 'center',
                lineSpacing: 2
            }
        ).setOrigin(0.5);
        this.finishPlacementButton.on(
            'pointerdown',
            () => this.lockPlacementAndAccelerate()
        );
    }

    private firstEligibleCell(): number {
        return this.state.tiles.findIndex(tile => tile.kind === 'empty');
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (!this.keyboardReady) return;
        if (event.key === 'Escape') {
            this.finish('abandoned');
            event.preventDefault();
            return;
        }
        if (event.key.toLowerCase() === 'h') {
            this.openHelp();
            event.preventDefault();
            return;
        }
        if (event.key.toLowerCase() === 'p') {
            this.togglePause();
            event.preventDefault();
            return;
        }
        if (event.key.toLowerCase() === 'f') {
            if (this.helpPage < 0) this.lockPlacementAndAccelerate();
            event.preventDefault();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            if (this.helpPage >= 0) this.advanceHelp();
            else this.placeAt(this.selectedTileIndex);
            event.preventDefault();
            return;
        }
        if (this.helpPage >= 0) return;

        const selectedX = this.selectedTileIndex % this.state.width;
        const selectedY = Math.floor(this.selectedTileIndex / this.state.width);
        let nextX = selectedX;
        let nextY = selectedY;
        if (event.key === 'ArrowUp') nextY--;
        else if (event.key === 'ArrowDown') nextY++;
        else if (event.key === 'ArrowLeft') nextX--;
        else if (event.key === 'ArrowRight') nextX++;
        else return;

        nextX = Phaser.Math.Clamp(nextX, 0, this.state.width - 1);
        nextY = Phaser.Math.Clamp(nextY, 0, this.state.height - 1);
        this.selectedTileIndex = nextY * this.state.width + nextX;
        this.draw();
        event.preventDefault();
    };

    private placeAt(tileIndex: number): void {
        if (this.finishing || this.helpPage >= 0) return;
        this.selectedTileIndex = tileIndex;
        const previousQueueIndex = this.state.queueIndex;
        this.state = placeQueuedPiece(this.state, tileIndex);
        if (this.state.lastEvent.kind === 'overwritten') {
            this.showCellNotice(tileIndex, 'FLOW +1', '#efc75e');
        } else if (
            this.state.lastEvent.kind === 'blocked'
            && this.state.lastEvent.message === 'WET PIPE LOCKED'
        ) {
            this.showCellNotice(tileIndex, 'WET · LOCKED', '#ee715f');
        } else if (this.state.queueIndex === previousQueueIndex) {
            this.showCellNotice(tileIndex, this.state.lastEvent.message, '#ee715f');
        }
        this.draw();
    }

    private lockPlacementAndAccelerate(): void {
        if (this.finishing || this.helpPage >= 0) return;
        this.state = finishPipePlacement(this.state);
        this.draw();
    }

    private showCellNotice(tileIndex: number, message: string, color: string): void {
        const tileX = tileIndex % this.state.width;
        const tileY = Math.floor(tileIndex / this.state.width);
        const notice = this.add.text(
            PIPE_BOARD_ORIGIN.x + tileX * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2,
            PIPE_BOARD_ORIGIN.y + tileY * PIPE_TILE_SIZE + 8,
            message,
            {
                color,
                backgroundColor: '#111919',
                fontFamily: 'Georgia, serif',
                fontSize: '11px',
                padding: {x: 3, y: 2}
            }
        ).setOrigin(0.5).setDepth(10);
        this.tweens.add({
            targets: notice,
            y: notice.y - 18,
            alpha: 0,
            duration: 900,
            onComplete: () => notice.destroy()
        });
    }

    private openHelp(): void {
        if (this.finishing) return;
        if (this.helpPage < 0) this.wasPausedBeforeHelp = this.state.paused;
        this.state = setPipePaused(this.state, true);
        this.helpPage = 0;
        this.updateHelp();
    }

    private advanceHelp(): void {
        if (this.helpPage < 0) return;
        this.helpPage++;
        if (this.helpPage >= HELP_STEPS.length) {
            this.helpPage = -1;
            this.state = setPipePaused(this.state, this.wasPausedBeforeHelp);
        }
        this.updateHelp();
    }

    private updateHelp(): void {
        const visible = this.helpPage >= 0;
        this.game.canvas.dataset.pipeHelpPage = String(this.helpPage);
        this.helpBackdrop.setVisible(visible);
        if (this.helpBackdrop.input !== null) this.helpBackdrop.input.enabled = visible;
        this.helpTitle.setVisible(visible);
        this.helpBody.setVisible(visible);
        this.helpFooter.setVisible(visible);
        if (!visible) return;
        const help = HELP_STEPS[this.helpPage]!;
        this.helpTitle.setText(help.title);
        this.helpBody.setText(help.body);
        this.helpFooter.setText(
            this.helpPage === HELP_STEPS.length - 1
                ? 'Tap or press Enter to start the flow'
                : 'Tap or press Enter for next'
        );
    }

    private togglePause(): void {
        if (this.finishing || this.helpPage >= 0) return;
        this.state = setPipePaused(this.state, !this.state.paused);
        this.draw();
    }

    private draw(): void {
        this.drawBoard();
        this.drawQueue();
        this.drawMeterAndHud();
        this.drawFinishPlacementButton();
        this.publishProgress();
    }

    private drawFinishPlacementButton(): void {
        const ready = this.state.terminalStatus === 'active'
            && !this.state.paused
            && !this.state.placementFinished
            && this.state.turns > 0
            && this.helpPage < 0
            && !this.finishing;
        const running = this.state.placementFinished
            && this.state.terminalStatus === 'active';

        this.finishPlacementButton.setFillStyle(
            running ? PIPE_COLORS.tileWet : ready ? 0x5b4a24 : 0x252d2d,
            ready || running ? 1 : 0.72
        ).setStrokeStyle(
            2,
            ready || running ? PIPE_COLORS.accent : PIPE_COLORS.panelBorder
        );
        if (this.finishPlacementButton.input !== null) {
            this.finishPlacementButton.input.enabled = ready;
        }
        this.finishPlacementLabel
            .setText(running
                ? `FAST FLOW ×${PIPE_FINISHED_FLOW_MULTIPLIER}\nPLACEMENT LOCKED`
                : 'FINISH PLACING\nFAST FLOW [F]')
            .setColor(ready || running ? '#f5f0df' : '#8e9992');
    }

    private drawBoard(): void {
        const visual = getPipeFlowVisualState(this.state);
        const wet = new Set(this.state.wetTileIndices);
        const tileSpan = PIPE_TILE_SIZE - 6;
        const pipeDistance = tileSpan / 2 - 4;
        this.boardGraphics.clear();

        for (let tileIndex = 0; tileIndex < this.state.tiles.length; tileIndex++) {
            const tile = this.state.tiles[tileIndex]!;
            const tileX = tileIndex % this.state.width;
            const tileY = Math.floor(tileIndex / this.state.width);
            const left = PIPE_BOARD_ORIGIN.x + tileX * PIPE_TILE_SIZE + 3;
            const top = PIPE_BOARD_ORIGIN.y + tileY * PIPE_TILE_SIZE + 3;
            const centerX = left + tileSpan / 2;
            const centerY = top + tileSpan / 2;
            const failedCell = this.state.terminalStatus === 'failure'
                && this.state.lastEvent.cellIndex === tileIndex;
            const fillColor = failedCell
                ? PIPE_COLORS.tileFailure
                : wet.has(tileIndex) ? PIPE_COLORS.tileWet
                    : tile.kind === 'obstacle' ? PIPE_COLORS.obstacle : PIPE_COLORS.tile;

            this.boardGraphics.fillStyle(fillColor).fillRoundedRect(
                left,
                top,
                tileSpan,
                tileSpan,
                5
            );
            this.boardGraphics.lineStyle(
                tileIndex === this.selectedTileIndex ? 3 : 1,
                tileIndex === this.selectedTileIndex
                    ? PIPE_COLORS.selected
                    : PIPE_COLORS.panelBorder
            ).strokeRoundedRect(left, top, tileSpan, tileSpan, 5);

            if (tile.kind === 'obstacle') {
                this.boardGraphics.lineStyle(6, PIPE_COLORS.panelBorder, 0.8);
                this.boardGraphics.lineBetween(left + 18, top + 18, left + tileSpan - 18, top + tileSpan - 18);
                this.boardGraphics.lineBetween(left + tileSpan - 18, top + 18, left + 18, top + tileSpan - 18);
                continue;
            }

            this.boardGraphics.lineStyle(11, PIPE_COLORS.pipe, 1);
            for (const direction of getPipeConnections(tile)) {
                const end = endpoint(centerX, centerY, direction, pipeDistance);
                this.boardGraphics.lineBetween(centerX, centerY, end.x, end.y);
            }
            if (tile.kind !== 'empty') {
                this.boardGraphics.fillStyle(PIPE_COLORS.pipe).fillCircle(centerX, centerY, 7);
            }
            if (tile.kind === 'source') {
                this.boardGraphics.fillStyle(0x3b9c58).fillCircle(centerX, centerY, 12);
            } else if (tile.kind === 'sink') {
                this.boardGraphics.fillStyle(PIPE_COLORS.accent).fillCircle(centerX, centerY, 12);
            }
        }

        for (const tileIndex of this.state.wetTileIndices) {
            const tile = this.state.tiles[tileIndex]!;
            const tileX = tileIndex % this.state.width;
            const tileY = Math.floor(tileIndex / this.state.width);
            const centerX = PIPE_BOARD_ORIGIN.x + tileX * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2;
            const centerY = PIPE_BOARD_ORIGIN.y + tileY * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2;
            const isFront = tileIndex === visual.frontIndex
                && this.state.terminalStatus === 'active';
            this.boardGraphics.lineStyle(7, PIPE_COLORS.pipeWet, 1);
            if (!isFront) {
                for (const direction of getPipeConnections(tile)) {
                    const end = endpoint(centerX, centerY, direction, pipeDistance);
                    this.boardGraphics.lineBetween(centerX, centerY, end.x, end.y);
                }
            } else {
                if (this.state.frontIncomingDirection !== null) {
                    const incomingEnd = endpoint(
                        centerX,
                        centerY,
                        this.state.frontIncomingDirection,
                        pipeDistance
                    );
                    this.boardGraphics.lineBetween(
                        centerX,
                        centerY,
                        incomingEnd.x,
                        incomingEnd.y
                    );
                }
                if (visual.outgoingDirection !== null) {
                    const outgoingEnd = endpoint(
                        centerX,
                        centerY,
                        visual.outgoingDirection,
                        pipeDistance
                    );
                    this.boardGraphics.lineBetween(
                        centerX,
                        centerY,
                        lerp(centerX, outgoingEnd.x, visual.connectionProgress),
                        lerp(centerY, outgoingEnd.y, visual.connectionProgress)
                    );
                }
            }
            this.boardGraphics.fillStyle(PIPE_COLORS.pipeWet).fillCircle(centerX, centerY, 5);
        }
    }

    private drawQueue(): void {
        this.queueGraphics.clear();
        for (let previewIndex = 0; previewIndex < 4; previewIndex++) {
            const top = 166 + previewIndex * 88;
            this.queueGraphics.fillStyle(
                previewIndex === 0 ? 0x243d41 : 0x222a2a,
                1
            ).fillRoundedRect(505, top, 106, 72, 7);
            this.queueGraphics.lineStyle(
                previewIndex === 0 ? 2 : 1,
                previewIndex === 0 ? PIPE_COLORS.pipeWet : PIPE_COLORS.panelBorder
            ).strokeRoundedRect(505, top, 106, 72, 7);
            const piece = this.state.queue[this.state.queueIndex + previewIndex];
            this.queueTexts[previewIndex]!.setText(pieceGlyph(piece));
            this.queueTexts[previewIndex]!.setColor(
                piece === undefined
                    ? '#7b8380'
                    : previewIndex === 0 ? '#67d5e8' : '#b6b09f'
            );
        }
    }

    private drawMeterAndHud(): void {
        const visual = getPipeFlowVisualState(this.state);
        const flowMultiplier = this.state.placementFinished
            ? PIPE_FINISHED_FLOW_MULTIPLIER
            : 1;
        const inGrace = this.state.flowClockMs < 0;
        const warning = inGrace
            ? visual.graceRemainingMs / flowMultiplier <= 3_000
            : visual.connectionRemainingMs / flowMultiplier <= 2_000;
        const pulse = warning ? 0.7 + Math.sin(this.time.now / 110) * 0.3 : 1;
        const meterProgress = inGrace ? visual.graceProgress : visual.connectionProgress;
        const meterColor = warning ? PIPE_COLORS.warning : PIPE_COLORS.pipeWet;
        this.meterGraphics.clear();
        this.meterGraphics.fillStyle(0x252d2d).fillRoundedRect(30, 109, 582, 12, 6);
        this.meterGraphics.fillStyle(meterColor, pulse).fillRoundedRect(
            30,
            109,
            Math.max(3, 582 * meterProgress),
            12,
            6
        );

        this.placementsText.setText(
            `Placed ${this.state.turns}  ·  Overwrites ${this.state.overwrites}`
        );
        this.clockText.setText(
            inGrace
                ? `${flowMultiplier > 1 ? 'FAST ' : ''}FLOW STARTS ${
                    (visual.graceRemainingMs / flowMultiplier / 1_000).toFixed(1)
                }s`
                : `${flowMultiplier > 1 ? `FAST ×${flowMultiplier} · ` : ''}NEXT JOINT ${
                    (visual.connectionRemainingMs / flowMultiplier / 1_000).toFixed(1)
                }s`
        ).setColor(warning ? '#ee715f' : '#67d5e8');

        let status = this.state.lastEvent.message || 'CHOOSE A DRY CELL';
        let statusColor = '#dce8a5';
        if (this.state.paused && this.helpPage < 0) {
            status = 'PAUSED · PRESS P TO RESUME';
            statusColor = '#efc75e';
        } else if (this.state.terminalStatus === 'success') {
            status = 'FLOW STABLE · SHORTCUT POWERED';
            statusColor = '#67d5e8';
        } else if (this.state.terminalStatus === 'failure') {
            status = `${this.state.lastEvent.message} · PRESSURE LOST`;
            statusColor = '#ee715f';
        } else if (this.state.placementFinished) {
            status = `PLACEMENT LOCKED · COOLANT RUNNING ×${PIPE_FINISHED_FLOW_MULTIPLIER}`;
            statusColor = '#67d5e8';
        } else if (this.state.queueIndex >= this.state.queue.length) {
            status = 'QUEUE EMPTY · LIQUID CONTINUES';
            statusColor = '#efc75e';
        }
        this.statusText.setText(status).setColor(statusColor);
    }

    private publishProgress(): void {
        this.game.canvas.dataset.pipeTurns = String(this.state.turns);
        this.game.canvas.dataset.pipeSelectedTile = String(this.selectedTileIndex);
        this.game.canvas.dataset.pipeQueueIndex = String(this.state.queueIndex);
        this.game.canvas.dataset.pipeFlowClock = String(Math.round(this.state.flowClockMs));
        this.game.canvas.dataset.pipeStatus = this.state.terminalStatus;
        this.game.canvas.dataset.pipeOverwrites = String(this.state.overwrites);
        this.game.canvas.dataset.pipeHelpPage = String(this.helpPage);
        this.game.canvas.dataset.pipeStepMs = String(this.state.config.stepMs);
        this.game.canvas.dataset.pipeFinishReady = String(
            this.state.terminalStatus === 'active'
            && !this.state.paused
            && !this.state.placementFinished
            && this.state.turns > 0
            && this.helpPage < 0
        );
        this.game.canvas.dataset.pipePlacementFinished =
            String(this.state.placementFinished);
        this.game.canvas.dataset.pipeFlowMultiplier = String(
            this.state.placementFinished ? PIPE_FINISHED_FLOW_MULTIPLIER : 1
        );
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (status === 'abandoned' && this.finishing) return;
        if (!this.scene.isActive()) return;
        this.finishing = true;
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        let effects: OutcomeEffect[];
        if (status === 'success') {
            effects = this.createSuccessEffects();
        } else if (status === 'failure') {
            effects = [
                {kind: 'adjust-world-system', system: 'securityAlert', delta: 7},
                {kind: 'set-flag', flag: 'coolant-terminal-filed-a-complaint'}
            ];
        } else {
            effects = [
                {kind: 'adjust-world-system', system: 'securityAlert', delta: 5},
                {kind: 'set-flag', flag: 'coolant-terminal-filed-a-complaint'}
            ];
        }
        const grade: PerformanceGrade = status === 'success'
            ? getPipeGrade(this.state)
            : 'none';
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'pipe',
            status,
            grade,
            score: status === 'success' ? getPipeScore(this.state) : 0,
            elapsedMs: Math.max(0, Math.round(this.state.activeElapsedMs)),
            effects
        };
    }

    private createSuccessEffects(): OutcomeEffect[] {
        const benefitX = this.launchData.context.modifiers['benefitX'];
        const benefitY = this.launchData.context.modifiers['benefitY'];
        if (typeof benefitX !== 'number' || typeof benefitY !== 'number') {
            throw new Error('Pipe encounter requires a numeric overworld benefit cell.');
        }
        return [
            {kind: 'change-resource', resource: 'scrap', delta: 5},
            {kind: 'adjust-world-system', system: 'powerRouting', delta: 15},
            {
                kind: 'open-pipe-shortcut',
                position: {x: benefitX, y: benefitY}
            }
        ];
    }
}
