import Phaser from 'phaser';

import {getControlDeck} from '../../app/control-deck-host';
import {PLATFORMER_CONTROL_SCHEME, type ControlEvent} from '../../app/control-scheme';
import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult, OutcomeEffect} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    advancePlatformer,
    createGeneratedPlatformerLevel,
    createPlatformerState,
    platformerGrade,
    platformerOutcome,
    platformerScore,
    PLATFORMER_PLAYER_SIZE,
    runtimePlatformRect,
    setPlatformerPaused,
    type PlatformerCollectible,
    type PlatformerCollectibleKind,
    type PlatformerEvent,
    type PlatformerInput,
    type PlatformerLevel,
    type PlatformerState,
    type PlatformerSurfaceKind
} from './platformer-model';

export const PLATFORMER_SCENE_KEY = 'platformer';

export interface PlatformerLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

const VIEW_SIZE = 672;
const HUD_HEIGHT = 104;

const COLORS = Object.freeze({
    background: 0x111714,
    skyline: 0x222b29,
    panel: 0x0f110e,
    panelBorder: 0x676b60,
    paper: 0xf5f0df,
    accent: 0xefc75e,
    cyan: 0x67d5e8,
    danger: 0xef6f6c,
    warning: 0xef8d6b,
    normal: 0x4b5551,
    ice: 0x7bbcd0,
    conveyor: 0x7f8d88,
    crumbling: 0xb7925c,
    bounce: 0x9c78c8,
    lift: 0xc48c51,
    enemy: 0xdc725f,
    enemyArmored: 0xa5adb0
});

function surfaceColor(surface: PlatformerSurfaceKind): number {
    switch (surface) {
        case 'normal':
            return COLORS.normal;
        case 'ice':
            return COLORS.ice;
        case 'conveyor':
            return COLORS.conveyor;
        case 'crumbling':
            return COLORS.crumbling;
        case 'bounce':
            return COLORS.bounce;
        case 'lift':
            return COLORS.lift;
    }
}

/** Short, readable names for every pickup the level can place. */
const COLLECTIBLE_LABELS: Readonly<Record<PlatformerCollectibleKind, string>> = Object.freeze({
    core: 'POWER CORE',
    salvage: 'SALVAGE',
    'pulse-blaster': 'BLASTER',
    ammo: 'AMMO',
    shield: 'SHIELD',
    emp: 'EMP'
});

function eventMessage(event: PlatformerEvent): string {
    switch (event.kind) {
        case 'jump':
            return '';
        case 'dropped-through':
            return 'DROPPED THROUGH — HOLD DOWN ON A RAISED PLATFORM';
        case 'shot-fired':
            return '';
        case 'empty-weapon':
            return 'BLASTER EMPTY — CHECKPOINTS RESTORE SIX CHARGES';
        case 'core-collected':
            return event.remaining === 0
                ? 'ALL CORES ONLINE — EXIT UNLOCKED'
                : `CORE SECURED — ${event.remaining} REMAIN`;
        case 'salvage-collected':
            return 'OPTIONAL SALVAGE BANKED FOR SUCCESS';
        case 'weapon-collected':
            return 'PULSE BLASTER ACQUIRED — F / J / X / FIRE';
        case 'ammo-collected':
            return 'BLASTER REFILLED';
        case 'emp-triggered':
            return 'EMP BURST — LIGHT HOSTILES ERASED';
        case 'shield-collected':
            return 'TEMPORARY SHIELD — TEN SECONDS OR ONE HIT';
        case 'enemy-defeated':
            return 'HOSTILE DISABLED';
        case 'player-hit':
            return 'HIT — INVULNERABILITY WINDOW ACTIVE';
        case 'shield-absorbed':
            return 'SHIELD ABSORBED THE HIT';
        case 'checkpoint':
            return 'CHECKPOINT ACTIVE — AMMO MINIMUM RESTORED';
        case 'respawn':
            return `RESPAWN ${event.deaths} — CORES AND DEFEATED ENEMIES KEPT`;
        case 'exit-locked':
            return `EXIT LOCKED — ${event.missing} CORE${event.missing === 1 ? '' : 'S'} MISSING`;
        case 'success':
            return 'SUBLEVEL STABLE — ELEVATOR RELEASED';
        case 'failure':
            return 'REPAIR LIMIT REACHED';
    }
}

export class PlatformerScene extends Phaser.Scene {
    private launchData!: PlatformerLaunchData;
    private level!: PlatformerLevel;
    private state!: PlatformerState;
    private worldGraphics!: Phaser.GameObjects.Graphics;
    private cameraTarget!: Phaser.GameObjects.Rectangle;
    private statsText!: Phaser.GameObjects.Text;
    private messageText!: Phaser.GameObjects.Text;
    private coreIndicatorText!: Phaser.GameObjects.Text;
    private keyboardLeft = false;
    private keyboardRight = false;
    private keyboardJump = false;
    private keyboardFire = false;
    private jumpPressed = false;
    private firePressed = false;
    private readonly collectibleLabels = new Map<string, Phaser.GameObjects.Text>();
    private keyboardDown = false;
    private deckLeft = false;
    private deckRight = false;
    private deckDown = false;
    private deckJump = false;
    private deckFire = false;
    private pauseOpen = false;
    private pauseObjects: Phaser.GameObjects.GameObject[] = [];
    private finishing = false;
    private reducedMotion = false;

    constructor() {
        super({key: PLATFORMER_SCENE_KEY});
    }

    create(data: PlatformerLaunchData): void {
        this.launchData = data;
        const rawTier = data.context.modifiers['levelTier'];
        const levelTier = typeof rawTier === 'number' && Number.isSafeInteger(rawTier)
            ? rawTier
            : 0;
        this.level = createGeneratedPlatformerLevel(
            new Mulberry32Random(data.context.seed),
            {
                difficulty: data.context.difficulty,
                levelTier,
                modifiers: {
                    powerRouting: data.context.campaignSnapshot.worldSystems.powerRouting,
                    miningPower: data.context.campaignSnapshot.player.miningPower,
                    airspaceControl: data.context.campaignSnapshot.worldSystems.airspaceControl
                }
            }
        );
        const createdState = createPlatformerState(this.level);
        const shieldBonusMs = Math.max(
            0,
            getEncounterNumberModifier(data.context, 'platformerShieldBonusMs')
        );
        const ammoBonus = Math.max(
            0,
            Math.floor(getEncounterNumberModifier(data.context, 'platformerAmmoBonus'))
        );
        this.state = {
            ...createdState,
            shieldMs: shieldBonusMs,
            weaponOwned: createdState.weaponOwned || ammoBonus > 0,
            ammo: createdState.ammo + ammoBonus
        };
        this.keyboardLeft = false;
        this.keyboardRight = false;
        this.keyboardJump = false;
        this.keyboardFire = false;
        this.jumpPressed = false;
        this.firePressed = false;
        this.keyboardDown = false;
        this.deckLeft = false;
        this.deckRight = false;
        this.deckDown = false;
        this.deckJump = false;
        this.deckFire = false;
        this.pauseOpen = false;
        this.pauseObjects = [];
        this.finishing = false;
        this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

        this.cameras.main.setBackgroundColor(COLORS.background);
        this.drawBackdrop();
        this.worldGraphics = this.add.graphics().setDepth(10);
        this.cameraTarget = this.add.rectangle(
            this.state.x,
            this.state.y,
            PLATFORMER_PLAYER_SIZE.width,
            PLATFORMER_PLAYER_SIZE.height,
            0xffffff,
            0
        ).setOrigin(0);
        this.cameras.main.setBounds(0, 0, this.level.width, this.level.height);
        this.cameras.main.startFollow(this.cameraTarget, true, 0.13, 0.1, -165, 0);
        this.cameras.main.setRoundPixels(true);

        this.collectibleLabels.clear();
        this.createCollectibleLabels();
        this.createHud();
        this.bindInput();
        this.syncPresentation();
    }

    override update(_time: number, delta: number): void {
        if (this.finishing) return;
        const left = this.keyboardLeft || this.deckLeft;
        const right = this.keyboardRight || this.deckRight;
        const horizontal: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1;
        const input: PlatformerInput = {
            horizontal,
            jumpPressed: this.jumpPressed,
            jumpHeld: this.keyboardJump || this.deckJump,
            firePressed: this.firePressed,
            dropPressed: this.keyboardDown || this.deckDown
        };
        this.jumpPressed = false;
        this.firePressed = false;
        const result = advancePlatformer(this.state, input, this.level, delta);
        this.state = result.state;
        this.handleEvents(result.events);
        this.syncPresentation();

        if (this.state.status === 'failure') {
            this.finish('failure');
        } else if (this.state.status === 'success') {
            this.finish('success');
        }
    }

    private createHud(): void {
        this.add.rectangle(0, 0, VIEW_SIZE, HUD_HEIGHT, COLORS.panel, 0.94)
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(100);
        this.add.text(18, 12, 'SUBLEVEL 9 // POWER-CORE RECOVERY', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '21px'
        }).setScrollFactor(0).setDepth(101);
        const itemBonus = getEncounterItemBonusLabel(this.launchData.context);
        if (itemBonus) {
            this.add.text(350, 15, `ITEM BONUS · ${itemBonus}`, {
                color: '#72efb1',
                fontFamily: 'monospace',
                fontSize: '9px',
                align: 'right',
                wordWrap: {width: 245}
            }).setScrollFactor(0).setDepth(101);
        }
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';
        this.statsText = this.add.text(18, 43, '', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '15px'
        }).setScrollFactor(0).setDepth(101);
        this.coreIndicatorText = this.add.text(18, 70, '', {
            color: '#67d5e8',
            fontFamily: 'Georgia, serif',
            fontSize: '13px'
        }).setScrollFactor(0).setDepth(101);
        this.messageText = this.add.text(250, 69, 'FIND EVERY CORE — HOLD DOWN TO DROP THROUGH A LEDGE', {
            color: '#dce8a5',
            fontFamily: 'Georgia, serif',
            fontSize: '13px',
            wordWrap: {width: 350}
        }).setScrollFactor(0).setDepth(101);

        const closeButton = this.add.circle(634, 35, 23, 0x2f3430)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setScrollFactor(0)
            .setDepth(102)
            .setInteractive({useHandCursor: true});
        this.add.text(634, 34, '×', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '26px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(103);
        closeButton.on('pointerdown', () => this.showPauseConfirmation());
    }

    private bindInput(): void {
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.input.keyboard?.on('keyup', this.handleKeyUp, this);
        getControlDeck(this)?.setScheme(PLATFORMER_CONTROL_SCHEME, this.handleControlEvent);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.input.keyboard?.off('keyup', this.handleKeyUp, this);
            getControlDeck(this)?.clearScheme(PLATFORMER_CONTROL_SCHEME.id);
            for (const key of [
                'platformerX',
                'platformerY',
                'platformerVelocityY',
                'platformerGrounded',
                'platformerDeaths',
                'platformerCollected',
                'platformerHealth',
                'platformerAmmo',
                'platformerStatus'
            ] as const) {
                delete this.game.canvas.dataset[key];
            }
            delete this.game.canvas.dataset.itemBonus;
        });
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            if (this.pauseOpen) this.hidePauseConfirmation();
            else this.showPauseConfirmation();
        } else if (!this.canInteract()) {
            return;
        } else if (key === 'arrowleft' || key === 'a') {
            this.keyboardLeft = true;
        } else if (key === 'arrowright' || key === 'd') {
            this.keyboardRight = true;
        } else if (key === 'arrowup' || key === 'w' || key === ' ') {
            if (!this.keyboardJump) this.jumpPressed = true;
            this.keyboardJump = true;
        } else if (key === 'arrowdown' || key === 's') {
            this.keyboardDown = true;
        } else if (key === 'f' || key === 'j' || key === 'x') {
            if (!this.keyboardFire) this.firePressed = true;
            this.keyboardFire = true;
        } else {
            return;
        }
        event.preventDefault();
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (key === 'arrowleft' || key === 'a') this.keyboardLeft = false;
        else if (key === 'arrowright' || key === 'd') this.keyboardRight = false;
        else if (key === 'arrowup' || key === 'w' || key === ' ') this.keyboardJump = false;
        else if (key === 'arrowdown' || key === 's') this.keyboardDown = false;
        else if (key === 'f' || key === 'j' || key === 'x') this.keyboardFire = false;
        else return;
        event.preventDefault();
    };

    private canInteract(): boolean {
        return !this.finishing && !this.pauseOpen && this.state.status === 'active';
    }

    private drawBackdrop(): void {
        this.add.rectangle(0, 0, this.level.width, this.level.height, 0x18231e)
            .setOrigin(0);
        for (let x = 0; x < this.level.width; x += 180) {
            const buildingHeight = 90 + ((x * 17) % 230);
            this.add.rectangle(x + 18, 570 - buildingHeight, 124, buildingHeight, COLORS.skyline)
                .setOrigin(0);
            for (let windowY = 590 - buildingHeight; windowY < 540; windowY += 42) {
                this.add.rectangle(x + 42, windowY, 17, 10, COLORS.accent, 0.18).setOrigin(0);
                this.add.rectangle(x + 92, windowY + 18, 17, 10, COLORS.cyan, 0.14).setOrigin(0);
            }
        }
    }

    /**
     * Movement, Jump, and Fire come from the shared control deck, so the
     * playfield keeps no in-canvas thumb buttons of its own.
     */
    private readonly handleControlEvent = (event: ControlEvent): void => {
        if (!this.canInteract()) {
            this.deckLeft = false;
            this.deckRight = false;
            this.deckDown = false;
            this.deckJump = false;
            this.deckFire = false;
            return;
        }
        if (event.kind === 'direction') {
            const held = event.phase === 'press';
            if (event.direction === 'left') this.deckLeft = held;
            if (event.direction === 'right') this.deckRight = held;
            if (event.direction === 'down') this.deckDown = held;
            return;
        }
        if (event.kind !== 'button') return;
        if (event.id === 'jump') {
            if (event.phase === 'press' && !this.deckJump) this.jumpPressed = true;
            this.deckJump = event.phase === 'press';
            return;
        }
        if (event.id === 'fire') {
            if (event.phase === 'press' && !this.deckFire) this.firePressed = true;
            this.deckFire = event.phase === 'press';
        }
    };

    private handleEvents(events: readonly PlatformerEvent[]): void {
        for (const event of events) {
            const message = eventMessage(event);
            if (message !== '') {
                this.messageText
                    .setText(message)
                    .setColor(
                        event.kind === 'player-hit' || event.kind === 'failure'
                            ? '#ef8d6b'
                            : event.kind === 'success' || event.kind === 'core-collected'
                                ? '#67d5e8'
                                : '#dce8a5'
                    );
            }
        }
    }

    private syncPresentation(): void {
        this.cameraTarget.setPosition(this.state.x, this.state.y);
        this.drawWorld();
        this.statsText.setText(
            `CORES ${this.state.collectedCoreIds.length}/${this.level.requiredCoreTotal}   ` +
            `HP ${'●'.repeat(this.state.health)}${'○'.repeat(Math.max(0, 3 - this.state.health))}   ` +
            `AMMO ${this.state.weaponOwned ? this.state.ammo : '—'}   ` +
            `DEATHS ${this.state.deaths}/${this.level.deathLimit}`
        );
        const nearest = this.nearestCore();
        if (!nearest) {
            this.coreIndicatorText.setText('CORE SIGNAL: COMPLETE');
        } else {
            const deltaX = nearest.x - this.state.x;
            this.coreIndicatorText.setText(
                `NEAREST CORE ${deltaX < 0 ? '◀' : '▶'} ${Math.round(Math.abs(deltaX))}m`
            );
        }
        const canvas = this.game.canvas;
        canvas.dataset.platformerX = String(Math.round(this.state.x));
        canvas.dataset.platformerY = String(Math.round(this.state.y));
        canvas.dataset.platformerVelocityY = String(Math.round(this.state.velocityY));
        canvas.dataset.platformerGrounded = String(this.state.grounded);
        canvas.dataset.platformerDeaths = String(this.state.deaths);
        canvas.dataset.platformerCollected = String(this.state.collectedCoreIds.length);
        canvas.dataset.platformerHealth = String(this.state.health);
        canvas.dataset.platformerAmmo = String(this.state.ammo);
        canvas.dataset.platformerStatus = this.state.status;
    }

    private nearestCore(): PlatformerCollectible | null {
        let nearest: PlatformerCollectible | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const item of this.level.collectibles) {
            if (item.kind !== 'core' || this.state.collectedCoreIds.includes(item.id)) continue;
            const distance = Math.abs(item.x - this.state.x);
            if (distance < nearestDistance) {
                nearest = item;
                nearestDistance = distance;
            }
        }
        return nearest;
    }

    private drawWorld(): void {
        const graphics = this.worldGraphics;
        graphics.clear();
        for (const platform of this.level.platforms) {
            const rect = runtimePlatformRect(this.state, platform);
            const dynamic = this.state.surfaceStates.find(surface =>
                surface.platformId === platform.id
            );
            if (platform.surfaceKind === 'crumbling' && (dynamic?.crumbleDisabledMs ?? 0) > 0) {
                continue;
            }
            // A crumbling floor shakes harder the closer it is to giving way, so
            // standing on one is a warning rather than a surprise.
            const contactMs = platform.surfaceKind === 'crumbling'
                ? (dynamic?.crumbleContactMs ?? 0)
                : 0;
            const shake = contactMs > 0 && !this.reducedMotion
                ? Math.sin(this.state.activeElapsedMs / 26) *
                    Math.min(3, 0.6 + contactMs / 220)
                : 0;
            const drawn = {...rect, x: rect.x + shake};
            graphics.fillStyle(surfaceColor(platform.surfaceKind))
                .fillRect(drawn.x, drawn.y, drawn.width, drawn.height);
            graphics.lineStyle(2, COLORS.paper, 0.35)
                .lineBetween(drawn.x, drawn.y, drawn.x + drawn.width, drawn.y);
            this.drawSurfaceCue(
                graphics,
                drawn,
                platform.surfaceKind,
                platform.conveyorVelocity,
                contactMs
            );
            if (platform.surfaceKind === 'lift') {
                graphics.lineStyle(2, COLORS.lift, 0.7)
                    .lineBetween(
                        rect.x + 8,
                        Math.min(platform.liftStartY, platform.liftEndY),
                        rect.x + 8,
                        Math.max(platform.liftStartY, platform.liftEndY) + rect.height
                    )
                    .lineBetween(
                        rect.x + rect.width - 8,
                        Math.min(platform.liftStartY, platform.liftEndY),
                        rect.x + rect.width - 8,
                        Math.max(platform.liftStartY, platform.liftEndY) + rect.height
                    );
            }
        }
        for (const hazard of this.level.hazards) {
            if (hazard.hazardKind === 'pit') continue;
            for (let x = hazard.x; x < hazard.x + hazard.width; x += 10) {
                graphics.fillStyle(COLORS.danger).fillTriangle(
                    x,
                    hazard.y + hazard.height,
                    x + 5,
                    hazard.y,
                    x + 10,
                    hazard.y + hazard.height
                );
            }
        }
        for (const checkpoint of this.level.checkpoints) {
            const active = this.state.activatedCheckpointIds.includes(checkpoint.id);
            graphics.fillStyle(active ? COLORS.cyan : COLORS.panelBorder, active ? 0.45 : 0.25)
                .fillRect(checkpoint.x, checkpoint.y, checkpoint.width, checkpoint.height);
            graphics.lineStyle(2, active ? COLORS.cyan : COLORS.panelBorder)
                .strokeRect(checkpoint.x, checkpoint.y, checkpoint.width, checkpoint.height);
            graphics.lineBetween(
                checkpoint.x + 8,
                checkpoint.y + 14,
                checkpoint.x + checkpoint.width - 8,
                checkpoint.y + 14
            );
        }
        this.drawCollectibles(graphics);
        this.syncCollectibleLabels();
        this.drawEnemies(graphics);
        for (const projectile of this.state.projectiles) {
            graphics.fillStyle(projectile.owner === 'player' ? COLORS.cyan : COLORS.danger)
                .fillRoundedRect(projectile.x - 6, projectile.y - 3, 12, 6, 3);
        }
        const exitUnlocked = this.state.collectedCoreIds.length === this.level.requiredCoreTotal;
        graphics.fillStyle(exitUnlocked ? 0x315e52 : 0x5e3434, 0.9)
            .fillRect(
                this.level.goal.x,
                this.level.goal.y,
                this.level.goal.width,
                this.level.goal.height
            );
        graphics.lineStyle(3, exitUnlocked ? COLORS.cyan : COLORS.danger)
            .strokeRect(
                this.level.goal.x,
                this.level.goal.y,
                this.level.goal.width,
                this.level.goal.height
            );
        graphics.fillStyle(exitUnlocked ? COLORS.cyan : COLORS.danger)
            .fillCircle(
                this.level.goal.x + this.level.goal.width / 2,
                this.level.goal.y + 27,
                8
            );
        this.drawPlayer(graphics);
    }

    private drawSurfaceCue(
        graphics: Phaser.GameObjects.Graphics,
        rect: {readonly x: number; readonly y: number; readonly width: number; readonly height: number},
        surface: PlatformerSurfaceKind,
        conveyorVelocity: number,
        crumbleContactMs = 0
    ): void {
        if (surface === 'ice') {
            // Sheen band, facet cracks, and hanging icicles: unmistakably ice
            // rather than a differently coloured floor.
            graphics.fillStyle(0xdff6ff, 0.5)
                .fillRect(rect.x + 2, rect.y + 2, rect.width - 4, 4);
            graphics.lineStyle(1, 0xffffff, 0.85);
            for (let x = rect.x + 8; x < rect.x + rect.width - 8; x += 22) {
                graphics.lineBetween(x, rect.y + 3, x + 10, rect.y + 11);
                graphics.lineBetween(x + 10, rect.y + 11, x + 4, rect.y + 16);
            }
            graphics.fillStyle(0xcdeeff, 0.9);
            for (let x = rect.x + 14; x < rect.x + rect.width - 10; x += 30) {
                graphics.fillTriangle(
                    x,
                    rect.y + rect.height,
                    x + 5,
                    rect.y + rect.height,
                    x + 2.5,
                    rect.y + rect.height + 8
                );
            }
        } else if (surface === 'conveyor') {
            const direction = conveyorVelocity < 0 ? -1 : 1;
            graphics.lineStyle(2, COLORS.accent, 0.8);
            for (let x = rect.x + 16; x < rect.x + rect.width - 12; x += 30) {
                graphics.lineBetween(x, rect.y + 9, x + direction * 9, rect.y + 9);
                graphics.lineBetween(
                    x + direction * 9,
                    rect.y + 9,
                    x + direction * 4,
                    rect.y + 4
                );
            }
        } else if (surface === 'crumbling') {
            graphics.lineStyle(2, 0x6f5438);
            for (let x = rect.x + 18; x < rect.x + rect.width; x += 34) {
                graphics.lineBetween(x, rect.y, x - 7, rect.y + 13);
                graphics.lineBetween(x - 7, rect.y + 13, x + 5, rect.y + 20);
            }
            if (crumbleContactMs > 0) {
                // Dust falls from the underside while the floor is failing.
                graphics.fillStyle(0xcbb894, 0.85);
                for (let x = rect.x + 10; x < rect.x + rect.width - 6; x += 18) {
                    const drift = (this.state.activeElapsedMs / 6 + x) % 16;
                    graphics.fillRect(x, rect.y + rect.height + drift, 2, 3);
                }
            }
        } else if (surface === 'bounce') {
            // Real coil springs under a bounce plate, with the plate on top.
            const coilTop = rect.y + 3;
            graphics.fillStyle(0x9aa2ad, 1)
                .fillRect(rect.x + 2, rect.y, rect.width - 4, 4);
            graphics.lineStyle(2, 0xd8dce4, 0.95);
            for (let x = rect.x + 12; x < rect.x + rect.width - 8; x += 26) {
                for (let coil = 0; coil < 3; coil++) {
                    const coilY = coilTop + 5 + coil * 5;
                    graphics.lineBetween(x, coilY, x + 12, coilY + 2.5);
                    graphics.lineBetween(x + 12, coilY + 2.5, x, coilY + 5);
                }
            }
        }
    }

    private drawCollectibles(graphics: Phaser.GameObjects.Graphics): void {
        for (const item of this.level.collectibles) {
            if (
                this.state.collectedCoreIds.includes(item.id) ||
                this.state.collectedSalvageIds.includes(item.id) ||
                this.state.collectedPickupIds.includes(item.id)
            ) continue;
            if (item.kind === 'core') {
                const pulse = this.reducedMotion
                    ? 10
                    : 10 + Math.sin(this.time.now / 180 + item.x) * 2;
                graphics.fillStyle(COLORS.accent).fillCircle(item.x, item.y, pulse);
                graphics.lineStyle(3, COLORS.paper)
                    .lineBetween(item.x - 6, item.y, item.x + 6, item.y)
                    .lineBetween(item.x, item.y - 6, item.x, item.y + 6);
            } else if (item.kind === 'salvage') {
                graphics.fillStyle(0xb7df79).fillTriangle(
                    item.x,
                    item.y - 10,
                    item.x + 10,
                    item.y,
                    item.x,
                    item.y + 10
                ).fillTriangle(
                    item.x,
                    item.y - 10,
                    item.x - 10,
                    item.y,
                    item.x,
                    item.y + 10
                );
            } else {
                const color = item.kind === 'shield' ? COLORS.cyan :
                    item.kind === 'emp' ? 0xb788d8 : COLORS.warning;
                graphics.fillStyle(color).fillRoundedRect(item.x - 12, item.y - 10, 24, 20, 5);
                if (item.kind === 'pulse-blaster') {
                    graphics.fillStyle(COLORS.paper).fillRect(item.x - 8, item.y - 3, 20, 6);
                } else if (item.kind === 'shield') {
                    graphics.lineStyle(2, COLORS.paper).strokeCircle(item.x, item.y, 7);
                } else if (item.kind === 'emp') {
                    graphics.lineStyle(2, COLORS.paper).strokeCircle(item.x, item.y, 8);
                    graphics.lineBetween(item.x - 10, item.y, item.x + 10, item.y);
                } else {
                    graphics.fillStyle(COLORS.paper).fillRect(item.x - 6, item.y - 6, 4, 12);
                    graphics.fillRect(item.x + 2, item.y - 6, 4, 12);
                }
            }
        }
    }

    /**
     * Static name tags over every pickup, created once. Shape and colour alone
     * never told the player what a collectible actually was.
     */
    private createCollectibleLabels(): void {
        for (const item of this.level.collectibles) {
            const label = this.add.text(item.x, item.y - 24, COLLECTIBLE_LABELS[item.kind], {
                color: '#f5f0df',
                backgroundColor: 'rgba(16,22,26,0.74)',
                fontFamily: 'Georgia, serif',
                fontSize: '11px',
                padding: {x: 3, y: 1}
            }).setOrigin(0.5).setDepth(11);
            this.collectibleLabels.set(item.id, label);
        }
    }

    private syncCollectibleLabels(): void {
        for (const item of this.level.collectibles) {
            const label = this.collectibleLabels.get(item.id);
            if (!label) continue;
            const taken = this.state.collectedCoreIds.includes(item.id) ||
                this.state.collectedSalvageIds.includes(item.id) ||
                this.state.collectedPickupIds.includes(item.id);
            label.setVisible(!taken);
        }
    }

    /**
     * Each hostile reads as a creature rather than a coloured block: legs that
     * walk, wings that beat, a coiled jumper, and shelled emplacements.
     */
    private drawEnemies(graphics: Phaser.GameObjects.Graphics): void {
        const clock = this.reducedMotion ? 0 : this.state.activeElapsedMs;
        for (const enemy of this.state.enemies) {
            if (enemy.health <= 0) continue;
            const color = enemy.kind === 'sentry' ? COLORS.enemyArmored : COLORS.enemy;
            const dark = 0x2a1f2c;
            if (enemy.kind === 'drone') {
                // Beating wings above a bulbous body with a stinger tail.
                const beat = Math.sin(clock / 55) * 6;
                graphics.fillStyle(0xd6e6ff, 0.55);
                graphics.fillTriangle(
                    enemy.x - 4, enemy.y - 6,
                    enemy.x - 22, enemy.y - 12 - beat,
                    enemy.x - 6, enemy.y + 1
                );
                graphics.fillTriangle(
                    enemy.x + 4, enemy.y - 6,
                    enemy.x + 22, enemy.y - 12 + beat,
                    enemy.x + 6, enemy.y + 1
                );
                graphics.fillStyle(color).fillEllipse(enemy.x, enemy.y - 2, 24, 17);
                graphics.fillStyle(dark);
                graphics.fillTriangle(
                    enemy.x - enemy.facing * 12, enemy.y - 1,
                    enemy.x - enemy.facing * 22, enemy.y + 6,
                    enemy.x - enemy.facing * 11, enemy.y + 4
                );
                graphics.fillStyle(color).fillCircle(enemy.x + enemy.facing * 9, enemy.y - 6, 7);
            } else if (enemy.kind === 'turret' || enemy.kind === 'sentry') {
                // A shelled crawler dug in on its legs, snout tracking the room.
                graphics.fillStyle(dark);
                for (const offset of [-10, -3, 4, 11]) {
                    graphics.fillRect(enemy.x + offset, enemy.y - 6, 3, 8);
                }
                graphics.fillStyle(color).fillEllipse(enemy.x, enemy.y - 13, 32, 22);
                graphics.fillStyle(dark, 0.35);
                graphics.fillEllipse(enemy.x, enemy.y - 16, 22, 11);
                graphics.lineStyle(6, color).lineBetween(
                    enemy.x,
                    enemy.y - 15,
                    enemy.x + enemy.facing * 24,
                    enemy.y - 15
                );
                graphics.fillStyle(dark)
                    .fillCircle(enemy.x + enemy.facing * 24, enemy.y - 15, 4);
            } else {
                const crouch = enemy.mode === 'crouch' ? 8 : 0;
                const step = Math.sin(clock / 130) * 5;
                graphics.lineStyle(3, dark, 1);
                if (enemy.kind === 'hopper') {
                    // Coiled haunches, tucked when crouching to spring.
                    graphics.lineBetween(
                        enemy.x - 8, enemy.y - 6,
                        enemy.x - 13, enemy.y - (crouch > 0 ? 2 : 0)
                    );
                    graphics.lineBetween(
                        enemy.x - 13, enemy.y - (crouch > 0 ? 2 : 0),
                        enemy.x - 9, enemy.y
                    );
                    graphics.lineBetween(
                        enemy.x + 8, enemy.y - 6,
                        enemy.x + 13, enemy.y - (crouch > 0 ? 2 : 0)
                    );
                    graphics.lineBetween(
                        enemy.x + 13, enemy.y - (crouch > 0 ? 2 : 0),
                        enemy.x + 9, enemy.y
                    );
                } else {
                    graphics.lineBetween(enemy.x - 7, enemy.y - 6, enemy.x - 7 - step, enemy.y);
                    graphics.lineBetween(enemy.x + 7, enemy.y - 6, enemy.x + 7 + step, enemy.y);
                }
                graphics.fillStyle(color).fillEllipse(
                    enemy.x,
                    enemy.y - 16 + crouch / 2,
                    28,
                    24 - crouch
                );
                // Head, snout, and a pair of spines along the back.
                graphics.fillCircle(enemy.x + enemy.facing * 10, enemy.y - 24 + crouch, 8);
                graphics.fillStyle(dark);
                graphics.fillTriangle(
                    enemy.x + enemy.facing * 15, enemy.y - 25 + crouch,
                    enemy.x + enemy.facing * 22, enemy.y - 22 + crouch,
                    enemy.x + enemy.facing * 15, enemy.y - 20 + crouch
                );
                graphics.fillStyle(color);
                for (const spine of [-9, -2, 5]) {
                    graphics.fillTriangle(
                        enemy.x + spine, enemy.y - 26 + crouch,
                        enemy.x + spine + 3, enemy.y - 33 + crouch,
                        enemy.x + spine + 6, enemy.y - 26 + crouch
                    );
                }
            }
            const eyeY = enemy.kind === 'drone'
                ? enemy.y - 7
                : enemy.kind === 'turret' || enemy.kind === 'sentry'
                    ? enemy.y - 17
                    : enemy.y - 25 + (enemy.mode === 'crouch' ? 8 : 0);
            graphics.fillStyle(COLORS.accent).fillCircle(
                enemy.x + enemy.facing * (enemy.kind === 'patroller' ? 12 : 8),
                eyeY,
                3
            );
            if (enemy.mode === 'aim') {
                graphics.lineStyle(2, COLORS.danger, 0.65)
                    .lineBetween(enemy.x, enemy.y - 15, this.state.x + 14, this.state.y + 18);
            } else if (enemy.mode === 'warn' || enemy.mode === 'crouch') {
                graphics.lineStyle(2, COLORS.warning).strokeCircle(enemy.x, enemy.y - 18, 24);
            } else if (enemy.mode === 'stunned') {
                graphics.lineStyle(2, COLORS.cyan).strokeCircle(enemy.x, enemy.y - 16, 22);
            }
        }
    }

    private drawPlayer(graphics: Phaser.GameObjects.Graphics): void {
        if (
            !this.reducedMotion &&
            this.state.invulnerableMs > 0 &&
            Math.floor(this.state.invulnerableMs / 80) % 2 === 0
        ) return;
        const x = this.state.x;
        const y = this.state.y;
        const bodyColor = this.state.invulnerableMs > 0 ? COLORS.warning : COLORS.cyan;
        graphics.fillStyle(bodyColor).fillRoundedRect(x + 5, y + 12, 18, 24, 5);
        graphics.fillStyle(COLORS.paper).fillCircle(x + 14, y + 7, 7);
        const stride = !this.reducedMotion &&
            this.state.grounded &&
            Math.abs(this.state.velocityX) > 20
            ? Math.sin(this.time.now / 75) * 5
            : 0;
        graphics.lineStyle(4, bodyColor)
            .lineBetween(x + 10, y + 35, x + 8 - stride, y + 40)
            .lineBetween(x + 18, y + 35, x + 20 + stride, y + 40);
        if (this.state.weaponOwned) {
            graphics.lineStyle(5, COLORS.accent).lineBetween(
                x + 14,
                y + 20,
                x + 14 + this.state.facing * 20,
                y + 20
            );
        }
        if (this.state.shieldMs > 0) {
            graphics.lineStyle(2, COLORS.cyan, 0.75)
                .strokeCircle(x + 14, y + 20, 25);
        }
    }

    private showPauseConfirmation(): void {
        if (this.pauseOpen || this.finishing) return;
        this.pauseOpen = true;
        this.clearHeldInput();
        this.state = setPlatformerPaused(this.state, true);
        const depth = 150;
        const shade = this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, 0x080908, 0.78)
            .setOrigin(0)
            .setScrollFactor(0)
            .setDepth(depth)
            .setInteractive();
        const panel = this.add.rectangle(336, 336, 442, 230, 0x20231f)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setScrollFactor(0)
            .setDepth(depth + 1);
        const title = this.add.text(336, 270, 'SUBLEVEL PAUSED', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2);
        const copy = this.add.text(336, 313, 'Cores, defeated enemies, and the alarm clock are frozen.', {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '15px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2);
        this.pauseObjects = [shade, panel, title, copy];
        this.pauseObjects.push(
            ...this.createOverlayButton(258, 384, 126, 'RESUME', () => {
                this.hidePauseConfirmation();
            }, depth + 2),
            ...this.createOverlayButton(423, 384, 160, 'RETURN TO MAZE', () => {
                this.finish('abandoned');
            }, depth + 2)
        );
    }

    private hidePauseConfirmation(): void {
        if (!this.pauseOpen) return;
        for (const object of this.pauseObjects) object.destroy();
        this.pauseObjects = [];
        this.pauseOpen = false;
        this.state = setPlatformerPaused(this.state, false);
    }

    private createOverlayButton(
        x: number,
        y: number,
        width: number,
        label: string,
        action: () => void,
        depth: number
    ): readonly Phaser.GameObjects.GameObject[] {
        const button = this.add.rectangle(x, y, width, 46, 0x343934)
            .setStrokeStyle(2, COLORS.panelBorder)
            .setScrollFactor(0)
            .setDepth(depth)
            .setInteractive({useHandCursor: true});
        const text = this.add.text(x, y, label, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '13px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 1);
        button.on('pointerdown', action);
        return [button, text];
    }

    private clearHeldInput(): void {
        this.keyboardLeft = false;
        this.keyboardRight = false;
        this.keyboardJump = false;
        this.keyboardFire = false;
        this.jumpPressed = false;
        this.firePressed = false;
        this.keyboardDown = false;
        this.deckLeft = false;
        this.deckRight = false;
        this.deckDown = false;
        this.deckJump = false;
        this.deckFire = false;
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (this.finishing) return;
        this.finishing = true;
        this.launchData.onComplete(this.createResult(status));
        this.scene.stop();
    }

    private createResult(status: 'success' | 'failure' | 'abandoned'): EncounterResult {
        const outcome = platformerOutcome(status, this.state);
        let effects: OutcomeEffect[];
        if (status === 'success') {
            effects = [
                {kind: 'change-resource', resource: 'scrap', delta: outcome.scrapDelta},
                {kind: 'change-resource', resource: 'health', delta: outcome.campaignHealthDelta},
                {
                    kind: 'adjust-world-system',
                    system: 'structuralStability',
                    delta: outcome.structuralStabilityDelta
                },
                ...outcome.flags.map((flag): OutcomeEffect => ({kind: 'set-flag', flag}))
            ];
        } else {
            effects = [
                {
                    kind: 'change-resource',
                    resource: 'health',
                    delta: outcome.campaignHealthDelta
                },
                {
                    kind: 'adjust-world-system',
                    system: 'structuralStability',
                    delta: outcome.structuralStabilityDelta
                },
                ...outcome.flags.map((flag): OutcomeEffect => ({kind: 'set-flag', flag}))
            ];
        }
        return {
            runId: this.launchData.context.runId,
            definitionId: this.launchData.context.definitionId,
            triggerId: this.launchData.context.trigger.triggerId,
            kind: 'platformer',
            status,
            grade: status === 'success' ? platformerGrade(this.state, this.level) : 'none',
            score: status === 'success' ? platformerScore(this.state) : 0,
            elapsedMs: this.state.activeElapsedMs,
            effects
        };
    }
}
