import Phaser from 'phaser';

import {
    createInitialCampaignState,
    type CampaignState,
    type EncounterKind
} from '../domain/campaign/campaign-state';
import {
    advanceCampaignLevel,
    getCampaignLevelNumber,
    getLevelExitStatus
} from '../domain/campaign/level-progression';
import {collectItemAtPlayer, initializeOverworldItems, type ItemPickupEvent} from '../domain/entities/item-system';
import {ITEM_DEFINITIONS} from '../domain/entities/item-types';
import {
    advanceMonsterTurn,
    initializeOverworldMonsters,
    type MonsterTurnEvent
} from '../domain/entities/monster-system';
import {MONSTER_DEFINITIONS} from '../domain/entities/monster-types';
import {MATERIALS} from '../domain/materials/materials';
import {generateMaze} from '../domain/overworld/maze-generator';
import {
    moveOverworldPlayer,
    type DirectionId,
    type OverworldMoveEvent
} from '../domain/overworld/move-player';
import {Mulberry32Random} from '../domain/random/random-source';
import {applyEncounterResult} from '../encounters/apply-encounter-result';
import type {EncounterContext, EncounterResult} from '../encounters/contracts';
import {placeIntroTrigger, type IntroTriggerPlacement} from '../encounters/place-intro-trigger';
import {LOCKPICK_SCENE_KEY, type LockpickLaunchData} from '../minigames/lock/lockpick.scene';
import {PLATFORMER_SCENE_KEY, type PlatformerLaunchData} from '../minigames/platformer/platformer.scene';
import {PIPE_DREAM_SCENE_KEY, type PipeDreamLaunchData} from '../minigames/pipe/pipe-dream.scene';
import {SHOOTER_SCENE_KEY, type ShooterLaunchData} from '../minigames/shooter/shooter.scene';

export const OVERWORLD_SCENE_KEY = 'overworld';
export const CELL_SIZE = 32;
export const INITIAL_MAZE_SIZE = 21;
export const GAME_VIEW_SIZE = INITIAL_MAZE_SIZE * CELL_SIZE;

export interface OverworldSceneOptions {
    readonly seed: number;
    readonly itemSpriteSheetUrl: string;
    readonly monsterSpriteSheetUrl: string;
    readonly initialCampaign?: CampaignState;
    readonly onStateChanged: (
        state: CampaignState,
        event?: OverworldMoveEvent | ItemPickupEvent | MonsterTurnEvent
    ) => void;
    readonly onEncounterChanged: (kind: EncounterKind | null) => void;
}

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

export class OverworldScene extends Phaser.Scene {
    private readonly options: OverworldSceneOptions;
    private campaign!: CampaignState;
    private mazeGraphics!: Phaser.GameObjects.Graphics;
    private playerMarker!: Phaser.GameObjects.Arc;
    private triggerMarker!: Phaser.GameObjects.Rectangle;
    private lockMarker!: Phaser.GameObjects.Rectangle;
    private shooterMarker!: Phaser.GameObjects.Arc;
    private platformerMarker!: Phaser.GameObjects.Triangle;
    private triggerPlacement!: IntroTriggerPlacement;
    private readonly itemSprites = new Map<string, Phaser.GameObjects.Sprite>();
    private readonly monsterSprites = new Map<string, Phaser.GameObjects.Sprite>();
    private encounterAttempt = 0;
    private lockAttempt = 0;
    private shooterAttempt = 0;
    private platformerAttempt = 0;
    private encounterOpen = false;
    private restartCampaign: CampaignState | undefined;
    private restartAnnouncement: string | undefined;

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
    }

    create(): void {
        this.itemSprites.clear();
        this.monsterSprites.clear();
        const initialCampaign = this.restartCampaign ?? this.options.initialCampaign;
        this.restartCampaign = undefined;
        const pristineSeed = initialCampaign?.overworld.seed ?? this.options.seed;
        const mazeSize = initialCampaign?.overworld.maze.length ?? INITIAL_MAZE_SIZE;
        const pristineMaze = generateMaze({
            size: mazeSize,
            random: new Mulberry32Random(pristineSeed)
        });
        this.campaign = initialCampaign ?? createInitialCampaignState({
            campaignSeed: this.options.seed,
            maze: pristineMaze,
            overworldSeed: pristineSeed,
            levelId: 'phaser-migration-zone'
        });
        this.triggerPlacement = placeIntroTrigger(pristineMaze, {x: 1, y: 1});
        if (!this.campaign.overworld.triggerStates['coolant-terminal']) {
            this.campaign = {
                ...this.campaign,
                overworld: {
                    ...this.campaign.overworld,
                    triggerStates: {
                        ...this.campaign.overworld.triggerStates,
                        'coolant-terminal': 'available'
                    }
                }
            };
        }
        if (!this.campaign.overworld.triggerStates['archive-lock']) {
            this.campaign = {
                ...this.campaign,
                overworld: {
                    ...this.campaign.overworld,
                    triggerStates: {
                        ...this.campaign.overworld.triggerStates,
                        'archive-lock': 'available'
                    }
                }
            };
        }
        if (!this.campaign.overworld.triggerStates['hangar-uplink']) {
            this.campaign = {
                ...this.campaign,
                overworld: {
                    ...this.campaign.overworld,
                    triggerStates: {
                        ...this.campaign.overworld.triggerStates,
                        'hangar-uplink': 'available'
                    }
                }
            };
        }
        if (!this.campaign.overworld.triggerStates['maintenance-elevator']) {
            this.campaign = {
                ...this.campaign,
                overworld: {
                    ...this.campaign.overworld,
                    triggerStates: {
                        ...this.campaign.overworld.triggerStates,
                        'maintenance-elevator': 'available'
                    }
                }
            };
        }
        this.campaign = initializeOverworldItems(
            this.campaign,
            new Mulberry32Random(pristineSeed ^ 0x4954454d),
            [this.triggerPlacement.position, this.triggerPlacement.benefitWallPosition]
        );
        this.campaign = initializeOverworldMonsters(
            this.campaign,
            new Mulberry32Random(pristineSeed ^ 0x4d4f4e53),
            [
                this.triggerPlacement.position,
                this.triggerPlacement.benefitWallPosition,
                ...this.campaign.overworld.items.map(item => item.position)
            ]
        );
        this.encounterAttempt = this.campaign.encounterHistory.filter(entry =>
            entry.triggerId === 'coolant-terminal'
        ).length;
        this.lockAttempt = this.campaign.encounterHistory.filter(entry =>
            entry.triggerId === 'archive-lock'
        ).length;
        this.shooterAttempt = this.campaign.encounterHistory.filter(entry =>
            entry.triggerId === 'hangar-uplink'
        ).length;
        this.platformerAttempt = this.campaign.encounterHistory.filter(entry =>
            entry.triggerId === 'maintenance-elevator'
        ).length;

        this.mazeGraphics = this.add.graphics();
        this.drawMaze();
        this.add.rectangle(CELL_SIZE * 1.5, CELL_SIZE * 1.5, 14, 14, 0x3b9c58);
        const currentSize = this.campaign.overworld.maze.length;
        this.add.rectangle(
            (currentSize - 1.5) * CELL_SIZE,
            (currentSize - 1.5) * CELL_SIZE,
            14,
            14,
            0xca4338
        );
        this.triggerMarker = this.add.rectangle(
            this.triggerPlacement.position.x * CELL_SIZE + CELL_SIZE / 2,
            this.triggerPlacement.position.y * CELL_SIZE + CELL_SIZE / 2,
            20,
            20,
            0xefc75e
        ).setStrokeStyle(2, 0x382f54).setVisible(
            this.campaign.overworld.triggerStates['coolant-terminal'] === 'available'
        );
        this.lockMarker = this.add.rectangle(
            this.triggerPlacement.benefitWallPosition.x * CELL_SIZE + CELL_SIZE / 2,
            this.triggerPlacement.benefitWallPosition.y * CELL_SIZE + CELL_SIZE / 2,
            20,
            20,
            0x67d5e8
        ).setStrokeStyle(2, 0x171918);
        this.shooterMarker = this.add.circle(
            this.triggerPlacement.benefitWallPosition.x * CELL_SIZE + CELL_SIZE / 2,
            this.triggerPlacement.benefitWallPosition.y * CELL_SIZE + CELL_SIZE / 2,
            11,
            0xef5b24
        ).setStrokeStyle(2, 0xefc75e);
        this.platformerMarker = this.add.triangle(
            this.triggerPlacement.position.x * CELL_SIZE + CELL_SIZE / 2,
            this.triggerPlacement.position.y * CELL_SIZE + CELL_SIZE / 2,
            0,
            20,
            10,
            0,
            20,
            20,
            0x3b9c58
        ).setStrokeStyle(2, 0xefc75e);
        this.refreshTriggerMarkers();
        this.syncItemSprites();
        this.syncMonsterSprites();
        this.playerMarker = this.add.circle(0, 0, CELL_SIZE / 3, 0x2468d8)
            .setStrokeStyle(3, 0x102d66).setDepth(3);
        this.syncPlayerMarker();

        const worldSize = currentSize * CELL_SIZE;
        this.cameras.main.setBounds(0, 0, worldSize, worldSize);
        this.cameras.main.startFollow(this.playerMarker, true, 0.15, 0.15);
        this.cameras.main.setRoundPixels(true);

        this.input.keyboard?.on('keydown', this.handleKeyDown, this);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown', this.handleKeyDown, this);
        });
        this.createTouchControls();
        const announcement = this.restartAnnouncement;
        this.restartAnnouncement = undefined;
        this.options.onStateChanged(this.campaign, announcement
            ? {kind: 'blocked', message: announcement}
            : undefined);
        if (this.hasReachedExit()) {
            this.time.delayedCall(0, () => this.handleExit());
        }
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        const direction = directionForKey(event.key);
        if (!direction) return;
        event.preventDefault();
        this.attemptMove(direction);
    };

    private attemptMove(direction: DirectionId): void {
        const result = moveOverworldPlayer(this.campaign, direction);
        if (result.state === this.campaign) {
            this.options.onStateChanged(this.campaign, result.event);
            return;
        }

        const itemCollection = collectItemAtPlayer(result.state);
        this.campaign = itemCollection.state;
        if (result.event.kind === 'mined') this.drawMaze();
        if (itemCollection.event) this.syncItemSprites();
        this.syncPlayerMarker();
        this.options.onStateChanged(this.campaign, itemCollection.event ?? result.event);
        if (this.isAtAvailablePipeTrigger()) {
            this.openPipeEncounter();
            return;
        }
        if (this.isAtAvailableLockTrigger()) {
            this.openLockEncounter();
            return;
        }
        if (this.isAtAvailableShooterTrigger()) {
            this.openShooterEncounter();
            return;
        }
        if (this.isAtAvailablePlatformerTrigger()) {
            this.openPlatformerEncounter();
            return;
        }
        if (this.hasReachedExit()) {
            this.handleExit();
            return;
        }

        const monsterTurn = advanceMonsterTurn(
            this.campaign,
            new Mulberry32Random(this.options.seed ^ this.campaign.overworld.turn)
        );
        this.campaign = monsterTurn.state;
        this.syncMonsterSprites();
        const damageEvent = monsterTurn.events.find(event => event.kind === 'player-damaged');
        if (this.campaign.player.health === 0) {
            this.restartAfterDefeat();
            return;
        }
        this.options.onStateChanged(this.campaign, damageEvent);
    }

    private isAtAvailablePipeTrigger(): boolean {
        const {x, y} = this.campaign.overworld.playerPosition;
        return x === this.triggerPlacement.position.x && y === this.triggerPlacement.position.y &&
            this.campaign.overworld.triggerStates['coolant-terminal'] === 'available';
    }

    private advanceLevel(): void {
        this.input.enabled = false;
        const nextCampaign = advanceCampaignLevel(this.campaign);
        this.restartCampaign = nextCampaign;
        this.restartAnnouncement = `Entered level ${getCampaignLevelNumber(nextCampaign)}.`;
        this.options.onStateChanged(nextCampaign);
        this.scene.restart();
    }

    private handleExit(): void {
        const status = getLevelExitStatus(this.campaign);
        if (status.ready) {
            this.advanceLevel();
            return;
        }
        this.options.onStateChanged(this.campaign, {
            kind: 'blocked',
            message: `Exit locked ${status.completed}/${status.total}. Next: ${status.nextLabel}.`
        });
    }

    private isAtAvailableLockTrigger(): boolean {
        const {x, y} = this.campaign.overworld.playerPosition;
        const lockPosition = this.triggerPlacement.benefitWallPosition;
        return x === lockPosition.x && y === lockPosition.y &&
            this.campaign.flags.includes('coolant-routing-restored') &&
            this.campaign.overworld.triggerStates['archive-lock'] === 'available';
    }

    private isAtAvailableShooterTrigger(): boolean {
        const {x, y} = this.campaign.overworld.playerPosition;
        const position = this.triggerPlacement.benefitWallPosition;
        return x === position.x && y === position.y &&
            this.campaign.flags.includes('archive-lock-opened') &&
            this.campaign.overworld.triggerStates['hangar-uplink'] === 'available';
    }

    private isAtAvailablePlatformerTrigger(): boolean {
        const {x, y} = this.campaign.overworld.playerPosition;
        return x === this.triggerPlacement.position.x && y === this.triggerPlacement.position.y &&
            this.campaign.flags.includes('orbital-corridor-cleared') &&
            this.campaign.overworld.triggerStates['maintenance-elevator'] === 'available';
    }

    private openPipeEncounter(): void {
        if (this.encounterOpen) return;
        this.encounterOpen = true;
        this.encounterAttempt++;
        this.input.enabled = false;
        this.options.onEncounterChanged('pipe');

        const context: EncounterContext = {
            runId: `coolant-terminal:${this.encounterAttempt}`,
            definitionId: 'act-1-coolant-routing',
            kind: 'pipe',
            act: this.campaign.act,
            seed: this.options.seed + this.encounterAttempt,
            difficulty: 'standard',
            campaignSnapshot: this.campaign,
            trigger: {
                triggerId: 'coolant-terminal',
                position: this.triggerPlacement.position,
                nearbyMaterialIds: this.triggerPlacement.nearbyMaterialIds,
                nearbyMaterialTags: this.triggerPlacement.nearbyMaterialTags
            },
            modifiers: {
                benefitX: this.triggerPlacement.benefitWallPosition.x,
                benefitY: this.triggerPlacement.benefitWallPosition.y
            }
        };
        const launchData: PipeDreamLaunchData = {
            context,
            onComplete: result => this.completePipeEncounter(result)
        };
        this.scene.launch(PIPE_DREAM_SCENE_KEY, launchData);
        this.scene.pause();
    }

    private openLockEncounter(): void {
        if (this.encounterOpen) return;
        this.encounterOpen = true;
        this.lockAttempt++;
        this.input.enabled = false;
        this.options.onEncounterChanged('lock');

        const context: EncounterContext = {
            runId: `archive-lock:${this.lockAttempt}`,
            definitionId: 'act-1-archive-lock',
            kind: 'lock',
            act: this.campaign.act,
            seed: this.options.seed + 0x1000 + this.lockAttempt,
            difficulty: 'standard',
            campaignSnapshot: this.campaign,
            trigger: {
                triggerId: 'archive-lock',
                position: this.triggerPlacement.benefitWallPosition,
                nearbyMaterialIds: this.triggerPlacement.nearbyMaterialIds,
                nearbyMaterialTags: this.triggerPlacement.nearbyMaterialTags
            },
            modifiers: {lockFamily: 'pin-tension'}
        };
        const launchData: LockpickLaunchData = {
            context,
            onComplete: result => this.completeLockEncounter(result)
        };
        this.scene.launch(LOCKPICK_SCENE_KEY, launchData);
        this.scene.pause();
    }

    private openShooterEncounter(): void {
        if (this.encounterOpen) return;
        this.encounterOpen = true;
        this.shooterAttempt++;
        this.input.enabled = false;
        this.options.onEncounterChanged('shooter');

        const context: EncounterContext = {
            runId: `hangar-uplink:${this.shooterAttempt}`,
            definitionId: 'act-1-orbital-service-road',
            kind: 'shooter',
            act: this.campaign.act,
            seed: this.options.seed + 0x2000 + this.shooterAttempt,
            difficulty: 'standard',
            campaignSnapshot: this.campaign,
            trigger: {
                triggerId: 'hangar-uplink',
                position: this.triggerPlacement.benefitWallPosition,
                nearbyMaterialIds: this.triggerPlacement.nearbyMaterialIds,
                nearbyMaterialTags: this.triggerPlacement.nearbyMaterialTags
            },
            modifiers: {
                poweredShield: this.campaign.worldSystems.powerRouting >= 60,
                archiveIntel: this.campaign.flags.includes('archive-lock-opened')
            }
        };
        const launchData: ShooterLaunchData = {
            context,
            onComplete: result => this.completeShooterEncounter(result)
        };
        this.scene.launch(SHOOTER_SCENE_KEY, launchData);
        this.scene.pause();
    }

    private openPlatformerEncounter(): void {
        if (this.encounterOpen) return;
        this.encounterOpen = true;
        this.platformerAttempt++;
        this.input.enabled = false;
        this.options.onEncounterChanged('platformer');

        const context: EncounterContext = {
            runId: `maintenance-elevator:${this.platformerAttempt}`,
            definitionId: 'act-1-sublevel-nine',
            kind: 'platformer',
            act: this.campaign.act,
            seed: this.options.seed + 0x3000 + this.platformerAttempt,
            difficulty: 'standard',
            campaignSnapshot: this.campaign,
            trigger: {
                triggerId: 'maintenance-elevator',
                position: this.triggerPlacement.position,
                nearbyMaterialIds: this.triggerPlacement.nearbyMaterialIds,
                nearbyMaterialTags: this.triggerPlacement.nearbyMaterialTags
            },
            modifiers: {
                toolBridge: this.campaign.player.miningPower >= 2,
                supplyBridge: this.campaign.worldSystems.airspaceControl >= 60,
                poweredLift: this.campaign.worldSystems.powerRouting >= 60
            }
        };
        const launchData: PlatformerLaunchData = {
            context,
            onComplete: result => this.completePlatformerEncounter(result)
        };
        this.scene.launch(PLATFORMER_SCENE_KEY, launchData);
        this.scene.pause();
    }

    private completePipeEncounter(result: EncounterResult): void {
        const appliedCampaign = applyEncounterResult(this.campaign, result);
        this.campaign = {
            ...appliedCampaign,
            overworld: {...appliedCampaign.overworld, resumeGraceTurns: 1}
        };
        this.encounterOpen = false;
        this.input.enabled = true;
        this.triggerMarker.setVisible(
            this.campaign.overworld.triggerStates['coolant-terminal'] === 'available'
        );
        this.drawMaze();
        this.refreshTriggerMarkers();
        this.options.onEncounterChanged(null);
        this.options.onStateChanged(this.campaign, {
            kind: 'blocked',
            message: result.status === 'success'
                ? 'Coolant sings through the walls. A powered shortcut opens nearby.'
                : 'The terminal filed a complaint. The lockout is temporary.'
        });
        this.scene.resume();
    }

    private completeLockEncounter(result: EncounterResult): void {
        const appliedCampaign = applyEncounterResult(this.campaign, result);
        this.campaign = {
            ...appliedCampaign,
            overworld: {...appliedCampaign.overworld, resumeGraceTurns: 1}
        };
        this.encounterOpen = false;
        this.input.enabled = true;
        this.refreshTriggerMarkers();
        this.options.onEncounterChanged(null);
        this.options.onStateChanged(this.campaign, {
            kind: 'blocked',
            message: result.status === 'success'
                ? 'The archive opens. Inside: one excellent pick and several terrible opinions.'
                : 'The archive remains locked, but its alarm has developed trust issues.'
        });
        this.scene.resume();
    }

    private completeShooterEncounter(result: EncounterResult): void {
        const appliedCampaign = applyEncounterResult(this.campaign, result);
        this.campaign = {
            ...appliedCampaign,
            overworld: {...appliedCampaign.overworld, resumeGraceTurns: 1}
        };
        this.encounterOpen = false;
        this.input.enabled = true;
        this.refreshTriggerMarkers();
        this.options.onEncounterChanged(null);
        this.options.onStateChanged(this.campaign, {
            kind: 'blocked',
            message: result.status === 'success'
                ? 'Supply drones can reach the ruins again. One delivers a cassette labeled BOSS MUSIC.'
                : 'The raiders own the corridor for now. Ground routes remain available.'
        });
        this.scene.resume();
    }

    private completePlatformerEncounter(result: EncounterResult): void {
        const appliedCampaign = applyEncounterResult(this.campaign, result);
        this.campaign = {
            ...appliedCampaign,
            overworld: {...appliedCampaign.overworld, resumeGraceTurns: 1}
        };
        this.encounterOpen = false;
        this.input.enabled = true;
        this.refreshTriggerMarkers();
        this.options.onEncounterChanged(null);
        this.options.onStateChanged(this.campaign, {
            kind: 'blocked',
            message: result.status === 'success'
                ? 'Sublevel Nine is stable. Its oldest cabinet still remembers your initials.'
                : 'The sublevel remains optional. The elevator promises not to judge your route choice.'
        });
        this.scene.resume();
    }

    private refreshTriggerMarkers(): void {
        this.triggerMarker.setVisible(
            this.campaign.overworld.triggerStates['coolant-terminal'] === 'available'
        );
        this.lockMarker.setVisible(
            this.campaign.flags.includes('coolant-routing-restored') &&
            this.campaign.overworld.triggerStates['archive-lock'] === 'available'
        );
        this.shooterMarker.setVisible(
            this.campaign.flags.includes('archive-lock-opened') &&
            this.campaign.overworld.triggerStates['hangar-uplink'] === 'available'
        );
        this.platformerMarker.setVisible(
            this.campaign.flags.includes('orbital-corridor-cleared') &&
            this.campaign.overworld.triggerStates['maintenance-elevator'] === 'available'
        );
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

    private syncPlayerMarker(): void {
        const {x, y} = this.campaign.overworld.playerPosition;
        this.playerMarker.setPosition(
            x * CELL_SIZE + CELL_SIZE / 2,
            y * CELL_SIZE + CELL_SIZE / 2
        );
    }

    private syncItemSprites(): void {
        const activeIds = new Set(this.campaign.overworld.items.map(item => item.id));
        for (const [itemId, sprite] of this.itemSprites) {
            if (activeIds.has(itemId)) continue;
            sprite.destroy();
            this.itemSprites.delete(itemId);
        }

        for (const item of this.campaign.overworld.items) {
            if (this.itemSprites.has(item.id)) continue;
            const definition = ITEM_DEFINITIONS[item.typeId];
            const sprite = this.add.sprite(
                item.position.x * CELL_SIZE + CELL_SIZE / 2,
                item.position.y * CELL_SIZE + CELL_SIZE / 2,
                'item-sprites',
                definition.spriteFrame
            ).setDepth(2);
            this.itemSprites.set(item.id, sprite);
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
            if (existing) {
                existing.setPosition(x, y);
                continue;
            }
            const sprite = this.add.sprite(x, y, 'monster-sprites', definition.spriteFrame)
                .setDepth(2);
            this.monsterSprites.set(monster.id, sprite);
        }
    }

    private restartAfterDefeat(): void {
        this.campaign = {
            ...this.campaign,
            player: {
                ...this.campaign.player,
                health: this.campaign.player.maxHealth,
                miningPower: 0,
                toolCharge: 0
            },
            overworld: {
                ...this.campaign.overworld,
                playerPosition: {x: 1, y: 1},
                resumeGraceTurns: 2
            }
        };
        this.syncPlayerMarker();
        this.options.onStateChanged(this.campaign, {
            kind: 'blocked',
            message: 'Defeated. The maze returned your warranty card and none of your dignity.'
        });
    }

    private hasReachedExit(): boolean {
        const {x, y} = this.campaign.overworld.playerPosition;
        const size = this.campaign.overworld.maze.length;
        return x === size - 2 && y === size - 2;
    }

    private createTouchControls(): void {
        if (!window.matchMedia('(pointer: coarse)').matches) return;

        const controls: readonly {direction: DirectionId; label: string; x: number; y: number}[] = [
            {direction: 'up', label: '^', x: 78, y: GAME_VIEW_SIZE - 142},
            {direction: 'left', label: '<', x: 34, y: GAME_VIEW_SIZE - 98},
            {direction: 'down', label: 'v', x: 78, y: GAME_VIEW_SIZE - 98},
            {direction: 'right', label: '>', x: 122, y: GAME_VIEW_SIZE - 98}
        ];

        for (const control of controls) {
            const button = this.add.circle(control.x, control.y, 20, 0x171918, 0.82)
                .setStrokeStyle(2, 0xefc75e)
                .setScrollFactor(0)
                .setDepth(100)
                .setInteractive({useHandCursor: true});
            this.add.text(control.x, control.y, control.label, {
                color: '#f5f0df',
                fontFamily: 'Georgia, serif',
                fontSize: '22px'
            }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
            button.on('pointerdown', () => this.attemptMove(control.direction));
        }
    }
}