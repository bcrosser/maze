import Phaser from 'phaser';

import type {PerformanceGrade} from '../../domain/campaign/campaign-state';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    createShooterMission,
    createShooterProgress,
    hasWonShooterMission,
    recordEnemyEscape,
    recordShooterHit,
    recordShooterKill,
    type ShooterLane,
    type ShooterMission,
    type ShooterProgress,
    type ShooterWaveEntry
} from './shooter-model';

export const SHOOTER_SCENE_KEY = 'shooter';
export const SHOOTER_LANE_X = Object.freeze([136, 236, 336, 436, 536] as const);

export interface ShooterLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

interface ActiveEnemy {
    readonly definition: ShooterWaveEntry;
    readonly shape: Phaser.GameObjects.Triangle;
    health: number;
}

interface ActiveBullet {
    readonly shape: Phaser.GameObjects.Rectangle;
}

const VIEW_SIZE = 672;
const PLAYER_Y = 584;

function shooterGrade(progress: ShooterProgress): PerformanceGrade {
    if (progress.hull === 3 && progress.escapedEnemies === 0) return 's';
    if (progress.hull >= 2 && progress.escapedEnemies <= 1) return 'a';
    if (progress.hull >= 1) return 'b';
    return 'c';
}

function nearestLane(x: number): ShooterLane {
    let bestLane: ShooterLane = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let lane = 0; lane < SHOOTER_LANE_X.length; lane++) {
        const distance = Math.abs(SHOOTER_LANE_X[lane]! - x);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        bestLane = lane as ShooterLane;
    }
    return bestLane;
}

export class ShooterScene extends Phaser.Scene {
    private launchData!: ShooterLaunchData;
    private mission!: ShooterMission;
    private progress!: ShooterProgress;
    private player!: Phaser.GameObjects.Triangle;
    private shieldRing!: Phaser.GameObjects.Arc;
    private statusText!: Phaser.GameObjects.Text;
    private nextWaveText!: Phaser.GameObjects.Text;
    private activeEnemies: ActiveEnemy[] = [];
    private activeBullets: ActiveBullet[] = [];
    private playerLane: ShooterLane = 2;
    private nextWaveIndex = 0;
    private missionElapsedMs = 0;
    private startedAt = 0;
    private lastFiredAt = Number.NEGATIVE_INFINITY;
    private finishing = false;
    private autoFire = false;

    constructor() {
        super({key: SHOOTER_SCENE_KEY});
    }

    create(data: ShooterLaunchData): void {
        this.launchData = data;
        this.mission = createShooterMission(new Mulberry32Random(data.context.seed), {
            powerRouting: data.context.campaignSnapshot.worldSystems.powerRouting,
            archiveIntel: data.context.campaignSnapshot.flags.includes('archive-lock-opened'),
            securityAlert: data.context.campaignSnapshot.worldSystems.securityAlert
        });
        this.progress = createShooterProgress(this.mission);
        this.playerLane = 2;
        this.nextWaveIndex = 0;
        this.missionElapsedMs = 0;
        this.activeEnemies = [];
        this.activeBullets = [];
        this.startedAt = this.time.now;
        this.lastFiredAt = Number.NEGATIVE_INFINITY;
        this.finishing = false;
        this.autoFire = data.context.campaignSnapshot.flags.includes('archive-lock-opened');

        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, 0x080d15).setOrigin(0);
        this.drawStarfield(data.context.seed);
        this.add.rectangle(VIEW_SIZE / 2, 52, VIEW_SIZE, 104, 0x111a24, 0.94);
        this.add.text(24, 18, 'ORBITAL SERVICE ROAD', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        });
        this.add.text(24, 52, 'Traffic control ended with civilization. The hold music survived.', {
            color: '#b6b09f',
            fontFamily: 'Georgia, serif',
            fontSize: '15px'
        });
        this.statusText = this.add.text(24, 78, '', {
            color: '#67d5e8',
            fontFamily: 'Georgia, serif',
            fontSize: '17px'
        });
        this.nextWaveText = this.add.text(486, 20, '', {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            align: 'right'
        });

        for (const laneX of SHOOTER_LANE_X) {
            this.add.rectangle(laneX, 370, 2, 500, 0x263647, 0.4);
        }
        this.player = this.add.triangle(
            SHOOTER_LANE_X[this.playerLane]!,
            PLAYER_Y,
            0,
            34,
            20,
            0,
            40,
            34,
            0x67d5e8
        ).setStrokeStyle(2, 0xf5f0df);
        this.shieldRing = this.add.circle(
            SHOOTER_LANE_X[this.playerLane]!,
            PLAYER_Y + 10,
            31,
            0x67d5e8,
            0
        ).setStrokeStyle(3, 0x67d5e8, 0.8);

        const closeButton = this.add.circle(630, 62, 20, 0x263647)
            .setStrokeStyle(2, 0x676b60)
            .setInteractive({useHandCursor: true});
        this.add.text(630, 61, 'X', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '18px'
        }).setOrigin(0.5);
        closeButton.on('pointerdown', () => this.finish('abandoned'));

        const fireButton = this.add.circle(604, 590, 42, 0x633b38, 0.94)
            .setStrokeStyle(3, 0xefc75e)
            .setInteractive({useHandCursor: true});
        this.add.text(604, 590, 'FIRE', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '16px'
        }).setOrigin(0.5);
        fireButton.on('pointerdown', () => this.fire());

        this.input.on('pointerdown', this.handlePointer, this);
        this.input.on('pointermove', this.handlePointer, this);
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.off('pointerdown', this.handlePointer, this);
            this.input.off('pointermove', this.handlePointer, this);
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            delete this.game.canvas.dataset.shooterKills;
            delete this.game.canvas.dataset.shooterTarget;
            delete this.game.canvas.dataset.shooterNextLane;
            delete this.game.canvas.dataset.shooterWaveIndex;
        });
        this.updateHud();
    }

    override update(_time: number, delta: number): void {
        if (this.finishing) return;
        const frameMs = Math.min(32, Math.max(0, delta));
        this.missionElapsedMs += frameMs;
        const elapsed = this.missionElapsedMs;
        while (
            this.nextWaveIndex < this.mission.waves.length &&
            elapsed >= this.mission.waves[this.nextWaveIndex]!.spawnAtMs
        ) {
            this.spawnEnemy(this.mission.waves[this.nextWaveIndex]!);
            this.nextWaveIndex++;
            this.updateHud();
        }
        if (this.autoFire && this.missionElapsedMs - this.lastFiredAt >= 220) this.fire();

        const seconds = frameMs / 1000;
        for (const bullet of this.activeBullets) bullet.shape.y -= 500 * seconds;
        for (const enemy of this.activeEnemies) enemy.shape.y += enemy.definition.speed * seconds;
        this.resolveBulletHits();
        this.resolveEscapesAndContacts();
        this.activeBullets = this.activeBullets.filter(bullet => {
            if (bullet.shape.y >= 96 && bullet.shape.active) return true;
            bullet.shape.destroy();
            return false;
        });
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            this.finish('abandoned');
            event.preventDefault();
            return;
        }
        if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
            this.setPlayerLane(Math.max(0, this.playerLane - 1) as ShooterLane);
        } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
            this.setPlayerLane(Math.min(4, this.playerLane + 1) as ShooterLane);
        } else if (event.key === ' ' || event.key === 'Enter') {
            this.fire();
        } else {
            return;
        }
        event.preventDefault();
    };

    private readonly handlePointer = (pointer: Phaser.Input.Pointer): void => {
        if (!pointer.isDown || pointer.y < 120 || pointer.x > 570 && pointer.y > 540) return;
        this.setPlayerLane(nearestLane(pointer.x));
    };

    private drawStarfield(seed: number): void {
        const random = new Mulberry32Random(seed ^ 0x53544152);
        for (let index = 0; index < 80; index++) {
            this.add.circle(
                random.next() * VIEW_SIZE,
                105 + random.next() * (VIEW_SIZE - 105),
                1 + random.next() * 1.5,
                index % 7 === 0 ? 0xefc75e : 0xb9ded8,
                0.35 + random.next() * 0.55
            );
        }
    }

    private setPlayerLane(lane: ShooterLane): void {
        this.playerLane = lane;
        const x = SHOOTER_LANE_X[lane]!;
        this.player.x = x;
        this.shieldRing.x = x;
        this.game.canvas.dataset.shooterPlayerLane = String(lane);
    }

    private fire(): void {
        if (this.finishing || this.missionElapsedMs - this.lastFiredAt < 140) return;
        this.lastFiredAt = this.missionElapsedMs;
        this.activeBullets.push({
            shape: this.add.rectangle(
                SHOOTER_LANE_X[this.playerLane]!,
                PLAYER_Y - 30,
                6,
                20,
                0xefc75e
            )
        });
    }

    private spawnEnemy(definition: ShooterWaveEntry): void {
        const x = SHOOTER_LANE_X[definition.lane]!;
        const shape = this.add.triangle(x, 116, 0, 0, 38, 0, 19, 32, 0xef5b24)
            .setStrokeStyle(definition.health > 1 ? 3 : 1, 0xf5f0df);
        this.activeEnemies.push({definition, shape, health: definition.health});
    }

    private resolveBulletHits(): void {
        for (let bulletIndex = this.activeBullets.length - 1; bulletIndex >= 0; bulletIndex--) {
            const bullet = this.activeBullets[bulletIndex]!;
            if (!bullet.shape.active) continue;
            const enemyIndex = this.activeEnemies.findIndex(enemy =>
                Math.abs(enemy.shape.x - bullet.shape.x) < 24 &&
                Math.abs(enemy.shape.y - bullet.shape.y) < 25
            );
            if (enemyIndex < 0) continue;

            const enemy = this.activeEnemies[enemyIndex]!;
            bullet.shape.destroy();
            this.activeBullets.splice(bulletIndex, 1);
            enemy.health--;
            if (enemy.health > 0) continue;
            enemy.shape.destroy();
            this.activeEnemies.splice(enemyIndex, 1);
            this.progress = recordShooterKill(this.progress, enemy.definition);
            this.updateHud();
            if (hasWonShooterMission(this.mission, this.progress)) {
                this.finishing = true;
                this.statusText.setText('CORRIDOR CLEAR - THE STARS REMEMBER YOUR HIGH SCORE');
                this.time.delayedCall(500, () => this.finish('success'));
                return;
            }
        }
    }

    private resolveEscapesAndContacts(): void {
        for (let index = this.activeEnemies.length - 1; index >= 0; index--) {
            const enemy = this.activeEnemies[index]!;
            const collided = enemy.shape.y > PLAYER_Y - 28 && enemy.definition.lane === this.playerLane;
            const escaped = enemy.shape.y > VIEW_SIZE + 20;
            if (!collided && !escaped) continue;

            enemy.shape.destroy();
            this.activeEnemies.splice(index, 1);
            this.progress = escaped
                ? recordEnemyEscape(this.progress)
                : recordShooterHit(this.progress);
            this.updateHud();
            if (this.progress.hull === 0) {
                this.finishing = true;
                this.statusText.setText('SHIP LOST - EMERGENCY POD FOUND A VERY SMALL PARKING SPACE');
                this.time.delayedCall(500, () => this.finish('failure'));
                return;
            }
        }
    }

    private updateHud(): void {
        this.statusText.setText(
            `Kills ${this.progress.kills}/${this.mission.targetKills}  ` +
            `Hull ${this.progress.hull}  Shield ${this.progress.shield}  Score ${this.progress.score}`
        );
        const nextWave = this.mission.waves[this.nextWaveIndex];
        this.nextWaveText.setText(nextWave ? `NEXT LANE ${nextWave.lane + 1}` : 'FINAL WAVE');
        this.shieldRing.setVisible(this.progress.shield > 0);
        this.game.canvas.dataset.shooterKills = String(this.progress.kills);
        this.game.canvas.dataset.shooterTarget = String(this.mission.targetKills);
        this.game.canvas.dataset.shooterNextLane = nextWave ? String(nextWave.lane) : '';
        this.game.canvas.dataset.shooterWaveIndex = String(this.nextWaveIndex);
        this.game.canvas.dataset.shooterPlayerLane = String(this.playerLane);
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (status === 'abandoned' && this.finishing) return;
        this.finishing = true;
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const effects: OutcomeEffect[] = status === 'success'
            ? [
                {kind: 'change-resource', resource: 'scrap', delta: 5},
                {kind: 'adjust-world-system', system: 'airspaceControl', delta: 20},
                {kind: 'adjust-world-system', system: 'securityAlert', delta: -5},
                {kind: 'set-flag', flag: 'orbital-corridor-cleared'},
                {
                    kind: 'set-trigger-state',
                    triggerId: this.launchData.context.trigger.triggerId,
                    state: 'resolved'
                }
            ]
            : [
                {kind: 'change-resource', resource: 'health', delta: -2},
                {kind: 'adjust-world-system', system: 'airspaceControl', delta: -10},
                {kind: 'set-flag', flag: 'raider-patrol-alerted'}
            ];
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'shooter',
            status,
            grade: status === 'success' ? shooterGrade(this.progress) : 'none',
            score: this.progress.score,
            elapsedMs: Math.max(0, this.time.now - this.startedAt),
            effects
        };
    }
}