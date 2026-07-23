import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    createIntroPipeBoard,
    getPipeConnections,
    rotatePipeTile,
    tracePipeFlow,
    type PipeBoard,
    type PipeDirection
} from './pipe-model';

export const PIPE_DREAM_SCENE_KEY = 'pipe-dream';
export const PIPE_BOARD_ORIGIN = Object.freeze({x: 144, y: 154});
export const PIPE_TILE_SIZE = 96;

export interface PipeDreamLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const PIPE_COLORS = Object.freeze({
    panel: 0x171918,
    panelBorder: 0x676b60,
    tile: 0x2f3430,
    tilePowered: 0x315e52,
    tileLeak: 0x633b38,
    pipe: 0xb6b09f,
    pipePowered: 0x67d5e8,
    accent: 0xefc75e,
    selected: 0xf5f0df
});

function endpoint(
    centerX: number,
    centerY: number,
    direction: PipeDirection
): {readonly x: number; readonly y: number} {
    const distance = PIPE_TILE_SIZE / 2 - 8;
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

function gradeForTurns(turns: number): PerformanceGrade {
    if (turns <= 4) return 's';
    if (turns <= 7) return 'a';
    if (turns <= 10) return 'b';
    return 'c';
}

export class PipeDreamScene extends Phaser.Scene {
    private launchData!: PipeDreamLaunchData;
    private board!: PipeBoard;
    private boardGraphics!: Phaser.GameObjects.Graphics;
    private turnsText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private selectedTileIndex = 5;
    private startedAt = 0;
    private finishing = false;

    constructor() {
        super({key: PIPE_DREAM_SCENE_KEY});
    }

    create(data: PipeDreamLaunchData): void {
        this.launchData = data;
        this.board = createIntroPipeBoard(new Mulberry32Random(data.context.seed));
        this.startedAt = this.time.now;
        this.finishing = false;

        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, 0x0f110e, 0.76).setOrigin(0);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 560, 610, PIPE_COLORS.panel)
            .setStrokeStyle(2, PIPE_COLORS.panelBorder);
        this.add.text(78, 48, 'COOLANT RELAY 7B', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '30px'
        });
        this.add.text(78, 88, 'The municipal apocalypse warranty remains confidently void.', {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        });
        this.turnsText = this.add.text(78, 574, 'Turns 0', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '19px'
        });
        this.statusText = this.add.text(78, 610, 'FLOW INTERRUPTED', {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '18px'
        });

        const closeButton = this.add.circle(594, 70, 20, 0x2f3430)
            .setStrokeStyle(2, PIPE_COLORS.panelBorder)
            .setInteractive({useHandCursor: true});
        this.add.text(594, 69, 'X', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '18px'
        }).setOrigin(0.5);
        closeButton.on('pointerdown', () => this.finish('abandoned'));

        this.boardGraphics = this.add.graphics();
        for (let tileIndex = 0; tileIndex < this.board.tiles.length; tileIndex++) {
            const x = tileIndex % this.board.width;
            const y = Math.floor(tileIndex / this.board.width);
            this.add.rectangle(
                PIPE_BOARD_ORIGIN.x + x * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2,
                PIPE_BOARD_ORIGIN.y + y * PIPE_TILE_SIZE + PIPE_TILE_SIZE / 2,
                PIPE_TILE_SIZE - 8,
                PIPE_TILE_SIZE - 8,
                0xffffff,
                0.001
            ).setInteractive({useHandCursor: true})
                .on('pointerdown', () => this.rotateTile(tileIndex));
        }

        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            delete this.game.canvas.dataset.pipeTurns;
            delete this.game.canvas.dataset.pipeSelectedTile;
        });
        this.drawBoard();
        this.publishProgress();
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this.finish('abandoned');
            event.preventDefault();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            this.rotateTile(this.selectedTileIndex);
            event.preventDefault();
            return;
        }

        const selectedX = this.selectedTileIndex % this.board.width;
        const selectedY = Math.floor(this.selectedTileIndex / this.board.width);
        let nextX = selectedX;
        let nextY = selectedY;
        if (event.key === 'ArrowUp') nextY--;
        else if (event.key === 'ArrowDown') nextY++;
        else if (event.key === 'ArrowLeft') nextX--;
        else if (event.key === 'ArrowRight') nextX++;
        else return;

        nextX = Phaser.Math.Clamp(nextX, 0, this.board.width - 1);
        nextY = Phaser.Math.Clamp(nextY, 0, this.board.height - 1);
        this.selectedTileIndex = nextY * this.board.width + nextX;
        this.drawBoard();
        event.preventDefault();
    };

    private rotateTile(tileIndex: number): void {
        if (this.finishing) return;
        this.selectedTileIndex = tileIndex;
        const nextBoard = rotatePipeTile(this.board, tileIndex);
        if (nextBoard === this.board) {
            this.drawBoard();
            return;
        }

        this.board = nextBoard;
        this.publishProgress();
        this.turnsText.setText(`Turns ${this.board.turns}`);
        this.drawBoard();
        if (tracePipeFlow(this.board).completed) {
            this.finishing = true;
            this.statusText.setText('FLOW STABLE - SHORTCUT POWERED').setColor('#67d5e8');
            this.time.delayedCall(500, () => this.finish('success'));
        }
    }

    private drawBoard(): void {
        const flow = tracePipeFlow(this.board);
        const powered = new Set(flow.poweredTileIndices);
        const leaking = new Set(flow.leakingTileIndices);
        this.boardGraphics.clear();

        for (let tileIndex = 0; tileIndex < this.board.tiles.length; tileIndex++) {
            const tile = this.board.tiles[tileIndex]!;
            const tileX = tileIndex % this.board.width;
            const tileY = Math.floor(tileIndex / this.board.width);
            const left = PIPE_BOARD_ORIGIN.x + tileX * PIPE_TILE_SIZE + 4;
            const top = PIPE_BOARD_ORIGIN.y + tileY * PIPE_TILE_SIZE + 4;
            const centerX = left + (PIPE_TILE_SIZE - 8) / 2;
            const centerY = top + (PIPE_TILE_SIZE - 8) / 2;
            const fillColor = leaking.has(tileIndex)
                ? PIPE_COLORS.tileLeak
                : powered.has(tileIndex) ? PIPE_COLORS.tilePowered : PIPE_COLORS.tile;

            this.boardGraphics.fillStyle(fillColor).fillRect(
                left,
                top,
                PIPE_TILE_SIZE - 8,
                PIPE_TILE_SIZE - 8
            );
            this.boardGraphics.lineStyle(
                tileIndex === this.selectedTileIndex ? 3 : 1,
                tileIndex === this.selectedTileIndex ? PIPE_COLORS.selected : PIPE_COLORS.panelBorder
            ).strokeRect(left, top, PIPE_TILE_SIZE - 8, PIPE_TILE_SIZE - 8);

            const pipeColor = powered.has(tileIndex)
                ? PIPE_COLORS.pipePowered
                : PIPE_COLORS.pipe;
            this.boardGraphics.lineStyle(14, pipeColor);
            for (const direction of getPipeConnections(tile)) {
                const pipeEnd = endpoint(centerX, centerY, direction);
                this.boardGraphics.lineBetween(centerX, centerY, pipeEnd.x, pipeEnd.y);
            }
            if (tile.kind !== 'empty') {
                this.boardGraphics.fillStyle(pipeColor).fillCircle(centerX, centerY, 9);
            }
            if (tile.kind === 'source') {
                this.boardGraphics.fillStyle(0x3b9c58).fillCircle(centerX, centerY, 15);
            } else if (tile.kind === 'sink') {
                this.boardGraphics.fillStyle(PIPE_COLORS.accent).fillCircle(centerX, centerY, 15);
            }
        }
    }

    private publishProgress(): void {
        this.game.canvas.dataset.pipeTurns = String(this.board.turns);
        this.game.canvas.dataset.pipeSelectedTile = String(this.selectedTileIndex);
    }

    private finish(status: 'success' | 'abandoned'): void {
        if (status === 'abandoned' && this.finishing) return;
        this.finishing = true;
        const result = this.createResult(status);
        this.launchData.onComplete(result);
        this.scene.stop();
    }

    private createResult(status: 'success' | 'abandoned'): EncounterResult {
        const effects: OutcomeEffect[] = status === 'success'
            ? this.createSuccessEffects()
            : [
                {kind: 'adjust-world-system', system: 'securityAlert', delta: 5},
                {kind: 'set-flag', flag: 'coolant-terminal-filed-a-complaint'}
            ];
        const grade = status === 'success' ? gradeForTurns(this.board.turns) : 'none';
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'pipe',
            status,
            grade,
            score: status === 'success' ? Math.max(500, 4_000 - this.board.turns * 200) : 0,
            elapsedMs: Math.max(0, this.time.now - this.startedAt),
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
            {kind: 'set-flag', flag: 'coolant-routing-restored'},
            {
                kind: 'transform-cell',
                position: {x: benefitX, y: benefitY},
                cell: {kind: 'passage', materialId: null}
            },
            {
                kind: 'set-trigger-state',
                triggerId: this.launchData.context.trigger.triggerId,
                state: 'resolved'
            }
        ];
    }
}