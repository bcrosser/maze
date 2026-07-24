import Phaser from 'phaser';

import {Mulberry32Random} from '../../domain/random/random-source';
import type {EncounterContext, EncounterResult} from '../../encounters/contracts';
import {
    getEncounterItemBonusLabel,
    getEncounterNumberModifier
} from '../item-bonus';
import {
    SHOOTER_ELITE_END_MS,
    SHOOTER_FIXED_STEP_MS,
    advanceShooter,
    calculateShooterScore,
    chooseShooterModule,
    createShooterMission,
    createShooterState,
    getShooterActiveElapsedMs,
    getShooterChargeRatio,
    getShooterMissionLimitMs,
    setShooterPaused,
    type ShooterEnemyArchetype,
    type ShooterModuleChoiceAction,
    type ShooterPickupKind,
    type ShooterProjectileState,
    type ShooterState
} from './shooter-model';
import {resolveShooterEncounter} from './shooter-result';

export const SHOOTER_SCENE_KEY = 'shooter';
export const SHOOTER_ATLAS_KEY = 'space-sprites';

export const REQUIRED_SHOOTER_ATLAS_FRAMES = Object.freeze([
    'player-idle',
    'player-thrust-1',
    'player-thrust-2',
    'player-charge-1',
    'player-charge-2',
    'player-hit',
    'player-shield',
    'companion-drone-idle',
    'companion-drone-hit',
    'enemy-scout-idle',
    'enemy-scout-bank',
    'enemy-scout-windup',
    'enemy-scout-hit',
    'enemy-fighter-idle',
    'enemy-fighter-bank',
    'enemy-fighter-windup',
    'enemy-fighter-hit',
    'enemy-turret-idle',
    'enemy-turret-windup',
    'enemy-turret-fire',
    'enemy-turret-hit',
    'enemy-carrier-idle',
    'enemy-carrier-armored',
    'enemy-carrier-windup',
    'enemy-carrier-hit',
    'enemy-mine-idle',
    'enemy-mine-armed',
    'enemy-mine-hit',
    'pickup-splitter-core',
    'pickup-beam-coil',
    'pickup-companion-drone',
    'pickup-shield-cell',
    'pickup-bomb-refill',
    'pickup-unstable-aura',
    'projectile-player-pulse',
    'projectile-player-charge',
    'projectile-player-splitter',
    'projectile-player-drone',
    'projectile-hostile',
    'projectile-hostile-heavy',
    'projectile-boss-bolt',
    'projectile-boss-beam',
    'bomb-icon',
    'bomb-blast',
    'boss-body-phase-1',
    'boss-body-phase-2',
    'boss-body-phase-3',
    'boss-shield-node',
    'boss-shield-node-hit',
    'boss-core-closed',
    'boss-core-open',
    'boss-core-hit',
    'boss-drone',
    'boss-beam-warning',
    'debris-small',
    'debris-large',
    'explosion-1',
    'explosion-2',
    'explosion-3',
    'explosion-4',
    'impact-player',
    'impact-hostile',
    'engine-spark',
    'warning-reticle'
] as const);

export type ShooterAtlasFrame = (typeof REQUIRED_SHOOTER_ATLAS_FRAMES)[number];

export interface ShooterSceneOptions {
    readonly atlasImageUrl: string;
    readonly atlasDataUrl: string;
}

/**
 * Retained for compatibility with older E2E helpers. These are visual guide
 * bands only; neither movement nor combat snaps to them.
 */
export const SHOOTER_LANE_X = Object.freeze([136, 236, 336, 436, 536] as const);

export interface ShooterLaunchData {
    readonly context: EncounterContext;
    readonly onComplete: (result: EncounterResult) => void;
}

interface ParallaxStar {
    readonly shape: Phaser.GameObjects.Arc;
    readonly originX: number;
    readonly factor: number;
}

interface PickupVisual {
    readonly container: Phaser.GameObjects.Container;
    readonly icon: Phaser.GameObjects.Sprite;
    readonly aura: Phaser.GameObjects.Sprite | null;
}

const VIEW_SIZE = 672;
const PLAYFIELD_TOP = 108;
const SPACE_ATLAS_SIZE = 512;
const SPACE_EXPLOSION_ANIMATION_KEY = 'space-atlas-explosion';
const MISSION_TIMER_WIDTH = 148;
const MISSION_TIMER_URGENT_MS = 30_000;
const COLOR = Object.freeze({
    background: 0x050b16,
    panel: 0x101b2b,
    cyan: 0x69e4ff,
    pale: 0xeaf9ff,
    gold: 0xffd166,
    hostile: 0xff5d5d,
    hostileDark: 0x8f2d3d,
    purple: 0xc77dff,
    green: 0x72efb1,
    shield: 0x69e4ff,
    debris: 0x667386
});

function coarseBand(value: number): number {
    return Math.max(0, Math.min(4, Math.floor((value - 120) / 104)));
}

function pickupLabel(kind: ShooterPickupKind): string {
    if (kind === 'splitter-core') return 'SPLITTER CORE';
    if (kind === 'beam-coil') return 'BEAM COIL';
    if (kind === 'companion-drone') return 'COMPANION DRONE';
    if (kind === 'shield-cell') return 'SHIELD CELL';
    return 'BOMB REFILL';
}

export class ShooterScene extends Phaser.Scene {
    private readonly options: ShooterSceneOptions;
    private launchData!: ShooterLaunchData;
    private state!: ShooterState;
    private finishing = false;
    private simulationRate = 1;
    private atlasBlocked = true;
    private atlasLoadError: string | null = null;

    private player!: Phaser.GameObjects.Sprite;
    private shieldRing!: Phaser.GameObjects.Arc;
    private droneShape!: Phaser.GameObjects.Sprite;
    private statusText!: Phaser.GameObjects.Text;
    private phaseText!: Phaser.GameObjects.Text;
    private missionTimerText!: Phaser.GameObjects.Text;
    private missionTimerFill!: Phaser.GameObjects.Rectangle;
    private promptText!: Phaser.GameObjects.Text;
    private chargeFill!: Phaser.GameObjects.Rectangle;
    private cooldownFill!: Phaser.GameObjects.Rectangle;
    private bombText!: Phaser.GameObjects.Text;
    private fireText!: Phaser.GameObjects.Text;
    private modelErrorText: Phaser.GameObjects.Text | null = null;

    private readonly enemyShapes = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly projectileShapes = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly pickupShapes = new Map<string, PickupVisual>();
    private readonly hazardShapes = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly bossShapes = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly enemyHealth = new Map<string, number>();
    private readonly enemyHitUntilTick = new Map<string, number>();
    private readonly bossHitUntilTick = new Map<string, number>();
    private readonly parallaxStars: ParallaxStar[] = [];
    private readonly dismissedTutorialPrompts = new Set<number>();
    private previousBossNodeHealth: readonly [number, number] | null = null;
    private previousBossCoreHealth: number | null = null;
    private previousBombsUsed = 0;
    private previousPlayerHitsTaken = 0;
    private playerHitUntilTick = 0;
    private previousDroneBlocksRemaining = 0;

    private moduleOverlay: Phaser.GameObjects.Container | null = null;
    private helpOverlay: Phaser.GameObjects.Container | null = null;
    private lastChoiceId: string | null = null;

    private readonly heldMovementKeys = new Set<string>();
    private keyboardFireDown = false;
    private touchFireDown = false;
    private firePointerId: number | null = null;
    private pendingFirePressed = false;
    private pendingFireReleased = false;
    private pendingBomb = false;
    private joystickPointerId: number | null = null;
    private joystickOrigin = {x: 0, y: 0};
    private joystickVector = {x: 0, y: 0};
    private joystickKnob!: Phaser.GameObjects.Arc;
    private joystickBase!: Phaser.GameObjects.Arc;

    constructor(options: ShooterSceneOptions) {
        super({key: SHOOTER_SCENE_KEY});
        this.options = options ?? {atlasImageUrl: '', atlasDataUrl: ''};
    }

    preload(): void {
        this.atlasLoadError = null;
        const imageUrl = this.options.atlasImageUrl.trim();
        const dataUrl = this.options.atlasDataUrl.trim();
        if (imageUrl.length === 0 || dataUrl.length === 0) {
            this.atlasLoadError =
                'Space atlas configuration is incomplete: both image and metadata URLs are required.';
            return;
        }
        if (this.textures.exists(SHOOTER_ATLAS_KEY)) return;
        this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.handleAtlasLoadError, this);
        this.load.atlas(SHOOTER_ATLAS_KEY, imageUrl, dataUrl);
    }

    create(data: ShooterLaunchData): void {
        this.launchData = data;
        this.atlasBlocked = true;
        this.modelErrorText = null;
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.handleAtlasLoadError, this);
        const atlasError = this.getAtlasValidationError();
        if (atlasError !== null) {
            this.showAtlasLoadError(atlasError);
            return;
        }
        this.atlasBlocked = false;
        const levelTierModifier = data.context.modifiers.levelTier;
        const levelTier = typeof levelTierModifier === 'number'
            ? levelTierModifier
            : Math.max(0, data.context.act - 1);
        const generatedMission = createShooterMission(
            new Mulberry32Random(data.context.seed),
            {
                powerRouting: data.context.campaignSnapshot.worldSystems.powerRouting,
                archiveIntel: data.context.campaignSnapshot.flags.includes('archive-lock-opened'),
                securityAlert: data.context.campaignSnapshot.worldSystems.securityAlert,
                difficulty: data.context.difficulty,
                levelTier
            }
        );
        const shieldBonus = Math.max(
            0,
            Math.floor(getEncounterNumberModifier(data.context, 'spaceShieldBonus'))
        );
        const bombBonus = Math.max(
            0,
            Math.floor(getEncounterNumberModifier(data.context, 'spaceBombBonus'))
        );
        const mission = shieldBonus === 0
            ? generatedMission
            : {
                ...generatedMission,
                startingShield: generatedMission.startingShield + shieldBonus,
                maximumShield: generatedMission.maximumShield + shieldBonus
            };
        const createdState = createShooterState(mission);
        this.state = bombBonus === 0
            ? createdState
            : {
                ...createdState,
                player: {
                    ...createdState.player,
                    bombs: Math.min(
                        createdState.player.maxBombs,
                        createdState.player.bombs + bombBonus
                    )
                }
            };
        const requestedRate = data.context.modifiers.simulationRate;
        this.simulationRate = typeof requestedRate === 'number'
            ? Math.max(0.1, Math.min(120, requestedRate))
            : 1;
        this.finishing = false;
        this.resetInputState();
        this.enemyShapes.clear();
        this.projectileShapes.clear();
        this.pickupShapes.clear();
        this.hazardShapes.clear();
        this.bossShapes.clear();
        this.enemyHealth.clear();
        this.enemyHitUntilTick.clear();
        this.bossHitUntilTick.clear();
        this.parallaxStars.length = 0;
        this.dismissedTutorialPrompts.clear();
        this.previousBossNodeHealth = null;
        this.previousBossCoreHealth = null;
        this.previousBombsUsed = this.state.player.bombsUsed;
        this.previousPlayerHitsTaken = this.state.player.hitsTaken;
        this.playerHitUntilTick = 0;
        this.previousDroneBlocksRemaining = this.state.player.droneBlocksRemaining;
        this.configureAtlasAnimations();

        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, COLOR.background).setOrigin(0);
        this.drawParallax(data.context.seed);
        this.add.rectangle(VIEW_SIZE / 2, 52, VIEW_SIZE, 104, COLOR.panel, 0.96);
        this.add.text(20, 13, 'ORBITAL CORRIDOR // WARDEN RUN', {
            color: '#ffd166',
            fontFamily: 'monospace',
            fontSize: '19px',
            fontStyle: 'bold'
        });
        this.phaseText = this.add.text(20, 42, '', {
            color: '#69e4ff',
            fontFamily: 'monospace',
            fontSize: '14px'
        });
        this.missionTimerText = this.add.text(462, 13, 'MISSION --:--', {
            color: '#eaf9ff',
            fontFamily: 'monospace',
            fontSize: '15px',
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5, 0);
        this.add.rectangle(
            388,
            48,
            MISSION_TIMER_WIDTH,
            10,
            0x1c2a3a,
            0.98
        ).setOrigin(0, 0.5).setStrokeStyle(1, 0x7990ab, 0.8);
        this.missionTimerFill = this.add.rectangle(
            388,
            48,
            MISSION_TIMER_WIDTH,
            6,
            COLOR.cyan
        ).setOrigin(0, 0.5);
        this.statusText = this.add.text(20, 67, '', {
            color: '#eaf9ff',
            fontFamily: 'monospace',
            fontSize: '13px'
        });
        const itemBonus = getEncounterItemBonusLabel(data.context);
        const missionNotes = [
            this.state.mission.archiveHint,
            itemBonus ? `ITEM BONUS · ${itemBonus}` : null
        ].filter((note): note is string => note !== null).join('\n');
        this.add.text(346, 68, missionNotes, {
            color: '#72efb1',
            fontFamily: 'monospace',
            fontSize: itemBonus ? '9px' : '11px',
            align: 'right',
            wordWrap: {width: 260}
        }).setOrigin(0, 0);
        this.game.canvas.dataset.itemBonus = itemBonus ?? '';

        this.promptText = this.add.text(VIEW_SIZE / 2, 124, '', {
            color: '#ffffff',
            backgroundColor: '#15243c',
            fontFamily: 'monospace',
            fontSize: '17px',
            fontStyle: 'bold',
            padding: {x: 12, y: 7}
        }).setOrigin(0.5, 0).setInteractive({useHandCursor: true});
        this.promptText.on('pointerdown', () => {
            const promptIndex = this.currentTutorialPromptIndex();
            if (promptIndex !== null) this.dismissedTutorialPrompts.add(promptIndex);
        });

        this.createPlayer();
        this.createControls();
        this.createMeters();
        this.createTopButtons();

        this.input.on('pointerdown', this.handlePointerDown, this);
        this.input.on('pointermove', this.handlePointerMove, this);
        this.input.on('pointerup', this.handlePointerUp, this);
        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.input.keyboard?.on('keyup', this.handleKeyUp, this);
        this.events.once('shutdown', this.handleShutdown, this);
        this.syncProjection();
    }

    override update(_time: number, delta: number): void {
        if (this.atlasBlocked || this.finishing || this.helpOverlay !== null) return;
        const previousTicks = this.state.activeTicks;
        try {
            this.state = advanceShooter(
                this.state,
                {
                    ...this.getMovementInput(),
                    fireHeld: this.keyboardFireDown || this.touchFireDown,
                    firePressed: this.pendingFirePressed,
                    fireReleased: this.pendingFireReleased,
                    bombPressed: this.pendingBomb
                },
                Math.max(0, delta) * this.simulationRate
            );
        } catch (error) {
            this.showModelError(error);
            return;
        }
        if (this.state.activeTicks > previousTicks) {
            this.pendingFirePressed = false;
            this.pendingFireReleased = false;
            this.pendingBomb = false;
        }
        this.syncProjection();
        this.syncModuleOverlay();
        if (this.state.terminal !== null) this.finish(this.state.terminal);
    }

    private readonly handleAtlasLoadError = (file: Phaser.Loader.File): void => {
        this.atlasLoadError =
            `Space atlas failed to load its ${file.type || 'asset'} file.`;
    };

    private getAtlasValidationError(): string | null {
        if (this.atlasLoadError !== null) return this.atlasLoadError;
        if (!this.textures.exists(SHOOTER_ATLAS_KEY)) {
            return 'Space atlas did not produce a Phaser texture.';
        }
        const texture = this.textures.get(SHOOTER_ATLAS_KEY);
        const source = texture.source[0];
        if (
            source === undefined ||
            source.width !== SPACE_ATLAS_SIZE ||
            source.height !== SPACE_ATLAS_SIZE
        ) {
            return `Space atlas image must be ${SPACE_ATLAS_SIZE}x${SPACE_ATLAS_SIZE} RGBA.`;
        }
        const missingFrames = REQUIRED_SHOOTER_ATLAS_FRAMES.filter(
            frame => !texture.has(frame)
        );
        if (missingFrames.length > 0) {
            const preview = missingFrames.slice(0, 3).join(', ');
            const suffix = missingFrames.length > 3
                ? ` and ${missingFrames.length - 3} more`
                : '';
            return `Space atlas metadata is missing required frames: ${preview}${suffix}.`;
        }
        return null;
    }

    private showAtlasLoadError(message: string): void {
        this.atlasBlocked = true;
        this.finishing = false;
        this.add.rectangle(0, 0, VIEW_SIZE, VIEW_SIZE, COLOR.background).setOrigin(0);
        this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, 570, 330, 0x301722, 0.98)
            .setStrokeStyle(5, COLOR.hostile);
        this.add.text(VIEW_SIZE / 2, 260, 'SPACE ASSET ERROR', {
            color: '#ffb1b1',
            fontFamily: 'monospace',
            fontSize: '28px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        this.add.text(
            VIEW_SIZE / 2,
            350,
            `${message}\n\nFlight is blocked until the checked-in Space atlas is repaired and reloaded.`,
            {
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: '16px',
                align: 'center',
                lineSpacing: 10,
                wordWrap: {width: 500}
            }
        ).setOrigin(0.5);
        this.game.canvas.dataset.shooterAssetStatus = 'error';
        this.game.canvas.dataset.shooterAssetError = message;
        this.game.canvas.dataset.shooterTerminal = 'asset-error';
        this.events.once('shutdown', this.handleShutdown, this);
    }

    private configureAtlasAnimations(): void {
        if (this.anims.exists(SPACE_EXPLOSION_ANIMATION_KEY)) return;
        this.anims.create({
            key: SPACE_EXPLOSION_ANIMATION_KEY,
            frames: [
                'explosion-1',
                'explosion-2',
                'explosion-3',
                'explosion-4'
            ].map(frame => ({key: SHOOTER_ATLAS_KEY, frame})),
            frameRate: 18,
            repeat: 0,
            hideOnComplete: true
        });
    }

    private createPlayer(): void {
        this.player = this.add.sprite(
            this.state.player.position.x,
            this.state.player.position.y,
            SHOOTER_ATLAS_KEY,
            'player-idle'
        ).setDisplaySize(52, 52);
        this.droneShape = this.add.sprite(
            this.state.player.position.x,
            this.state.player.position.y - 28,
            SHOOTER_ATLAS_KEY,
            'companion-drone-idle'
        ).setDisplaySize(32, 32).setVisible(false);
        this.shieldRing = this.add.circle(
            this.state.player.position.x,
            this.state.player.position.y,
            26,
            COLOR.shield,
            0
        ).setStrokeStyle(2, COLOR.shield, 0.9);
    }

    private createControls(): void {
        this.joystickBase = this.add.circle(86, 578, 49, 0x26364d, 0.55)
            .setStrokeStyle(2, 0x7990ab, 0.75);
        this.joystickKnob = this.add.circle(86, 578, 20, COLOR.cyan, 0.55);

        const bombButton = this.add.circle(502, 592, 34, 0x70415b, 0.94)
            .setStrokeStyle(3, COLOR.purple)
            .setInteractive({useHandCursor: true});
        this.add.sprite(502, 580, SHOOTER_ATLAS_KEY, 'bomb-icon')
            .setDisplaySize(34, 34);
        this.bombText = this.add.text(502, 613, 'x2', {
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        bombButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.state.moduleChoice === null && this.helpOverlay === null) {
                this.pendingBomb = true;
            }
            pointer.event.preventDefault();
        });

        const fireButton = this.add.circle(602, 568, 46, 0x763b45, 0.96)
            .setStrokeStyle(3, COLOR.gold)
            .setInteractive({useHandCursor: true});
        this.fireText = this.add.text(602, 568, 'FIRE', {
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: '15px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        fireButton.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.firePointerId === null || this.firePointerId === pointer.id) {
                this.firePointerId = pointer.id;
                this.setTouchFire(true);
            }
            pointer.event.preventDefault();
        });
        fireButton.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            this.releaseTouchFire(pointer.id);
            pointer.event.preventDefault();
        });
        fireButton.on('pointerout', (pointer: Phaser.Input.Pointer) => {
            this.releaseTouchFire(pointer.id);
        });
    }

    private createMeters(): void {
        this.add.rectangle(474, 642, 150, 8, 0x1c2a3a).setOrigin(0, 0.5);
        this.chargeFill = this.add.rectangle(474, 642, 150, 8, COLOR.gold)
            .setOrigin(0, 0.5);
        this.add.text(424, 642, 'CHARGE', {
            color: '#b8c9d9',
            fontFamily: 'monospace',
            fontSize: '10px'
        }).setOrigin(0, 0.5);
        this.add.rectangle(474, 655, 150, 5, 0x1c2a3a).setOrigin(0, 0.5);
        this.cooldownFill = this.add.rectangle(474, 655, 150, 5, COLOR.cyan)
            .setOrigin(0, 0.5);
    }

    private createTopButtons(): void {
        const help = this.add.rectangle(580, 26, 54, 25, 0x26364d)
            .setStrokeStyle(1, 0x7990ab)
            .setInteractive({useHandCursor: true});
        this.add.text(580, 26, 'HELP', {
            color: '#eaf9ff',
            fontFamily: 'monospace',
            fontSize: '11px'
        }).setOrigin(0.5);
        help.on('pointerdown', () => this.openHelp());

        const close = this.add.circle(642, 27, 16, 0x4d2834)
            .setStrokeStyle(2, COLOR.hostile)
            .setInteractive({useHandCursor: true});
        this.add.text(642, 27, 'X', {
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: '13px'
        }).setOrigin(0.5);
        close.on('pointerdown', () => this.finish('abandoned'));
    }

    private drawParallax(seed: number): void {
        const random = new Mulberry32Random(seed ^ 0x53504143);
        for (let index = 0; index < 46; index++) {
            const originX = random.next() * VIEW_SIZE;
            const y = PLAYFIELD_TOP + random.next() * (VIEW_SIZE - PLAYFIELD_TOP);
            const factor = index < 28 ? 0.28 : 0.62;
            const radius = factor < 0.5 ? 1 : 1.7;
            const shape = this.add.circle(
                originX,
                y,
                radius,
                factor < 0.5 ? 0x53718f : 0xb9e7ff,
                factor < 0.5 ? 0.45 : 0.72
            );
            this.parallaxStars.push({shape, originX, factor});
        }
        for (let index = 0; index < 5; index++) {
            const y = 165 + random.next() * 420;
            const originX = random.next() * VIEW_SIZE;
            const nebula = this.add.circle(
                originX,
                y,
                45 + random.next() * 45,
                index % 2 === 0 ? 0x19365b : 0x472d63,
                0.09
            );
            this.parallaxStars.push({shape: nebula, originX, factor: 0.12});
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if (key === 'escape') {
            if (this.helpOverlay !== null) {
                this.closeHelp();
            } else {
                this.finish('abandoned');
            }
            event.preventDefault();
            return;
        }
        if (key === 'h') {
            if (this.helpOverlay === null) this.openHelp();
            else this.closeHelp();
            event.preventDefault();
            return;
        }
        if (
            key === 'arrowleft' ||
            key === 'arrowright' ||
            key === 'arrowup' ||
            key === 'arrowdown' ||
            key === 'w' ||
            key === 'a' ||
            key === 's' ||
            key === 'd'
        ) {
            this.heldMovementKeys.add(key);
            event.preventDefault();
            return;
        }
        if (key === ' ' || key === 'z') {
            if (!this.keyboardFireDown) {
                this.keyboardFireDown = true;
                this.pendingFirePressed = true;
            }
            event.preventDefault();
        } else if (key === 'x' || key === 'b') {
            if (!event.repeat) this.pendingBomb = true;
            event.preventDefault();
        }
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        this.heldMovementKeys.delete(key);
        if ((key === ' ' || key === 'z') && this.keyboardFireDown) {
            this.keyboardFireDown = false;
            this.pendingFireReleased = true;
            event.preventDefault();
        }
    };

    private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
        if (
            pointer.x >= 350 ||
            pointer.y < 155 ||
            this.state.moduleChoice !== null ||
            this.helpOverlay !== null
        ) return;
        this.joystickPointerId = pointer.id;
        this.joystickOrigin = {x: pointer.x, y: pointer.y};
        this.joystickVector = {x: 0, y: 0};
        this.joystickBase.setPosition(pointer.x, pointer.y);
        this.joystickKnob.setPosition(pointer.x, pointer.y);
    };

    private readonly handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
        if (pointer.id !== this.joystickPointerId || !pointer.isDown) return;
        const dx = pointer.x - this.joystickOrigin.x;
        const dy = pointer.y - this.joystickOrigin.y;
        const magnitude = Math.hypot(dx, dy);
        const scale = magnitude > 45 ? 45 / magnitude : 1;
        this.joystickVector = {x: dx / 45 * scale, y: dy / 45 * scale};
        this.joystickKnob.setPosition(
            this.joystickOrigin.x + dx * scale,
            this.joystickOrigin.y + dy * scale
        );
    };

    private readonly handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
        if (pointer.id === this.joystickPointerId) {
            this.joystickPointerId = null;
            this.joystickVector = {x: 0, y: 0};
            this.joystickBase.setPosition(86, 578);
            this.joystickKnob.setPosition(86, 578);
        }
        this.releaseTouchFire(pointer.id);
    };

    private readonly handleShutdown = (): void => {
        this.input.off('pointerdown', this.handlePointerDown, this);
        this.input.off('pointermove', this.handlePointerMove, this);
        this.input.off('pointerup', this.handlePointerUp, this);
        this.input.keyboard?.off('keydown', this.handleKeyDown, this);
        this.input.keyboard?.off('keyup', this.handleKeyUp, this);
        this.clearDatasets();
        this.resetInputState();
    };

    private getMovementInput(): {moveX: number; moveY: number} {
        let moveX = this.joystickVector.x;
        let moveY = this.joystickVector.y;
        if (this.heldMovementKeys.has('arrowleft') || this.heldMovementKeys.has('a')) moveX--;
        if (this.heldMovementKeys.has('arrowright') || this.heldMovementKeys.has('d')) moveX++;
        if (this.heldMovementKeys.has('arrowup') || this.heldMovementKeys.has('w')) moveY--;
        if (this.heldMovementKeys.has('arrowdown') || this.heldMovementKeys.has('s')) moveY++;
        return {moveX, moveY};
    }

    private setTouchFire(down: boolean): void {
        if (down === this.touchFireDown) return;
        this.touchFireDown = down;
        if (down) this.pendingFirePressed = true;
        else this.pendingFireReleased = true;
    }

    private releaseTouchFire(pointerId: number): void {
        if (pointerId !== this.firePointerId) return;
        this.firePointerId = null;
        this.setTouchFire(false);
    }

    private resetInputState(): void {
        this.heldMovementKeys.clear();
        this.keyboardFireDown = false;
        this.touchFireDown = false;
        this.firePointerId = null;
        this.pendingFirePressed = false;
        this.pendingFireReleased = false;
        this.pendingBomb = false;
        this.joystickPointerId = null;
        this.joystickVector = {x: 0, y: 0};
    }

    private clearHeldForOverlay(): void {
        this.resetInputState();
        if (this.joystickBase !== undefined) {
            this.joystickBase.setPosition(86, 578);
            this.joystickKnob.setPosition(86, 578);
        }
    }

    private syncProjection(): void {
        this.syncPlayer();
        this.syncEnemies();
        this.syncProjectiles();
        this.syncPickups();
        this.syncHazards();
        this.syncBoss();
        this.syncBackground();
        this.syncHud();
        this.syncDatasets();
    }

    private syncPlayer(): void {
        this.player.setPosition(this.state.player.position.x, this.state.player.position.y);
        this.droneShape.setPosition(
            this.state.player.position.x - 3,
            this.state.player.position.y - 29
        );
        this.shieldRing
            .setPosition(this.state.player.position.x, this.state.player.position.y)
            .setVisible(this.state.player.shield > 0);
        const tilt = Phaser.Math.Clamp(this.state.player.velocity.y / 700, -0.24, 0.24);
        this.player.setRotation(tilt);
        if (this.state.player.hitsTaken > this.previousPlayerHitsTaken) {
            this.playerHitUntilTick = this.state.activeTicks + 10;
            this.spawnAtlasEffect(
                'impact-player',
                this.state.player.position.x,
                this.state.player.position.y,
                52,
                260
            );
        }
        this.previousPlayerHitsTaken = this.state.player.hitsTaken;
        const chargeRatio = getShooterChargeRatio(this.state);
        let frame: ShooterAtlasFrame = 'player-idle';
        if (this.state.activeTicks < this.playerHitUntilTick) {
            frame = 'player-hit';
        } else if (chargeRatio > 0) {
            frame = chargeRatio >= 0.55 ? 'player-charge-2' : 'player-charge-1';
        } else if (
            Math.hypot(
                this.state.player.velocity.x,
                this.state.player.velocity.y
            ) > 25
        ) {
            frame = this.state.activeTicks % 12 < 6
                ? 'player-thrust-1'
                : 'player-thrust-2';
        }
        this.player.setFrame(frame);
        const invulnerable = this.state.player.invulnerabilityMs > 0;
        this.player.setAlpha(invulnerable && this.state.activeTicks % 6 < 3 ? 0.5 : 1);
        this.droneShape.setVisible(this.state.player.utilityModule === 'companion-drone');
        this.droneShape.setFrame('companion-drone-idle');
        if (
            this.state.player.droneBlocksRemaining < this.previousDroneBlocksRemaining &&
            this.state.player.utilityModule === null
        ) {
            this.spawnAtlasEffect(
                'companion-drone-hit',
                this.state.player.position.x - 3,
                this.state.player.position.y - 29,
                42,
                320
            );
        }
        this.previousDroneBlocksRemaining = this.state.player.droneBlocksRemaining;
        if (this.state.player.bombsUsed > this.previousBombsUsed) {
            this.spawnBombBlast();
        }
        this.previousBombsUsed = this.state.player.bombsUsed;
    }

    private createEnemyShape(archetype: ShooterEnemyArchetype): Phaser.GameObjects.Sprite {
        const frame = `enemy-${archetype}-idle` as ShooterAtlasFrame;
        const sprite = this.add.sprite(0, 0, SHOOTER_ATLAS_KEY, frame);
        const size = archetype === 'carrier'
            ? 66
            : archetype === 'turret'
                ? 52
                : archetype === 'mine'
                    ? 42
                    : 48;
        return sprite.setDisplaySize(size, size);
    }

    private enemyFrame(
        enemy: ShooterState['enemies'][number]
    ): ShooterAtlasFrame {
        if ((this.enemyHitUntilTick.get(enemy.id) ?? 0) > this.state.activeTicks) {
            return `enemy-${enemy.archetype}-hit` as ShooterAtlasFrame;
        }
        if (enemy.archetype === 'mine') {
            const distance = Phaser.Math.Distance.Between(
                enemy.position.x,
                enemy.position.y,
                this.state.player.position.x,
                this.state.player.position.y
            );
            return distance < 145 ? 'enemy-mine-armed' : 'enemy-mine-idle';
        }
        if (enemy.windupMs > 0) {
            return `enemy-${enemy.archetype}-windup` as ShooterAtlasFrame;
        }
        if (enemy.archetype === 'scout' || enemy.archetype === 'fighter') {
            return this.state.activeTicks % 28 < 14
                ? `enemy-${enemy.archetype}-idle` as ShooterAtlasFrame
                : `enemy-${enemy.archetype}-bank` as ShooterAtlasFrame;
        }
        if (enemy.archetype === 'carrier' && enemy.health === enemy.maxHealth) {
            return 'enemy-carrier-armored';
        }
        return `enemy-${enemy.archetype}-idle` as ShooterAtlasFrame;
    }

    private syncEnemies(): void {
        const activeIds = new Set(this.state.enemies.map(enemy => enemy.id));
        for (const [id, shape] of this.enemyShapes) {
            if (activeIds.has(id)) continue;
            if (
                shape.x > -20 &&
                shape.x < VIEW_SIZE + 20 &&
                shape.y > PLAYFIELD_TOP &&
                shape.y < VIEW_SIZE
            ) {
                this.spawnExplosion(shape.x, shape.y, shape.displayWidth * 1.15);
            }
            shape.destroy();
            this.enemyShapes.delete(id);
            this.enemyHealth.delete(id);
            this.enemyHitUntilTick.delete(id);
        }
        for (const enemy of this.state.enemies) {
            let shape = this.enemyShapes.get(enemy.id);
            if (shape === undefined) {
                shape = this.createEnemyShape(enemy.archetype);
                this.enemyShapes.set(enemy.id, shape);
            }
            const previousHealth = this.enemyHealth.get(enemy.id);
            if (previousHealth !== undefined && enemy.health < previousHealth) {
                this.enemyHitUntilTick.set(enemy.id, this.state.activeTicks + 7);
                this.spawnAtlasEffect(
                    'impact-hostile',
                    enemy.position.x,
                    enemy.position.y,
                    38,
                    180
                );
            }
            this.enemyHealth.set(enemy.id, enemy.health);
            shape.setPosition(enemy.position.x, enemy.position.y);
            shape.setFrame(this.enemyFrame(enemy));
            shape.setAlpha(enemy.windupMs > 0 && this.state.activeTicks % 8 < 4 ? 0.45 : 1);
        }
    }

    private projectileFrame(projectile: ShooterProjectileState): ShooterAtlasFrame {
        if (projectile.allegiance === 'hostile') {
            if (projectile.source === 'boss') return 'projectile-boss-bolt';
            return projectile.radius >= 7
                ? 'projectile-hostile-heavy'
                : 'projectile-hostile';
        }
        if (projectile.source === 'splitter') return 'projectile-player-splitter';
        if (projectile.source === 'drone') return 'projectile-player-drone';
        return projectile.damage > 1
            ? 'projectile-player-charge'
            : 'projectile-player-pulse';
    }

    private projectileShape(
        projectile: ShooterProjectileState
    ): Phaser.GameObjects.Sprite {
        const frame = this.projectileFrame(projectile);
        const sprite = this.add.sprite(0, 0, SHOOTER_ATLAS_KEY, frame);
        if (projectile.allegiance === 'hostile') {
            return sprite.setDisplaySize(
                projectile.source === 'boss' ? 34 : projectile.radius >= 7 ? 25 : 18,
                projectile.source === 'boss' ? 20 : projectile.radius >= 7 ? 25 : 18
            );
        }
        return sprite.setDisplaySize(
            projectile.damage > 1 ? 38 : 28,
            projectile.damage > 1 ? 22 : 14
        );
    }

    private syncProjectiles(): void {
        const activeIds = new Set(this.state.projectiles.map(projectile => projectile.id));
        for (const [id, shape] of this.projectileShapes) {
            if (activeIds.has(id)) continue;
            shape.destroy();
            this.projectileShapes.delete(id);
        }
        for (const projectile of this.state.projectiles) {
            let shape = this.projectileShapes.get(projectile.id);
            if (shape === undefined) {
                shape = this.projectileShape(projectile);
                this.projectileShapes.set(projectile.id, shape);
            }
            shape.setPosition(projectile.position.x, projectile.position.y);
            shape.setRotation(Math.atan2(projectile.velocity.y, projectile.velocity.x));
        }
    }

    private syncPickups(): void {
        const activeIds = new Set(this.state.pickups.map(pickup => pickup.id));
        for (const [id, visual] of this.pickupShapes) {
            if (activeIds.has(id)) continue;
            visual.container.destroy(true);
            this.pickupShapes.delete(id);
        }
        for (const pickup of this.state.pickups) {
            let visual = this.pickupShapes.get(pickup.id);
            if (visual === undefined) {
                const frame = `pickup-${pickup.definition.kind}` as ShooterAtlasFrame;
                const icon = this.add.sprite(0, 0, SHOOTER_ATLAS_KEY, frame)
                    .setDisplaySize(48, 48);
                const aura = pickup.definition.unstable
                    ? this.add.sprite(0, 0, SHOOTER_ATLAS_KEY, 'pickup-unstable-aura')
                        .setDisplaySize(58, 58)
                    : null;
                const children: Phaser.GameObjects.GameObject[] = aura === null
                    ? [icon]
                    : [aura, icon];
                visual = {
                    container: this.add.container(0, 0, children),
                    icon,
                    aura
                };
                this.pickupShapes.set(pickup.id, visual);
            }
            visual.container.setPosition(pickup.position.x, pickup.position.y);
            visual.icon.setRotation(pickup.ageMs / 1_500);
            visual.aura?.setRotation(-pickup.ageMs / 900);
        }
    }

    private syncHazards(): void {
        const activeIds = new Set(this.state.hazards.map(hazard => hazard.id));
        for (const [id, shape] of this.hazardShapes) {
            if (activeIds.has(id)) continue;
            shape.destroy();
            this.hazardShapes.delete(id);
        }
        for (const hazard of this.state.hazards) {
            let shape = this.hazardShapes.get(hazard.id);
            if (shape === undefined) {
                shape = this.add.sprite(
                    0,
                    0,
                    SHOOTER_ATLAS_KEY,
                    hazard.radius >= 19 ? 'debris-large' : 'debris-small'
                ).setDisplaySize(hazard.radius * 2.4, hazard.radius * 2.4);
                this.hazardShapes.set(hazard.id, shape);
            }
            shape.setPosition(hazard.position.x, hazard.position.y);
            shape.setRotation(hazard.rotation);
        }
    }

    private syncBoss(): void {
        if (this.state.boss === null) {
            for (const shape of this.bossShapes.values()) shape.destroy();
            this.bossShapes.clear();
            this.previousBossNodeHealth = null;
            this.previousBossCoreHealth = null;
            return;
        }
        const boss = this.state.boss;
        if (this.previousBossNodeHealth !== null) {
            for (const index of [0, 1] as const) {
                if (boss.nodeHealth[index] < this.previousBossNodeHealth[index]) {
                    this.bossHitUntilTick.set(`node-${index}`, this.state.activeTicks + 8);
                    this.spawnAtlasEffect(
                        'boss-shield-node-hit',
                        boss.position.x - 8,
                        boss.position.y + (index === 0 ? -92 : 92),
                        56,
                        220
                    );
                }
            }
        }
        if (
            this.previousBossCoreHealth !== null &&
            boss.coreHealth > 0 &&
            boss.coreHealth < this.previousBossCoreHealth
        ) {
            this.bossHitUntilTick.set('core', this.state.activeTicks + 8);
            this.spawnAtlasEffect(
                'boss-core-hit',
                boss.position.x - 18,
                boss.position.y,
                66,
                200
            );
        }
        this.previousBossNodeHealth = [...boss.nodeHealth] as [number, number];
        this.previousBossCoreHealth = boss.coreHealth;
        let body = this.bossShapes.get('body');
        if (body === undefined) {
            body = this.add.sprite(
                0,
                0,
                SHOOTER_ATLAS_KEY,
                'boss-body-phase-1'
            ).setDisplaySize(150, 190);
            this.bossShapes.set('body', body);
        }
        body
            .setPosition(boss.position.x, boss.position.y)
            .setFrame(`boss-body-phase-${boss.phase}`);
        for (const index of [0, 1] as const) {
            const id = `node-${index}`;
            let node = this.bossShapes.get(id);
            if (node === undefined) {
                node = this.add.sprite(
                    0,
                    0,
                    SHOOTER_ATLAS_KEY,
                    'boss-shield-node'
                ).setDisplaySize(50, 50);
                this.bossShapes.set(id, node);
            }
            node.setPosition(
                boss.position.x - 8,
                boss.position.y + (index === 0 ? -92 : 92)
            );
            node.setFrame(
                (this.bossHitUntilTick.get(id) ?? 0) > this.state.activeTicks
                    ? 'boss-shield-node-hit'
                    : 'boss-shield-node'
            );
            node.setVisible(boss.phase === 1 && boss.nodeHealth[index] > 0);
        }
        let core = this.bossShapes.get('core');
        if (core === undefined) {
            core = this.add.sprite(
                0,
                0,
                SHOOTER_ATLAS_KEY,
                'boss-core-closed'
            ).setDisplaySize(68, 68);
            this.bossShapes.set('core', core);
        }
        core.setPosition(boss.position.x - 18, boss.position.y);
        core.setVisible(boss.phase > 1);
        core.setFrame(
            (this.bossHitUntilTick.get('core') ?? 0) > this.state.activeTicks
                ? 'boss-core-hit'
                : boss.coreExposed
                    ? 'boss-core-open'
                    : 'boss-core-closed'
        );
        let warning = this.bossShapes.get('warning');
        if (warning === undefined) {
            warning = this.add.sprite(
                0,
                0,
                SHOOTER_ATLAS_KEY,
                'boss-beam-warning'
            ).setDisplaySize(260, 62);
            this.bossShapes.set('warning', warning);
        }
        warning
            .setPosition(400, boss.position.y)
            .setVisible(boss.windupMs > 0)
            .setAlpha(this.state.activeTicks % 8 < 4 ? 0.35 : 0.72);
        body.setAlpha(boss.windupMs > 0 && this.state.activeTicks % 8 < 4 ? 0.62 : 1);
    }

    private spawnExplosion(x: number, y: number, size: number): void {
        const explosion = this.add.sprite(
            x,
            y,
            SHOOTER_ATLAS_KEY,
            'explosion-1'
        ).setDisplaySize(size, size).setDepth(15);
        explosion.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            explosion.destroy();
        });
        explosion.play(SPACE_EXPLOSION_ANIMATION_KEY);
    }

    private spawnAtlasEffect(
        frame: ShooterAtlasFrame,
        x: number,
        y: number,
        size: number,
        durationMs: number
    ): void {
        const effect = this.add.sprite(x, y, SHOOTER_ATLAS_KEY, frame)
            .setDisplaySize(size, size)
            .setDepth(16);
        this.tweens.add({
            targets: effect,
            alpha: 0,
            scaleX: effect.scaleX * 1.3,
            scaleY: effect.scaleY * 1.3,
            duration: durationMs,
            ease: 'Quad.easeOut',
            onComplete: () => effect.destroy()
        });
    }

    private spawnBombBlast(): void {
        const blast = this.add.sprite(
            this.state.player.position.x,
            this.state.player.position.y,
            SHOOTER_ATLAS_KEY,
            'bomb-blast'
        ).setDisplaySize(560, 560).setAlpha(0.78).setDepth(14);
        this.tweens.add({
            targets: blast,
            alpha: 0,
            scaleX: blast.scaleX * 1.08,
            scaleY: blast.scaleY * 1.08,
            duration: 340,
            ease: 'Quad.easeOut',
            onComplete: () => blast.destroy()
        });
    }

    private syncBackground(): void {
        for (const star of this.parallaxStars) {
            const wrapped = (
                star.originX -
                this.state.worldScroll * star.factor
            ) % VIEW_SIZE;
            star.shape.x = wrapped < 0 ? wrapped + VIEW_SIZE : wrapped;
        }
    }

    private syncHud(): void {
        const elapsedMs = getShooterActiveElapsedMs(this.state);
        const missionLimitMs = getShooterMissionLimitMs(this.state.mission.levelTier);
        const missionRemainingMs = Math.max(0, missionLimitMs - elapsedMs);
        const missionSeconds = Math.ceil(missionRemainingMs / 1000);
        const missionMinutes = Math.floor(missionSeconds / 60);
        const missionClockSeconds = String(missionSeconds % 60).padStart(2, '0');
        const missionUrgent = missionRemainingMs <= MISSION_TIMER_URGENT_MS;
        const missionExpired = missionRemainingMs === 0;
        const timerColor = missionUrgent ? COLOR.hostile : COLOR.cyan;
        this.missionTimerText
            .setText(`MISSION ${missionMinutes}:${missionClockSeconds}`)
            .setColor(missionUrgent ? '#ff8e8e' : '#eaf9ff')
            .setAlpha(
                missionUrgent &&
                !missionExpired &&
                this.state.activeTicks % 30 >= 20
                    ? 0.55
                    : 1
            );
        this.missionTimerFill
            .setFillStyle(timerColor)
            .setDisplaySize(
                MISSION_TIMER_WIDTH * missionRemainingMs / missionLimitMs,
                missionUrgent ? 8 : 6
            );
        const phaseLabel = this.state.phase.toUpperCase();
        const phaseRemaining = this.state.phase === 'approach'
            ? Math.max(0, 20_000 - elapsedMs)
            : this.state.phase === 'wreck'
                ? Math.max(0, 50_000 - elapsedMs)
                : Math.max(0, SHOOTER_ELITE_END_MS - elapsedMs);
        const phaseClock = this.state.phase === 'boss'
            ? `${missionMinutes}:${missionClockSeconds} LEFT`
            : `${Math.ceil(phaseRemaining / 1000)}s`;
        this.phaseText.setText(`${phaseLabel}  ${phaseClock}  THREAT ${this.state.threatRank}`);
        const module = [
            this.state.player.weaponCore?.replace('-', ' ') ?? 'base pulse',
            this.state.player.utilityModule?.replace('-', ' ') ?? 'no drone'
        ].join(' / ');
        this.statusText.setText(
            `HULL ${this.state.player.hull}/${this.state.player.maxHull}  ` +
            `SHIELD ${this.state.player.shield}/${this.state.player.maxShield}  ` +
            `BOMBS ${this.state.player.bombs}  SCORE ${calculateShooterScore(this.state)}\n` +
            module.toUpperCase()
        );
        this.bombText.setText(`x${this.state.player.bombs}`);
        this.fireText.setText(this.state.player.chargeMs === null ? 'FIRE' : 'CHARGE');
        this.chargeFill.displayWidth = 150 * getShooterChargeRatio(this.state);
        const cooldownRatio = Math.min(1, this.state.player.cooldownMs / 540);
        this.cooldownFill.displayWidth = 150 * (1 - cooldownRatio);
        const tutorialPrompt = this.currentTutorialPromptIndex();
        if (tutorialPrompt === 0 && !this.dismissedTutorialPrompts.has(0)) {
            this.promptText.setText('MOVE  //  WASD, ARROWS, OR LEFT DRAG');
        } else if (tutorialPrompt === 1 && !this.dismissedTutorialPrompts.has(1)) {
            this.promptText.setText('TAP FIRE / HOLD TO CHARGE  //  SPACE OR Z');
        } else if (tutorialPrompt === 2 && !this.dismissedTutorialPrompts.has(2)) {
            this.promptText.setText('BOMB CLEARS SHOTS  //  X OR B');
        } else if (this.state.boss !== null) {
            const boss = this.state.boss;
            const objective = boss.phase === 1
                ? `NODES ${boss.nodeHealth[0]} + ${boss.nodeHealth[1]}`
                : `CORE ${boss.coreHealth}/${boss.coreMaxHealth} ` +
                    (boss.coreExposed ? 'EXPOSED' : 'ARMORED');
            this.promptText.setText(`CORRIDOR WARDEN // PHASE ${boss.phase} // ${objective}`);
        } else {
            this.promptText.setText('');
        }
        this.promptText.setVisible(this.promptText.text.length > 0);
    }

    private currentTutorialPromptIndex(): 0 | 1 | 2 | null {
        const elapsedMs = getShooterActiveElapsedMs(this.state);
        if (elapsedMs < 5_000) return 0;
        if (elapsedMs < 11_000) return 1;
        if (elapsedMs < 17_000) return 2;
        return null;
    }

    private syncDatasets(): void {
        const canvas = this.game.canvas;
        canvas.dataset.shooterAssetStatus = 'ready';
        delete canvas.dataset.shooterAssetError;
        const nextWave = this.state.mission.waves[this.state.directorIndex];
        canvas.dataset.shooterKills = String(this.state.kills);
        canvas.dataset.shooterNextLane = nextWave === undefined
            ? ''
            : String(nextWave.lane);
        canvas.dataset.shooterWaveIndex = String(this.state.directorIndex);
        canvas.dataset.shooterPlayerLane = String(coarseBand(this.state.player.position.y));
        canvas.dataset.shooterX = String(Math.round(this.state.player.position.x));
        canvas.dataset.shooterY = String(Math.round(this.state.player.position.y));
        canvas.dataset.shooterJoystickActive = String(this.joystickPointerId !== null);
        canvas.dataset.shooterTouchFire = String(this.touchFireDown);
        canvas.dataset.shooterBombs = String(this.state.player.bombs);
        canvas.dataset.shooterPhase = this.state.phase;
        canvas.dataset.shooterBossPhase = this.state.boss === null
            ? ''
            : String(this.state.boss.phase);
        canvas.dataset.shooterBossCoreHealth = this.state.boss === null
            ? ''
            : String(this.state.boss.coreHealth);
        canvas.dataset.shooterBossCoreMaxHealth = this.state.boss === null
            ? ''
            : String(this.state.boss.coreMaxHealth);
        canvas.dataset.shooterPlayerHull = String(this.state.player.hull);
        const elapsedMs = getShooterActiveElapsedMs(this.state);
        const missionLimitMs = getShooterMissionLimitMs(this.state.mission.levelTier);
        const missionRemainingMs = Math.max(0, missionLimitMs - elapsedMs);
        canvas.dataset.shooterElapsedMs = String(elapsedMs);
        canvas.dataset.shooterMissionLimitMs = String(missionLimitMs);
        canvas.dataset.shooterMissionRemainingMs = String(missionRemainingMs);
        canvas.dataset.shooterMissionTimedOut = String(missionRemainingMs === 0);
        canvas.dataset.shooterTerminal = this.state.terminal ?? '';
        canvas.dataset.shooterTerminalReason = this.state.terminalReason ?? '';
    }

    private clearDatasets(): void {
        const canvas = this.game.canvas;
        delete canvas.dataset.shooterKills;
        delete canvas.dataset.shooterNextLane;
        delete canvas.dataset.shooterWaveIndex;
        delete canvas.dataset.shooterPlayerLane;
        delete canvas.dataset.shooterX;
        delete canvas.dataset.shooterY;
        delete canvas.dataset.shooterJoystickActive;
        delete canvas.dataset.shooterTouchFire;
        delete canvas.dataset.shooterBombs;
        delete canvas.dataset.shooterPhase;
        delete canvas.dataset.shooterBossPhase;
        delete canvas.dataset.shooterBossCoreHealth;
        delete canvas.dataset.shooterBossCoreMaxHealth;
        delete canvas.dataset.shooterPlayerHull;
        delete canvas.dataset.shooterElapsedMs;
        delete canvas.dataset.shooterMissionLimitMs;
        delete canvas.dataset.shooterMissionRemainingMs;
        delete canvas.dataset.shooterMissionTimedOut;
        delete canvas.dataset.shooterTerminal;
        delete canvas.dataset.shooterTerminalReason;
        delete canvas.dataset.shooterAssetStatus;
        delete canvas.dataset.shooterAssetError;
        delete canvas.dataset.itemBonus;
    }

    private syncModuleOverlay(): void {
        const choice = this.state.moduleChoice;
        if (choice === null) {
            if (this.moduleOverlay !== null) {
                this.moduleOverlay.destroy(true);
                this.moduleOverlay = null;
                this.lastChoiceId = null;
                this.clearHeldForOverlay();
            }
            return;
        }
        if (this.lastChoiceId === choice.pickup.id && this.moduleOverlay !== null) return;
        this.clearHeldForOverlay();
        this.lastChoiceId = choice.pickup.id;
        const panel = this.add.rectangle(336, 365, 500, 250, 0x101b2b, 0.985)
            .setStrokeStyle(4, choice.pickup.unstable ? COLOR.hostile : COLOR.cyan);
        const title = this.add.text(
            336,
            280,
            `${choice.pickup.unstable ? 'UNSTABLE ' : ''}${pickupLabel(choice.pickup.kind)}`,
            {
                color: choice.pickup.unstable ? '#ff8e8e' : '#72efb1',
                fontFamily: 'monospace',
                fontSize: '23px',
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);
        const detail = this.add.text(
            336,
            323,
            choice.pickup.unstable
                ? 'OVERCLOCKED POWER // +1 THREAT // +25% SCORE'
                : 'RUN-SCOPED MODULE // NO HIDDEN THREAT',
            {
                color: '#eaf9ff',
                fontFamily: 'monospace',
                fontSize: '13px'
            }
        ).setOrigin(0.5);
        const children: Phaser.GameObjects.GameObject[] = [panel, title, detail];
        const actions: readonly [ShooterModuleChoiceAction, string, number][] = [
            ['equip', 'EQUIP', 205],
            ['convert', '+400 SCORE', 336],
            ['keep', 'KEEP CURRENT', 467]
        ];
        for (const [action, label, x] of actions) {
            const button = this.add.rectangle(x, 425, 116, 48, 0x26364d)
                .setStrokeStyle(2, COLOR.gold)
                .setInteractive({useHandCursor: true});
            const text = this.add.text(x, 425, label, {
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: '12px',
                fontStyle: 'bold'
            }).setOrigin(0.5);
            button.on('pointerdown', () => {
                this.state = chooseShooterModule(this.state, action);
                this.clearHeldForOverlay();
                this.syncProjection();
                this.syncModuleOverlay();
            });
            children.push(button, text);
        }
        this.moduleOverlay = this.add.container(0, 0, children).setDepth(50);
    }

    private openHelp(): void {
        if (this.helpOverlay !== null || this.finishing) return;
        this.state = setShooterPaused(this.state, true);
        this.clearHeldForOverlay();
        const panel = this.add.rectangle(336, 370, 540, 360, 0x101b2b, 0.99)
            .setStrokeStyle(4, COLOR.cyan);
        const title = this.add.text(336, 229, 'FLIGHT BRIEFING', {
            color: '#ffd166',
            fontFamily: 'monospace',
            fontSize: '25px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const instructions = this.add.text(
            106,
            273,
            [
                '1  MOVE continuously with WASD / arrows / left drag.',
                '2  TAP FIRE for pulses. HOLD and RELEASE for charge.',
                '3  BOMB clears nearby hostile shots and grants safety.',
                '4  Destroy both Warden nodes, then fire in core windows.',
                '5  Red UNSTABLE modules add power, threat, and score.'
            ],
            {
                color: '#eaf9ff',
                fontFamily: 'monospace',
                fontSize: '14px',
                lineSpacing: 14
            }
        );
        const close = this.add.rectangle(336, 500, 170, 48, 0x26364d)
            .setStrokeStyle(2, COLOR.gold)
            .setInteractive({useHandCursor: true});
        const closeText = this.add.text(336, 500, 'RETURN TO FLIGHT', {
            color: '#ffffff',
            fontFamily: 'monospace',
            fontSize: '13px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        close.on('pointerdown', () => this.closeHelp());
        this.helpOverlay = this.add.container(
            0,
            0,
            [panel, title, instructions, close, closeText]
        ).setDepth(60);
    }

    private closeHelp(): void {
        if (this.helpOverlay === null) return;
        this.helpOverlay.destroy(true);
        this.helpOverlay = null;
        this.state = setShooterPaused(this.state, false);
        this.clearHeldForOverlay();
    }

    private showModelError(error: unknown): void {
        if (this.modelErrorText !== null) return;
        this.state = setShooterPaused(this.state, true);
        const message = error instanceof Error ? error.message : String(error);
        this.modelErrorText = this.add.text(
            VIEW_SIZE / 2,
            VIEW_SIZE / 2,
            `SPACE MODEL ERROR\n${message}`,
            {
                color: '#ffffff',
                backgroundColor: '#7d1d2d',
                fontFamily: 'monospace',
                fontSize: '17px',
                align: 'center',
                padding: {x: 20, y: 16},
                wordWrap: {width: 500}
            }
        ).setOrigin(0.5).setDepth(100);
    }

    private finish(status: 'success' | 'failure' | 'abandoned'): void {
        if (this.finishing) return;
        this.finishing = true;
        const completion = resolveShooterEncounter(
            this.launchData.context,
            this.state,
            status
        );
        this.state = completion.state;
        this.launchData.onComplete(completion.result);
        this.scene.stop();
    }
}

export const SHOOTER_MODEL_STEP_MS = SHOOTER_FIXED_STEP_MS;
