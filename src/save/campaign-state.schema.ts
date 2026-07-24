import {z} from 'zod';

import {
    CAMPAIGN_SCHEMA_VERSION,
    ENCOUNTER_KINDS,
    ENCOUNTER_STATUSES,
    OVERWORLD_CONTENT_GENERATOR_ID,
    PERFORMANCE_GRADES,
    TRIGGER_STATES,
    type CampaignState
} from '../domain/campaign/campaign-state';
import {
    ITEM_AFFIX_IDS,
    ITEM_CHOICE_IDS,
    ITEM_DEFINITIONS,
    ITEM_QUALITIES,
    ITEM_TYPE_IDS
} from '../domain/entities/item-types';
import {MONSTER_TYPE_IDS, MONSTER_VARIANT_IDS} from '../domain/entities/monster-types';
import {TRAP_TYPE_IDS} from '../domain/entities/trap-types';
import {MATERIAL_IDS, type MaterialId} from '../domain/materials/materials';
import {
    getObjectiveStatus,
    getLevelObjectiveSelectionCount,
    getPersistedLevelObjectiveRequirementCount,
    isCompatibleLevelObjectiveCount,
    MAX_LEVEL_OBJECTIVE_COUNT,
    OBJECTIVE_BY_ID,
    OBJECTIVE_DEFINITIONS,
    OBJECTIVE_IDS,
    requiresCasinoHeistShop,
    type ObjectiveId
} from '../domain/overworld/level-objectives';
import {SERVICE_SITE_KINDS} from '../domain/overworld/level-service-sites';
import {MAZE_GENERATOR_ID} from '../domain/overworld/maze-generator';
import type {Coordinate} from '../domain/overworld/maze-types';
import {MAX_REINFORCEMENT_DELAY_MS} from '../domain/overworld/reinforcement-schedule';
import {deriveSeed} from '../domain/random/seed-derivation';

const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const uint32 = z.number().int().min(0).max(0xffff_ffff);
const nonNegativeSafeInteger = safeInteger.nonnegative();
const coordinateSchema = z.object({
    x: nonNegativeSafeInteger,
    y: nonNegativeSafeInteger
}).strict();
const materialIdSchema = z.custom<MaterialId>(
    value => typeof value === 'string' && MATERIAL_IDS.includes(value as MaterialId),
    {message: 'Unknown material ID.'}
);
const mazeCellSchema = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('passage'), materialId: z.null()}).strict(),
    z.object({kind: z.literal('wall'), materialId: materialIdSchema}).strict()
]);
const mazeSchema = z.array(z.array(mazeCellSchema).min(5)).min(5);

const MIN_PLAYABLE_MAZE_SIZE = 21;
const MAX_PLAYABLE_MAZE_SIZE = 99;
const CARDINAL_DIRECTIONS = Object.freeze([
    Object.freeze({x: 0, y: -1}),
    Object.freeze({x: 1, y: 0}),
    Object.freeze({x: 0, y: 1}),
    Object.freeze({x: -1, y: 0})
]);

function coordinateKey(position: Coordinate): string {
    return `${position.x},${position.y}`;
}

function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
    return left.x === right.x && left.y === right.y;
}

function campaignLevelNumber(levelId: string): number {
    const match = /^level-(\d+)$/.exec(levelId);
    const parsed = match ? Number(match[1]) : 1;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function encounterAttemptSeed(
    levelSeed: number,
    objectiveId: ObjectiveId,
    ordinal: number
): number {
    const namespace = objectiveId === 'space'
        ? 'space-attempt'
        : `${objectiveId}-attempt`;
    return deriveSeed(levelSeed, namespace, ordinal);
}

const itemInstanceSchema = z.object({
    id: z.string().min(1),
    baseTypeId: z.enum(ITEM_TYPE_IDS),
    quality: z.enum(ITEM_QUALITIES),
    affixIds: z.array(z.enum(ITEM_AFFIX_IDS)).max(2),
    rolledChoiceIds: z.array(z.enum(ITEM_CHOICE_IDS)).max(3),
    quantity: z.number().int().min(1).max(3),
    charges: z.number().int().min(0).max(99).nullable()
}).strict().superRefine((item, context) => {
    if (new Set(item.affixIds).size !== item.affixIds.length) {
        context.addIssue({code: 'custom', path: ['affixIds'], message: 'Item affixes must be unique.'});
    }
    if (item.quality === 'common' && item.affixIds.length > 0) {
        context.addIssue({code: 'custom', path: ['affixIds'], message: 'Common items cannot have affixes.'});
    }
    if (item.quality === 'uncommon' && item.affixIds.length > 1) {
        context.addIssue({code: 'custom', path: ['affixIds'], message: 'Uncommon items have at most one affix.'});
    }
    if (item.affixIds.includes('frost-bound') && item.affixIds.includes('ember-bound')) {
        context.addIssue({code: 'custom', path: ['affixIds'], message: 'Frost and Ember affixes conflict.'});
    }
    const orbChoices = item.baseTypeId === 'mystery-orb' ? 3 : 0;
    if (item.rolledChoiceIds.length !== orbChoices ||
        new Set(item.rolledChoiceIds).size !== item.rolledChoiceIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['rolledChoiceIds'],
            message: 'Mystery Orbs require exactly three unique choices; other items require none.'
        });
    }
});

const worldItemSchema = z.object({
    instance: itemInstanceSchema,
    position: coordinateSchema
}).strict();

const monsterIntentSchema = z.object({
    kind: z.enum(['melee', 'ranged', 'reveal']),
    targetPositions: z.array(coordinateSchema).max(16),
    damage: nonNegativeSafeInteger.max(10),
    executeOnTurn: nonNegativeSafeInteger
}).strict();

const monsterStatusSchema = z.object({
    kind: z.enum(['rooted', 'frost-delayed', 'poison']),
    remainingTurns: z.number().int().min(1).max(20)
}).strict();

const monsterSchema = z.object({
    id: z.string().min(1),
    typeId: z.enum(MONSTER_TYPE_IDS),
    variantIds: z.array(z.enum(MONSTER_VARIANT_IDS)).max(2),
    elite: z.boolean(),
    position: coordinateSchema,
    spawnPosition: coordinateSchema,
    health: z.number().int().min(1).max(99),
    maxHealth: z.number().int().min(1).max(99),
    armor: z.number().int().min(0).max(3),
    actionCount: nonNegativeSafeInteger,
    nextMoveTurn: nonNegativeSafeInteger,
    nextAttackTurn: nonNegativeSafeInteger,
    revealed: z.boolean(),
    intent: monsterIntentSchema.nullable(),
    statuses: z.array(monsterStatusSchema).max(8),
    undamagedTurns: z.number().int().min(0).max(3),
    drop: itemInstanceSchema.nullable()
}).strict().superRefine((monster, context) => {
    if (monster.health > monster.maxHealth) {
        context.addIssue({code: 'custom', path: ['health'], message: 'Monster health exceeds maximum.'});
    }
    if (new Set(monster.variantIds).size !== monster.variantIds.length) {
        context.addIssue({code: 'custom', path: ['variantIds'], message: 'Monster variants must be unique.'});
    }
    if (!monster.elite && monster.variantIds.length > 1) {
        context.addIssue({code: 'custom', path: ['variantIds'], message: 'Ordinary monsters have one variant maximum.'});
    }
});

const trapSchema = z.object({
    id: z.string().min(1),
    typeId: z.enum(TRAP_TYPE_IDS),
    position: coordinateSchema,
    owner: z.enum(['world', 'player']),
    revealed: z.boolean(),
    disabled: z.boolean(),
    phase: z.number().int().min(0).max(8),
    nextPhaseTurn: nonNegativeSafeInteger
}).strict();

const pendingHazardSchema = z.object({
    id: z.string().min(1),
    typeId: z.literal('volatile-explosion'),
    origin: coordinateSchema,
    targetPositions: z.array(coordinateSchema).min(1).max(5),
    executeAfterTurn: nonNegativeSafeInteger
}).strict();

const playerStatusSchema = z.object({
    kind: z.enum([
        'poison',
        'fire-ward',
        'ice-ward',
        'lightning-ward',
        'guard',
        'rooted',
        'map-reveal'
    ]),
    remainingTurns: z.number().int().min(0).max(999),
    charges: z.number().int().min(0).max(9)
}).strict();

const playerSchema = z.object({
    health: nonNegativeSafeInteger,
    maxHealth: nonNegativeSafeInteger.positive().max(99),
    money: nonNegativeSafeInteger,
    scrap: nonNegativeSafeInteger,
    miningPower: nonNegativeSafeInteger.max(4),
    toolCharge: nonNegativeSafeInteger.max(999),
    installedModuleIds: z.array(z.string().min(1)),
    backpack: z.array(itemInstanceSchema).max(8),
    equippedWeapon: itemInstanceSchema.nullable(),
    equippedUtility: itemInstanceSchema.nullable(),
    bowAmmo: z.number().int().min(0).max(16),
    quickSlotItemIds: z.tuple([
        z.string().min(1).nullable(),
        z.string().min(1).nullable(),
        z.string().min(1).nullable()
    ]),
    statuses: z.array(playerStatusSchema).max(16),
    weaponRecoveryActions: z.union([z.literal(0), z.literal(1)])
}).strict().refine(player => player.health <= player.maxHealth, {
    message: 'Player health cannot exceed maximum health.',
    path: ['health']
});

const objectiveSchema = z.object({
    objectiveId: z.enum(OBJECTIVE_IDS),
    triggerId: z.string().min(1),
    position: coordinateSchema
}).strict();

const serviceSiteSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(SERVICE_SITE_KINDS),
    position: coordinateSchema
}).strict();

const historyEntrySchema = z.object({
    runId: z.string().min(1),
    definitionId: z.string().min(1),
    triggerId: z.string().min(1),
    kind: z.enum(ENCOUNTER_KINDS),
    status: z.enum(ENCOUNTER_STATUSES),
    grade: z.enum(PERFORMANCE_GRADES),
    score: z.number().finite().nonnegative(),
    elapsedMs: z.number().finite().nonnegative()
}).strict();

const activeEncounterSchema = z.object({
    levelId: z.string().min(1),
    objectiveId: z.enum(OBJECTIVE_IDS),
    triggerId: z.string().min(1),
    encounterKind: z.enum(ENCOUNTER_KINDS),
    attemptOrdinal: nonNegativeSafeInteger,
    runId: z.string().min(1),
    seed: uint32
}).strict();

const pendingLevelRewardSchema = z.object({
    levelId: z.string().min(1),
    seed: uint32,
    armoryOffer: itemInstanceSchema
}).strict();

export const campaignStateSchema: z.ZodType<CampaignState> = z.object({
    schemaVersion: z.literal(CAMPAIGN_SCHEMA_VERSION),
    campaignSeed: uint32,
    act: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    player: playerSchema,
    worldSystems: z.object({
        powerRouting: safeInteger.min(0).max(100),
        securityAlert: safeInteger.min(0).max(100),
        airspaceControl: safeInteger.min(0).max(100),
        structuralStability: safeInteger.min(0).max(100)
    }).strict(),
    flags: z.array(z.string().min(1)),
    overworld: z.object({
        levelId: z.string().min(1),
        seed: uint32,
        generatorId: z.literal(MAZE_GENERATOR_ID),
        contentGeneratorId: z.literal(OVERWORLD_CONTENT_GENERATOR_ID),
        contentOrigin: z.enum(['native-v2', 'migrated-v1']),
        levelContentInitialized: z.boolean(),
        maze: mazeSchema,
        playerPosition: coordinateSchema,
        turn: nonNegativeSafeInteger,
        reinforcementCountdownMs: z.number().finite().min(0).max(MAX_REINFORCEMENT_DELAY_MS),
        reinforcementOrdinal: uint32,
        items: z.array(worldItemSchema),
        monsters: z.array(monsterSchema),
        traps: z.array(trapSchema),
        pendingHazards: z.array(pendingHazardSchema),
        objectives: z.array(objectiveSchema).max(MAX_LEVEL_OBJECTIVE_COUNT),
        serviceSites: z.array(serviceSiteSchema).max(SERVICE_SITE_KINDS.length),
        pipeShortcutWall: coordinateSchema.nullable(),
        sanctuaryPosition: coordinateSchema,
        sanctuaryServiceClaims: z.array(z.enum(OBJECTIVE_IDS)).max(MAX_LEVEL_OBJECTIVE_COUNT),
        levelDeathCount: nonNegativeSafeInteger,
        mercyDropUsed: z.boolean(),
        pendingDefeatChoice: z.object({
            turn: nonNegativeSafeInteger,
            cause: z.enum(['monster', 'trap', 'volatile', 'encounter']),
            featherInstanceId: z.string().min(1)
        }).strict().nullable(),
        triggerStates: z.record(z.string().min(1), z.enum(TRIGGER_STATES)),
        resumeGraceTurns: z.number().int().min(0).max(3)
    }).strict(),
    activeEncounter: activeEncounterSchema.nullable(),
    pendingLevelReward: pendingLevelRewardSchema.nullable(),
    appliedEncounterRunIds: z.array(z.string().min(1)),
    encounterHistory: z.array(historyEntrySchema)
}).strict().superRefine((state, context) => {
    const {overworld, player} = state;
    const size = overworld.maze.length;
    const squareMaze = size % 2 === 1 && overworld.maze.every(row => row.length === size);
    if (!squareMaze) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'maze'],
            message: 'Saved maze must be an odd square grid.'
        });
    }
    if (size < MIN_PLAYABLE_MAZE_SIZE || size > MAX_PLAYABLE_MAZE_SIZE) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'maze'],
            message: `Saved maze size must be between ${MIN_PLAYABLE_MAZE_SIZE} and ${MAX_PLAYABLE_MAZE_SIZE}.`
        });
    }

    const isPassage = (position: {readonly x: number; readonly y: number}) =>
        overworld.maze[position.y]?.[position.x]?.kind === 'passage';
    const spawn = {x: 1, y: 1};
    const exit = {x: size - 2, y: size - 2};

    if (squareMaze) {
        const solidPerimeter = overworld.maze.every((row, y) =>
            row.every((cell, x) =>
                x > 0 && y > 0 && x < size - 1 && y < size - 1
                    ? true
                    : cell.kind === 'wall'
            )
        );
        if (!solidPerimeter) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'maze'],
                message: 'Saved maze perimeter must be solid wall.'
            });
        }
        if (!isPassage(spawn)) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'maze', spawn.y, spawn.x],
                message: 'Maze spawn must be a passage.'
            });
        }
        if (!isPassage(exit)) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'maze', exit.y, exit.x],
                message: 'Maze exit must be a passage.'
            });
        }

        if (isPassage(spawn)) {
            const reachable = new Set<string>([coordinateKey(spawn)]);
            const queue: Coordinate[] = [spawn];
            for (let index = 0; index < queue.length; index++) {
                const current = queue[index]!;
                for (const direction of CARDINAL_DIRECTIONS) {
                    const candidate = {
                        x: current.x + direction.x,
                        y: current.y + direction.y
                    };
                    const candidateKey = coordinateKey(candidate);
                    if (!isPassage(candidate) || reachable.has(candidateKey)) continue;
                    reachable.add(candidateKey);
                    queue.push(candidate);
                }
            }
            const passageCount = overworld.maze.reduce(
                (total, row) => total + row.filter(cell => cell.kind === 'passage').length,
                0
            );
            if (reachable.size !== passageCount) {
                context.addIssue({
                    code: 'custom',
                    path: ['overworld', 'maze'],
                    message: 'Every maze passage must be reachable from spawn.'
                });
            }
            if (isPassage(exit) && !reachable.has(coordinateKey(exit))) {
                context.addIssue({
                    code: 'custom',
                    path: ['overworld', 'maze', exit.y, exit.x],
                    message: 'Maze exit must be reachable from spawn.'
                });
            }
        }
    }

    for (const [path, position] of [
        [['overworld', 'playerPosition'], overworld.playerPosition],
        [['overworld', 'sanctuaryPosition'], overworld.sanctuaryPosition],
        ...overworld.items.map((item, index) =>
            [['overworld', 'items', index, 'position'], item.position] as const
        ),
        ...overworld.monsters.flatMap((monster, index) => [
            [['overworld', 'monsters', index, 'position'], monster.position] as const,
            [['overworld', 'monsters', index, 'spawnPosition'], monster.spawnPosition] as const
        ]),
        ...overworld.traps.map((trap, index) =>
            [['overworld', 'traps', index, 'position'], trap.position] as const
        ),
        ...overworld.objectives.map((objective, index) =>
            [['overworld', 'objectives', index, 'position'], objective.position] as const
        ),
        ...overworld.serviceSites.map((site, index) =>
            [['overworld', 'serviceSites', index, 'position'], site.position] as const
        ),
        ...overworld.pendingHazards.flatMap((hazard, index) => [
            [['overworld', 'pendingHazards', index, 'origin'], hazard.origin] as const,
            ...hazard.targetPositions.map((position, targetIndex) =>
                [
                    ['overworld', 'pendingHazards', index, 'targetPositions', targetIndex],
                    position
                ] as const
            )
        ])
    ] as const) {
        if (!isPassage(position)) {
            context.addIssue({code: 'custom', path: [...path], message: 'Entity must occupy a maze passage.'});
        }
    }

    if (!overworld.levelContentInitialized) {
        if (
            overworld.contentOrigin !== 'native-v2' ||
            overworld.items.length > 0 ||
            overworld.monsters.length > 0 ||
            overworld.traps.length > 0 ||
            overworld.pendingHazards.length > 0 ||
            overworld.objectives.length > 0 ||
            overworld.serviceSites.length > 0 ||
            overworld.pipeShortcutWall !== null ||
            overworld.pendingDefeatChoice !== null ||
            state.activeEncounter !== null ||
            state.pendingLevelReward !== null ||
            OBJECTIVE_DEFINITIONS.some(definition =>
                state.flags.includes(definition.completionFlag)
            )
        ) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'levelContentInitialized'],
                message: 'Uninitialized native content must be empty.'
            });
        }
    } else if (
        !isCompatibleLevelObjectiveCount(
            campaignLevelNumber(overworld.levelId),
            overworld.objectives.length
        ) ||
        new Set(overworld.objectives.map(objective => objective.objectiveId)).size !==
            overworld.objectives.length
    ) {
        const expectedCount = getLevelObjectiveSelectionCount(
            campaignLevelNumber(overworld.levelId)
        );
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'objectives'],
            message:
                `Initialized level ${campaignLevelNumber(overworld.levelId)} requires ` +
                `${expectedCount} distinct objectives ` +
                `(or a compatible persisted 4/5/6-game roster).`
        });
    }

    const isObjectiveComplete = (objectiveId: ObjectiveId): boolean =>
        state.flags.includes(OBJECTIVE_BY_ID[objectiveId].completionFlag);
    for (const [index, objective] of overworld.objectives.entries()) {
        const definition = OBJECTIVE_BY_ID[objective.objectiveId];
        if (objective.triggerId !== definition.triggerId) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'objectives', index, 'triggerId'],
                message: 'Objective trigger ID does not match its registry definition.'
            });
        }
        if (sameCoordinate(objective.position, spawn) || sameCoordinate(objective.position, exit)) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'objectives', index, 'position'],
                message: 'Objectives cannot occupy the maze spawn or exit.'
            });
        }
    }
    for (const definition of OBJECTIVE_DEFINITIONS) {
        if (Object.hasOwn(overworld.triggerStates, definition.triggerId)) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'triggerStates', definition.triggerId],
                message: 'Required objective progress must be represented by completion flags.'
            });
        }
    }

    const reportDuplicatePositions = (
        entries: readonly {
            readonly position: Coordinate;
            readonly path: readonly (string | number)[];
        }[],
        message: string
    ): void => {
        const seen = new Set<string>();
        for (const entry of entries) {
            const positionKey = coordinateKey(entry.position);
            if (seen.has(positionKey)) {
                context.addIssue({code: 'custom', path: [...entry.path], message});
            }
            seen.add(positionKey);
        }
    };
    reportDuplicatePositions(
        overworld.objectives.map((objective, index) => ({
            position: objective.position,
            path: ['overworld', 'objectives', index, 'position']
        })),
        'Objective positions must be unique.'
    );
    reportDuplicatePositions(
        overworld.items.map((item, index) => ({
            position: item.position,
            path: ['overworld', 'items', index, 'position']
        })),
        'World item positions must be unique.'
    );
    reportDuplicatePositions(
        overworld.monsters.map((monster, index) => ({
            position: monster.position,
            path: ['overworld', 'monsters', index, 'position']
        })),
        'Monster positions must be unique.'
    );
    reportDuplicatePositions(
        overworld.monsters.map((monster, index) => ({
            position: monster.spawnPosition,
            path: ['overworld', 'monsters', index, 'spawnPosition']
        })),
        'Monster spawn positions must be unique.'
    );
    reportDuplicatePositions(
        overworld.traps.map((trap, index) => ({
            position: trap.position,
            path: ['overworld', 'traps', index, 'position']
        })),
        'Trap positions must be unique.'
    );
    reportDuplicatePositions(
        overworld.serviceSites.map((site, index) => ({
            position: site.position,
            path: ['overworld', 'serviceSites', index, 'position']
        })),
        'Service-site positions must be unique.'
    );

    if (new Set(overworld.serviceSites.map(site => site.kind)).size !== overworld.serviceSites.length) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'serviceSites'],
            message: 'A level can contain at most one service site of each kind.'
        });
    }
    if (new Set(overworld.serviceSites.map(site => site.id)).size !== overworld.serviceSites.length) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'serviceSites'],
            message: 'Service-site IDs must be unique.'
        });
    }
    if (
        requiresCasinoHeistShop(state.flags, overworld.objectives) &&
        !overworld.serviceSites.some(site => site.kind === 'shop')
    ) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'serviceSites'],
            message: 'A locked Casino Heist objective requires a shop purchase route.'
        });
    }

    const objectivePositionKeys = new Set(
        overworld.objectives.map(objective => coordinateKey(objective.position))
    );
    for (const [index, site] of overworld.serviceSites.entries()) {
        if (
            objectivePositionKeys.has(coordinateKey(site.position)) ||
            sameCoordinate(site.position, spawn) ||
            sameCoordinate(site.position, exit)
        ) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'serviceSites', index, 'position'],
                message: 'Service sites cannot overlap objectives, spawn, or exit.'
            });
        }
    }
    for (const [index, item] of overworld.items.entries()) {
        if (objectivePositionKeys.has(coordinateKey(item.position))) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'items', index, 'position'],
                message: 'World items cannot overlap objectives.'
            });
        }
    }
    for (const [index, monster] of overworld.monsters.entries()) {
        if (sameCoordinate(monster.position, overworld.playerPosition)) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'monsters', index, 'position'],
                message: 'A monster cannot share the player position.'
            });
        }
        if (
            objectivePositionKeys.has(coordinateKey(monster.position)) ||
            objectivePositionKeys.has(coordinateKey(monster.spawnPosition))
        ) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'monsters', index, 'position'],
                message: 'Monsters cannot overlap objectives.'
            });
        }
    }
    for (const [index, trap] of overworld.traps.entries()) {
        if (objectivePositionKeys.has(coordinateKey(trap.position))) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'traps', index, 'position'],
                message: 'Traps cannot overlap objectives.'
            });
        }
    }

    if (!sameCoordinate(overworld.sanctuaryPosition, spawn)) {
        const sanctuaryObjective = overworld.objectives.find(objective =>
            sameCoordinate(objective.position, overworld.sanctuaryPosition)
        );
        if (!sanctuaryObjective || !isObjectiveComplete(sanctuaryObjective.objectiveId)) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'sanctuaryPosition'],
                message: 'Sanctuary must be spawn or a completed objective.'
            });
        }
    }

    if (overworld.levelContentInitialized) {
        const pipeSelected = overworld.objectives.some(
            objective => objective.objectiveId === 'pipe'
        );
        const pipeComplete = isObjectiveComplete('pipe');
        if (pipeComplete && overworld.pipeShortcutWall !== null) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pipeShortcutWall'],
                message: 'Completed Pipe objective cannot retain a protected shortcut wall.'
            });
        }
        if (pipeSelected && !pipeComplete && overworld.pipeShortcutWall === null) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pipeShortcutWall'],
                message: 'Incomplete Pipe objective requires a protected shortcut wall.'
            });
        }
        // Pre-expansion generators reserved this connector even when Pipe was
        // absent from the roster. Accept that inert legacy state; new levels
        // leave it null unless Pipe is selected.
        const shortcut = overworld.pipeShortcutWall;
        if (shortcut !== null) {
            const interior = shortcut.x > 0 && shortcut.y > 0 &&
                shortcut.x < size - 1 && shortcut.y < size - 1;
            const mixedParity = shortcut.x % 2 !== shortcut.y % 2;
            const horizontal = isPassage({x: shortcut.x - 1, y: shortcut.y}) &&
                isPassage({x: shortcut.x + 1, y: shortcut.y});
            const vertical = isPassage({x: shortcut.x, y: shortcut.y - 1}) &&
                isPassage({x: shortcut.x, y: shortcut.y + 1});
            if (
                !interior ||
                !mixedParity ||
                overworld.maze[shortcut.y]?.[shortcut.x]?.kind !== 'wall' ||
                (!horizontal && !vertical)
            ) {
                context.addIssue({
                    code: 'custom',
                    path: ['overworld', 'pipeShortcutWall'],
                    message: 'Protected Pipe shortcut must be a valid interior wall connector.'
                });
            }
        }
    }

    for (const [index, hazard] of overworld.pendingHazards.entries()) {
        const targetKeys = hazard.targetPositions.map(coordinateKey);
        if (new Set(targetKeys).size !== targetKeys.length) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingHazards', index, 'targetPositions'],
                message: 'Pending hazard targets must be unique.'
            });
        }
        const expectedTargetKeys = new Set([
            coordinateKey(hazard.origin),
            ...CARDINAL_DIRECTIONS
                .map(direction => ({
                    x: hazard.origin.x + direction.x,
                    y: hazard.origin.y + direction.y
                }))
                .filter(isPassage)
                .map(coordinateKey)
        ]);
        if (
            targetKeys.length !== expectedTargetKeys.size ||
            targetKeys.some(targetKey => !expectedTargetKeys.has(targetKey))
        ) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingHazards', index, 'targetPositions'],
                message: 'Pending hazard targets must equal its passage origin and orthogonal passage neighbors.'
            });
        }
        if (hazard.executeAfterTurn <= overworld.turn) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingHazards', index, 'executeAfterTurn'],
                message: 'Pending hazards must execute on a future turn.'
            });
        }
    }

    if (
        player.equippedWeapon !== null &&
        ITEM_DEFINITIONS[player.equippedWeapon.baseTypeId].category !== 'weapon'
    ) {
        context.addIssue({
            code: 'custom',
            path: ['player', 'equippedWeapon'],
            message: 'Equipped weapon slot requires a weapon item.'
        });
    }
    if (
        player.equippedUtility !== null &&
        ITEM_DEFINITIONS[player.equippedUtility.baseTypeId].category !== 'utility'
    ) {
        context.addIssue({
            code: 'custom',
            path: ['player', 'equippedUtility'],
            message: 'Equipped utility slot requires a utility item.'
        });
    }

    const ids = [
        ...player.backpack.map(item => item.id),
        ...(player.equippedWeapon ? [player.equippedWeapon.id] : []),
        ...(player.equippedUtility ? [player.equippedUtility.id] : []),
        ...overworld.items.map(item => item.instance.id),
        ...overworld.monsters.flatMap(monster => [monster.id, ...(monster.drop ? [monster.drop.id] : [])]),
        ...overworld.traps.map(trap => trap.id),
        ...overworld.pendingHazards.map(hazard => hazard.id),
        ...overworld.serviceSites.map(site => site.id),
        ...(state.pendingLevelReward ? [state.pendingLevelReward.armoryOffer.id] : [])
    ];
    if (new Set(ids).size !== ids.length) {
        context.addIssue({code: 'custom', path: ['overworld'], message: 'Entity/item IDs must be globally unique.'});
    }

    const backpackIds = new Set(player.backpack.map(item => item.id));
    for (const [index, quickId] of player.quickSlotItemIds.entries()) {
        if (quickId !== null && !backpackIds.has(quickId)) {
            context.addIssue({
                code: 'custom',
                path: ['player', 'quickSlotItemIds', index],
                message: 'Quick slots must reference backpack items.'
            });
        }
    }

    if (new Set(state.appliedEncounterRunIds).size !== state.appliedEncounterRunIds.length) {
        context.addIssue({
            code: 'custom',
            path: ['appliedEncounterRunIds'],
            message: 'Applied encounter run IDs must be unique.'
        });
    }
    if (new Set(overworld.sanctuaryServiceClaims).size !== overworld.sanctuaryServiceClaims.length) {
        context.addIssue({
            code: 'custom',
            path: ['overworld', 'sanctuaryServiceClaims'],
            message: 'Sanctuary claims must be unique.'
        });
    }
    for (const [index, objectiveId] of overworld.sanctuaryServiceClaims.entries()) {
        if (
            !overworld.objectives.some(objective => objective.objectiveId === objectiveId) ||
            !isObjectiveComplete(objectiveId)
        ) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'sanctuaryServiceClaims', index],
                message: 'Sanctuary claims must reference selected, completed objectives.'
            });
        }
    }

    const activeEncounter = state.activeEncounter;
    if (activeEncounter !== null) {
        const definition = OBJECTIVE_BY_ID[activeEncounter.objectiveId];
        const placement = overworld.objectives.find(objective =>
            objective.objectiveId === activeEncounter.objectiveId
        );
        const expectedOrdinal = state.encounterHistory.filter(entry =>
            entry.triggerId === definition.triggerId
        ).length;
        const expectedRunId =
            `${overworld.levelId}/${definition.triggerId}/${activeEncounter.attemptOrdinal}`;
        if (
            activeEncounter.levelId !== overworld.levelId ||
            activeEncounter.triggerId !== definition.triggerId ||
            activeEncounter.encounterKind !== definition.kind ||
            activeEncounter.runId !== expectedRunId ||
            activeEncounter.attemptOrdinal !== expectedOrdinal ||
            activeEncounter.seed !== encounterAttemptSeed(
                overworld.seed,
                activeEncounter.objectiveId,
                activeEncounter.attemptOrdinal
            ) ||
            getObjectiveStatus(state.flags, activeEncounter.objectiveId) !== 'available'
        ) {
            context.addIssue({
                code: 'custom',
                path: ['activeEncounter'],
                message: 'Active encounter descriptor does not match the current objective attempt.'
            });
        }
        if (!placement || !sameCoordinate(placement.position, overworld.playerPosition)) {
            context.addIssue({
                code: 'custom',
                path: ['activeEncounter', 'objectiveId'],
                message: 'Active encounter requires the player at its persisted objective.'
            });
        }
        if (
            state.appliedEncounterRunIds.includes(activeEncounter.runId) ||
            state.encounterHistory.some(entry => entry.runId === activeEncounter.runId)
        ) {
            context.addIssue({
                code: 'custom',
                path: ['activeEncounter', 'runId'],
                message: 'Active encounter run cannot already be committed.'
            });
        }
        if (state.pendingLevelReward !== null || overworld.pendingDefeatChoice !== null) {
            context.addIssue({
                code: 'custom',
                path: ['activeEncounter'],
                message: 'Active encounter cannot coexist with another persisted modal.'
            });
        }
    }

    const pendingDefeat = overworld.pendingDefeatChoice;
    if (pendingDefeat !== null) {
        const feather = player.backpack.find(item =>
            item.id === pendingDefeat.featherInstanceId
        );
        if (player.health !== 0) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingDefeatChoice'],
                message: 'Pending defeat requires zero player health.'
            });
        }
        if (!feather || feather.baseTypeId !== 'revival-feather') {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingDefeatChoice', 'featherInstanceId'],
                message: 'Pending defeat must reference an owned Revival Feather.'
            });
        }
        if (pendingDefeat.turn !== overworld.turn) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingDefeatChoice', 'turn'],
                message: 'Pending defeat turn must match the current overworld turn.'
            });
        }
        if (state.activeEncounter !== null || state.pendingLevelReward !== null) {
            context.addIssue({
                code: 'custom',
                path: ['overworld', 'pendingDefeatChoice'],
                message: 'Pending defeat cannot coexist with another persisted modal.'
            });
        }
    } else if (player.health === 0) {
        context.addIssue({
            code: 'custom',
            path: ['player', 'health'],
            message: 'Zero health requires a persisted defeat choice.'
        });
    }

    const pendingReward = state.pendingLevelReward;
    if (pendingReward !== null) {
        const completedSelectedObjectives = overworld.objectives.filter(objective =>
            isObjectiveComplete(objective.objectiveId)
        ).length;
        const levelNumber = campaignLevelNumber(overworld.levelId);
        const requiredObjectiveCount = getPersistedLevelObjectiveRequirementCount(
            levelNumber,
            overworld.objectives.length
        );
        const exitRequirementsMet =
            isCompatibleLevelObjectiveCount(levelNumber, overworld.objectives.length) &&
            completedSelectedObjectives >= requiredObjectiveCount;
        if (
            pendingReward.levelId !== overworld.levelId ||
            pendingReward.seed !== deriveSeed(overworld.seed, 'level-reward', 0) ||
            !sameCoordinate(overworld.playerPosition, exit) ||
            !exitRequirementsMet
        ) {
            context.addIssue({
                code: 'custom',
                path: ['pendingLevelReward'],
                message: 'Pending level reward does not match the completed current level.'
            });
        }
        const offerDefinition = ITEM_DEFINITIONS[pendingReward.armoryOffer.baseTypeId];
        if (
            pendingReward.armoryOffer.id !== `${overworld.levelId}/armory-reward` ||
            offerDefinition.category !== 'weapon' ||
            !['uncommon', 'rare'].includes(pendingReward.armoryOffer.quality) ||
            pendingReward.armoryOffer.quantity !== 1 ||
            pendingReward.armoryOffer.charges !== null
        ) {
            context.addIssue({
                code: 'custom',
                path: ['pendingLevelReward', 'armoryOffer'],
                message: 'Pending Armory offer must be one rolled equipment item for this level.'
            });
        }
        if (state.activeEncounter !== null || overworld.pendingDefeatChoice !== null) {
            context.addIssue({
                code: 'custom',
                path: ['pendingLevelReward'],
                message: 'Pending level reward cannot coexist with another persisted modal.'
            });
        }
    }
});

export function parseCampaignState(input: unknown): CampaignState {
    return campaignStateSchema.parse(input);
}
