import Phaser from 'phaser';

import {
    createInitialCampaignState,
    type ActiveEncounterRecord,
    type CampaignState,
    type EncounterKind
} from '../domain/campaign/campaign-state';
import {
    CAMPAIGN_VICTORY_FLAG,
    getCampaignLevelNumber,
    getLevelExitStatus,
    getLevelTier,
    MAX_CAMPAIGN_LEVEL
} from '../domain/campaign/level-progression';
import {
    ITEM_DEFINITIONS,
    type ItemChoiceId
} from '../domain/entities/item-types';
import {
    purchaseShopOffer,
    purchaseSpaceObjectiveSkip,
    SHOP_CATALOG,
    SPACE_OBJECTIVE_SKIP_COST,
    type ShopPurchaseFailureReason,
    type SpaceObjectiveSkipFailureReason
} from '../domain/economy/economy';
import {MONSTER_DEFINITIONS} from '../domain/entities/monster-types';
import {MATERIALS, type MaterialId, type MaterialTag} from '../domain/materials/materials';
import {getMinigameItemBonus} from '../domain/minigame/minigame-item-bonuses';
import {initializeLevelContent} from '../domain/overworld/level-content-generator';
import {
    CASINO_HEIST_UNLOCK_FLAG,
    getCurrentObjective,
    getObjectivePlacement,
    getObjectiveStatus,
    OBJECTIVE_BY_ID,
    OBJECTIVE_DEFINITIONS,
    type LevelObjectivePlacement,
    type ObjectiveDefinition,
    type ObjectiveId
} from '../domain/overworld/level-objectives';
import type {LevelServicePlacement} from '../domain/overworld/level-service-sites';
import {SERVICE_SITE_DEFINITIONS} from '../domain/overworld/service-site-placement';
import {generateMaze, MAZE_GENERATOR_ID} from '../domain/overworld/maze-generator';
import {
    DIRECTION_VECTORS,
    type DirectionId
} from '../domain/overworld/move-player';
import {
    resolveCampaignDefeat,
    resolveOverworldAction,
    type OverworldAction,
    type OverworldEvent
} from '../domain/overworld/resolve-overworld-action';
import {advanceOverworldReinforcements} from '../domain/overworld/reinforcements';
import {Mulberry32Random} from '../domain/random/random-source';
import {deriveSeed} from '../domain/random/seed-derivation';
import {applyEncounterResult} from '../encounters/apply-encounter-result';
import type {EncounterContext, EncounterResult} from '../encounters/contracts';
import {
    BLACKJACK_SCENE_KEY,
    type BlackjackLaunchData
} from '../minigames/casino/blackjack.scene';
import {
    HOLDEM_SCENE_KEY,
    type HoldemLaunchData
} from '../minigames/casino/holdem.scene';
import {
    CIRCUIT_CRUSH_SCENE_KEY,
    type CircuitCrushLaunchData
} from '../minigames/circuit/circuit.scene';
import {
    HORSEMASTER_SCENE_KEY,
    type HorsemasterLaunchData
} from '../minigames/horsemaster/horsemaster.scene';
import {
    CASINO_HEIST_SCENE_KEY,
    type CasinoHeistLaunchData
} from '../minigames/heist/casino-heist.scene';
import {LOCKPICK_SCENE_KEY, type LockpickLaunchData} from '../minigames/lock/lockpick.scene';
import {PLATFORMER_SCENE_KEY, type PlatformerLaunchData} from '../minigames/platformer/platformer.scene';
import {PIPE_DREAM_SCENE_KEY, type PipeDreamLaunchData} from '../minigames/pipe/pipe-dream.scene';
import {SHOOTER_SCENE_KEY, type ShooterLaunchData} from '../minigames/shooter/shooter.scene';
import {ZAPPER_SCENE_KEY, type ZapperLaunchData} from '../minigames/zapper/zapper.scene';
import {getEncounterResultPresentation} from './encounter-result-presentation';
import {encounterResultKeyAction} from './encounter-result-input';
import {commitObjectiveResult} from './commit-objective-result';

export const OVERWORLD_SCENE_KEY = 'overworld';
export const CELL_SIZE = 32;
export const INITIAL_MAZE_SIZE = 21;
export const GAME_VIEW_SIZE = INITIAL_MAZE_SIZE * CELL_SIZE;
const WALKABLE_EDGE_CELL_CENTER = CELL_SIZE * 1.5;
const IDLE_TOUCH_CONTROL_ALPHA = 0.68;
const ACTIVE_TOUCH_CONTROL_ALPHA = 0.92;

export interface OverworldSceneOptions {
    readonly seed: number;
    readonly itemSpriteSheetUrl: string;
    readonly monsterSpriteSheetUrl: string;
    readonly objectiveSpriteSheetUrl: string;
    readonly initialCampaign?: CampaignState;
    readonly onStateChanged: (state: CampaignState, event?: OverworldEvent) => void;
    readonly onEncounterChanged: (
        kind: EncounterKind | 'blackjack' | 'holdem' | null
    ) => void;
}

interface ObjectiveVisual {
    readonly sprite: Phaser.GameObjects.Sprite;
    readonly badge: Phaser.GameObjects.Text;
    readonly label: Phaser.GameObjects.Text;
}

interface ServiceSiteVisual {
    readonly container: Phaser.GameObjects.Container;
}

type ScrollFactorGameObject = Phaser.GameObjects.GameObject & {
    setScrollFactor(x: number, y?: number): unknown;
};

function colorToNumber(color: `#${string}`): number {
    return Number.parseInt(color.slice(1), 16);
}

function directionForKey(key: string): DirectionId | null {
    switch (key.toLowerCase()) {
        case 'arrowup':
        case 'w':
            return 'up';
        case 'arrowdown':
        case 's':
            return 'down';
        case 'arrowleft':
        case 'a':
            return 'left';
        case 'arrowright':
        case 'd':
            return 'right';
        default:
            return null;
    }
}

function samePosition(
    left: {readonly x: number; readonly y: number},
    right: {readonly x: number; readonly y: number}
): boolean {
    return left.x === right.x && left.y === right.y;
}

function objectiveLockedMessage(objectiveId: ObjectiveId): string {
    const definition = OBJECTIVE_BY_ID[objectiveId];
    if (objectiveId === 'casino-heist') {
        return `${definition.label} is locked. Find a Getaway Car in the maze or buy one at the shop for $100.`;
    }
    const prerequisite = definition.prerequisiteId
        ? OBJECTIVE_BY_ID[definition.prerequisiteId].label
        : 'the prerequisite';
    return `${definition.label} is locked. Complete ${prerequisite}.`;
}

function messageEvent(message: string): OverworldEvent {
    return {kind: 'blocked', message};
}

export class OverworldScene extends Phaser.Scene {
    private readonly options: OverworldSceneOptions;
    private campaign!: CampaignState;
    private mazeGraphics!: Phaser.GameObjects.Graphics;
    private playerMarker!: Phaser.GameObjects.Arc;
    private readonly objectiveVisuals = new Map<ObjectiveId, ObjectiveVisual>();
    private readonly serviceSiteVisuals = new Map<string, ServiceSiteVisual>();
    private readonly itemSprites = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly monsterSprites = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly trapGraphics = new Map<string, Phaser.GameObjects.Rectangle>();
    private attackTargeting = false;
    private itemTargetingId: string | null = null;
    private encounterOpen = false;
    private restartCampaign: CampaignState | undefined;
    private restartAnnouncement: string | undefined;
    private modalContainer: Phaser.GameObjects.Container | null = null;
    private modalConfirmAction: (() => void) | null = null;
    private modalCancelAction: (() => void) | null = null;
    private spaceSkipAction: (() => void) | null = null;
    private shopPreviousPageAction: (() => void) | null = null;
    private shopNextPageAction: (() => void) | null = null;
    private shopOfferActions: readonly (() => void)[] = [];
    private lastShopNavigationKey: string | null = null;
    private lastShopNavigationTimestamp = Number.NEGATIVE_INFINITY;
    private encounterResultModalOpen = false;
    private armoryRewardChoiceOpen = false;
    private casinoSessionOrdinal = 0;
    private reinforcementFrameAccumulatorMs = 0;
    private reinforcementSaveAccumulatorMs = 0;
    private victoryHorse: Phaser.GameObjects.Container | null = null;
    private playerCameraConfigured = false;

    constructor(options: OverworldSceneOptions) {
        super({key: OVERWORLD_SCENE_KEY});
        this.options = options;
    }

    preload(): void {
        this.load.spritesheet('item-sprites', this.options.itemSpriteSheetUrl, {
            frameWidth: CELL_SIZE,
            frameHeight: CELL_SIZE
        });
        this.load.spritesheet('monster-sprites', this.options.monsterSpriteSheetUrl, {
            frameWidth: CELL_SIZE,
            frameHeight: CELL_SIZE
        });
        this.load.spritesheet('objective-sprites', this.options.objectiveSpriteSheetUrl, {
            frameWidth: CELL_SIZE,
            frameHeight: CELL_SIZE
        });
    }

    create(): void {
        this.itemSprites.clear();
        this.monsterSprites.clear();
        this.objectiveVisuals.clear();
        this.serviceSiteVisuals.clear();
        this.trapGraphics.clear();
        this.attackTargeting = false;
        this.itemTargetingId = null;
        this.encounterOpen = false;
        this.modalContainer = null;
        this.spaceSkipAction = null;
        this.encounterResultModalOpen = false;
        this.armoryRewardChoiceOpen = false;
        this.casinoSessionOrdinal = 0;
        this.lastShopNavigationKey = null;
        this.lastShopNavigationTimestamp = Number.NEGATIVE_INFINITY;
        this.reinforcementFrameAccumulatorMs = 0;
        this.reinforcementSaveAccumulatorMs = 0;
        this.victoryHorse = null;
        this.playerCameraConfigured = false;

        const provided = this.restartCampaign ?? this.options.initialCampaign;
        this.restartCampaign = undefined;
        if (provided) {
            // Initialization is idempotent and also backfills newly introduced
            // optional services into older in-progress campaign saves.
            this.campaign = initializeLevelContent(provided);
        } else {
            const levelSeed = deriveSeed(
                this.options.seed,
                `level:${MAZE_GENERATOR_ID}`,
                1
            );
            const maze = generateMaze({
                size: INITIAL_MAZE_SIZE,
                topologyRandom: new Mulberry32Random(deriveSeed(levelSeed, 'maze-topology')),
                materialRandom: new Mulberry32Random(deriveSeed(levelSeed, 'wall-materials'))
            });
            this.campaign = initializeLevelContent(createInitialCampaignState({
                campaignSeed: this.options.seed,
                overworldSeed: levelSeed,
                maze,
                levelId: 'level-1'
            }));
        }

        this.mazeGraphics = this.add.graphics();
        this.drawMaze();
        this.drawLandmarks();
        this.createObjectiveVisuals();
        this.createServiceSiteVisuals();
        this.syncWorldVisuals();
        this.playerMarker = this.add.circle(0, 0, CELL_SIZE / 3, 0x2468d8)
            .setStrokeStyle(3, 0x102d66)
            .setDepth(30);
        this.syncPlayerMarker();

        this.configurePlayerCamera();

        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
            this.destroyModal();
            delete this.game.canvas.dataset.campaignVictory;
            delete this.game.canvas.dataset.victoryFanfare;
            delete this.game.canvas.dataset.overworldCameraMode;
            delete this.game.canvas.dataset.overworldCameraPaddingX;
            delete this.game.canvas.dataset.overworldCameraPaddingY;
            delete this.game.canvas.dataset.overworldPlayerScreenX;
            delete this.game.canvas.dataset.overworldPlayerScreenY;
        });
        this.createTouchControls();

        const announcement = this.restartAnnouncement;
        this.restartAnnouncement = undefined;
        this.options.onStateChanged(
            this.campaign,
            messageEvent(announcement ?? `Explore the maze. Find ${this.currentObjectiveLabel()}.`)
        );
        this.game.canvas.dataset.campaignVictory = String(
            this.campaign.flags.includes(CAMPAIGN_VICTORY_FLAG)
        );

        if (this.campaign.overworld.pendingDefeatChoice) {
            this.showDefeatChoice();
        } else if (this.campaign.flags.includes(CAMPAIGN_VICTORY_FLAG)) {
            this.showCampaignVictory(false);
        } else if (this.campaign.pendingLevelReward) {
            this.showLevelReward();
        } else if (this.campaign.activeEncounter) {
            this.time.delayedCall(0, () => this.showInterruptedEncounter());
        }
    }

    override update(_time: number, delta: number): void {
        if (
            this.encounterOpen ||
            this.modalContainer ||
            !this.input.enabled ||
            this.campaign.pendingLevelReward ||
            this.campaign.overworld.pendingDefeatChoice
        ) {
            return;
        }
        this.reinforcementFrameAccumulatorMs += Math.max(0, delta);
        if (this.reinforcementFrameAccumulatorMs < 1_000) return;

        const activeElapsedMs = this.reinforcementFrameAccumulatorMs;
        this.reinforcementFrameAccumulatorMs = 0;
        const result = advanceOverworldReinforcements(this.campaign, activeElapsedMs);
        if (result.state === this.campaign) return;

        this.campaign = result.state;
        this.reinforcementSaveAccumulatorMs += activeElapsedMs;
        if (result.spawnedMonsters.length > 0) {
            this.reinforcementSaveAccumulatorMs = 0;
            this.syncWorldVisuals();
            const labels = result.spawnedMonsters.map(monster =>
                MONSTER_DEFINITIONS[monster.typeId].label
            );
            this.emitState(messageEvent(
                labels.length === 1
                    ? `Reinforcement arrived: ${labels[0]}. Defeat it for money.`
                    : `${labels.length} reinforcements entered the maze.`
            ));
            return;
        }
        if (this.reinforcementSaveAccumulatorMs >= 5_000) {
            this.reinforcementSaveAccumulatorMs = 0;
            // Persist the countdown without replacing the player's current
            // live-region message every few frames.
            this.options.onStateChanged(this.campaign);
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (this.campaign.overworld.pendingDefeatChoice) {
            if (event.key.toLowerCase() === 'f') this.resolveDefeat('feather');
            if (event.key.toLowerCase() === 'r') this.resolveDefeat('retreat');
            return;
        }
        if (this.campaign.pendingLevelReward) {
            if (this.armoryRewardChoiceOpen) {
                if (event.key === '1') this.chooseLevelReward('armory-equip');
                if (event.key === '2') this.chooseLevelReward('armory-salvage');
                if (event.key === '3') this.chooseLevelReward('armory-leave');
            } else {
                if (event.key === '1') this.chooseLevelReward('repair');
                if (event.key === '2') this.chooseLevelReward('supply');
                if (event.key === '3') this.showArmoryRewardChoices();
            }
            return;
        }
        if (this.modalContainer) {
            if (this.spaceSkipAction && event.key === '2') {
                event.preventDefault();
                this.spaceSkipAction();
            } else if (this.spaceSkipAction && event.key === '1') {
                event.preventDefault();
                this.modalConfirmAction?.();
            } else if (this.encounterResultModalOpen) {
                const action = encounterResultKeyAction(event.key, event.repeat);
                if (action === 'confirm') {
                    event.preventDefault();
                    this.modalConfirmAction?.();
                } else if (action === 'cancel') {
                    event.preventDefault();
                    this.modalCancelAction?.();
                } else if (action === 'consume') {
                    event.preventDefault();
                }
            } else if (
                this.shopPreviousPageAction &&
                (event.key === 'ArrowLeft' || event.key === 'PageUp')
            ) {
                this.handleShopPageNavigation(event, this.shopPreviousPageAction);
            } else if (
                this.shopNextPageAction &&
                (event.key === 'ArrowRight' || event.key === 'PageDown')
            ) {
                this.handleShopPageNavigation(event, this.shopNextPageAction);
            } else if (
                /^[1-4]$/.test(event.key) &&
                this.shopOfferActions[Number(event.key) - 1]
            ) {
                event.preventDefault();
                this.shopOfferActions[Number(event.key) - 1]!();
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.modalConfirmAction?.();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.modalCancelAction?.();
            }
            return;
        }
        if (this.encounterOpen) return;

        const direction = directionForKey(event.key);
        if (direction) {
            event.preventDefault();
            if (this.itemTargetingId) {
                const itemId = this.itemTargetingId;
                this.itemTargetingId = null;
                this.perform({kind: 'use-item', itemId, direction});
            } else if (this.attackTargeting) {
                this.attackTargeting = false;
                this.perform({kind: 'ranged', direction});
            } else {
                this.perform({kind: 'move', direction});
            }
            return;
        }
        switch (event.key.toLowerCase()) {
            case 'f':
                if (this.itemTargetingId) {
                    this.itemTargetingId = null;
                    this.emitState(messageEvent('Item targeting cancelled.'));
                    break;
                }
                this.attackTargeting = !this.attackTargeting;
                this.emitState(messageEvent(this.attackTargeting
                    ? 'Attack targeting: choose a direction. F cancels.'
                    : 'Attack targeting cancelled.'));
                break;
            case 'q':
                this.useQuickSlot();
                break;
            case '1':
            case '2':
            case '3':
                this.useQuickSlot(Number(event.key) - 1);
                break;
            case 'e':
                this.interact();
                break;
            case 'i':
                this.showInventory();
                break;
            case '.':
            case ' ':
                event.preventDefault();
                this.perform({kind: 'wait'});
                break;
        }
    };

    private handleShopPageNavigation(event: KeyboardEvent, action: () => void): void {
        event.preventDefault();
        const duplicate = event.repeat || (
            this.lastShopNavigationKey === event.key &&
            event.timeStamp - this.lastShopNavigationTimestamp < 75
        );
        this.lastShopNavigationKey = event.key;
        this.lastShopNavigationTimestamp = event.timeStamp;
        if (!duplicate) action();
    }

    private perform(action: OverworldAction): void {
        const result = resolveOverworldAction(this.campaign, action, {difficulty: 'standard'});
        if (!result.consumedTurn && result.state === this.campaign) {
            const event = result.events.at(-1);
            if (event?.kind === 'choice-required' && action.kind === 'move') {
                this.showPickupChoice(action, event);
            } else {
                this.emitState(event);
            }
            return;
        }
        this.campaign = result.state;
        this.drawMaze();
        this.syncWorldVisuals();
        this.syncPlayerMarker();
        this.emitState(result.events.at(-1));
        if (this.campaign.overworld.pendingDefeatChoice) {
            this.showDefeatChoice();
            return;
        }
        this.checkCurrentCell();
    }

    private showPickupChoice(
        move: Extract<OverworldAction, {kind: 'move'}>,
        event: Extract<OverworldEvent, {kind: 'choice-required'}>
    ): void {
        this.destroyModal();
        this.emitState(event);
        const height = Math.min(430, 160 + event.options.length * 52);
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 540, height, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -height / 2 + 36, 'LOOT CHOICE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -height / 2 + 72, event.message, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            align: 'center',
            wordWrap: {width: 475}
        }).setOrigin(0.5));

        const choose = (optionId: string): void => {
            const replacementChoice = optionId.startsWith('equip-')
                ? optionId.slice('equip-'.length) as 'store' | 'salvage' | 'leave'
                : undefined;
            const choice = optionId === 'equip' || replacementChoice
                ? 'equip'
                : optionId as 'salvage' | 'leave' | ItemChoiceId;
            this.destroyModal();
            this.perform({
                ...move,
                pickup: {
                    itemId: event.itemId,
                    choice,
                    ...(replacementChoice ? {replacementChoice} : {})
                }
            });
        };
        event.options.forEach((option, index) => {
            const y = -height / 2 + 118 + index * 48;
            const button = this.add.text(0, y, option.label, {
                color: '#f5f0df',
                backgroundColor: option.id === 'leave' ? '#806b4f' : '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                align: 'center',
                padding: {x: 14, y: 9},
                fixedWidth: 450
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', () => choose(option.id));
            container.add(button);
        });
        this.activateModal(container);
        this.modalConfirmAction = event.options[0]
            ? () => choose(event.options[0]!.id)
            : null;
        const leave = event.options.find(option => option.id === 'leave');
        this.modalCancelAction = leave ? () => choose(leave.id) : () => this.destroyModal();
    }

    private useQuickSlot(slot = 0): void {
        const itemId = this.campaign.player.quickSlotItemIds[slot] ??
            this.campaign.player.backpack.find(item =>
                ['health-potion', 'antidote'].includes(item.baseTypeId)
            )?.id;
        if (!itemId) {
            this.emitState(messageEvent(`No item is assigned to quick slot ${slot + 1}.`));
            return;
        }
        this.perform({kind: 'use-item', itemId});
    }

    private interact(): void {
        const objective = this.objectiveAtPlayer();
        if (objective) {
            const status = getObjectiveStatus(this.campaign.flags, objective.objectiveId);
            if (status === 'locked') {
                this.emitState(messageEvent(objectiveLockedMessage(objective.objectiveId)));
                return;
            }
            if (status === 'available') {
                if (objective.objectiveId === 'space') this.showSpaceOptions(objective);
                else this.openEncounter(objective);
                return;
            }
            this.showSanctuaryService(objective.objectiveId);
            return;
        }

        const serviceSite = this.serviceSiteAtPlayer();
        if (serviceSite) {
            if (serviceSite.kind === 'shop') {
                this.showShop();
            } else {
                this.openCasino(serviceSite);
            }
            return;
        }

        const adjacentTrap = this.campaign.overworld.traps.find(trap => {
            const distance = Math.abs(trap.position.x - this.campaign.overworld.playerPosition.x) +
                Math.abs(trap.position.y - this.campaign.overworld.playerPosition.y);
            return distance === 1 && trap.revealed && !trap.disabled;
        });
        if (adjacentTrap) {
            const direction = Object.entries(DIRECTION_VECTORS).find(([, vector]) =>
                this.campaign.overworld.playerPosition.x + vector.x === adjacentTrap.position.x &&
                this.campaign.overworld.playerPosition.y + vector.y === adjacentTrap.position.y
            )?.[0] as DirectionId | undefined;
            if (direction) this.perform({kind: 'disarm', direction});
            return;
        }
        this.emitState(messageEvent('Nothing here needs interaction.'));
    }

    private showSanctuaryService(objectiveId: ObjectiveId): void {
        const claims = this.campaign.overworld.sanctuaryServiceClaims;
        const unclaimed = this.campaign.overworld.objectives.find(placement => {
            const definition = OBJECTIVE_BY_ID[placement.objectiveId];
            return this.campaign.flags.includes(definition.completionFlag) &&
                !claims.includes(definition.id);
        })?.objectiveId;
        if (!unclaimed) {
            this.emitState(messageEvent('This sanctuary has no unused service.'));
            return;
        }
        this.destroyModal();
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, 270, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -92, 'SANCTUARY SERVICE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '25px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -52,
            `Spend the ${OBJECTIVE_BY_ID[unclaimed].label} entitlement.`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '16px'
            }
        ).setOrigin(0.5));
        const choose = (service: 'heal' | 'recharge'): void => {
            this.destroyModal();
            this.perform({kind: 'claim-sanctuary-service', objectiveId, service});
        };
        const heal = this.add.text(0, 0, 'RESTORE 2 HEALTH · 2 SCRAP', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            padding: {x: 16, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const recharge = this.add.text(0, 55, 'RESTORE 1 UTILITY CHARGE · 3 SCRAP', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            padding: {x: 16, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const close = this.add.text(0, 103, 'CANCEL', {
            color: '#f5f0df',
            backgroundColor: '#806b4f',
            fontFamily: 'Georgia, serif',
            fontSize: '15px',
            padding: {x: 14, y: 8}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        heal.on('pointerdown', () => choose('heal'));
        recharge.on('pointerdown', () => choose('recharge'));
        close.on('pointerdown', () => this.destroyModal());
        container.add([heal, recharge, close]);
        this.activateModal(container);
        this.modalConfirmAction = () => choose('heal');
        this.modalCancelAction = () => this.destroyModal();
    }

    private spaceSkipFailureMessage(reason: SpaceObjectiveSkipFailureReason): string {
        switch (reason) {
            case 'objective-locked':
                return 'Space clearance cannot be purchased until Pipe and Lock are complete.';
            case 'objective-already-completed':
                return 'The Orbital Corridor is already cleared.';
            case 'insufficient-funds':
                return `Space clearance costs $${SPACE_OBJECTIVE_SKIP_COST}. ` +
                    'Defeat reinforcements or play a card table to earn more.';
        }
    }

    private showSpaceOptions(placement: LevelObjectivePlacement): void {
        this.destroyModal();
        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(500);
        container.add(this.add.rectangle(0, 0, 540, 350, 0x101b2b, 0.98)
            .setStrokeStyle(3, 0x69e4ff));
        container.add(this.add.text(0, -132, 'ORBITAL CORRIDOR', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -89,
            `Wallet $${this.campaign.player.money}`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '18px'
            }
        ).setOrigin(0.5));
        container.add(this.add.text(0, -51,
            'Fly the mission, or purchase a one-level flight clearance.\n' +
            'Either choice completes Space toward this level’s exit requirement.',
            {
                color: '#d8e9f2',
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                align: 'center',
                lineSpacing: 5
            }
        ).setOrigin(0.5));

        const play = (): void => {
            this.destroyModal();
            this.openEncounter(placement);
        };
        const skip = (): void => {
            const result = purchaseSpaceObjectiveSkip(this.campaign);
            if (!result.ok) {
                this.emitState(messageEvent(this.spaceSkipFailureMessage(result.reason)));
                return;
            }
            this.campaign = {
                ...result.state,
                overworld: {
                    ...result.state.overworld,
                    sanctuaryPosition: placement.position,
                    resumeGraceTurns: 1
                }
            };
            this.destroyModal();
            this.syncWorldVisuals();
            this.syncPlayerMarker();
            this.emitState(messageEvent(
                `Space clearance purchased for $${SPACE_OBJECTIVE_SKIP_COST}. ` +
                'Space is complete for this level.'
            ));
            this.showEncounterResult(placement, {status: 'success'});
        };
        const addOption = (
            y: number,
            label: string,
            color: string,
            action: () => void
        ): void => {
            const button = this.add.text(0, y, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                padding: {x: 16, y: 11},
                fixedWidth: 430
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
        };
        addOption(25, '1 · FLY THE SPACE MISSION', '#382f54', play);
        addOption(
            86,
            `2 · PAY $${SPACE_OBJECTIVE_SKIP_COST} TO SKIP`,
            this.campaign.player.money >= SPACE_OBJECTIVE_SKIP_COST ? '#3b654a' : '#66343a',
            skip
        );
        addOption(143, 'ESC · NOT YET', '#806b4f', () => this.destroyModal());

        this.activateModal(container);
        this.modalConfirmAction = play;
        this.modalCancelAction = () => this.destroyModal();
        this.spaceSkipAction = skip;
        this.game.canvas.dataset.spaceOptionsOpen = 'true';
        this.game.canvas.dataset.spaceSkipAffordable = String(
            this.campaign.player.money >= SPACE_OBJECTIVE_SKIP_COST
        );
    }

    private shopFailureMessage(
        reason: ShopPurchaseFailureReason,
        offerId: string | null
    ): string {
        switch (reason) {
            case 'unknown-offer':
                return 'That offer is no longer available.';
            case 'insufficient-funds':
                return 'Not enough money. Monsters and card tables can replenish your wallet.';
            case 'inventory-full':
                return 'Your backpack is full. Salvage or use something before buying.';
            case 'already-owned':
                return offerId === 'getaway-car'
                    ? 'Getaway Car already owned. Casino Heist is unlocked.'
                    : 'That permanent upgrade is already installed.';
            case 'upgrade-at-cap':
                return 'That upgrade is already at its maximum.';
        }
    }

    private showShop(page = 0): void {
        this.destroyModal();
        const pageSize = 4;
        const pageCount = Math.ceil(SHOP_CATALOG.length / pageSize);
        const boundedPage = Phaser.Math.Clamp(page, 0, pageCount - 1);
        const offers = SHOP_CATALOG.slice(
            boundedPage * pageSize,
            boundedPage * pageSize + pageSize
        );
        const carOwned = this.campaign.flags.includes(CASINO_HEIST_UNLOCK_FLAG);
        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(500);
        container.add(this.add.rectangle(0, 0, 574, 618, 0x171918, 0.98)
            .setStrokeStyle(3, 0xd7a64a));
        container.add(this.add.text(0, -274, 'WANDERING SHOP', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -238,
            `Wallet $${this.campaign.player.money}  ·  Page ${boundedPage + 1}/${pageCount}`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                wordWrap: {width: 440}
            }
        ).setOrigin(0.5));

        const buy = (offerId: string): void => {
            const result = purchaseShopOffer(this.campaign, offerId);
            if (!result.ok) {
                this.emitState(messageEvent(
                    this.shopFailureMessage(result.reason, result.offer?.id ?? null)
                ));
                return;
            }
            this.campaign = result.state;
            this.emitState(messageEvent(
                `${result.offer.label} purchased for $${result.offer.price}.`
            ));
            this.showShop(boundedPage);
        };

        offers.forEach((offer, index) => {
            const y = -170 + index * 102;
            const owned = offer.kind === 'upgrade'
                ? this.campaign.player.installedModuleIds.includes(offer.upgradeId)
                : offer.id === 'getaway-car' && carOwned;
            const affordable = this.campaign.player.money >= offer.price;
            const button = this.add.text(0, y,
                `${index + 1} · ${offer.label}  ·  ${owned ? 'OWNED' : `$${offer.price}`}`,
                {
                    color: owned ? '#b6bac2' : '#f5f0df',
                    backgroundColor: owned
                        ? '#424646'
                        : affordable ? '#382f54' : '#66343a',
                    fontFamily: 'Georgia, serif',
                    fontSize: '17px',
                    align: 'center',
                    padding: {x: 14, y: 9},
                    fixedWidth: 500
                }
            ).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            const description = this.add.text(0, y + 37, offer.description, {
                color: '#d8d2c4',
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                align: 'center',
                wordWrap: {width: 500}
            }).setOrigin(0.5);
            button.on('pointerdown', () => buy(offer.id));
            container.add([button, description]);
        });

        const addFooterButton = (
            x: number,
            label: string,
            action: () => void,
            color = '#382f54'
        ): Phaser.GameObjects.Text => {
            const button = this.add.text(x, 270, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                padding: {x: 14, y: 9}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
            return button;
        };
        const previousPage = () =>
            this.showShop((boundedPage - 1 + pageCount) % pageCount);
        const nextPage = () =>
            this.showShop((boundedPage + 1) % pageCount);
        addFooterButton(-185, '◀ PREV', previousPage);
        addFooterButton(185, 'NEXT ▶', nextPage);
        addFooterButton(0, 'CLOSE', () => this.destroyModal(), '#806b4f');

        this.activateModal(container);
        this.modalConfirmAction = offers[0] ? () => buy(offers[0]!.id) : null;
        this.modalCancelAction = () => this.destroyModal();
        this.shopPreviousPageAction = previousPage;
        this.shopNextPageAction = nextPage;
        this.shopOfferActions = offers.map(offer => () => buy(offer.id));
        this.game.canvas.dataset.shopOpen = 'true';
        this.game.canvas.dataset.shopPage = String(boundedPage);
        this.game.canvas.dataset.shopCarOwned = String(carOwned);
    }

    private openCasino(site: LevelServicePlacement): void {
        if (this.encounterOpen || site.kind === 'shop') return;
        const definition = SERVICE_SITE_DEFINITIONS[site.kind];
        const sessionSeed = deriveSeed(
            this.campaign.overworld.seed,
            `${site.id}:session:${this.campaign.overworld.turn}:${this.campaign.player.money}`,
            this.casinoSessionOrdinal++
        );
        const onBankrollChanged = (bankroll: number, message: string): void => {
            if (!Number.isSafeInteger(bankroll) || bankroll < 0) {
                throw new Error('Casino bankroll must remain a non-negative safe integer.');
            }
            this.campaign = {
                ...this.campaign,
                player: {...this.campaign.player, money: bankroll}
            };
            this.emitState(messageEvent(message));
        };
        const onExit = (): void => {
            this.encounterOpen = false;
            this.input.enabled = true;
            this.options.onEncounterChanged(null);
            this.scene.resume();
            this.emitState(messageEvent(
                `${definition.label} closed. Wallet $${this.campaign.player.money}.`
            ));
        };

        this.encounterOpen = true;
        this.input.enabled = false;
        this.options.onEncounterChanged(site.kind);
        if (site.kind === 'blackjack') {
            const launch: BlackjackLaunchData = {
                seed: sessionSeed,
                bankroll: this.campaign.player.money,
                onBankrollChanged,
                onExit
            };
            this.scene.launch(BLACKJACK_SCENE_KEY, launch);
        } else {
            const launch: HoldemLaunchData = {
                seed: sessionSeed,
                bankroll: this.campaign.player.money,
                onBankrollChanged,
                onExit
            };
            this.scene.launch(HOLDEM_SCENE_KEY, launch);
        }
        this.scene.pause();
    }

    private checkCurrentCell(): void {
        const objective = this.objectiveAtPlayer();
        if (objective) {
            const status = getObjectiveStatus(this.campaign.flags, objective.objectiveId);
            if (status === 'available') {
                if (objective.objectiveId === 'space') this.showSpaceOptions(objective);
                else this.openEncounter(objective);
            }
            else if (status === 'locked') {
                this.emitState(messageEvent(objectiveLockedMessage(objective.objectiveId)));
            }
            return;
        }
        const serviceSite = this.serviceSiteAtPlayer();
        if (serviceSite) {
            const definition = SERVICE_SITE_DEFINITIONS[serviceSite.kind];
            this.emitState(messageEvent(
                `${definition.label}. Press E or tap E to ${
                    serviceSite.kind === 'shop' ? 'browse' : 'play'
                }. Optional — the exit does not require it.`
            ));
            return;
        }
        if (this.hasReachedExit()) this.handleExit();
    }

    private objectiveAtPlayer(): LevelObjectivePlacement | null {
        return this.campaign.overworld.objectives.find(objective =>
            samePosition(objective.position, this.campaign.overworld.playerPosition)
        ) ?? null;
    }

    private serviceSiteAtPlayer(): LevelServicePlacement | null {
        return this.campaign.overworld.serviceSites.find(site =>
            samePosition(site.position, this.campaign.overworld.playerPosition)
        ) ?? null;
    }

    private currentObjectiveLabel(): string {
        return getCurrentObjective(this.campaign)?.label ?? 'the exit';
    }

    private attemptOrdinal(triggerId: string): number {
        return this.campaign.encounterHistory.filter(entry => entry.triggerId === triggerId).length;
    }

    private encounterSeed(definition: ObjectiveDefinition, ordinal: number): number {
        const namespace = definition.id === 'space'
            ? 'space-attempt'
            : `${definition.id}-attempt`;
        return deriveSeed(this.campaign.overworld.seed, namespace, ordinal);
    }

    private nearbyMaterials(position: {readonly x: number; readonly y: number}): {
        readonly ids: readonly MaterialId[];
        readonly tags: readonly MaterialTag[];
    } {
        const ids = new Set<MaterialId>();
        for (let y = position.y - 2; y <= position.y + 2; y++) {
            for (let x = position.x - 2; x <= position.x + 2; x++) {
                const cell = this.campaign.overworld.maze[y]?.[x];
                if (cell?.kind === 'wall') ids.add(cell.materialId);
            }
        }
        const tags = new Set<MaterialTag>();
        for (const id of ids) for (const tag of MATERIALS[id].tags) tags.add(tag);
        return {ids: [...ids], tags: [...tags]};
    }

    private buildEncounterContext(
        placement: LevelObjectivePlacement,
        record: ActiveEncounterRecord
    ): EncounterContext {
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        const nearby = this.nearbyMaterials(placement.position);
        const baseModifiers: Record<string, string | number | boolean> = {
            levelTier: getLevelTier(this.campaign)
        };
        const bonusTarget = placement.objectiveId === 'space'
            ? 'shooter'
            : placement.objectiveId;
        Object.assign(
            baseModifiers,
            getMinigameItemBonus(this.campaign.player, bonusTarget).modifiers
        );
        if (placement.objectiveId === 'pipe' && this.campaign.overworld.pipeShortcutWall) {
            baseModifiers.benefitX = this.campaign.overworld.pipeShortcutWall.x;
            baseModifiers.benefitY = this.campaign.overworld.pipeShortcutWall.y;
        }
        if (placement.objectiveId === 'lock') baseModifiers.lockFamily = 'pin-tension';
        if (placement.objectiveId === 'space') {
            baseModifiers.poweredShield = this.campaign.flags.includes('coolant-routing-restored');
            baseModifiers.archiveIntel = this.campaign.flags.includes('archive-lock-opened');
            baseModifiers.securityAlert = this.campaign.worldSystems.securityAlert;
        }
        if (placement.objectiveId === 'platformer') {
            baseModifiers.toolBridge = this.campaign.player.miningPower >= 2;
            baseModifiers.supplyBridge = this.campaign.worldSystems.airspaceControl >= 60;
            baseModifiers.poweredLift = this.campaign.worldSystems.powerRouting >= 60;
        }
        return {
            runId: record.runId,
            definitionId: definition.definitionId,
            kind: definition.kind,
            act: this.campaign.act,
            seed: record.seed,
            difficulty: 'standard',
            campaignSnapshot: this.campaign,
            trigger: {
                triggerId: definition.triggerId,
                position: placement.position,
                nearbyMaterialIds: nearby.ids,
                nearbyMaterialTags: nearby.tags
            },
            modifiers: baseModifiers
        };
    }

    private openEncounter(
        placement: LevelObjectivePlacement,
        existingRecord?: ActiveEncounterRecord
    ): void {
        if (this.encounterOpen) return;
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        if (getObjectiveStatus(this.campaign.flags, placement.objectiveId) !== 'available') return;
        const ordinal = existingRecord?.attemptOrdinal ?? this.attemptOrdinal(definition.triggerId);
        const record: ActiveEncounterRecord = existingRecord ?? {
            levelId: this.campaign.overworld.levelId,
            objectiveId: placement.objectiveId,
            triggerId: definition.triggerId,
            encounterKind: definition.kind,
            attemptOrdinal: ordinal,
            runId: `${this.campaign.overworld.levelId}/${definition.triggerId}/${ordinal}`,
            seed: this.encounterSeed(definition, ordinal)
        };
        this.campaign = {...this.campaign, activeEncounter: record};
        this.emitState(messageEvent(`${definition.label} started.`));
        this.encounterOpen = true;
        this.input.enabled = false;
        this.options.onEncounterChanged(definition.kind);
        const context = this.buildEncounterContext(placement, record);
        const complete = (result: EncounterResult) =>
            this.completeEncounter(placement.objectiveId, result);

        switch (placement.objectiveId) {
            case 'pipe': {
                const launch: PipeDreamLaunchData = {context, onComplete: complete};
                this.scene.launch(PIPE_DREAM_SCENE_KEY, launch);
                break;
            }
            case 'lock': {
                const launch: LockpickLaunchData = {
                    context,
                    onComplete: complete,
                    onTutorialSeen: () => {
                        if (this.campaign.flags.includes('tutorial-lock-seen')) return;
                        this.campaign = {
                            ...this.campaign,
                            flags: [...this.campaign.flags, 'tutorial-lock-seen']
                        };
                        this.emitState(messageEvent('Lock tutorial recorded.'));
                    }
                };
                this.scene.launch(LOCKPICK_SCENE_KEY, launch);
                break;
            }
            case 'space': {
                const launch: ShooterLaunchData = {context, onComplete: complete};
                this.scene.launch(SHOOTER_SCENE_KEY, launch);
                break;
            }
            case 'platformer': {
                const launch: PlatformerLaunchData = {context, onComplete: complete};
                this.scene.launch(PLATFORMER_SCENE_KEY, launch);
                break;
            }
            case 'circuit': {
                const launch: CircuitCrushLaunchData = {context, onComplete: complete};
                this.scene.launch(CIRCUIT_CRUSH_SCENE_KEY, launch);
                break;
            }
            case 'horsemaster': {
                const launch: HorsemasterLaunchData = {context, onComplete: complete};
                this.scene.launch(HORSEMASTER_SCENE_KEY, launch);
                break;
            }
            case 'zapper': {
                const launch: ZapperLaunchData = {context, onComplete: complete};
                this.scene.launch(ZAPPER_SCENE_KEY, launch);
                break;
            }
            case 'casino-heist': {
                const launch: CasinoHeistLaunchData = {context, onComplete: complete};
                this.scene.launch(CASINO_HEIST_SCENE_KEY, launch);
                break;
            }
        }
        this.scene.pause();
    }

    private resumeInterruptedEncounter(): void {
        const record = this.campaign.activeEncounter;
        if (!record) return;
        const placement = this.campaign.overworld.objectives.find(objective =>
            objective.objectiveId === record.objectiveId &&
            samePosition(objective.position, this.campaign.overworld.playerPosition)
        );
        if (!placement) {
            this.campaign = {...this.campaign, activeEncounter: null};
            this.emitState(messageEvent('Interrupted attempt was invalid and has been cleared.'));
            return;
        }
        this.openEncounter(placement, record);
    }

    private showInterruptedEncounter(): void {
        const record = this.campaign.activeEncounter;
        if (!record) return;
        const definition = OBJECTIVE_BY_ID[record.objectiveId];
        const placement = this.campaign.overworld.objectives.find(objective =>
            objective.objectiveId === record.objectiveId &&
            samePosition(objective.position, this.campaign.overworld.playerPosition)
        );
        if (!placement || definition.triggerId !== record.triggerId) {
            this.campaign = {...this.campaign, activeEncounter: null};
            this.emitState(messageEvent('Interrupted attempt was invalid and has been cleared.'));
            return;
        }

        this.destroyModal();
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, 250, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -78, 'ATTEMPT INTERRUPTED', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '26px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -34,
            `${definition.label} can resume from the same saved seed.`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px'
            }
        ).setOrigin(0.5));
        const retry = this.add.text(-105, 48, 'ENTER · RETRY', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const back = this.add.text(115, 48, 'ESC · RETURN', {
            color: '#f5f0df',
            backgroundColor: '#806b4f',
            fontFamily: 'Georgia, serif',
            fontSize: '17px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const retryAttempt = (): void => {
            this.destroyModal();
            this.resumeInterruptedEncounter();
        };
        const returnToMaze = (): void => {
            this.destroyModal();
            const abandoned = applyEncounterResult(this.campaign, {
                runId: record.runId,
                definitionId: definition.definitionId,
                triggerId: record.triggerId,
                kind: record.encounterKind,
                status: 'abandoned',
                grade: 'none',
                score: 0,
                elapsedMs: 0,
                effects: []
            });
            this.campaign = {...abandoned, activeEncounter: null};
            this.emitState(messageEvent(`${definition.label} attempt returned to the maze.`));
        };
        retry.on('pointerdown', retryAttempt);
        back.on('pointerdown', returnToMaze);
        container.add([retry, back]);
        this.activateModal(container);
        this.modalConfirmAction = retryAttempt;
        this.modalCancelAction = returnToMaze;
        this.game.canvas.dataset.encounterOverlay = 'interrupted';
    }

    private showEncounterResult(
        placement: LevelObjectivePlacement,
        result: Pick<EncounterResult, 'status' | 'failureReason'>
    ): void {
        const definition = OBJECTIVE_BY_ID[placement.objectiveId];
        this.destroyModal();
        const successful = result.status === 'success';
        const presentation = getEncounterResultPresentation(
            definition.label,
            result,
            getLevelExitStatus(this.campaign).ready
        );
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, successful ? 215 : 260, 0x171918, 0.97)
            .setStrokeStyle(3, successful ? 0x5bbf72 : 0xd83847));
        container.add(this.add.text(0, successful ? -60 : -82,
            presentation.title,
            {
                color: successful ? '#76d58b' : '#efc75e',
                fontFamily: 'Georgia, serif',
                fontSize: '27px'
            }
        ).setOrigin(0.5));
        const detailIsMultiline = presentation.detail.includes('\n');
        container.add(this.add.text(0, successful ? -18 : detailIsMultiline ? -35 : -39,
            presentation.detail,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center',
                lineSpacing: 3,
                wordWrap: {width: 430, useAdvancedWrap: true}
            }
        ).setOrigin(0.5));

        const returnToMaze = (): void => {
            this.destroyModal();
            this.emitState(messageEvent(presentation.returnMessage));
        };
        const continueButton = this.add.text(successful ? 0 : 118, successful ? 45 : 48,
            successful ? 'ENTER · CONTINUE' : 'ESC · RETURN',
            {
                color: '#f5f0df',
                backgroundColor: '#806b4f',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                padding: {x: 16, y: 12}
            }
        ).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        continueButton.on('pointerdown', returnToMaze);
        container.add(continueButton);

        this.modalConfirmAction = returnToMaze;
        this.modalCancelAction = returnToMaze;
        if (!successful) {
            const retryAttempt = (): void => {
                this.destroyModal();
                this.openEncounter(placement);
            };
            const retry = this.add.text(-118, 48, 'ENTER · RETRY', {
                color: '#f5f0df',
                backgroundColor: '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                padding: {x: 16, y: 12}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            retry.on('pointerdown', retryAttempt);
            container.add(retry);
            this.modalConfirmAction = retryAttempt;
        }
        this.activateModal(container);
        this.encounterResultModalOpen = true;
        this.game.canvas.dataset.encounterOverlay = successful ? 'success' : 'retry';
    }

    private completeEncounter(objectiveId: ObjectiveId, result: EncounterResult): void {
        const record = this.campaign.activeEncounter;
        const definition = OBJECTIVE_BY_ID[objectiveId];
        if (
            !record ||
            record.runId !== result.runId ||
            record.objectiveId !== objectiveId ||
            record.triggerId !== result.triggerId ||
            record.encounterKind !== result.kind ||
            definition.definitionId !== result.definitionId
        ) {
            return;
        }
        let next = commitObjectiveResult(this.campaign, objectiveId, result);
        next = {...next, activeEncounter: null};
        if (result.status === 'success') {
            const placement = getObjectivePlacement(next.overworld.objectives, objectiveId);
            next = {
                ...next,
                overworld: {
                    ...next.overworld,
                    sanctuaryPosition: placement.position,
                    resumeGraceTurns: 1,
                    ...(objectiveId === 'pipe' ? {pipeShortcutWall: null} : {})
                }
            };
        } else {
            next = {
                ...next,
                overworld: {...next.overworld, resumeGraceTurns: 1}
            };
        }
        if (next.player.health === 0) {
            next = resolveCampaignDefeat(next, 'encounter').state;
        }
        this.campaign = next;
        this.encounterOpen = false;
        this.input.enabled = true;
        this.options.onEncounterChanged(null);
        this.drawMaze();
        this.syncWorldVisuals();
        this.syncPlayerMarker();
        this.emitState(messageEvent(
            result.status === 'success'
                ? `${OBJECTIVE_BY_ID[objectiveId].label} complete. Sanctuary activated.`
                : `${OBJECTIVE_BY_ID[objectiveId].label} attempt ended. You may retry.`
        ));
        this.scene.resume();
        if (this.campaign.overworld.pendingDefeatChoice) this.showDefeatChoice();
        else this.showEncounterResult(
            getObjectivePlacement(this.campaign.overworld.objectives, objectiveId),
            result
        );
    }

    private handleExit(): void {
        const status = getLevelExitStatus(this.campaign);
        if (!status.ready) {
            this.emitState(messageEvent(
                `Exit locked ${status.completed}/${status.total}. Next: ${status.nextLabel}.`
            ));
            return;
        }
        if (getCampaignLevelNumber(this.campaign) >= MAX_CAMPAIGN_LEVEL) {
            if (!this.campaign.flags.includes(CAMPAIGN_VICTORY_FLAG)) {
                this.campaign = {
                    ...this.campaign,
                    flags: [...this.campaign.flags, CAMPAIGN_VICTORY_FLAG],
                    pendingLevelReward: null
                };
                this.emitState(messageEvent(
                    'All eight trials are complete. The Ultra Horse Gym celebrates your victory!'
                ));
            }
            this.showCampaignVictory(true);
            return;
        }
        if (!this.campaign.pendingLevelReward) {
            this.perform({kind: 'wait'});
            return;
        }
        this.showLevelReward();
    }

    private showCampaignVictory(playFanfare: boolean): void {
        this.destroyModal();
        this.armoryRewardChoiceOpen = false;
        const canvas = this.game.canvas;
        canvas.dataset.campaignVictory = 'true';
        canvas.dataset.victoryOverlay = 'open';
        canvas.dataset.victoryHorse = 'dancing';

        const container = this.add.container(
            this.cameras.main.width / 2,
            this.cameras.main.height / 2
        ).setScrollFactor(0).setDepth(600);
        container.add(this.add.rectangle(0, 0, 570, 510, 0x111714, 0.98)
            .setStrokeStyle(4, 0xefc75e));
        container.add(this.add.text(0, -218, 'MAZE MASTERED!', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '34px',
            fontStyle: 'bold'
        }).setOrigin(0.5));
        container.add(this.add.text(
            0,
            -170,
            `LEVEL ${MAX_CAMPAIGN_LEVEL} COMPLETE\nALL EIGHT MINIGAMES CLEARED`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '18px',
                fontStyle: 'bold',
                align: 'center',
                lineSpacing: 5
            }
        ).setOrigin(0.5));

        const gymSign = this.add.rectangle(0, 86, 310, 94, 0x51358f)
            .setStrokeStyle(3, 0xc59cff);
        const gymLabel = this.add.text(0, 86, 'ULTRA HORSE GYM', {
            color: '#fff7df',
            fontFamily: 'Georgia, serif',
            fontSize: '24px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        container.add([gymSign, gymLabel]);
        this.victoryHorse = this.createDancingVictoryHorse();
        container.add(this.victoryHorse);

        const fanfare = this.add.text(-128, 194, '♪ PLAY FANFARE', {
            color: '#171918',
            backgroundColor: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            fontStyle: 'bold',
            padding: {x: 15, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        fanfare.on('pointerdown', () => this.playVictoryFanfare());

        const explore = this.add.text(132, 194, 'ENTER · KEEP EXPLORING', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            padding: {x: 15, y: 11}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        explore.on('pointerdown', () => this.destroyModal());
        container.add([fanfare, explore]);

        this.activateModal(container);
        this.modalConfirmAction = () => this.destroyModal();
        this.modalCancelAction = () => this.destroyModal();
        if (playFanfare) this.playVictoryFanfare();
    }

    private createDancingVictoryHorse(): Phaser.GameObjects.Container {
        const horse = this.add.container(0, -20);
        const art = this.add.graphics();
        art.fillStyle(0xa65d32);
        art.fillEllipse(0, 8, 116, 54);
        art.fillCircle(50, -25, 28);
        art.fillStyle(0xe9ae68);
        art.fillTriangle(36, -49, 43, -73, 53, -47);
        art.fillTriangle(57, -47, 69, -70, 70, -39);
        art.fillEllipse(61, -20, 18, 12);
        art.fillStyle(0x4c2d22);
        art.fillTriangle(25, -34, 43, -52, 34, -15);
        art.fillTriangle(-53, -2, -88, -20, -58, 17);
        art.fillStyle(0x171918);
        art.fillCircle(58, -31, 3);
        art.lineStyle(8, 0xa65d32);
        art.lineBetween(-34, 24, -48, 61);
        art.lineBetween(-8, 27, -2, 64);
        art.lineBetween(21, 25, 11, 61);
        art.lineBetween(42, 17, 56, 56);
        art.lineStyle(4, 0x4c2d22);
        art.lineBetween(-54, 61, -39, 61);
        art.lineBetween(-7, 64, 8, 64);
        art.lineBetween(6, 61, 22, 61);
        art.lineBetween(52, 56, 68, 56);
        art.fillStyle(0xefc75e);
        art.fillTriangle(39, -63, 48, -88, 56, -62);
        art.fillTriangle(50, -62, 62, -88, 67, -56);
        art.fillRect(39, -64, 29, 9);
        const leftNote = this.add.text(-116, -46, '♪', {
            color: '#67d5e8',
            fontSize: '34px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const rightNote = this.add.text(112, -27, '♫', {
            color: '#ef6f9d',
            fontSize: '34px',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        horse.add([art, leftNote, rightNote]);
        this.tweens.add({
            targets: horse,
            y: -35,
            angle: 5,
            duration: 310,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
        this.tweens.add({
            targets: [leftNote, rightNote],
            y: '-=12',
            scale: 1.2,
            alpha: 0.45,
            duration: 440,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
        return horse;
    }

    private playVictoryFanfare(): void {
        const canvas = this.game.canvas;
        canvas.dataset.victoryFanfare = 'attempted';
        type AudioContextConstructor = new (
            contextOptions?: AudioContextOptions
        ) => AudioContext;
        const browserWindow = window as typeof window & {
            readonly webkitAudioContext?: AudioContextConstructor;
        };
        const AudioContextClass: AudioContextConstructor | undefined =
            window.AudioContext ?? browserWindow.webkitAudioContext;
        if (!AudioContextClass) {
            canvas.dataset.victoryFanfare = 'unavailable';
            return;
        }
        try {
            const audio = new AudioContextClass();
            const schedule = (): void => {
                const start = audio.currentTime + 0.03;
                const notes = [
                    {frequency: 523.25, offset: 0, duration: 0.2},
                    {frequency: 659.25, offset: 0.2, duration: 0.2},
                    {frequency: 783.99, offset: 0.4, duration: 0.2},
                    {frequency: 1046.5, offset: 0.6, duration: 0.55},
                    {frequency: 783.99, offset: 1.15, duration: 0.18},
                    {frequency: 987.77, offset: 1.33, duration: 0.18},
                    {frequency: 1318.51, offset: 1.51, duration: 0.72}
                ] as const;
                const master = audio.createGain();
                master.gain.setValueAtTime(0.24, start);
                master.connect(audio.destination);
                let finalOscillator: OscillatorNode | null = null;
                for (const note of notes) {
                    const oscillator = audio.createOscillator();
                    const envelope = audio.createGain();
                    const noteStart = start + note.offset;
                    oscillator.type = 'triangle';
                    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
                    envelope.gain.setValueAtTime(0.0001, noteStart);
                    envelope.gain.exponentialRampToValueAtTime(0.34, noteStart + 0.025);
                    envelope.gain.exponentialRampToValueAtTime(
                        0.0001,
                        noteStart + note.duration
                    );
                    oscillator.connect(envelope);
                    envelope.connect(master);
                    oscillator.start(noteStart);
                    oscillator.stop(noteStart + note.duration + 0.03);
                    finalOscillator = oscillator;
                }
                canvas.dataset.victoryFanfare = 'playing';
                if (finalOscillator) {
                    finalOscillator.addEventListener('ended', () => {
                        canvas.dataset.victoryFanfare = 'played';
                        void audio.close();
                    }, {once: true});
                }
            };
            if (audio.state === 'suspended') {
                void audio.resume().then(schedule).catch(() => {
                    canvas.dataset.victoryFanfare = 'blocked';
                    void audio.close();
                });
            } else {
                schedule();
            }
        } catch {
            canvas.dataset.victoryFanfare = 'unavailable';
        }
    }

    private showLevelReward(): void {
        this.destroyModal();
        this.armoryRewardChoiceOpen = false;
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 500, 300, 0x171918, 0.96)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -110, 'LEVEL COMPLETE', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '28px'
        }).setOrigin(0.5));
        const choices = [
            {id: 'repair' as const, label: '1 · REPAIR  +5 health and Potion'},
            {id: 'supply' as const, label: '2 · SUPPLY  tools, arrows, utility'},
            {id: 'armory' as const, label: '3 · ARMORY  inspect rolled equipment'}
        ];
        choices.forEach((choice, index) => {
            const button = this.add.text(0, -45 + index * 62, choice.label, {
                color: '#f5f0df',
                backgroundColor: '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '18px',
                padding: {x: 16, y: 12}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', () => {
                if (choice.id === 'armory') this.showArmoryRewardChoices();
                else this.chooseLevelReward(choice.id);
            });
            container.add(button);
        });
        this.activateModal(container);
    }

    private showArmoryRewardChoices(): void {
        const reward = this.campaign.pendingLevelReward;
        if (!reward) return;
        this.destroyModal();
        this.armoryRewardChoiceOpen = true;
        const offer = reward.armoryOffer;
        const definition = ITEM_DEFINITIONS[offer.baseTypeId];
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 520, 315, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(0, -112, 'ARMORY OFFER', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '27px'
        }).setOrigin(0.5));
        container.add(this.add.text(0, -70,
            `${definition.label} · ${offer.quality.toUpperCase()}\n` +
            `${offer.affixIds.length ? offer.affixIds.join(', ') : 'No affixes'}`,
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                align: 'center'
            }
        ).setOrigin(0.5));
        const choices = [
            {id: 'armory-equip' as const, label: '1 · EQUIP'},
            {id: 'armory-salvage' as const, label: '2 · SALVAGE'},
            {id: 'armory-leave' as const, label: '3 · LEAVE'}
        ];
        choices.forEach((choice, index) => {
            const button = this.add.text(0, -10 + index * 58, choice.label, {
                color: '#f5f0df',
                backgroundColor: choice.id === 'armory-leave' ? '#806b4f' : '#382f54',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                padding: {x: 18, y: 11},
                fixedWidth: 330,
                align: 'center'
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', () => this.chooseLevelReward(choice.id));
            container.add(button);
        });
        this.activateModal(container);
    }

    private chooseLevelReward(
        choice:
            | 'repair'
            | 'supply'
            | 'armory-equip'
            | 'armory-salvage'
            | 'armory-leave'
    ): void {
        const result = resolveOverworldAction(this.campaign, {
            kind: 'choose-level-reward',
            choice
        });
        if (result.state === this.campaign) {
            this.emitState(result.events.at(-1));
            return;
        }
        const next = result.state;
        this.restartCampaign = next;
        this.restartAnnouncement =
            `Entered level ${getCampaignLevelNumber(next)} with ${choice.replaceAll('-', ' ')}.`;
        this.armoryRewardChoiceOpen = false;
        this.destroyModal();
        this.options.onStateChanged(next, result.events.at(-1));
        this.scene.restart();
    }

    private showDefeatChoice(): void {
        this.destroyModal();
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 460, 220, 0x171918, 0.96)
            .setStrokeStyle(3, 0xd83847));
        container.add(this.add.text(0, -70, 'DEFEATED', {
            color: '#efc75e',
            fontFamily: 'Georgia, serif',
            fontSize: '28px'
        }).setOrigin(0.5));
        const feather = this.add.text(0, -5, 'F · Use Revival Feather', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontSize: '18px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        const retreat = this.add.text(0, 55, 'R · Retreat to sanctuary', {
            color: '#f5f0df',
            backgroundColor: '#382f54',
            fontSize: '18px',
            padding: {x: 16, y: 12}
        }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
        feather.on('pointerdown', () => this.resolveDefeat('feather'));
        retreat.on('pointerdown', () => this.resolveDefeat('retreat'));
        container.add([feather, retreat]);
        this.activateModal(container);
    }

    private resolveDefeat(choice: 'feather' | 'retreat'): void {
        const result = resolveOverworldAction(this.campaign, {kind: 'resolve-defeat', choice});
        this.campaign = result.state;
        this.destroyModal();
        this.input.enabled = true;
        this.syncWorldVisuals();
        this.syncPlayerMarker();
        this.emitState(result.events.at(-1));
    }

    private showInventory(selectedIndex = 0): void {
        this.destroyModal();
        const items = this.campaign.player.backpack;
        const boundedIndex = items.length === 0
            ? 0
            : Phaser.Math.Clamp(selectedIndex, 0, items.length - 1);
        const selected = items[boundedIndex] ?? null;
        const weapon = this.campaign.player.equippedWeapon;
        const utility = this.campaign.player.equippedUtility;
        const container = this.add.container(this.cameras.main.width / 2, this.cameras.main.height / 2)
            .setScrollFactor(0)
            .setDepth(500);
        container.add(this.add.rectangle(0, 0, 520, 430, 0x171918, 0.97)
            .setStrokeStyle(3, 0xefc75e));
        container.add(this.add.text(-225, -188,
            [
                'INVENTORY',
                `Weapon: ${weapon ? ITEM_DEFINITIONS[weapon.baseTypeId].label : 'Improvised Dagger'}`,
                `Utility: ${utility ? ITEM_DEFINITIONS[utility.baseTypeId].label : 'None'}`,
                `Money $${this.campaign.player.money}  ·  Arrows ${this.campaign.player.bowAmmo}  ·  Slots ${items.length}/8`,
                '',
                selected
                    ? `${boundedIndex + 1}/${items.length}  ${ITEM_DEFINITIONS[selected.baseTypeId].label}`
                    : 'No item selected',
                selected
                    ? `${selected.quality.toUpperCase()}  ×${selected.quantity}` +
                        `${selected.charges === null ? '' : `  ·  ${selected.charges} charges`}`
                    : 'Backpack empty',
                selected?.affixIds.length
                    ? `Affixes: ${selected.affixIds.join(', ')}`
                    : selected ? 'Affixes: none' : '',
                selected?.baseTypeId === 'mystery-orb'
                    ? `Orb choices: ${selected.rolledChoiceIds.join(', ')}`
                    : ''
            ].join('\n'),
            {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '17px',
                lineSpacing: 5,
                wordWrap: {width: 450}
            }
        ));

        const addButton = (
            x: number,
            y: number,
            label: string,
            action: () => void,
            color = '#382f54'
        ): void => {
            const button = this.add.text(x, y, label, {
                color: '#f5f0df',
                backgroundColor: color,
                fontFamily: 'Georgia, serif',
                fontSize: '15px',
                padding: {x: 12, y: 10}
            }).setOrigin(0.5).setScrollFactor(0).setInteractive({useHandCursor: true});
            button.on('pointerdown', action);
            container.add(button);
        };

        if (items.length > 1) {
            addButton(-175, 45, '◀ PREV', () =>
                this.showInventory((boundedIndex - 1 + items.length) % items.length));
            addButton(175, 45, 'NEXT ▶', () =>
                this.showInventory((boundedIndex + 1) % items.length));
        }
        if (selected) {
            const definition = ITEM_DEFINITIONS[selected.baseTypeId];
            if (definition.category === 'weapon' || definition.category === 'utility') {
                addButton(-155, 105, 'EQUIP', () => {
                    this.destroyModal();
                    this.perform({kind: 'equip', itemId: selected.id});
                });
            } else if (selected.baseTypeId !== 'mystery-orb') {
                addButton(-155, 105, 'USE', () => {
                    this.destroyModal();
                    if (selected.baseTypeId === 'bomb' || selected.baseTypeId === 'snare-kit') {
                        this.itemTargetingId = selected.id;
                        this.emitState(messageEvent(
                            `Choose a direction for ${definition.label}. F cancels.`
                        ));
                    } else {
                        this.perform({kind: 'use-item', itemId: selected.id});
                    }
                });
            }
            addButton(155, 105, 'SALVAGE', () => {
                this.destroyModal();
                this.perform({kind: 'salvage', itemId: selected.id});
            });
            const quickUsable = [
                'health-potion',
                'antidote',
                'fire-ward',
                'ice-ward',
                'lightning-ward',
                'map-scroll',
                'mining-pick',
                'ammo-bundle'
            ].includes(selected.baseTypeId);
            if (quickUsable) {
                for (let slot = 0; slot < 3; slot++) {
                    addButton(-100 + slot * 100, 150, `QUICK ${slot + 1}`, () => {
                        const slots = [...this.campaign.player.quickSlotItemIds] as [
                            string | null,
                            string | null,
                            string | null
                        ];
                        slots[slot] = selected.id;
                        this.campaign = {
                            ...this.campaign,
                            player: {...this.campaign.player, quickSlotItemIds: slots}
                        };
                        this.destroyModal();
                        this.emitState(messageEvent(
                            `${definition.label} assigned to quick slot ${slot + 1}.`
                        ));
                    });
                }
            }
            if (selected.baseTypeId === 'mystery-orb') {
                selected.rolledChoiceIds.forEach((choiceId, index) => {
                    addButton(-145 + index * 145, 150, choiceId.toUpperCase(), () => {
                        this.destroyModal();
                        this.perform({kind: 'use-item', itemId: selected.id, choiceId});
                    });
                });
            }
        }
        addButton(0, 185, 'CLOSE', () => this.destroyModal(), '#806b4f');
        this.activateModal(container);
        this.modalCancelAction = () => this.destroyModal();
    }

    private activateModal(container: Phaser.GameObjects.Container): void {
        for (const child of container.list) {
            if (
                child.input !== null &&
                'setScrollFactor' in child &&
                typeof child.setScrollFactor === 'function'
            ) {
                (child as ScrollFactorGameObject).setScrollFactor(0);
            }
        }
        this.modalContainer = container;
        this.game.canvas.dataset.overworldModalOpen = 'true';
    }

    private destroyModal(): void {
        if (this.victoryHorse) {
            this.tweens.killTweensOf(this.victoryHorse);
            for (const child of this.victoryHorse.list) this.tweens.killTweensOf(child);
            this.victoryHorse = null;
        }
        this.modalContainer?.destroy(true);
        this.modalContainer = null;
        this.modalConfirmAction = null;
        this.modalCancelAction = null;
        this.spaceSkipAction = null;
        this.shopPreviousPageAction = null;
        this.shopNextPageAction = null;
        this.shopOfferActions = [];
        this.encounterResultModalOpen = false;
        delete this.game.canvas.dataset.encounterOverlay;
        delete this.game.canvas.dataset.shopOpen;
        delete this.game.canvas.dataset.shopPage;
        delete this.game.canvas.dataset.shopCarOwned;
        delete this.game.canvas.dataset.spaceOptionsOpen;
        delete this.game.canvas.dataset.spaceSkipAffordable;
        delete this.game.canvas.dataset.victoryOverlay;
        delete this.game.canvas.dataset.victoryHorse;
        delete this.game.canvas.dataset.overworldModalOpen;
    }

    private emitState(event?: OverworldEvent): void {
        this.options.onStateChanged(this.campaign, event);
    }

    private drawLandmarks(): void {
        this.add.rectangle(CELL_SIZE * 1.5, CELL_SIZE * 1.5, 14, 14, 0x3b9c58)
            .setDepth(5);
        const size = this.campaign.overworld.maze.length;
        this.add.rectangle(
            (size - 1.5) * CELL_SIZE,
            (size - 1.5) * CELL_SIZE,
            18,
            18,
            0xca4338
        ).setStrokeStyle(2, 0x171918).setDepth(5);
    }

    private createObjectiveVisuals(): void {
        for (const placement of this.campaign.overworld.objectives) {
            const definition = OBJECTIVE_BY_ID[placement.objectiveId];
            const x = placement.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = placement.position.y * CELL_SIZE + CELL_SIZE / 2;
            const sprite = this.add.sprite(x, y, 'objective-sprites', definition.iconFrame)
                .setDepth(12)
                .setInteractive({useHandCursor: true});
            sprite.on('pointerdown', () => {
                const status = getObjectiveStatus(this.campaign.flags, placement.objectiveId);
                const message = status === 'locked'
                    ? objectiveLockedMessage(placement.objectiveId)
                    : `${definition.label}: ${status}. ` +
                    (status === 'available'
                        ? 'Stand here and interact to begin.'
                        : 'Completed sanctuary.');
                this.emitState(messageEvent(message));
            });
            const badge = this.add.text(x + 9, y - 12, '', {
                color: '#f5f0df',
                backgroundColor: '#171918',
                fontSize: '10px',
                padding: {x: 2, y: 1}
            }).setOrigin(0.5).setDepth(14);
            const label = this.add.text(x, y + 19, definition.label, {
                color: '#171918',
                backgroundColor: 'rgba(245,240,223,0.82)',
                fontFamily: 'Georgia, serif',
                fontSize: '10px',
                padding: {x: 2, y: 1}
            }).setOrigin(0.5).setDepth(13);
            this.objectiveVisuals.set(placement.objectiveId, {sprite, badge, label});
        }
        this.refreshObjectiveVisuals();
    }

    private createServiceSiteVisuals(): void {
        for (const site of this.campaign.overworld.serviceSites) {
            const definition = SERVICE_SITE_DEFINITIONS[site.kind];
            const x = site.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = site.position.y * CELL_SIZE + CELL_SIZE / 2;
            const container = this.add.container(x, y).setDepth(16);
            const marker = this.add.rectangle(0, 0, 27, 27, definition.color, 0.96)
                .setStrokeStyle(2, 0x171918)
                .setInteractive({useHandCursor: true});
            const glyph = this.add.text(0, -1, definition.marker, {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: site.kind === 'blackjack' ? '12px' : '19px',
                fontStyle: 'bold'
            }).setOrigin(0.5);
            const label = this.add.text(0, 20, definition.shortLabel, {
                color: '#171918',
                backgroundColor: 'rgba(245,240,223,0.88)',
                fontFamily: 'Georgia, serif',
                fontSize: '9px',
                padding: {x: 2, y: 1}
            }).setOrigin(0.5);
            marker.on('pointerdown', () => {
                this.emitState(messageEvent(
                    `${definition.label}. Optional. Stand here and press E or tap E to ${
                        site.kind === 'shop' ? 'browse' : 'play'
                    }.`
                ));
            });
            container.add([marker, glyph, label]);
            this.serviceSiteVisuals.set(site.id, {container});
        }
        this.game.canvas.dataset.serviceSites = this.campaign.overworld.serviceSites
            .map(site => `${site.kind}@${site.position.x},${site.position.y}`)
            .join(';');
        this.game.canvas.dataset.shopPresent = String(
            this.campaign.overworld.serviceSites.some(site => site.kind === 'shop')
        );
    }

    private refreshObjectiveVisuals(): void {
        for (const definition of OBJECTIVE_DEFINITIONS) {
            const visual = this.objectiveVisuals.get(definition.id);
            if (!visual) continue;
            const status = getObjectiveStatus(this.campaign.flags, definition.id);
            visual.sprite.clearTint();
            visual.sprite.setAlpha(status === 'completed' ? 0.55 : status === 'locked' ? 0.42 : 1);
            if (status === 'locked') visual.sprite.setTint(0x6b6f70);
            visual.badge.setText(status === 'locked' ? 'L' : status === 'completed' ? 'OK' : '!');
            visual.badge.setColor(status === 'available' ? '#efc75e' : '#f5f0df');
        }
    }

    private drawMaze(): void {
        this.mazeGraphics.clear();
        for (let y = 0; y < this.campaign.overworld.maze.length; y++) {
            const row = this.campaign.overworld.maze[y]!;
            for (let x = 0; x < row.length; x++) {
                const cell = row[x]!;
                const color = cell.kind === 'passage'
                    ? 0xf4f1e8
                    : colorToNumber(MATERIALS[cell.materialId].color);
                this.mazeGraphics.fillStyle(color).fillRect(
                    x * CELL_SIZE,
                    y * CELL_SIZE,
                    CELL_SIZE,
                    CELL_SIZE
                );
            }
        }
    }

    private syncWorldVisuals(): void {
        this.refreshObjectiveVisuals();
        this.syncItemSprites();
        this.syncMonsterSprites();
        this.syncTrapGraphics();
    }

    private syncPlayerMarker(): void {
        const {x, y} = this.campaign.overworld.playerPosition;
        this.playerMarker.setPosition(
            x * CELL_SIZE + CELL_SIZE / 2,
            y * CELL_SIZE + CELL_SIZE / 2
        );
        if (this.playerCameraConfigured) this.centerCameraOnPlayer();
    }

    private configurePlayerCamera(): void {
        const camera = this.cameras.main;
        const worldSize = this.campaign.overworld.maze.length * CELL_SIZE;
        const paddingX = Math.max(0, camera.width / 2 - WALKABLE_EDGE_CELL_CENTER);
        const paddingY = Math.max(0, camera.height / 2 - WALKABLE_EDGE_CELL_CENTER);

        camera.setBackgroundColor(0x242722);
        camera.setBounds(
            -paddingX,
            -paddingY,
            worldSize + paddingX * 2,
            worldSize + paddingY * 2
        );
        camera.startFollow(this.playerMarker, true, 1, 1);
        camera.setRoundPixels(true);
        this.playerCameraConfigured = true;
        this.centerCameraOnPlayer();

        const canvas = this.game.canvas;
        canvas.dataset.overworldCameraMode = 'player-centered';
        canvas.dataset.overworldCameraPaddingX = String(paddingX);
        canvas.dataset.overworldCameraPaddingY = String(paddingY);
    }

    private centerCameraOnPlayer(): void {
        const camera = this.cameras.main;
        camera.centerOn(this.playerMarker.x, this.playerMarker.y);

        const canvas = this.game.canvas;
        canvas.dataset.overworldPlayerScreenX = (
            camera.x + (this.playerMarker.x - camera.scrollX) * camera.zoom
        ).toFixed(1);
        canvas.dataset.overworldPlayerScreenY = (
            camera.y + (this.playerMarker.y - camera.scrollY) * camera.zoom
        ).toFixed(1);
    }

    private syncItemSprites(): void {
        const activeIds = new Set(this.campaign.overworld.items.map(item => item.instance.id));
        for (const [itemId, sprite] of this.itemSprites) {
            if (activeIds.has(itemId)) continue;
            sprite.destroy();
            this.itemSprites.delete(itemId);
        }
        for (const item of this.campaign.overworld.items) {
            const definition = ITEM_DEFINITIONS[item.instance.baseTypeId];
            const x = item.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = item.position.y * CELL_SIZE + CELL_SIZE / 2;
            const existing = this.itemSprites.get(item.instance.id);
            if (existing) {
                existing.setPosition(x, y);
                continue;
            }
            const sprite = this.add.sprite(
                x,
                y,
                'item-sprites',
                definition.spriteFrame
            ).setDepth(10).setInteractive({useHandCursor: true});
            sprite.on('pointerdown', () => {
                const current = this.campaign.overworld.items.find(candidate =>
                    candidate.instance.id === item.instance.id
                );
                if (!current) return;
                const instance = current.instance;
                this.emitState(messageEvent(
                    `${definition.label} · ${instance.quality}` +
                    `${instance.affixIds.length ? ` · ${instance.affixIds.join(', ')}` : ''}` +
                    `${instance.quantity > 1 ? ` · ×${instance.quantity}` : ''}`
                ));
            });
            this.itemSprites.set(item.instance.id, sprite);
        }
    }

    private syncMonsterSprites(): void {
        const activeIds = new Set(this.campaign.overworld.monsters.map(monster => monster.id));
        for (const [monsterId, sprite] of this.monsterSprites) {
            if (activeIds.has(monsterId)) continue;
            sprite.destroy();
            this.monsterSprites.delete(monsterId);
        }
        for (const monster of this.campaign.overworld.monsters) {
            const definition = MONSTER_DEFINITIONS[monster.typeId];
            const x = monster.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = monster.position.y * CELL_SIZE + CELL_SIZE / 2;
            const existing = this.monsterSprites.get(monster.id);
            const sprite = existing ?? this.add.sprite(
                x,
                y,
                'monster-sprites',
                definition.spriteFrame
            ).setDepth(20);
            sprite.setPosition(x, y);
            sprite.setAlpha(monster.revealed ? 1 : 0.72);
            if (monster.intent) sprite.setTint(0xff4d4d);
            else if (monster.elite) sprite.setTint(0xefc75e);
            else sprite.clearTint();
            if (!existing) {
                sprite.setInteractive({useHandCursor: true});
                sprite.on('pointerdown', () => {
                    const current = this.campaign.overworld.monsters.find(candidate =>
                        candidate.id === monster.id
                    );
                    if (!current) return;
                    const currentDefinition = MONSTER_DEFINITIONS[current.typeId];
                    this.emitState(messageEvent(
                        `${currentDefinition.label} · HP ${current.health}/${current.maxHealth}` +
                        ` · armor ${current.armor}` +
                        `${current.variantIds.length
                            ? ` · ${current.variantIds.join(', ')}`
                            : ''}` +
                        `${current.intent
                            ? ` · ${current.intent.kind} hits turn ${current.intent.executeOnTurn}`
                            : ''}` +
                        `${current.drop ? ' · carrying loot' : ''}`
                    ));
                });
                this.monsterSprites.set(monster.id, sprite);
            }
        }
    }

    private syncTrapGraphics(): void {
        const activeIds = new Set(this.campaign.overworld.traps.map(trap => trap.id));
        for (const [trapId, graphic] of this.trapGraphics) {
            if (activeIds.has(trapId)) continue;
            graphic.destroy();
            this.trapGraphics.delete(trapId);
        }
        for (const trap of this.campaign.overworld.traps) {
            const existing = this.trapGraphics.get(trap.id);
            if (existing) {
                existing.setVisible(trap.revealed && !trap.disabled);
                continue;
            }
            const x = trap.position.x * CELL_SIZE + CELL_SIZE / 2;
            const y = trap.position.y * CELL_SIZE + CELL_SIZE / 2;
            const color = trap.typeId === 'gas-vent'
                ? 0x55a33f
                : trap.typeId === 'arc-plate'
                    ? 0x67d5e8
                    : trap.typeId === 'flame-jet'
                        ? 0xef5b24
                        : 0x382f54;
            const marker = this.add.rectangle(x, y, 18, 8, color)
                .setStrokeStyle(2, 0x171918)
                .setDepth(11)
                .setVisible(trap.revealed && !trap.disabled)
                .setInteractive({useHandCursor: true});
            marker.on('pointerdown', () => {
                const current = this.campaign.overworld.traps.find(candidate =>
                    candidate.id === trap.id
                );
                if (!current) return;
                this.emitState(messageEvent(
                    `${current.typeId} · ${current.disabled ? 'disabled' : 'active'}` +
                    `${current.phase > 0 ? ' · warning phase' : ''}` +
                    ` · ${current.owner}`
                ));
            });
            this.trapGraphics.set(trap.id, marker);
        }
    }

    private hasReachedExit(): boolean {
        const size = this.campaign.overworld.maze.length;
        return this.campaign.overworld.playerPosition.x === size - 2 &&
            this.campaign.overworld.playerPosition.y === size - 2;
    }

    private createTouchControls(): void {
        const controls: readonly {
            direction: DirectionId;
            label: string;
            x: number;
            y: number;
        }[] = [
            {direction: 'up', label: '\u2191', x: 80, y: GAME_VIEW_SIZE - 154},
            {direction: 'left', label: '\u2190', x: 28, y: GAME_VIEW_SIZE - 102},
            {direction: 'down', label: '\u2193', x: 80, y: GAME_VIEW_SIZE - 102},
            {direction: 'right', label: '\u2192', x: 132, y: GAME_VIEW_SIZE - 102}
        ];
        for (const control of controls) {
            this.createTouchButton(control.x, control.y, control.label, () => {
                if (this.itemTargetingId) {
                    const itemId = this.itemTargetingId;
                    this.itemTargetingId = null;
                    this.perform({kind: 'use-item', itemId, direction: control.direction});
                } else if (this.attackTargeting) {
                    this.attackTargeting = false;
                    this.perform({kind: 'ranged', direction: control.direction});
                } else this.perform({kind: 'move', direction: control.direction});
            });
        }
        this.createTouchButton(GAME_VIEW_SIZE - 60, GAME_VIEW_SIZE - 150, 'ATTACK', () => {
            this.attackTargeting = !this.attackTargeting;
            this.emitState(messageEvent(this.attackTargeting
                ? 'Choose an attack direction.'
                : 'Attack cancelled.'));
        }, 92);
        this.createTouchButton(GAME_VIEW_SIZE - 60, GAME_VIEW_SIZE - 96, 'USE', () =>
            this.useQuickSlot(), 92);
        this.createTouchButton(GAME_VIEW_SIZE - 174, GAME_VIEW_SIZE - 96, 'E', () =>
            this.interact(), 48);
        this.createTouchButton(GAME_VIEW_SIZE - 174, GAME_VIEW_SIZE - 150, 'WAIT', () =>
            this.perform({kind: 'wait'}), 70);
        this.createTouchButton(GAME_VIEW_SIZE - 60, GAME_VIEW_SIZE - 42, 'INV', () =>
            this.showInventory(), 92);
    }

    private createTouchButton(
        x: number,
        y: number,
        label: string,
        callback: () => void,
        width = 48
    ): void {
        const background = this.add.rectangle(
            x,
            y,
            width,
            48,
            0x171918,
            IDLE_TOUCH_CONTROL_ALPHA
        )
            .setStrokeStyle(2, 0xefc75e, 0.9)
            .setScrollFactor(0)
            .setDepth(200)
            .setInteractive({useHandCursor: true});
        const buttonLabel = this.add.text(x, y, label, {
            color: '#f5f0df',
            fontFamily: 'Georgia, serif',
            fontSize: label.length > 2 ? '13px' : '20px'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0.94);
        const setControlActive = (active: boolean): void => {
            background.setFillStyle(
                active ? 0x262b27 : 0x171918,
                active ? ACTIVE_TOUCH_CONTROL_ALPHA : IDLE_TOUCH_CONTROL_ALPHA
            );
            buttonLabel.setAlpha(active ? 1 : 0.94);
        };
        background.on('pointerover', () => setControlActive(true));
        background.on('pointerout', () => setControlActive(false));
        background.on('pointerup', () => setControlActive(false));
        background.on('pointerdown', () => {
            setControlActive(true);
            if (
                this.campaign.overworld.pendingDefeatChoice ||
                this.campaign.pendingLevelReward ||
                this.modalContainer
            ) return;
            callback();
        });
    }
}
