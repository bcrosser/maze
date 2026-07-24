# Gameplay Overhaul Specification

Status: Implementation-ready draft  
Target: Phaser runtime, proposed version 0.3  
Last updated: 2026-07-24

## 1. Purpose

This specification turns the current checkpoint into a replayable, single-player, multi-genre maze game whose overworld and selected required encounters change from level to level.

## Active minigame-roster amendment

The eight-game campaign supersedes older references below to “four required objectives,” “six required objectives,” or a fixed sequential chain:

- The required-objective registry is Pipe, Lock, Space, Platformer, Circuit Crush, Horsemaster, Zapper, and Casino Heist. Blackjack and Texas Hold’em remain optional service games and never count toward the exit.
- Levels 1–4 select four stable random objectives. Levels 5, 6, 7, and 8 select five, six, seven, and all eight respectively. Refreshing an unfinished level keeps its roster, placements, and encounter seeds stable.
- The number required to unlock the exit equals the level number, capped at eight. Thus levels 1 through 8 require 1, 2, 3, 4, 5, 6, 7, and 8 completed selected games respectively. Once the threshold is met, any remaining games on levels 1–3 stay optional and playable.
- Existing saves that already contain a four-, five-, or six-game roster are preserved without rerolling. A grandfathered save never requires more objectives than its persisted roster contains, preventing a migration deadlock.
- Levels 1–7 retain the level-reward flow. Completing all eight objectives and entering the level-8 exit persists `campaign-victory`, never creates level 9, and presents a synthesized fanfare with a dancing-horse celebration.
- Circuit Crush uses an 8×8, 18-move, seeded board with no starting matches, at least one legal swap, a replay-verified solvability certificate, blocker-clearing objectives, row/column/burst/color specials, and limited extra-move, hint, pulse, and shuffle boosters. Every retry derives a new seed and certified board.
- Horsemaster uses a seeded fixed-step traffic simulation. The horse jumps upward between exercise machines mounted on wrapping cars, with wide slow opportunities and narrow fast opportunities, horizontal alignment, three recoverable impacts, touch controls, and the Ultra Horse Gym as its finish.
- Zapper is a seeded alien-laboratory service rush in which the player fills slime-powered blasters, slides them down nanotech counters, and catches the completed guns returning from alien technicians before handing them to waiting customers.
- Casino Heist is a seeded highway escape that is visibly locked until the persistent Getaway Car has been acquired as rare maze loot or purchased for exactly `$100`. It starts the car unarmed, provides finite-ammo road weapon pickups, fields obstacles, spiked luxury cars, and forward-firing enemies, and awards exactly `$1000` on success.
- Carried and equipped maze items may grant small, visible, passive minigame bonuses. Entering a minigame never consumes or mutates the contributing item.
- The objective atlas is 256×32 RGBA with eight 32×32 frames in registry order.

The intended player loop is:

1. Enter a newly generated maze.
2. Build a small persistent loadout while using materials, avoiding/disarming traps, and fighting or outmaneuvering readable monster variants.
3. Explore to find the level’s stable, visually distinct selected objective sites.
4. Complete the level-number requirement from that roster; a still-locked Casino Heist clearly points to the Getaway Car.
5. Return to the exit once the required count is complete and choose a level reward, or finish all eight games on level 8 to win.
6. Enter a larger newly generated maze and repeat with increased difficulty. Maze size grows to 99×99; later levels stay at 99×99 but receive a new level seed and layout.

The maze is the connective challenge, not a hallway between objective encounters placed beside the spawn. Each minigame must be understandable on its first play, support keyboard and touch input, have a real success and failure state, and remain interesting on repeat attempts.

## 2. Product decisions

The objective, reroll, icon, Space-upgrade, and Space-duration choices below were approved on 2026-07-23. The remaining bullets are scope defaults for this draft.

- The game remains single-player. Multiplayer, leaderboards, and network services are out of scope.
- Phaser is the sole game runtime. The former inline `?runtime=legacy` application has been retired; version-1 save migration remains supported so existing campaigns are not discarded.
- A new campaign is a total reroll of all procedural content. A newly entered later level is also fresh. Refreshing, leaving, or resuming an unfinished saved level preserves its exact maze, items, item features, monsters, monster variants, traps, and objective positions.
- The original maze algorithm is preserved as `wilson-v1`: the existing loop-erased random-walk topology generator followed by the existing clustered wall-material assignment.
- The selected roster is randomized and stable for the unfinished level. Every selected site is instantiated at level creation; any unavailable site appears visibly locked and states its unlock requirement. Casino Heist specifically requires the persistent Getaway Car unlock.
- Objective sites are not generic collectible items. Health potions, mining picks, and future consumables remain a separate item system.
- The Platformer landmark retains its elevator/lift icon; the expanded atlas adds distinct Circuit Crush, Horsemaster, Zapper, and Casino Heist silhouettes.
- The maze becomes a deterministic roguelike combat layer using the existing item, monster, and material art banks. Persistent overworld gear is separate from run-scoped Space modules and attempt-scoped Platformer pickups.
- Carried and equipped overworld items can supply modest passive modifiers to individual minigames without being consumed.
- Maze defeat is a recoverable setback, not permadeath: the player always retains a basic attack and required progression, and recovery rules prevent a monster-induced loss spiral.
- The Getaway Car is rare random maze loot and a fixed `$100` shop offer. If a level selects a still-locked Casino Heist, that level guarantees a shop so the required roster cannot deadlock.
- A skilled Space run may still finish near 120 seconds on Standard, but the hard limit is deliberately generous: 5:00 at level tier 0 plus 30 seconds per tier, capped at 7:30. Rare unstable Space powerups explicitly increase both power and threat; ordinary pickups remain purely beneficial.
- R-Type is a mechanical inspiration only. The Space encounter must use original names, art, enemies, boss design, interface, sound, and narrative.

## 3. Baseline findings that motivated the overhaul

This table records the pre-overhaul checkpoint for design context; the active eight-game amendment and implementation rules above are authoritative.

| Area | Current behavior | Why it needs revision |
| --- | --- | --- |
| Fresh maze | Every new campaign uses `PHASER_MIGRATION_SEED` (`src/app/game-constants.ts`, `src/app/create-game.ts`). | Clearing a save produces the same first maze and the same later level sequence. |
| Maze algorithm | `generateMazeTopology()` already implements the original loop-erased random-walk algorithm (`src/domain/overworld/maze-generator.ts`). | The algorithm is suitable; seed creation and version persistence are missing. |
| Objectives | One deterministic placement beside spawn supplies two cells shared by all four games (`src/encounters/place-intro-trigger.ts`, `src/scenes/overworld.scene.ts`). | The player shuttles between neighboring cells instead of exploring the maze. |
| Objective art | Pipe and Lock are rectangles, Space is a circle, and Platformer is a triangle. | The shapes do not communicate the activity they represent. |
| Maze items | `floor(size / 5)` passage cells alternate Health Potion and Mining Pick; only their positions vary. Potions are consumed even at full health, while 48 existing item frames are unused. | Loot has no category balance, inventory, equipment, weapon, affix, or meaningful pickup choice. |
| Maze monsters | `floor(size / 4)` monsters alternate Moss Slime and Ember Hound. They have no health, telegraph, loot, or player counterattack; multiple monsters can stack damage on one cell. | The maze is avoidance-only and can become a repeated contact-damage loop rather than fair roguelike combat. |
| Maze materials/traps | Of 24 materials and 12 tags, only mineral mining and the Ember Hound’s adjacent `hot` bonus affect the overworld. No trap state exists. | Most generated regions are visual metadata rather than tactical terrain. |
| Maze defeat | Zero health teleports to spawn, resets mining power/charges, leaves pursuing monsters in place, and provides two grace turns. | A death can erase a persistent Lock reward and return the player to the same threat without new counterplay. |
| Pipe | A fixed 4×4 route has randomized rotations, instant connectivity, no timer, and no failure state. | The solution topology is always the same and there is no liquid pressure. |
| Lock | Four hidden pin heights and one hidden tension number are advanced by repeated taps. It has no binding order, tutorial, timer, or failure. | It is easy to brute-force and difficult to understand. |
| Space | A five-lane vertical shooter ends after 6–8 kills. The normal campaign route enables auto-fire and maximum shielding. | It is short, repetitive, unusually easy, and has no boss or alternate weapon. |
| Platformer | One authored level ignores its encounter seed. Two ledges are above the current jump ceiling; materials are cosmetic; collectibles are optional; there are no enemies or weapons. | It is partly unreachable but still trivial to finish by staying on the ground. |
| Saves | The maze is saved, but objective positions and generator version are not. Save validation is strict version 1. | Recomputing positions after an algorithm change can invalidate an old save. |

## 4. Design principles

### 4.1 Deterministic variation

A seed must completely describe a generated level or encounter. The same seed and rules reproduce the same result for tests and saved games; a different production seed materially changes it.

Random systems must use named, independent seed streams. Adding a random call to item placement must not silently change the maze, objectives, monsters, or minigames.

### 4.2 Legible challenge

Difficulty must come from decisions, execution, and pressure rather than hidden rules. Every game must show:

- the immediate objective;
- the player’s current resources or remaining mistakes;
- what caused a failure;
- what action is currently possible;
- progress toward success.

### 4.3 Mobile-first interaction

Every encounter must be completable on one touchscreen. No action may require hover, right-click, or a physical keyboard. Pipe and Lock use one contact at a time. Space and Platformer may use an ordinary two-thumb layout but may never require more than two simultaneous contacts.

### 4.4 No softlocks

Every finite encounter must reach success or failure. Procedural generation must validate solvability before the player sees a level. Reloading, pausing, or exhausting a wave must not leave a scene running forever.

### 4.5 Pure rules, rendered by Phaser

Generation, movement, collision, resources, win/loss rules, and scoring belong in framework-independent models. Phaser scenes translate input, advance model time, synchronize visual objects, and emit `EncounterResult`.

### 4.6 Fair roguelike pressure

Randomness creates builds and tactical situations, not unknowable punishment. Affixes, monster intents, trap areas, and material interactions are identified before they can cause unavoidable harm. Defeat preserves the tools needed to recover, and required progression never depends on receiving one lucky item.

## 5. Randomness, maze generation, and persistence

### 5.1 Seed lifecycle

Production must stop using `PHASER_MIGRATION_SEED` as the new-game seed.

- A new campaign gets an unsigned 32-bit seed from `crypto.getRandomValues`.
- A version-2 saved campaign keeps its `campaignSeed`.
- Every level first created under schema version 2 receives `deriveSeed(campaignSeed, "level:" + generatorId, levelNumber)`, where the first playable level number is 1.
- Each subsystem derives a named seed from the level seed:

  - `maze-topology`
  - `wall-materials`
  - `objective-placement`
  - `overworld-item-placement`
  - `overworld-item-types`
  - `overworld-item-affixes`
  - `overworld-monster-placement`
  - `overworld-monster-types`
  - `overworld-monster-variants`
  - `overworld-traps`
  - `monster-loot`
  - `monster-ai`
  - `level-reward`
  - `pipe-attempt`
  - `lock-attempt`
  - `space-attempt`
  - `platformer-attempt`

- Static subsystem roots use ordinal 0. Stable item/monster instance indices derive their feature rolls from the relevant root without consuming placement randomness.
- Monster decisions use `turnSeed = deriveSeed(levelSeed, 'monster-ai', turn)` followed by `deriveSeed(turnSeed, monster.id, monster.actionCount)`. Stable-ID order or inserting an unrelated monster cannot perturb another monster’s decision.
- An encounter uses its committed-history attempt ordinal with its objective-specific namespace.
- Encounter seeds also include the attempt ordinal derived from committed history. A failed or abandoned retry is different; reloading an uncommitted attempt is reproducible.
- New Game and Restart receive a `CampaignSeedSource`; production supplies a Web Crypto implementation and tests may inject exact values or failures.
- If `crypto.getRandomValues` is unavailable or throws, show a blocking `Unable to create a random maze` error with Retry, leave the existing save unchanged, and do not fall back to a constant, timestamp, or `Math.random()`.

A stable `deriveSeed(baseSeed, namespace, ordinal)` function must be the only way to create subsystem seeds. Its compatibility contract is:

1. Treat `baseSeed` and `ordinal` as unsigned 32-bit integers.
2. Encode `namespace` as UTF-8.
3. Hash the bytes with FNV-1a using offset `0x811c9dc5` and prime `0x01000193`.
4. XOR that hash with `baseSeed` and `Math.imul(ordinal, 0x9e3779b1)`.
5. Apply this 32-bit avalanche: xor-shift 16, multiply `0x7feb352d`, xor-shift 15, multiply `0x846ca68b`, xor-shift 16.
6. Return the unsigned 32-bit result.

Required test vectors:

| Base | Namespace | Ordinal | Result |
| ---: | --- | ---: | ---: |
| `0` | `maze-topology` | `0` | `1417617988` |
| `20260723` | `objective-placement` | `1` | `1372142315` |
| `4294967295` | `pipe-attempt` | `7` | `174535124` |

`generateMaze()` must accept separate topology and material random sources. Material clustering may not depend on how many random values topology generation consumed.

### 5.2 Original algorithm contract

`wilson-v1` consists of:

1. Create an odd square lattice filled with walls.
2. Mark odd-coordinate cells as candidate passages.
3. Begin the visited tree at `(1, 1)`.
4. For each unvisited odd cell, perform a random walk until it reaches the visited tree.
5. Erase loops from that walk.
6. Carve the resulting path and the walls between adjacent path cells.
7. Collect all remaining wall coordinates.
8. Shuffle wall coordinates, choose one seed per registered material up to `min(materialIds.length, wallCount)`, and assign each wall the material of its nearest Manhattan-distance seed. Manhattan-distance ties retain the earlier seed in shuffled order. If a small test maze has fewer walls than registered materials, the unused registry tail receives no seed; this preserves the existing implementation.

The generated topology must remain a connected perfect maze with a solid perimeter. Spawn remains `(1, 1)` and the exit remains `(size - 2, size - 2)`.

The exact versioned string `wilson-v1` is the sole persisted generator identifier and participates in level-seed derivation. Replace the unused numeric `MAZE_GENERATOR_VERSION` with `MAZE_GENERATOR_ID = 'wilson-v1'`; do not store a second version field that can disagree.

Playable objective-bearing levels support odd sizes from 21 through 99. The low-level maze generator may continue supporting smaller odd grids for unit tests, but `placeLevelObjectives()` must reject gameplay sizes below 21.

A campaign remains pinned to the generator ID with which it was created for every later level. A new app version may choose a newer generator only for a new campaign. Loading a save never regenerates its current maze or silently upgrades its generator.

The same rule applies independently to `overworld-content-v1`. Adding a registry entry may not silently change the loot, variants, traps, or AI continuation of an existing campaign; retain the old content tables or introduce a new content generator ID for new campaigns.

### 5.3 Generation presentation

On first entry to a newly created level, show a short `GENERATING MAZE · WILSON v1` state while the new level is prepared. A 300–700 ms reveal of carved cells is desirable, but it must be skippable and respect reduced-motion settings. A resume from save must not replay generation or change the maze.

### 5.4 Save and campaign schema version 2

Add the following level data:

```ts
type MazeGeneratorId = 'wilson-v1';
type OverworldContentGeneratorId = 'overworld-content-v1';

interface LevelObjectivePlacement {
    readonly objectiveId:
        | 'pipe'
        | 'lock'
        | 'space'
        | 'platformer'
        | 'circuit'
        | 'horsemaster'
        | 'zapper'
        | 'casino-heist';
    readonly triggerId: string;
    readonly position: Coordinate;
}

interface LevelServicePlacement {
    readonly id: string;
    readonly kind: 'shop' | 'blackjack' | 'holdem';
    readonly position: Coordinate;
}

interface OverworldState {
    // Existing fields remain.
    readonly generatorId: MazeGeneratorId;
    readonly contentGeneratorId: OverworldContentGeneratorId;
    readonly contentOrigin: 'native-v2' | 'migrated-v1';
    readonly levelContentInitialized: boolean;
    readonly objectives: readonly LevelObjectivePlacement[];
    readonly serviceSites: readonly LevelServicePlacement[];
    readonly pipeShortcutWall: Coordinate | null;
    readonly traps: readonly TrapState[];
    readonly pendingHazards: readonly PendingHazardState[];
    readonly sanctuaryPosition: Coordinate;
    readonly sanctuaryServiceClaims: readonly LevelObjectivePlacement['objectiveId'][];
    readonly levelDeathCount: number;
    readonly mercyDropUsed: boolean;
    readonly pendingDefeatChoice: PendingDefeatChoice | null;
}

interface ActiveEncounterRecord {
    readonly levelId: string;
    readonly objectiveId: LevelObjectivePlacement['objectiveId'];
    readonly triggerId: string;
    readonly encounterKind:
        | 'pipe'
        | 'lock'
        | 'shooter'
        | 'platformer'
        | 'circuit'
        | 'horsemaster'
        | 'zapper'
        | 'casino-heist';
    readonly attemptOrdinal: number;
    readonly runId: string;
    readonly seed: number;
}

interface CampaignState {
    // Existing fields remain.
    readonly activeEncounter: ActiveEncounterRecord | null;
    readonly pendingLevelReward: PendingLevelReward | null;
}
```

Completion flags are the one objective-status authority:

- if an objective’s completion flag exists, status is `completed`;
- otherwise, if every explicit prerequisite and unlock flag exists, status is `available`;
- otherwise status is `locked`, with the missing requirement shown to the player.

Do not persist status. Required objectives do not use `overworld.triggerStates`, and their success results do not emit `set-trigger-state`. That record remains available for non-objective encounters only. Exit requirements and HUD labels must be sourced from the objective registry so scene names and player-facing labels cannot drift.

`levelContentInitialized` replaces the separate objective/item/monster initialization authorities in schema version 2. Its invariant is interpreted with `contentOrigin`:

- `false` is legal only with `contentOrigin: 'native-v2'`; objectives, world items, monsters, traps, and pending hazards are empty and `pipeShortcutWall` is `null`;
- `true` with `native-v2` means exactly one valid placement exists for each selected roster objective and every generated item, monster, trap, budget, guarantee, and shortcut invariant passes;
- `true` with `migrated-v1` means the preserved legacy content plus newly placed objectives/shortcut passes the version-2 instance and collision schema. It is intentionally exempt from native content budgets, guaranteed-loot counts, trap counts, and same-seed content-signature assertions.

Retire `objectivesInitialized`, `itemsInitialized`, and `monstersInitialized` after parsing version 1. Any partial, duplicate, or unknown version-2 content set fails validation.

Before granting player control to a valid version-2 level with `levelContentInitialized: false`, run one deterministic level-content initialization transaction. It derives objectives, shortcut, items/features, monsters/variants/loot, and traps from the authoritative level seed, validates the whole result, and persists the completed state once. A crash before the write leaves the prior false/empty state, so reload repeats the same transaction; a crash after it observes `true` and does not reroll.

Save migration requirements:

- Bump both the envelope `SAVE_FORMAT_VERSION` and the state `CAMPAIGN_SCHEMA_VERSION`; they are separate version layers.
- Version-2 seed fields validate as unsigned 32-bit integers. Migration normalizes legacy integer seeds with JavaScript unsigned-32-bit semantics while preserving the already-generated maze.
- Keep dedicated format-1/state-1 parsers. Parse v1, construct v2, validate v2, and only then replace storage.
- Accept format 1 and migrate it atomically and idempotently to format 2.
- Assign migrated campaigns `generatorId: 'wilson-v1'`; never infer a newer generator from the running build.
- Assign `contentGeneratorId: 'overworld-content-v1'` and pin that campaign to its content tables just as the maze is pinned to its topology generator.
- Mark only the migrated current level `contentOrigin: 'migrated-v1'`; every later level created by version 2 uses `native-v2`.
- Preserve the current legacy `overworld.seed` after unsigned normalization as that level’s authoritative seed. Use it for migrated objective/shortcut placement and any uninitialized items or monsters; do not force it to match the new level formula or regenerate the current maze. Only later levels first created under version 2 use the formula in section 5.1.
- Preserve the saved maze, player location, items, monsters, flags, resources, and encounter history.
- Convert each legacy Health Potion/Mining Pick into a Common, no-affix, quantity-one world item at the same coordinate. Preserve its unique legacy ID as the new instance ID; set item charges to `null` and Mystery-Orb choices empty. Do not reroll the collection.
- Convert each legacy Slime/Hound into its base full-health, no-variant monster with `spawnPosition` equal to its final migrated coordinate, `actionCount: 0`, `intent: null`, empty statuses, `undamagedTurns: 0`, and `drop: null`. Legacy move/attack timestamps are retired rather than interpreted as the new AI clock.
- A legal v1 save may contain one or more monsters on the player cell because legacy contact attacks used overlap. Before objective placement, relocate only overlapping monsters in stable-ID order to the nearest reachable free passage, breaking equal graph distances by `y` then `x`; reserve the player, already normalized monsters, and perimeter. Fail migration without replacing the original slot if no such cell exists.
- Add the permanent fallback attack, one basic Health Potion, otherwise empty backpack/equipment, cleared statuses, `weaponRecoveryActions: 0`, spawn sanctuary, zero level deaths, and an unused mercy drop. Preserve current health/max health, mining power, and charges.
- The migrated current level receives no newly injected traps: set `traps` empty. Later version-2 levels use the full trap generator, avoiding surprise hazards in a save already in progress.
- Initialize `pendingHazards` and `pendingDefeatChoice` empty. Mark every already-completed objective as having spent its sanctuary-service entitlement, initialize `pendingLevelReward` to `null`, and do not retroactively grant a level reward.
- Generate missing objective positions against the saved maze, not a regenerated maze.
- Remove obsolete required-objective keys from `triggerStates`; completion flags determine status.
- Reject unknown objective placements, duplicate completion authority, or an impossible explicit unlock state. Do not silently invent completion or unlock flags.
- Reserve the saved player position and every surviving item and monster while placing migrated objectives. If a complete collision-free selected site set cannot be found, fail migration and leave the original slot unchanged.
- If Pipe is incomplete, choose and protect a valid shortcut wall against the saved maze. If Pipe is already complete, preserve its altered maze and set `pipeShortcutWall` to `null`; never open a second wall.
- During migration, validate that every objective is in bounds, on a reachable passage, unique, and initially separate from spawn, exit, the saved player, items, and monsters.
- Validate that passage-based entities are in bounds and on passages and that IDs/positions are unique within each static collection.
- Format-1 migration initializes `activeEncounter` to `null`.
- Successful migration finishes with `levelContentInitialized: true` and every persisted selected placement; it never emits a partially initialized migrated state.
- Do not replace a valid slot until migration and validation both succeed.
- A malformed or invalid v1 slot remains byte-for-byte unchanged after a failed migration.

Active minigame frame state does not need to be saved in this milestone. The small launch descriptor above is persisted before a minigame starts, but positions, projectiles, timers, board progress, and other frame state are not.

Attempt ordinal is campaign-global per stable trigger and zero-based:

```ts
attemptOrdinal = encounterHistory.filter(entry => entry.triggerId === triggerId).length;
```

The first launch is ordinal 0. Launching or refreshing an uncommitted attempt does not increment it; committing success, failure, or abandonment appends one history entry, so the next launch uses the next ordinal. The same trigger on a later level continues the count.

A run ID is unique within one campaign/save and includes level, objective, and ordinal, for example `level-3/archive-lock/2`. Level and trigger IDs are restricted to lowercase ASCII letters, digits, and hyphens so `/` remains an unambiguous separator. On launch, persist an `activeEncounter` whose objective, trigger, kind, seed, ordinal, and run ID all validate against the current level and registry. A valid active record also requires the saved player position to equal that objective’s persisted coordinate. A terminal result atomically appends history, applies effects, and clears that matching record.

Static schema validation always forbids objective/objective, item/item, monster/monster, objective/item, objective/trap, and objective/monster overlaps. It does not apply every generation-only exclusion to runtime frames: the player may stand on an objective or an uncollected item, and a monster may enter an item or armed-trap cell. Monster/trap resolution occurs in the same atomic turn.

Reloading with a valid active record returns to its objective site with an `Attempt interrupted · Retry` prompt and applies no abandonment effect. Retry reuses the same seed and run ID; Return clears the descriptor without an effect. A mismatched or impossible active descriptor invalidates the save rather than launching an arbitrary scene. Failure or deliberate in-game abandonment commits first; choosing `Retry` then launches the next ordinal and seed.

### 5.5 Difficulty source

`EncounterContext.difficulty` is the player preset and defaults to `standard`; it must no longer be an unexplained hard-coded scene value. Campaign escalation is a separate, capped value:

```ts
levelTier = Math.min(5, Math.floor((levelNumber - 1) / 2));
```

The player preset selects base timing/tolerance. `levelTier` adjusts bounded content budgets:

| Game | Level-tier effect at tier 5 cap |
| --- | --- |
| Overworld | Capped threat/trap budgets, broader archetype/affix pools, at most two elites; guaranteed supplies never weaken |
| Pipe | Longer witness route, more decoys, liquid at most 20% faster |
| Lock | Up to one additional pin, 20% narrower tension tolerance, alarm at most 20% faster |
| Space | More formation budget, hostile shots at most 20% faster, additional boss pattern variants |
| Platformer | Up to two additional sections, enemy budget up to 14, required cores up to 5 |
| Zapper | Tighter arrival gaps, modestly faster blaster travel, and a bounded quota increase |
| Casino Heist | Longer routes, denser obstacle budgets, and additional telegraphed interceptors |

No level tier may violate touch sizing, solvability, telegraph minimums, or the campaign-reward limits in this specification.

## 6. Overworld generation and roguelike maze play

### 6.1 Objective registry

Create one typed registry containing the stable identity and presentation of each required objective.

| Objective label/ID | Encounter kind | Trigger | Completion flag | Prerequisite | Icon |
| --- | --- | --- | --- | --- | --- |
| Pipe / `pipe` | `pipe` | `coolant-terminal` | `coolant-routing-restored` | None | Bent pipe with visible liquid |
| Lock / `lock` | `lock` | `archive-lock` | `archive-lock-opened` | None | Treasure chest with keyhole |
| Space / `space` | `shooter` | `hangar-uplink` | `orbital-corridor-cleared` | None | Small side-view spaceship |
| Platformer / `platformer` | `platformer` | `maintenance-elevator` | `sublevel-nine-stabilized` | None | Lift platform/elevator doors |
| Circuit Crush / `circuit` | `circuit` | `circuit-crush-console` | `circuit-crush-completed` | None | Colored circuit chip |
| Horsemaster / `horsemaster` | `horsemaster` | `ultra-horse-crossing` | `ultra-horse-gym-reached` | None | Horse over a moving car |
| Zapper / `zapper` | `zapper` | `nanotech-blaster-bench` | `zapper-shift-completed` | None | Slime-filled space blaster |
| Casino Heist / `casino-heist` | `casino-heist` | `casino-getaway-route` | `casino-heist-completed` | Getaway Car acquired | Armored getaway car |

All eight icons must be silhouette-readable at 32×32, visually distinct without color, and accompanied by a text label when the player approaches.

Use a checked-in 256×32 RGBA atlas at `assets/objective-sprites.png`, containing eight 32×32 frames in registry order. A deterministic asset script owns it; do not append undocumented objective frames to the fixed 50-frame item sheet and do not represent objective sites as consumable `ItemState` entries. `main.ts` passes the atlas URL through `CreateMazeGameOptions`, and `OverworldScene.preload()` loads it. A dimension/frame-count test and preload test are required. Production atlas failure shows a blocking asset error; it must not silently fall back to primitive markers.

Status treatment:

- `locked`: desaturated icon with a small lock badge and prerequisite label;
- `available`: full-color icon with a slow pulse;
- `completed`: stable dim icon with a check badge;
- the current objective receives the highest draw depth and a HUD label.

### 6.2 Placement algorithm

Replace `placeIntroTrigger()` with a pure seeded `placeLevelObjectives()` function.

The placement function accepts only playable odd maze sizes from 21 through 99.

1. Enumerate every passage reachable from spawn.
2. Compute graph distances with breadth-first search.
3. Remove spawn, exit, and cells within three graph steps of either.
4. Choose one unique cell per selected objective from different distance bands and prefer dead ends or separate branches.
5. Enforce a pairwise graph-distance floor of `max(6, floor(mazeDiameter / 10))`.
6. Weight random selection inside each valid band so the same maze seed remains deterministic without always choosing the first candidate.
7. Use deterministic bounded backtracking to find the complete selected site set at the preferred floor. If none exists, widen bands and relax pairwise distance one step at a time down to 1. A relaxation is legal only after the search has exhausted all candidates at the stronger setting; uniqueness, passage reachability, spawn/exit exclusion, and collision reservations may never be relaxed.
8. Validate all placements before returning.

The pure generation result includes test/development diagnostics containing the preferred separation floor, accepted floor, band-relaxation count, and candidates examined. Diagnostics do not need to be persisted. They make fallback behavior auditable instead of allowing an implementation to jump directly to distance 1.

Recommended progression bands, measured from spawn as a percentage of the maximum reachable distance:

- Pipe: 20–50%;
- Lock: 35–70%;
- Space: 50–85%;
- Platformer: 65–100%.
- Circuit Crush: 25–75%;
- Horsemaster: 45–100%;
- Zapper: 30–80%;
- Casino Heist: 55–100%.

These are weighted preferences, not hard corridors. Pairwise separation and reachability take priority.

The Pipe reward wall is separate from every objective coordinate. It must be a mixed-parity, non-perimeter wall between two existing passages. Prefer a wall whose endpoints have a pre-removal shortest path of at least eight steps and whose removal shortens that path by at least five. Deterministically relax those thresholds to four and two before accepting any otherwise valid connector. Persist it as `pipeShortcutWall`.

`pipeShortcutWall` is protected from mining while Pipe is incomplete, regardless of material hardness. Pipe success atomically transforms it into a passage and sets the field to `null`. A native version-2 save whose protected coordinate is missing or already open before Pipe completion is invalid; runtime must not silently repair it. Only format-1 migration may derive a replacement before the final version-2 slot is validated and written.

Add one atomic domain outcome operation, `open-pipe-shortcut`, carrying the expected coordinate. Result application verifies that it matches the persisted protected wall, changes that maze cell to a passage, clears `pipeShortcutWall`, and sets the Pipe completion flag in the same idempotent campaign update. Failure and abandonment leave both wall and field unchanged. Before Pipe completion the field must reference a non-perimeter wall satisfying the connector invariant; after completion it must be `null`.

### 6.3 Collision reservations

Placement order is:

1. maze;
2. objective sites, sanctuary exclusion zones, and Pipe shortcut wall;
3. compatible trap candidates;
4. guaranteed weapon, recovery, mining, and trap-counter items;
5. remaining loot, weighted toward dead ends;
6. monsters and their pre-rolled drops.

Spawn, exit, all objective positions, the shortcut wall, world items, traps, and monster positions must be mutually validated. No two interactive entities may begin on the same passage, no initial damage areas may overlap, and no entity may violate the safe radii in section 6.10.

### 6.4 Progression behavior

- All objective icons exist from level creation.
- Selected objectives without an unmet explicit unlock start available. Casino Heist starts locked until the Getaway Car has ever been acquired.
- Distant sites are not expected to fit on screen at spawn. The current available objective has a small edge-of-screen compass arrow showing cardinal direction but never a shortest path. Locked sites become visible normally when explored and remain recorded by the level state.
- Completing an objective updates the exit counter. Acquiring or buying the Getaway Car immediately makes a selected Casino Heist available.
- A successful objective becomes the current sanctuary/checkpoint; the spawn is the sanctuary until then.
- A live model terminal state disables scene input and submits its result immediately, before optional success/failure animation. The shell/Overworld applies it atomically, then owns an inert overlay: success shows `Continue`; failure or live-attempt abandonment shows `Retry` and `Return to maze`.
- `Retry` after a committed result derives the next ordinal before relaunch. `Return to maze` after that result only closes the overlay and cannot apply a second effect. By contrast, `Return` on the interrupted-attempt prompt clears the uncommitted descriptor with no effect.
- The exit advances when the completed selected-objective count reaches `min(levelNumber, 8, persistedRosterSize)`.
- Reaching a locked objective explains the prerequisite rather than doing nothing.

Each launch computes `nearbyMaterialIds` and `nearbyMaterialTags` around that objective’s own persisted coordinate using the current authoritative maze, including any mining or Pipe shortcut changes. No encounter reuses Pipe-site material context.

### 6.5 Authoritative overworld turn

Replace scene-ordered movement, automatic pickup, and contact damage with one pure transaction:

```ts
resolveOverworldAction(
    state: CampaignState,
    action: OverworldAction,
    context: DeterministicOverworldContext
): {readonly state: CampaignState; readonly events: readonly OverworldEvent[]}
```

Supported actions are `move`, `melee`, `ranged`, `mine`, `use-item`, `place-item`, `interact`, `disarm`, `equip`, `salvage`, `wait`, `resolve-defeat`, `claim-sanctuary-service`, and `choose-level-reward`.

These consume exactly one turn:

- a successful move or mine-and-move;
- a valid melee or ranged attack;
- using or placing an item;
- disarming or interacting with a trap/sanctuary;
- changing equipment from the inventory;
- waiting.

Blocked movement, invalid targets, opening/closing inventory, inspecting a monster or item, choosing a target, Help, and Pause consume no turn.

`resolve-defeat` and `choose-level-reward` are persisted-modal resolutions, not world turns: while either matching descriptor is pending, the hostile world is frozen and no other action is accepted. `claim-sanctuary-service` is the final form of an `interact` action and consumes one turn only when its payment and entitlement both validate.

One committed turn resolves in this order:

1. Validate and apply the player action.
2. Resolve movement, player attack, pickup choice, and entered-cell trap.
3. Resolve player-caused monster deaths and reveal their pre-rolled drops.
4. Tick player statuses.
5. Execute already-telegraphed monster attacks whose target is still valid and record those monster IDs as having spent their action.
6. For only monsters that have not spent their action, plan a new intent or resolve one legal movement from one shared snapshot, in stable entity-ID order.
7. Advance trap phases and resolve environmental effects against players and monsters.
8. Remove deaths, clamp the per-turn incoming-damage budget, and enter automatic retreat or a persisted defeat choice if needed.
9. Persist once, emit presentation events, then open an objective or create the persisted level-reward offer if the player still occupies the completed exit.

Entering an objective or exit no longer skips the hostile world turn. Those cells and their safety radius cannot be entered or targeted by monsters/traps, so completing the turn is safe without creating a repeatable turn-freeze exploit. Minigames pause overworld turns entirely.

Monster rules:

- monsters never share a cell with the player or another monster;
- a monster may move or prepare/execute an attack in one phase, never move and deal contact damage in the same turn;
- each monster has one action budget per committed player turn. Executing an attack, preparing an intent, making or attempting a chosen move, or taking a return-home step spends it; a dormant/cooldown-only tick does not. `actionCount` increments exactly when this budget is spent, including when another monster blocks the chosen destination;
- every damaging attack marks its cells for one complete player decision before execution;
- player attacks never miss;
- after armor/wards, total overworld monster/trap damage between player actions is capped at 2 on Story, 3 on Standard, and 4 on Expert;
- deterministic conflicts leave the later stable-ID monster in its prior cell.

Wait uses `.` or Space when no modal/targeting action is active and has a visible touch button.

### 6.6 Player loadout, combat, and pickup choice

The player always has a permanent one-damage, range-one improvised attack. It cannot be dropped, consumed, broken, or lost on defeat, so a corridor blocker can never create an equipment soft lock.

Campaign maximum health remains 10. A new campaign starts at 10 health; migration preserves the valid legacy current/max pair.

Loadout:

- one equipped weapon slot;
- one equipped utility/defense slot;
- eight backpack slots;
- identical consumables stack to three;
- three assignable quick slots reference backpack stacks;
- equipped items do not consume backpack slots;
- melee weapons have no durability;
- `bowAmmo` and Pick `toolCharge` are finite player resources and shown separately; equipping a first Bow raises ammo to at least 6.
- Bow ammo has an absolute storage cap of 16. A normal Bow can refill only to 12 and an Efficient Bow to 16. Unequipping or replacing an Efficient Bow never deletes ammo above 12; that excess remains usable by a normal Bow, but further bundles add nothing until the stored count falls below that Bow’s refill cap.

New campaigns and migrated saves receive the fallback attack and one basic Health Potion. Moving onto loot opens a turn-frozen choice when necessary:

- currency is collected immediately;
- consumables enter the backpack;
- equipment offers `Equip`, `Salvage`, or `Leave`;
- a full backpack leaves the pickup in the world;
- a potion at full health is stored or left, never silently consumed;
- replacing equipment may leave the old item on the now-vacant pickup cell or salvage it at the player’s explicit choice.

Pickup choice is part of the move that reached the item and costs no second turn. Later inventory use/equip/salvage actions cost one turn. Space modules and Platformer pickups never enter this persistent inventory.

If a move needs pickup/equipment choice, the reducer first returns a non-mutating `choice-required` description. The chosen option is then included in the one final move action; there is no partially moved, unsaved modal state to duplicate on refresh.

Combat:

- moving toward an adjacent monster performs a bump melee attack while the player remains in place;
- if the attack kills it, the player advances into the vacated cell and resolves its trap/pickup;
- `F`, then a direction or visible target, performs a ranged/reach attack; touch uses `ATTACK`, a highlighted target, and `Cancel`;
- damage is `max(1, attackDamage + conditionalBonuses - armor)`;
- Bow shots require line of sight and one arrow; an empty Bow uses the fallback one-damage bash;
- all attacks consume one turn and all attack ranges are measured in passage cells.

Base weapon set:

| Weapon / existing item frame | Damage | Range | Rule |
| --- | ---: | ---: | --- |
| Improvised dagger / 32 | 1 | 1 | Permanent fallback |
| Salvage sword / 31 | 2 | 1 | No special restriction |
| Fire axe / 30 | 3 | 1 | Sets persisted `weaponRecoveryActions` to 1; no weapon attack is legal until one other committed player action decrements it to 0 |
| Spear / 33 | 2 | 2 straight | Cannot pass through walls or entities |
| Bow / 34, arrows / 35 | 2 | 6 line of sight | Starts with 6 arrows; base cap 12 |

Base unconditional weapon damage caps at 4 after quality/affixes; a conditional material bonus may reach 5. Utility armor reduction caps at 2, and every nonzero hit still deals at least 1 unless a Ward prevents the whole event.

### 6.7 Loot generation, qualities, and affixes

Use semantic registries mapped to the existing 50-frame item atlas. Strategy code never branches on numeric sprite frames.

Version 0.3 activates this existing art. Type IDs, player-facing labels, and sprite IDs remain distinct: for example, type `revival-feather` has label `Revival Feather` and sprite ID `feather`. Only the documented sprite ID is mapped to a numeric frame.

| Category | Types and exact base use |
| --- | --- |
| Recovery | Health Potion (`health-potion`, frame 0) restores 4; Antidote (`antidote`, 3) clears poison and restores 1; Revival Feather (`feather`, 45) supports the defeat rule in section 6.11 |
| Element defense | Fire/Ice/Lightning Ward consumables (`fire-ward`, `ice-ward`, `lightning-ward`, frames 4–6) reduce the next two matching damage events by 2, minimum 0, then expire |
| Navigation/utility | Lantern (`lantern`, 8) expands trap reveal from 2 to 5; Compass (`compass`, 12) adds graph distance and selectable objective/healing/exit targets to the base cardinal arrow; Map Scroll (`map-scroll`, 13) marks entities within 12 graph steps for 20 turns; Multitool (`gear`, 48) disables complex traps |
| Maze tools | Mining Pick (`mining-pick`, 1) grants power/charges; Bomb (`bomb`, 26) damages monsters or opens eligible flammable walls; Snare (`snare`, 27) creates a player-owned trap |
| Weapons/defense | Axe, Sword, Dagger, Spear, Bow, Ammo Bundle, and Shield (`axe` through `shield`, frames 30–36; Ammo uses sprite ID `arrow-bundle`, frame 35) |
| Economy/choice | Coin (`coin`, 16) becomes scrap; Mystery Orb (`mystery-orb`, 49) offers three fully previewed seeded choices |

Unused frames remain reserved for later content rather than activating 50 untested mechanics at once.

Equipment, Pick, and Potion quality is rolled independently from placement. Fixed consumables such as Antidote, Ammo Bundle, and Bomb remain Common:

| Level tier | Common | Uncommon | Rare |
| ---: | ---: | ---: | ---: |
| 0 | 80% | 20% | 0% |
| 1 | 70% | 27% | 3% |
| 2 | 60% | 34% | 6% |
| 3 | 52% | 38% | 10% |
| 4 | 45% | 40% | 15% |
| 5 | 38% | 42% | 20% |

- Common has no affix.
- Uncommon has one.
- Rare has two distinct compatible affixes.
- Every affix and drawback is named and visible before equip; there are no unidentified curses.
- Salvage value is 1/2/4 scrap for Common/Uncommon/Rare.

Initial weapon affixes:

| Affix | Effect |
| --- | --- |
| Keen | +1 damage |
| Extended | +1 Spear/Bow range, capped at 3/7 |
| Piercing | Ignores 1 armor |
| Efficient | Bow maximum ammo +4; Ammo Bundles grant +2 extra |
| Frost-bound | Delays the target’s next movement opportunity once; cannot stack |
| Arc-bound | If the target touches a wet/conductive wall, deal 1 chain damage to the nearest second monster within graph distance 2 |
| Ember-bound | +1 damage against cold variants or a monster touching a cold wall |

Frost-bound and Ember-bound are mutually exclusive. Initial utility affixes are Durable (+2 charges), Surveyor (+2 reveal/indicator radius), and Insulated (-1 matching elemental damage, minimum 1).

Recovery/tool rolls:

- Potent Potion restores 6 instead of 4.
- Purifying Potion restores 4 and clears poison.
- Common Pick raises mining power to at least 2 and adds 6 charges.
- Reinforced Uncommon Pick raises it to at least 3 and adds 5.
- Crystal Rare Pick raises it to at least 4 and adds 4.
- Ammo Bundle adds 6 arrows up to 16 with an Efficient Bow equipped, otherwise up to 12; no Bow is treated as the normal 12-arrow refill cap.
- Bomb targets within range 4/line of sight, deals 4 damage in radius 1, never hurts the player, and does not cross walls.
- Snare Kit is placed on an adjacent empty passage and roots the first monster entering for its next three movement opportunities.
- Shield utility prevents 1 damage from each hit and counts toward the armor cap; a Ward is consumed before Shield reduction.
- Multitool starts with 2 charges and has a hard cap of 5; Durable adds 2 at generation up to that cap. Disabling one Gas, Arc, or Flame trap consumes one charge.

Using a Pick kit applies its permanent mining-power minimum and charges, then consumes that kit; it is not a combat weapon. Ammo Bundles likewise transfer arrows and are consumed.

A Mystery Orb’s instance stores exactly three distinct `rolledChoiceIds`, selected at generation from this versioned four-choice pool:

- `mend`: restore 4 health and clear poison; health that would exceed maximum becomes 1 scrap per two points, rounded down;
- `salvage`: gain 4 scrap;
- `tools`: gain 4 Pick charges and raise mining power to at least 2;
- `guard`: apply a visible status that prevents the next one incoming damage event, then expires.

Entering the Orb cell returns a non-mutating, fully previewed `choice-required` result. The final move names one stored choice, consumes the Orb, applies that choice, and costs the same single turn as the move. Refresh before choosing leaves the player and Orb untouched; replay after the committed save cannot offer it again.

No loot roll respawns during a level. Monster drops are rolled once at level generation and stored on that monster; reload, array order, and registry additions under a pinned content version cannot reroll them.

### 6.8 Monster archetypes, intent, and variants

Version 0.3 activates a staged subset of the existing monster atlas:

| Monster / sprite ID / frame | HP | Armor | Damage | Detect / leash | Base behavior | Threat |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Moss Slime / `moss-slime` / 0 | 2 | 0 | 1 | 4 / 6 | Random legal step every 3 turns; adjacent tackle intent, cooldown 2 | 1 |
| Ember Hound / `ember-hound` / 1 | 3 | 0 | 2 | 8 / 12 | BFS pursuit step every 2 turns; adjacent bite intent, cooldown 2 | 2 |
| Cave Bat / `cave-bat` / 6 | 2 | 0 | 1 | 5 / 8 | Moves while alerted and rests every third turn | 2 |
| Sentry Eye / `floating-eye` / 27 | 3 | 0 | 2 | line of sight 6 / stationary | One-turn aim line, cooldown 4 | 2 |
| Mimic / `mimic` / 26 | 3 | 0 | 2 | 2 / 8 | Spends one full turn revealing before pursuit | 2 |
| Stone Golem / `stone-golem` / 2 | 6 | 1 | 3 | 5 / 8 | Moves every 3 turns; one-turn marked adjacent slam, cooldown 3 | 3 |

Use one player distance field per turn for all pursuit decisions. Monsters outside their detection/leash remain dormant. Every intent shows icon, target cells, damage, and execution turn; inspection shows current/max HP, armor, behavior, variants, material modifier, and carried-drop badge.

Detection and leash are graph distances. Once alerted, a mobile monster stays alerted while the player is within its leash distance from that monster’s `spawnPosition`; after the player leaves, it cancels any non-executing intent and takes legal return-home steps on its normal movement cadence until home. Sentry Eye never moves. A revealed Mimic remains visually revealed, but follows the same leash/return rule.

Initial compatible variants:

| Variant | Exact effect |
| --- | --- |
| Armored | +2 HP, +1 armor, movement interval +1; incompatible with Stone Golem |
| Swift | Movement interval -1, minimum 1; -1 HP, minimum 1; incompatible with Cave Bat |
| Venomous | A damaging hit applies two poison ticks |
| Ember-touched | +1 attack only while attacker or target touches a hot wall |
| Volatile | Death marks its cell and four orthogonal cells; neutral 2-damage explosion at the end of the next player turn |
| Regenerating | At the end of a third consecutive committed player turn without taking damage, restores 1 HP and resets its persisted `undamagedTurns` counter; taking damage or being at full HP resets it to 0 |

Poison deals 1 after each of the next two player actions, does not stack, and cannot reduce the player below 1. A Volatile death creates a persisted `PendingHazardState` with the origin, every in-bounds orthogonally adjacent passage, and `executeAfterTurn = currentTurn + 1`; removing the monster never removes that warning. At the environmental phase of that future turn it deals neutral 2 damage to occupants, cannot alter walls/objectives, then is removed.

Ordinary monsters have at most one variant. Elites have two compatible variants, +2 additional HP, a visible badge, and guaranteed minimum-Uncommon loot. Dead monsters remain removed in the saved level, preventing farming.

Tier availability:

| Tier | New content | Variant chance | Elite cap |
| ---: | --- | ---: | ---: |
| 0 | Slime, Hound | 0% | 0 |
| 1 | Sentry, Bow, Lantern | 10% | 0 |
| 2 | Bat, Mimic, Gas Vent | 20% | 0 |
| 3 | Golem, Arc Plate, Flame Jet | 30% | 1 |
| 4 | Full compatible material/affix pool | 40% | 1 |
| 5 | Budget cap; no new raw-stat multiplier | 50% | 2 |

Variant threat cost is +1; elite status costs +2. At least 30% of spent monster threat remains basic Slimes/Hounds.

### 6.9 Traps and material interactions

Traps are passage entities with visible states, not surprise damage from wall color. Every trap reveals automatically within graph distance 2 and must be visible for one complete player decision before it can damage the player.

| Trap | Cost | Exact rule |
| --- | ---: | --- |
| Spike Plate | 1 | 2 damage on entry, then inactive 3 turns; adjacent basic disarm takes one turn |
| Snare | 1 | No damage; next movement action clears root; single-use; adjacent basic disarm takes one turn |
| Gas Vent | 2 | Requires poisonous wall; one-turn warning every fourth turn; radius 1 applies two poison ticks |
| Arc Plate | 2 | Requires wet/conductive wall; one-turn warning, then 2 damage along a marked range-3 passage line; cooldown 4 |
| Flame Jet | 2 | Requires hot/flammable wall; one-turn warning, then 2 damage along a marked range-3 passage line; cooldown 4 |

Gas, Arc, and Flame traps always have a safe waiting cell outside their marked area. A Multitool charge disables one complex trap permanently. Traps affect monsters using the same marked cells/damage, so luring is valid counterplay. Player Snare ownership only changes who it roots; generated traps are neutral.

Material behavior always reads typed tags/hardness, never rendered color:

- any non-protected wall with `hardness` is Pick-mineable at sufficient power; mining costs 1 charge;
- mined hardness 2/3/4 yields 1/1/2 scrap, and Gold adds 1;
- a Bomb may open one non-perimeter, non-objective, non-shortcut wall tagged flammable/organic;
- conductive/wet enables Arc traps and Arc-bound chaining; wet adds 1 to hostile lightning damage before caps/wards;
- hot enables Flame traps and Ember bonuses; a matching Ward counters it;
- cold weights frost content and enables Ember-bound’s conditional target;
- poisonous enables Gas/Venomous content and is countered by Antidote;
- earth/organic weights Snare placement; sharp weights Spike placement;
- magical dead ends add 10 percentage points to Uncommon/Rare equipment chance, taken from Common.

No material tag passively damages the player. Perimeter walls, objective sites, and the protected Pipe shortcut are immune to every tool, Bomb, monster, and trap mutation except the dedicated atomic Pipe-success operation.

### 6.10 Content budgets and fairness validator

Base Standard budgets include guarantees:

```ts
lootSlots = clamp(6 + floor((mazeSize - 21) / 12) + floor(levelTier / 2), 6, 16);
monsterThreatBudget = clamp(5 + floor((mazeSize - 21) / 8) + 2 * levelTier, 5, 24);
monsterEntityCap = clamp(5 + floor((mazeSize - 21) / 12) + levelTier, 5, 18);
trapBudget = clamp(2 + floor((mazeSize - 21) / 16) + levelTier, 2, 12);
```

Story multiplies monster threat by 0.75 rounded down and removes one trap; Expert multiplies threat by 1.20 rounded up and adds one trap. Guaranteed loot is unchanged. Security Alert adds 1 threat point at 40 and 2 total at 80; it never increases raw damage.

Every natively generated version-2 level guarantees:

- one Sword or Spear cache at graph distance 6–12 from spawn; tier 1+ may substitute Axe/Bow;
- one basic Health Potion at distance 4–10 and a second recovery item in the middle/far half;
- one Pick at distance 8–18;
- one utility item;
- remaining slots weighted 35% recovery, 25% utility, 25% weapon, 15% mining/ammo.

Generation constraints:

- no monster or trap within graph distance 6 of spawn or 2 of an objective/exit/sanctuary;
- sanctuary cells and their radius are impassable/untargetable to monsters;
- no initial monster is adjacent to another monster;
- no elite, Golem, Mimic, or complex trap appears in the first 10 steps of a required route;
- in any six-cell window of the next-objective critical path, tiers 0–2 allow monster threat at most 3 and trap cost at most 1; tiers 3–5 allow 5 and 2;
- a Sentry requires reachable cover within two player steps;
- a complex trap requires a safe wait cell;
- required-path monsters are killable by the permanent fallback and have at most 3 HP/0 armor; harder blockers need a bypass or earlier guaranteed counter;
- required objectives never require a consumable, ammo, mining, utility, or affix;
- no more than two damaging intents target the same Standard player turn (one Story, three Expert), independent of the damage cap.

Generation also produces and replays one concrete, cumulative tactical witness through the production reducer. Its canonical snapshot is the complete fresh native level at turn 0: player at spawn with 10/10 health, the permanent fallback, one basic Potion, no campaign bonuses or statuses; every generated monster/trap in its initial state; guaranteed world items present at their real coordinates; and optional rolled loot treated as `Leave` and never used. The action list reaches every selected objective in deterministic roster order, treats each available minigame as an immediate success with no health cost, carries remaining health/resources forward, and ends each maze segment with at least 1 health. If Casino Heist is selected, the witness must either physically collect the rare car or accumulate/preserve `$100` and buy it from the guaranteed shop before attempting the objective. It may collect and use any other guaranteed item only after physically reaching it.

The witness planner uses fixed action ordering and a fixed node-expansion cap of `40 × passageCellCount` per segment; its visited-state key includes player position/health/resources, collected guarantees, route-monster HP/positions/intents, trap phases, statuses, and turn modulo the least common cadence. Off-route entities still advance through the production reducer, but they may be canonicalized out of the search key only after a proof that their detection/leash cannot reach the current segment. This is a generation validator, not an in-game hint. Retry invalid content with a derived salt, then use a versioned known-good content fallback that passes the identical replay.

### 6.11 Defeat, mercy, sanctuaries, and level reward

Maze defeat is recoverable and never rerolls the level.

- Spawn is the initial sanctuary; each successful objective becomes the new sanctuary.
- If carrying a Revival Feather, lethal resolution atomically persists `pendingDefeatChoice` with the turn, damage cause, and exact Feather instance ID, leaves health at 0, freezes the hostile world, and offers `Use Feather` or `Retreat`. Refresh restores this same overlay. No inventory/world action is legal until it resolves.
- `Use Feather` is a zero-turn `resolve-defeat` action that revalidates and consumes that exact instance, restores 3 health in place, clears negative statuses, delays adjacent monster actions once, and clears the descriptor in the same save. `Retreat` invokes the rule below and clears it atomically. If there is no Feather, retreat occurs inside the lethal turn without creating a descriptor.
- Retreat increments `levelDeathCount`, restores full health, clears negative statuses, returns to `sanctuaryPosition`, resets surviving monsters to their persisted spawn positions, clears intents, and grants three monster-free player turns.
- The player retains inventory, equipment, scrap, mining power/charges, objectives, discovered loot, killed monsters, disarmed/triggered traps, and mined walls.
- No item, monster, trap, or affix rerolls on defeat.
- If health is 3 or lower, no healing is carried, and no uncollected recovery lies within 12 graph steps, the next defeated monster creates a bonus basic Health Potion with stable ID `{levelId}/mercy-potion`; it never replaces the monster’s pre-rolled drop. If that drop occupies the death cell, place the mercy Potion on the nearest reachable passage free of an item/objective, breaking ties by `y` then `x`. For a multi-kill action, the lowest stable monster ID owns the check. Set `mercyDropUsed` in the same death transaction only after a valid Potion position is chosen; if no position exists, leave it false and retry on a later kill.
- Damage-over-time cannot deal the lethal point.
- Health reaching zero through a trap, monster, or minigame result enters this same reducer exactly once.

The setback is travel, death count, and repositioned surviving threats—not deletion of the tools needed to recover. This explicitly replaces the current reset of the persistent Lock mining reward.

Each newly completed objective grants one sanctuary-service entitlement keyed by its objective ID. At any completed sanctuary, the player may spend the oldest unclaimed entitlement on exactly one of: 2 scrap to restore 2 health, or 3 scrap to restore one equipped-utility charge. The final `claim-sanctuary-service` action revalidates the price/cap, applies the service, and appends that objective ID to `sanctuaryServiceClaims` in one save; unaffordable or no-effect choices do not consume it.

When the player ends a turn on the fully unlocked exit, do not advance immediately. Persist a `PendingLevelReward` containing the current level ID, `deriveSeed(levelSeed, 'level-reward', 0)`, and the fully rolled Armory item, freeze world turns, and show these three choices:

- **Repair:** restore 5 health and add one basic Potion;
- **Supply:** +6 Pick charges, +6 Bow arrows using the same 12/16 refill cap, and one utility charge;
- **Armory:** one Uncommon equipment offer, with a 25% Rare chance at tiers 4–5.

Reload shows the same offer. `choose-level-reward` is a zero-turn action that revalidates the level/offer, applies exactly one choice, creates the next native level, clears the descriptor, and saves that transition atomically. Repair leaves its Potion in the backpack or, if all compatible/full slots prevent storage, converts it to 2 scrap. Armory requires `Equip`, `Salvage`, or `Leave`; `Leave` advances without the item, while Equip/Salvage are part of the same atomic choice.

Carried/equipped overworld loot persists to the next maze. Stat/affix caps keep later equipment side-grade-driven.

Level advance keeps PlayerProgress, then creates the next native world through its deterministic content transaction, sets sanctuary to the new spawn, clears sanctuary claims/pending hazards/pending defeat, sets `levelDeathCount` to 0 and `mercyDropUsed` to false, and clears the claimed `pendingLevelReward` in the same atomic save.

### 6.12 Optional money, casino, and shops

Money is a persistent player resource separate from crafting scrap. A new or migrated campaign receives `$40`; the balance survives defeat and level advancement. Defeated monsters immediately award a deterministic amount based on archetype threat, variants, and elite status. Currency pickups also credit money. A kill can never be farmed by reload because the dead monster remains removed in the same atomic state transition.

Each generated level persists `serviceSites` separately from required objectives:

- one Blackjack table and one Texas Hold’em table are always placed on distinct reachable passages;
- a Wandering Shop normally appears with an independent deterministic 60% chance;
- if Casino Heist is selected while the Getaway Car is still locked, a shop is guaranteed on that level;
- services never gate the next objective or exit;
- monsters and traps do not initially occupy or camp within two graph steps of a service;
- saving or refreshing an unfinished level preserves exact service presence and positions;
- valid older saves deterministically backfill the two card tables and independently roll the shop without changing their maze or required objectives.

Blackjack supports repeated hands against a dealer, Hit, Stand, and first-action Double Down. The dealer stands on soft 17 and naturals pay 3:2. The interface uses even-dollar wagers so the persisted wallet remains an integer. Texas Hold’em is heads-up fixed-limit poker against the computer with preflop, flop, turn, river, burn cards, Fold/Check/Call/Bet/Raise decisions, complete five-to-seven-card hand evaluation, showdown tie breaking, and repeated hands. Leaving an active card hand forfeits only the already committed wager; leaving between hands is free.

Casino settlement updates and autosaves the absolute bankroll after every completed hand. The player may leave after any hand and return later. These activities do not create required-objective encounter history or completion flags.

The shop offers consumables, ammunition, upgraded weapons, permanent health/mining/tool upgrades, and the Getaway Car for exactly `$100`. The car also appears as rare random maze loot. The first successful pickup or purchase records the persistent `casino-heist-unlocked` flag; it is not consumed by entering the Heist. Purchase is one atomic operation that revalidates price, available balance, backpack capacity, stack limits, ownership, and upgrade caps before charging money. Failed purchases change nothing.

### 6.13 State, registries, presentation, and controls

Persist rolled mutable instances; never reconstruct them from current registry order:

```ts
interface ItemInstance {
    readonly id: string;
    readonly baseTypeId: ItemTypeId;
    readonly quality: 'common' | 'uncommon' | 'rare';
    readonly affixIds: readonly ItemAffixId[];
    readonly rolledChoiceIds: readonly ItemChoiceId[];
    readonly quantity: number;
    readonly charges: number | null;
}

interface WorldItemState {
    readonly instance: ItemInstance;
    readonly position: Coordinate;
}

interface MonsterState {
    readonly id: string;
    readonly typeId: MonsterTypeId;
    readonly variantIds: readonly MonsterVariantId[];
    readonly position: Coordinate;
    readonly spawnPosition: Coordinate;
    readonly health: number;
    readonly maxHealth: number;
    readonly actionCount: number;
    readonly intent: MonsterIntent | null;
    readonly statuses: readonly MonsterStatus[];
    readonly undamagedTurns: number;
    readonly drop: ItemInstance | null;
}

interface TrapState {
    readonly id: string;
    readonly typeId: TrapTypeId;
    readonly position: Coordinate;
    readonly owner: 'world' | 'player';
    readonly revealed: boolean;
    readonly disabled: boolean;
    readonly phase: number;
    readonly nextPhaseTurn: number;
}

interface PendingHazardState {
    readonly id: string;
    readonly typeId: 'volatile-explosion';
    readonly origin: Coordinate;
    readonly targetPositions: readonly Coordinate[];
    readonly executeAfterTurn: number;
}

interface PendingDefeatChoice {
    readonly turn: number;
    readonly cause: 'monster' | 'trap' | 'volatile' | 'encounter';
    readonly featherInstanceId: string;
}

interface PendingLevelReward {
    readonly levelId: string;
    readonly seed: number;
    readonly armoryOffer: ItemInstance;
}
```

`PlayerProgress` adds persistent `money`, `backpack: ItemInstance[]`, `equippedWeapon: ItemInstance | null`, `equippedUtility: ItemInstance | null`, `bowAmmo`, three nullable quick-slot item IDs, statuses, and `weaponRecoveryActions: 0 | 1`. Equipment is stored separately from the eight backpack slots. Level-namespaced IDs such as `level-3/monster-7` prevent cross-level collisions.

Schema validation requires:

- unique instance/entity IDs and in-bounds passage coordinates;
- capped HP, quantity, charges, backpack size, affix count, Mystery-Orb choice count, status duration, weapon recovery, regeneration counter, and trap/hazard phase;
- compatible weapon/utility categories in equipment slots and quick-slot IDs that reference backpack stacks;
- no duplicate ownership between world, backpack, equipment, or monster drop;
- valid behavior/affix compatibility and content-generator ID;
- unique sanctuary claims that reference completed objectives; a pending defeat whose player is at 0 health and whose Feather ID is owned; and a pending level reward whose level/player/exit/completion state matches the current level;
- unique pending-hazard IDs, Volatile targets equal to the origin plus every in-bounds orthogonally adjacent passage, and execution turns strictly after their creation turn;
- exact round-trip preservation of partial monster HP, intent, regeneration counter, trap phase, pending hazards/choices/rewards, item charges, and loot.

Extend items and monsters through the typed `ITEM_DEFINITIONS`, `MONSTER_DEFINITIONS`,
affix registries, and pure overworld reducer behavior. `ITEM_SPRITES` and
`MONSTER_SPRITES` are the only numeric frame maps. Validate both existing atlases
as 320×160 RGBA, 50 32×32 frames, with every active semantic ID mapped in range.

Overworld HUD adds money, weapon/damage, utility/charges, backpack quick slots, health, statuses, turn, and nearby hostile intents. Tap/click a visible monster, trap, item, service, or material region for a readable inspect card. State is communicated with icon, label, and shape—not color alone.

Keyboard/touch parity:

- movement remains arrows/WASD/D-pad;
- `F`/`ATTACK` enters targeting;
- `Q`/`USE` activates the selected quick slot;
- `E`/`INTERACT` picks up, disarms, opens a sanctuary, shops, or optional card tables;
- `I`/`INVENTORY` opens the turn-frozen backpack;
- `.`/`WAIT` spends a turn;
- every contextual touch control is at least 44×44 CSS px and targeting has a visible Cancel action.

### 6.14 Passive maze-item minigame bonuses

At encounter launch, derive deterministic modifiers from positive-quantity backpack stacks plus the equipped weapon and utility. The scene names every active benefit in its HUD. These effects are passive: launching, failing, retrying, or completing a minigame never consumes, unequips, or otherwise mutates the source item.

| Minigame | Maze-item benefit |
| --- | --- |
| Pipe | Multitool adds 2 seconds to each liquid step; Mining Pick adds 4 seconds of setup grace |
| Lock | Lantern widens each tension band by 0.04; Compass delays the alarm by 15 seconds |
| Space | Shield adds one flight shield charge; Bomb adds one mission bomb |
| Platformer | Shield grants 10 seconds of starting protection; Ammo Bundle grants six starting shots |
| Circuit Crush | Compass adds two Trace charges; Multitool adds one Pulse charge |
| Horsemaster | Map Scroll adds one recovery heart |
| Zapper | Multitool fills blasters 25% faster; Lantern increases the returning-blaster catch tolerance |
| Casino Heist | Shield adds one hull point; Compass improves high-speed handling by 15% |

## 7. Pipe game: placement under pressure

### 7.1 Player fantasy

The player is laying emergency coolant pipe faster than the liquid can catch up. Pieces arrive in a fixed orientation. The challenge is deciding where to use each piece or dump it in an off-route cell while an increasingly visible liquid front approaches.

### 7.2 Board generation

Standard and Expert use a 6×6 board; Story uses 5×5. Expert difficulty increases route, queue, and flow pressure without shrinking adjacent mobile cells below the touch target.

Base generation budgets:

| Difficulty | Route cells | Obstacles | Maximum decoys as share of queue |
| --- | ---: | ---: | ---: |
| Story | 7–9 | 1–2 | 25% |
| Standard | 10–14 | 3–5 | 35% |
| Expert | 14–18 | 5–7 | 45% |

For each attempt:

1. Choose source and sink on different randomized edges.
2. Generate a non-self-intersecting hidden route with a configurable minimum length and at least two turns.
3. Convert every route step into a fixed-orientation pipe piece.
4. Add seeded obstacles and ordinary off-route cells where unwanted pieces can be placed without blocking the hidden route.
5. Build a piece queue containing every required oriented piece with seeded decoys between them. Story and Standard include at least one later recovery copy of every route-critical orientation.
6. Construct a concrete witness plan containing every route placement and decoy dump. Replay that plan through the real timing model at a conservative 1,000 ms input cadence, including liquid-front deadlines. Generation does not perform an unbounded search over every board/queue state.
7. Retry generation with a derived salt if validation fails; use a known valid fallback only after a bounded number of retries.

Version 0.3 uses straight and corner sections only. Tee, cross, split-front, and branch-leak rules are deferred.

Same seed and difficulty must reproduce the complete board, queue, and timing configuration. Variation is measured across a fixed corpus rather than requiring every possible seed pair to differ.

### 7.3 Controls

- Tap/click an eligible board cell to place the current piece and advance the queue.
- Pieces are pre-oriented and cannot be rotated.
- Display the current piece prominently and at least the next three pieces.
- Arrow keys move a selection cursor; Enter or Space places the current piece.
- Source, sink, obstacle, and flooded cells are immutable.
- A dry player-placed piece may be overwritten by placing the next piece on it.
- There is no separate discard control. Dumping means placing a piece in an ordinary dry off-route cell.

Overwrite penalty:

- the old piece is discarded;
- the new piece consumes the queue head;
- the liquid clock advances by one base flow step;
- show `OVERWRITE · FLOW +1` beside the affected cell;
- multiple overwrites stack and can cause immediate flow movement.

### 7.4 Liquid clock

Recommended starting values:

| Difficulty | Build-only delay | Liquid time per joint |
| --- | ---: | ---: |
| Story | None | 10 seconds |
| Standard | None | 8 seconds |
| Expert | None | 6 seconds |

The model owns one signed `flowClockMs`.

- It starts at zero for the default difficulties, so the liquid and its visible
  per-joint timer begin together when the help overlay closes.
- Custom negative values remain a supported build-only countdown.
- At zero, the liquid front begins advancing slowly.
- Every full `stepMs` after zero advances one connection; interpolation within a step renders partial fill.
- An overwrite adds exactly one `stepMs`, so it can end grace or immediately advance the front.
- There is no separate global pressure deadline. Only sink arrival, an invalid front connection, or a pressure loop is terminal; queue exhaustion alone is not.

The scene must show:

- liquid beginning at the source at the same moment as the per-joint timer;
- partial fill moving through the current pipe rather than instant color changes;
- a pressure/countdown meter as redundant non-spatial feedback;
- a visible `NEXT JOINT` countdown and warning pulse for the final two seconds
  of every connection; a sound cue is optional until a shared audio/settings
  subsystem exists.

The player may keep placing dry pieces while liquid is moving.

### 7.5 Terminal rules

- Success: the liquid front reaches the sink through reciprocal connections with no active leak.
- Failure: the front reaches an empty cell, mismatched joint, or board edge, or the front enters a previously wet connection and forms a pressure loop without reaching the sink.
- An empty queue is not itself terminal. Placement becomes unavailable, `QUEUE EMPTY` is shown, and liquid continues: an already complete route may still succeed; an incomplete route fails only when the front reaches its first invalid connection.
- Replacing a flooded piece is disabled. The interface explains that wet pipe is locked.
- Pause freezes all model time.
- The puzzle may never start solved.
- The hidden route is a solvability witness, not a highlighted answer. The player may construct any valid source-to-sink route.
- Before flow starts, show a three-step help overlay covering fixed orientation,
  off-route dumping, slow per-joint flow, and the overwrite penalty. Help freezes
  model time and can be replayed.

### 7.6 Scoring and campaign result

Grade uses route-normalized active model time and overwrite count rather than rotation count. Help, pause, and post-result presentation time are excluded.

- S: success, no overwrites, and no more than 110% of witness-plan time;
- A: success with at most one overwrite;
- B: success with at most three overwrites;
- C: any other success;
- failure and abandonment: `none`.

Successful score is:

```text
max(500, 5,000 - floor(max(0, activeElapsedMs - witnessTimeMs) / 10) - 600 × overwrites)
```

Failure and abandonment score 0.

Pipe result effects:

- success: +5 scrap, +15 Power Routing, `coolant-routing-restored`, and the persisted shortcut-wall transformation;
- failure: +7 Security Alert and `coolant-terminal-filed-a-complaint`;
- abandonment: +5 Security Alert and the complaint flag.

The completion flag, rather than a required-objective trigger-state effect, resolves the objective.

### 7.7 Model boundary

The pure model should expose behavior equivalent to:

```ts
createPipePuzzle(random, config)
placeQueuedPiece(state, cellIndex)
advancePipeFlow(state, deltaMs)
getPipeTerminalState(state)
```

There must be no public rotation operation in the new gameplay model.

`advancePipeFlow` consumes all elapsed time in deterministic fixed substeps; it may cap individual substeps but may not discard excess time after a frame stall. Placement input is processed before a flow substep with the same timestamp. After placement, sink success and invalid-front failure are evaluated as liquid advances; queue exhaustion is only a nonterminal input-state change.

## 8. Space game: horizontal assault and boss

### 8.1 Player fantasy

The player pilots a small ship through a hostile side-scrolling corridor, gathers risky upgrades, survives enemy formations and debris, then defeats an original multi-phase boss. `Space` is the player-facing objective ID and label; it maps to the existing persisted `EncounterKind` and result kind `shooter`.

A skilled Standard run may finish near 120 seconds, while the clearly displayed hard mission limit is 300 seconds at level tier 0 plus 30 seconds per tier, capped at 450 seconds. Victory is tied to the boss, not a small kill count.

### 8.2 Movement and controls

- Replace five lanes with continuous two-dimensional movement inside the playfield.
- The stage scrolls horizontally; the player normally occupies the left third but can move within safe bounds.
- Arrows or WASD move with acceleration and deceleration.
- Space or Z controls primary fire.
- X or B uses the alternate bomb.
- Touch uses a conventional two-thumb layout: left drag pad or virtual stick plus separate, labeled `FIRE` and `BOMB` buttons on the right.
- The ship must never snap to lanes.

Remove autonomous primary and targeting fire. Archive intelligence must not fire on the player’s behalf. A Companion Drone may only mirror a shot created by current player fire input.

Primary fire:

- pressing starts a charge; releasing at `holdMs < 250` creates one 1-damage, one-target pulse at 520 units/s and starts a 180 ms cooldown;
- without a Beam Coil, charged fire uses `capMs = 1200`, `maxDamage = 6`, `maxPenetrations = 3`, and `cooldownMultiplier = 1`;
- for `holdMs >= 250`, compute `u = clamp((min(holdMs, capMs) - 250) / (capMs - 250), 0, 1)`, then `damage = 2 + floor((maxDamage - 2) × u)`, `penetrations = 1 + floor((maxPenetrations - 1) × u)`, and `cooldownMs = round((180 + 270 × u) × cooldownMultiplier)`;
- every projectile damage value is an integer. A Companion Drone mirror deals `max(1, ceil(releasedShotDamage × droneMultiplier))` and does not create a separate fire cadence;
- cooldown and charge state are visible, and fire input during cooldown queues nothing.

Bomb:

- start with two, maximum three;
- consume exactly one per activation;
- clear hostile projectiles whose hitbox intersects a 280-unit radius;
- deal exactly 3 damage to each non-boss enemy whose hitbox intersects that radius;
- deal `max(1, floor(exposedComponentMaxHealth × 0.08))` to the currently exposed boss component inside the radius and 0 through an invulnerability window;
- grant 750 ms of clearly shown invulnerability.

Baseline combat values:

- player visual size 40×28 with a centered 26×18 damage hitbox;
- 3 hull maximum;
- maximum and starting shield are 1 normally or 2 after Pipe success;
- one hit or collision removes one shield, then one hull;
- 900 ms post-hit invulnerability prevents frame-overlap damage;
- collision applies visible knockback but never repeated damage during invulnerability.

### 8.3 Mission structure

Build the encounter from seeded formation and hazard templates:

1. **Approach, 20 seconds:** movement and firing tutorial through light formations.
2. **Wreck-field gauntlet, 30 seconds:** obstacles, turrets, mines, and attacks from multiple angles.
3. **Elite interception, 15 seconds:** an armored formation that guarantees one upgrade drop.
4. **Boss arena, using the remaining mission budget:** the Corridor Warden. At level tier 0 it appears after 65 seconds, leaving 235 seconds on the 5:00 clock.

At least four normal enemy archetypes are required:

- swooping scout;
- formation fighter;
- stationary or mounted turret;
- armored carrier;
- seeded mines or drones may serve as a fifth archetype.

Enemies must use readable movement paths, hostile projectiles, wind-up tells, and collision damage. A finite stage director owns spawning and must always transition to the boss.

The Approach displays dismissible prompts in order: `MOVE`, `TAP FIRE / HOLD TO CHARGE`, and `BOMB CLEARS SHOTS`. Each prompt has a safe practice target and can be replayed from Help.

### 8.4 Boss: Corridor Warden

The boss is an original damaged orbital machine with three phases:

1. **Shield lattice:** destroy two exposed shield nodes while avoiding aimed volleys.
2. **Open core:** attack the core during telegraphed windows while drones and sweeping beams constrain movement.
3. **Emergency protocol:** the damaged boss changes position, accelerates its patterns, and exposes the core more often.

Requirements:

- each phase has a visible health or objective indicator;
- attacks are deterministic under the encounter seed but not identical across seeds;
- the boss cannot leave the playfield or become permanently invulnerable;
- destroying the core is the only success condition;
- hull reaching zero is failure;
- a visible level-scaled countdown and progress bar begin with the mission and remain visible through every phase; the limit is 5:00 at tier 0 and gains 30 seconds per tier up to 7:30;
- the timer becomes visually urgent during its final 30 seconds;
- reaching zero triggers the Warden’s escape and an explicit time-expired failure result, but boss destruction on that exact simulation frame takes precedence;
- a phase-two or phase-three core at one HP remains exposed, and its collision radius matches the visible core art so the finishing shot cannot appear to hit without registering;
- exhausting any scripted event list transitions explicitly rather than softlocking.

### 8.5 Run-scoped add-ons

At least one upgrade is guaranteed before the boss. The initial pool is:

- **Splitter Core:** every released primary creates two ±20-degree side shots. Forward damage is `max(1, floor(baseDamage × 0.8))`; each side shot deals `max(1, floor(baseDamage × 0.4))` and can hit one target;
- **Beam Coil:** use the primary-fire formula with `capMs = 900`, `maxDamage = 7`, `maxPenetrations = 4`, and `cooldownMultiplier = 1.20`;
- **Companion Drone:** uses `droneMultiplier = 0.40`, mirrors each released shot, and blocks the first hostile projectile that would hit the player before being disabled;
- **Shield Cell:** restores one shield point;
- **Bomb Refill:** restores one bomb up to the cap.

Splitter Core, Beam Coil, and Companion Drone are equipable modules. Shield Cell and Bomb Refill are consumed immediately. Only one weapon core and one utility module may be active at a time.

A new equipable module opens a short choice overlay: `Equip`, `Convert to score`, or `Keep current`. It never silently replaces the current build or opts the player into extra threat. Pickups remain for at least 10 seconds and gain gentle magnetism within 80 units. The boss must be beatable with the base weapon if every pickup is missed.

The module-choice overlay pauses the entire shooter model and clears held movement/fire/bomb state both when it opens and closes. Shield Cell restores one shield only up to the current maximum.

Rare unstable variants explicitly trade power for difficulty. Each equipable module roll has a 10% unstable chance. Version 0.3 may offer at most one unstable module on Story/Standard and two on Expert; `threatRank` starts at 0 and is capped at 3.

The unstable version keeps the ordinary effect and applies this visible overclock:

| Module | Additional player power |
| --- | --- |
| Splitter Core | Forward damage remains the unreduced base value and each side shot uses `ceil(baseDamage × 0.50)` |
| Beam Coil | `capMs = 750`, `maxDamage = 8`, `maxPenetrations = 4`, and `cooldownMultiplier = 1.10` |
| Companion Drone | `droneMultiplier = 0.60` and the drone blocks two hostile projectiles before disabling |

Equipping an unstable module raises `threatRank` by one in the same paused choice transaction, even if it replaces another unstable module; declining/converting it does not. From that point forward, each rank increases hostile projectile speed by 8%, adds one compatible future director/boss pattern modifier where available, and multiplies score by `1 + 0.25 × threatRank`. Ordinary defensive pickups do not secretly punish the player.

### 8.6 Campaign modifiers

- Pipe power increases starting and maximum shield by exactly one, not three layers of near-invulnerability.
- Archive Lock intelligence reveals weak points, ambush direction, or boss phase order. It never enables auto-fire and never removes an entire mission phase.
- Convert the campaign’s clamped 0–100 Security Alert to `securityRank = floor(SecurityAlert / 20)`, producing 0–5. Add exactly `securityRank` normal-enemy budget points across Wreck/Elite, never more than two extra simultaneous enemies; add 3% hostile-projectile speed per rank; and add one compatible boss-pattern modifier at ranks 2 and 4. Level tier adds 4% hostile-projectile speed per tier, up to its separate 20% cap.
- The final hostile-projectile speed multiplier is `min(1.50, 1 + 0.03 × securityRank + 0.04 × levelTier + 0.08 × threatRank)`. Pattern modifiers may add geometry/timing combinations but never reduce an attack wind-up below 500 ms, increase boss health, skip a vulnerability window, or exceed the two-extra-enemy cap.

### 8.7 Scoring

Grade uses boss defeat, hull remaining, hits taken, bombs remaining, elapsed time, and unstable add-on threat rank. Normal enemy kills contribute score but never complete the encounter.

- S: boss defeated within 120 seconds, full hull, and at most one bomb used;
- A: boss defeated with at least 2 hull;
- B: boss defeated with at least 1 hull;
- C: any other success;
- failure and abandonment: `none`.

Base score values are 100 per scout, 150 per formation fighter, 250 per turret, 400 per carrier, 500 per shield node, and 5,000 for destroying the boss. A success also adds 500 per hull and 250 per remaining bomb. `Convert to score` grants 400. Apply the unstable multiplier once at result creation:

```text
score = floor(rawScore × (1 + 0.25 × threatRank))
```

Active elapsed time excludes pause, help, module choice, and post-result presentation. Failure and abandonment keep legitimately earned combat score but receive grade `none` and no completion reward.

Space result effects:

- success: +5 scrap, +20 Airspace Control, -5 Security Alert, and `orbital-corridor-cleared`;
- failure: -2 campaign health, -10 Airspace Control, and `raider-patrol-alerted`;
- abandonment: -1 campaign health, -5 Airspace Control, and the alert flag.

### 8.8 Model boundary

Move simulation into a pure `ShooterState` advanced by `stepShooter()`. It owns:

- player position, velocity, hull, shield, charge, bombs, and modules;
- player and hostile projectiles;
- enemies and movement paths;
- pickups;
- world scroll position, debris, terrain, and environmental collision;
- stage phase and elapsed time;
- boss phase, components, health, and invulnerability windows;
- terminal status.

The model advances on a fixed 60 Hz simulation step with an accumulator, consuming all elapsed time unless the game is paused. Seeded event timing must be identical across different render frame schedules. Phaser objects are projections keyed by stable entity IDs.

On Standard at level tier 0, the two shield nodes have 8 health each, the phase-two core has 12 health, and the phase-three core has 18 health, for 46 total component health. At level tier `t`, each value becomes `ceil(baseHealth × (1 + 0.10 × t))`, with `t` clamped to `0..5`. The hard mission limit is `300000 + 30000 × t` milliseconds. After the fixed 65-second approach, this leaves roughly 51–56 seconds per ten points of total boss health across supported tiers. For every supported tier, automated balance validation replays a deterministic base-weapon witness with no module, no bomb damage, and 30% intentionally missed fire opportunities; it must defeat the boss within 50 seconds of arena entry.

Replace placeholder-only combat art with an original checked-in atlas at `assets/space-sprites.png` plus named frame metadata at `assets/space-sprites.json`. It contains distinct frames/animations for the player, four enemy families, pickups, player and hostile projectiles, boss components, explosions, and hit states. `main.ts` passes its image/data URLs through `CreateMazeGameOptions` to `ShooterScene.preload()`. A validation test asserts that every required named frame exists inside the PNG. Missing or invalid production art shows a blocking asset error. Use at least two parallax background layers, visible damage flashes that respect reduced flashing, and clear projectile allegiance by both shape and color.

## 9. Lock game: readable pin-tumbler interaction

### 9.1 Player fantasy

The player manipulates an old mechanical lock by balancing tension, identifying the binding pin, and lifting it to the shear line. The lock should look and behave like a lock rather than a hidden number puzzle.

### 9.2 Presentation

Show a cutaway containing:

- lock cylinder and keyway;
- tension wrench with a continuous gauge;
- four to six spring chambers;
- key pins and driver pins as separate shapes;
- a prominent shear line;
- a movable pick;
- pick integrity and alarm meters;
- explicit feedback text paired with motion and shape.

Base difficulty configuration:

| Difficulty | Pins | Integrity | Alarm window | Initial tension-band width | Set tolerance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Story | 4 | 7 | 120 seconds | 0.24 | 0.08 |
| Standard | 5 | 5 | 90 seconds | 0.18 | 0.06 |
| Expert | 6 | 4 | 70 seconds | 0.13 | 0.05 |

### 9.3 Interaction

The tension control is a slider or wrench arc that remains where placed. Mobile play must not require holding one finger on tension while moving the pick with another.

Tension and pick rules:

- tension is a normalized value from 0.00 to 1.00;
- Q/E changes tension by 0.05;
- Story shows the exact valid band, Standard shows a broader approximate zone around it, and Expert relies on loose/binding/jammed feedback;
- pick height is normalized from 0.00 to 1.00 and follows vertical drag;
- release or Enter attempts a set using the configured seam tolerance;
- an invalid release returns that pin visibly to rest rather than cycling through hidden heights.

Core loop:

1. Drag the wrench into a working tension band.
2. Move the pick beneath a pin.
3. The currently binding unset pin always trembles or pulses, carries a numbered
   gold `NEXT` marker, and becomes selected automatically after the prior pin sets.
4. Drag upward to align the key/driver seam with the visible shear line.
5. Correct height and tension produce a click, latch animation, and partial cylinder rotation.
6. Repeat until all pins are set.
7. A labeled `TURN NOW` control appears; tap/click it or press Enter to open the cylinder.

Feedback vocabulary:

- `SPRINGY`: this is not the current binding pin;
- `LOOSE`: tension is too low and the pin slips;
- `BINDING`: correct pin, continue lifting;
- `JAMMED`: tension is too high and integrity/alarm is penalized;
- `SET`: the seam reached the shear line under valid tension.

The useful tension band shifts slightly after each set pin so finding the first value does not reduce the rest to mechanical tapping.

`TURN` remains visible but disabled until every pin is set. Activating it early
announces `SET ALL PINS FIRST`. Once enabled, one ordinary tap/click or keyboard
Enter completes the turn; no hidden drag threshold is required.

### 9.4 Randomization and failure

Seeded generation controls:

- pin target heights sampled from separate depth bands so every pin in one lock
  has visibly distinct bitting;
- binding order;
- initial and per-pin tension bands;
- tolerance.

The alarm meter increases continuously by `100 / alarmWindowMs` per active millisecond, plus 15 for a jam and 3 for a slip.

- Alarm and integrity start at the values in the difficulty table.
- A jam removes one integrity point.
- A jam drops no pin on Story, drops the latest set pin on every second jam on Standard, and drops it on every jam on Expert.
- Too little tension slips the active pin but does not immediately damage integrity.
- Reaching zero integrity or a full alarm is failure.
- Setting all pins and rotating the cylinder is success.
- Pause freezes alarm time.
- False sets are deferred beyond version 0.3 so feedback remains legible.

No state may require cycling a pin through unrelated hidden heights after receiving feedback.

Only `releaseLockPick` or its keyboard Enter equivalent resolves an attempt; hovering, touching, selecting, and dragging provide feedback but never apply a penalty. Resolution uses this precedence and applies at most one row per release:

| Selected pin/tension | Seam inside tolerance | Result |
| --- | --- | --- |
| Any pin, tension above valid band | Either | `JAMMED`; +15 alarm, -1 integrity, apply the difficulty pin-drop rule |
| Nonbinding pin, low or valid tension | Either | `SPRINGY`; +3 alarm, no integrity loss |
| Binding pin, tension below valid band | Either | `LOOSE`; +3 alarm, no integrity loss |
| Binding pin, valid tension | Yes | `SET`; latch pin with no penalty |
| Binding pin, valid tension | No | `BINDING`; no penalty |

Every non-set release returns the selected pin visibly to rest. Level tier may add at most one pin but never exceed six: Story grows from 4 to 5, Standard from 5 to 6, and Expert remains at 6. Tier narrowing and alarm acceleration use the caps in section 5.5; jam, slip, and springy costs do not increase.

### 9.5 Onboarding and controls

The first Lock attempt in a campaign shows a three-step overlay:

1. `Set the wrench inside the working band.`
2. `Follow the gold NEXT marker; that binding pin trembles.`
3. `Lift its seam to the gold line; when all pins are cyan, tap TURN NOW.`

The overlay pauses the model and has `Try it`, `Replay help`, and `Skip` actions. After dismissal, persist the non-level-scoped campaign flag `tutorial-lock-seen`; it is instructional state, not an objective completion flag. Help remains available on every attempt.

Pointer/touch uses generous drag targets and snap tolerance. Keyboard parity:

- Left/Right or A/D selects a pin;
- Q/E adjusts tension;
- Up/Down moves the pick;
- Enter attempts a set and activates `TURN` after all pins are set;
- Escape opens the shared pause/abandon confirmation.

### 9.6 Results and architecture

Grade thresholds:

- S: success with at least 4 integrity, alarm below 25, and elapsed time below 45 seconds;
- A: success with at least 3 integrity and alarm below 50;
- B: success with at least 1 integrity and alarm below 80;
- C: any other success;
- failure and abandonment: `none`.

Successful score is:

```text
max(500, 4,000 - floor(activeElapsedMs / 25) - 350 × jams - 100 × slipsOrSpringyAttempts - 250 × droppedPins)
```

Pause, help, and post-result time are excluded. Failure and abandonment score 0.

Lock result effects:

- success: raise mining power to at least 2, +6 tool charges, +3 scrap, -10 Security Alert, and `archive-lock-opened`;
- failure: +10 Security Alert and `archive-lock-scratched`;
- abandonment: +7 Security Alert and the scratched flag.

The completion flag, not a required-objective trigger-state effect, resolves the objective.

Retain `modifiers.lockFamily` and route construction through a lock-family factory so later acts can introduce different lock types without replacing the scene contract.

The pure model exposes behavior equivalent to:

```ts
createLockPuzzle(random, config)
setLockTension(state, value)
moveLockPick(state, pinIndex, height)
releaseLockPick(state)
advanceLockTime(state, deltaMs)
turnLockCylinder(state)
```

Time advances in deterministic fixed substeps and consumes all elapsed active time.

## 10. Platformer: generated traversal, collection, and combat

### 10.1 Player fantasy

The player traverses a damaged generated sublevel, learns how its materials behave, avoids or fights enemies, collects every required power core, and reaches the now-powered exit.

### 10.2 Seeded level grammar

Replace `createActOnePlatformerLevel()` with a seeded section generator. Standard levels contain 6–8 compatible sections selected from:

1. safe introduction;
2. basic traversal;
3. material lesson;
4. hazard run;
5. enemy patrol;
6. vertical or branching collectible route;
7. arena or avoidance challenge;
8. exit approach.

Recommended standard width is 2,400–3,200 world pixels, with a 90–150 second Standard completion target including required branches.

Each section template declares:

- entry and exit anchors;
- platforms and explicit surface behavior;
- valid spawn sockets for enemies, required cores, optional salvage, weapons, and checkpoints;
- traversal tags and difficulty cost;
- minimum campaign modifiers, if any.

The generator assembles compatible anchors, populates sockets, then validates the complete route.

### 10.3 Reachability contract

Reachability is a contract between certified section templates and the real movement model. Templates declare candidate input traces for each supported transition. Generation replays those traces through the same fixed-step physics used in play; visual distance alone is never sufficient.

Baseline player physics:

- player collision box: 28×40 px;
- grounded acceleration: 1,400 px/s²;
- grounded braking: 1,800 px/s²;
- air acceleration: 900 px/s²;
- maximum horizontal speed: 210 px/s;
- jump impulse: -430 px/s;
- gravity: 1,000 px/s²;
- early jump-release vertical-speed clamp: -180 px/s.

The ordinary-jump envelope is coupled rather than two independent maxima:

| Destination rise | Maximum ordinary horizontal gap |
| --- | ---: |
| 0 px or lower | 120 px |
| 36 px | 105 px |
| 72 px | 80 px |

Bounce surfaces and powered lifts may exceed this envelope only when the template explicitly models their state. Validation runs at a fixed 16 ms step, allows at most four simulated seconds per transition, and includes entry velocity, surface traction, moving-platform position, and crumbling-platform state. It searches a bounded set of template-supplied input traces; this is deterministic validation, not an unbounded platformer-solving AI.

Before returning a level, prove:

- spawn can reach every required core and then the exit;
- collecting cores in any locally offered branch order cannot strand the player or make another required core unreachable;
- every required branch has a return route, and its core is no more than two sections or 700 world pixels from the main route;
- no required route, core, or exit depends on a campaign bonus, weapon charge, enemy kill, or optional moving lift;
- enemies do not spawn on the player, checkpoint, required item, or hazard;
- the exit cannot be reached only by falling through geometry;
- the baseline checkpoint lies between 45% and 60% of the critical path.

Retry invalid generation with a derived salt up to a fixed attempt limit, then use a versioned known-good fallback that passes the same validator. An Airspace Control reward may add one extra checkpoint, but never replaces the baseline midpoint checkpoint.

### 10.4 Material behaviors

Platform data stores both a visual `materialId` and an explicit behavioral `surfaceKind`; behavior must never be inferred from an ID string, sprite, or color.

| Surface | Representative material | Required behavior |
| --- | --- | --- |
| Normal | stone or metal | Full baseline acceleration and braking |
| Ice | ice | 35% grounded acceleration and 15% grounded braking |
| Conveyor | conductive metal | Adds a declared -70 or +70 px/s belt velocity while grounded |
| Crumbling | sand, clay, or wood | Warns and shakes after contact, becomes non-solid at 600 ms, then resets two seconds after it is unoccupied |
| Bounce | crystal | Applies a -560 px/s vertical impulse on landing |
| Powered lift | conductive/elemental | Travels at 80 px/s between declared endpoints, pauses 350 ms at each endpoint, carries riders, and stops rather than crushing them |

The first generated level uses Normal plus one special surface. Later tiers introduce at most one unfamiliar behavior at a time, with a safe demonstration before its first hazardous use. Standard levels use two or three surface behaviors; requiring three special behaviors in every level would overload the opening level.

Campaign benefits create alternate routes rather than deleting the challenge:

- mining power opens a breakable shortcut;
- restored power activates an optional moving lift or recharge station;
- airspace control adds a supply platform or checkpoint.

### 10.5 Required and optional collectibles

- Generate 3–5 required power cores or memory cartridges.
- Generate 2–4 optional salvage items on validated side paths.
- The HUD always shows `Cores n / total`.
- Reaching the exit early displays the missing count and keeps the encounter active.
- Required cores persist through respawn.
- A directional core indicator points toward the nearest remaining required core without drawing the full route.
- Optional salvage is visually distinct and contributes only score/resources after success; retrying or abandoning cannot farm it.
- Success requires all required cores plus contact with the exit.

### 10.6 Enemies and damage

Initial enemy set:

- floor patroller: one health, turns at edges, 70 px/s;
- hopper: two health, shows a 500 ms crouch before a -340 px/s jump and waits at least two seconds between jumps;
- ranged turret: two health, shows a 650 ms aim line before firing a 140 px/s projectile and waits at least 2.4 seconds between shots;
- flying drone: two health, appears only at higher tiers and shows a 500 ms warning before each dive;
- armored sentry: four health, slow and strongly telegraphed, used only after the pulse blaster has been introduced.

Player combat state includes three health points, knockback, and at least 800 ms of visible post-hit invulnerability.

- Enemy contact or projectile damage removes one health and applies up to 140 px/s horizontal and -180 px/s vertical knockback.
- Zero health respawns at the latest checkpoint, restores encounter health, and adds one death.
- Pits and spikes cause an immediate checkpoint respawn and add one death.
- The attempt fails at 7 deaths on Story, 5 on Standard, or 3 on Expert.
- Collected required cores and defeated enemies remain resolved after a respawn within the attempt.
- Every basic enemy on a required route is avoidable with baseline movement. Combat may create a safer route or optional reward, but ammunition exhaustion cannot block completion.

### 10.7 Combat pickups

The initial guaranteed weapon is a pulse blaster with finite charges.

- The pulse blaster pickup appears in the safe opening section before any hostile encounter.
- J or X fires; touch receives a dedicated `FIRE` button.
- Each shot consumes one charge, deals one damage, travels at 420 px/s, and starts a 250 ms cooldown.
- The blaster holds at most 12 charges; its pickup and each checkpoint guarantee at least six.
- The weapon remains owned through checkpoint respawns. Ammo/charge is always visible.
- Standard enemies take one or two hits; armored sentries take four or can be bypassed through a deterministic environmental route.
- Generate one or two additional combat pickups: an EMP pickup destroys non-armored enemies within 240 px and stuns armored sentries for three seconds; a temporary shield absorbs one hit within 10 seconds; an ammo refill adds six charges up to the cap.
- No required route or core requires an enemy kill. All baseline enemies remain avoidable, allowing collection and combat to support different play styles and preventing an empty-ammo soft lock.

### 10.8 Results

Success requires all cores and the exit. Because all required cores are mandatory, grade uses optional salvage, defeated enemies, deaths, damage, and active elapsed time rather than awarding points merely for the required collection.

- S: success within 105 seconds, no deaths, at most one damage event, and every optional salvage item;
- A: success within 130 seconds, at most one death, and at least half of optional salvage;
- B: success with at most three deaths;
- C: any other success;
- failure and abandonment: `none`.

Successful score is:

```text
max(
    500,
    3,000
        + 250 × optionalSalvage
        + 150 × defeatedEnemies
        - 300 × deaths
        - 100 × damageEvents
        - 5 × floor(activeElapsedMs / 1,000)
)
```

Failure and abandonment score 0. Pause, help, and post-result time are excluded.

Result application preserves the existing campaign economy:

- success: +4 scrap plus 1 scrap per optional salvage capped at 3, +2 campaign health, +20 Structural Stability, `sublevel-nine-stabilized`, and `memory-cartridges-{requiredTotal}`;
- failure: -2 campaign health, -5 Structural Stability, and `sublevel-nine-awaits-repairs`;
- abandonment: -1 campaign health, -5 Structural Stability, and `sublevel-nine-awaits-repairs`.

Collected optional salvage is granted only on success. The existing `memory-cartridges-*` level-scoped flag remains for compatibility, but its numeric suffix must equal the required cores actually collected during the successful attempt.

### 10.9 Presentation

Replace the current geometric placeholders with sprite states for idle, run, jump, fall, fire, and hurt. Reuse the checked-in item, monster, and material sheets only where a documented frame is semantically correct; add dedicated frames rather than recoloring an unrelated item.

- Each behavioral surface has a texture/edge treatment plus a non-color cue: frost streaks for Ice, arrows for Conveyor, fracture animation for Crumbling, facets for Bounce, and rails for Powered Lift.
- Required cores pulse with a core symbol; optional salvage uses a different silhouette and the exit displays its missing-core lock state.
- Enemy families have distinct silhouettes and pre-attack animation matching their telegraph.
- Damage, invulnerability, checkpoint activation, pickup, and exit unlock receive visible feedback that respects reduced-motion/flashing settings.

### 10.10 Model boundary

The pure platformer model must own:

- generated level geometry and surfaces;
- player movement, health, weapon, ammo, invulnerability, and checkpoint;
- enemies and projectiles;
- moving and crumbling surface state;
- required and optional collectibles;
- locked-exit state;
- deaths, time, score, and terminal status.

The model advances with its declared fixed-step accumulator, owns all collision decisions, and emits semantic events for presentation. Phaser sprites and tweens may visualize state but may not decide reachability, damage, collection, or terminal results.

## 10A. Zapper: alien nanotech service rush

Zapper is a four-lane, seeded service game inspired by the timing loop of classic counter games but built from original alien-laboratory fiction and art. Aliens approach separate nanotech tables with randomized species, blaster designs, slime flavors, arrival order, and timing. The player moves Up/Down or taps a lane, holds `F`/Fill until the slime tank reaches 100%, then presses Enter/Space/`E` or Slide to send the gun down that counter.

The technician assembles the weapon and returns it along the same lane. The player must be in that lane to catch it, then press the same action again to hand it to the waiting customer. Sending an unfilled gun, serving the wrong lane, missing a return, or allowing an alien to reach the desk costs a life. The default shift requires 12 completed orders and allows three broken orders. The schedule is fixed-step and seeded, retries generate a distinct schedule, and the production model must validate that the quota remains reachable.

Touch controls expose two lane buttons, a holdable Fill button, and one context-sensitive Slide/Hand Off button, each at least 44×44 CSS px. The HUD shows quota, lives, selected lane, fill progress, active orders, and the exact active maze-item bonus.

## 10B. Casino Heist: armed highway escape

Casino Heist is a required roster game with an explicit overworld gate. Its marker is visible but locked until the campaign has ever acquired the Getaway Car, either as rare random maze loot or as the fixed `$100` shop offer. Acquiring the car persists `casino-heist-unlocked`; entering, failing, or completing the Heist never consumes it. A selected locked Heist forces a reachable shop onto the level so the required-objective count cannot become impossible.

The attempt starts with an unarmed getaway car on a continuously scrolling road. Arrows/A/D or drag/touch provide variable horizontal steering rather than lane snapping. The player dodges road debris, barriers, and fast or slow luxury interceptors with damaging wheel spikes. Armed enemy cars fire only forward, so their aim, muzzle tell, projectile path, and safe side must be readable before damage can occur.

Road powerups grant a gun and a small finite ammunition supply; the player begins with neither. `F`/Fire or the visible touch action spends one shot, and additional ammo pickups are required to remain armed. The route always generates enough survivable space and optional weapon opportunities, but combat is never required when a clean dodge is available. Reaching the casino exit with hull remaining succeeds and atomically credits exactly `$1000`; collision destruction or falling behind fails without a payout. The HUD shows route progress, hull, weapon/ammo state, incoming threats, and any Shield or Compass maze-item bonus.

## 11. Cross-genre reward balance

Earlier victories should help later games without removing them.

| Prior result | Later benefit |
| --- | --- |
| Pipe success | One Space shield bonus; activates a real Platformer lift/recharge station |
| Lock success | Space weak-point/ambush intel; Platformer breakable shortcut or weapon cache |
| Space success | Platformer supply checkpoint or optional salvage route |
| Platformer success | Final exit requirement and structural-stability reward |

Forbidden reward effects:

- autonomous firing;
- skipping the Space boss;
- satisfying required Platformer collection automatically;
- filling every Platformer gap with ground;
- revealing a Lock solution outright.

## 12. Input, accessibility, and pause

### 12.1 Touch targets

Interactive controls must be at least 44×44 CSS pixels after canvas scaling. This applies to overworld Attack/Use/Interact/Wait/Inventory/targeting controls, close/help buttons, queue pieces, Lock tension controls, Space fire/bomb buttons, Platformer controls, Zapper lane/fill/action buttons, and Casino Heist steering/fire controls.

If Phaser FIT scaling makes a canvas control smaller than that, enlarge the world-space hit region or use a responsive DOM control overlay. Tests must convert each Phaser hit rectangle through the live canvas scale and assert its effective CSS size; checking logical pixels alone is insufficient.

The shell must support portrait and landscape viewports down to 320×568 CSS pixels without clipping a required control. Replace the current `78vmin` stage constraint with a layout that can use up to 96% of the available viewport width, compacts/wraps the HUD, and reserves explicit space for touch controls. The menu button also grows from 36×36 to at least 44×44 CSS pixels.

At 568×320 and other viewports no more than 420 CSS px high, encounters use a rectangular landscape layout rather than shrinking the fixed square canvas: a compact one-line status strip, gameplay/board on the left, and queue/action/help controls in a right-side DOM panel. Pipe reserves at least 264×264 CSS px for its 6×6 board; Lock uses the same left/right split; Space, Platformer, Zapper, and Casino Heist use the full-width playfield with controls over safe lower corners. Required controls must fit without page scrolling. The overworld may keep its square camera with a compact overlay HUD.

Space, Platformer, and Casino Heist use conventional two-thumb controls: movement on the left and at most two action buttons on the right. Required actions may never need a third simultaneous contact. The turn-based Overworld, Pipe, Lock, and Zapper remain completable with a single contact at a time.

### 12.2 Redundant feedback

- Never communicate state with color alone.
- Pair success, danger, selection, and locked states with shape, animation, icon, and text.
- Update the canvas accessible label when entering each minigame and provide a DOM `aria-live="polite"` status region for objectives, loot choices, monster intents, traps, resources, damage, and results.
- Provide visible keyboard controls and a replayable help action.
- Essential supporting text must render at 14 CSS px or larger and primary objectives/actions at 16 CSS px or larger after scaling.
- Store shared reduced-motion and reduced-flashing preferences and apply them to overworld generation, liquid animation, Lock feedback, Space effects, and Platformer camera effects.
- Every action exposed by a DOM overlay must be keyboard focusable, visibly focused, and labelled. Canvas-only actions need an equivalent visible instruction and accessible status update.

### 12.3 Pause

Pause freezes:

- overworld targeting/modal input and prevents any turn dispatch;
- Pipe grace and liquid time;
- Lock alarm time;
- Space stage, projectiles, and boss patterns;
- Platformer simulation, moving surfaces, enemies, and invulnerability timers;
- Zapper orders, fill progress, blaster travel, and assembly timers;
- Casino Heist road progress, traffic, projectiles, pickups, and invulnerability timers.

Escape and the menu button always open the same pause overlay. `document.visibilitychange` auto-pauses when the tab becomes hidden. Choosing Abandon from a live attempt requires confirmation and commits exactly one abandonment result. Returning from an already terminal overlay never commits again, and returning from an interrupted-attempt prompt clears its descriptor with no effect. No input pressed while opening or closing an overlay may leak into gameplay, and resuming clears held-input state before accepting new actions.

## 13. Technical architecture

Recommended additions and revisions:

```text
index.html
src/main.ts
src/app/create-game.ts
src/app/game-shell.ts
src/app/phaser-shell-controls.ts
src/domain/random/seed-derivation.ts
src/domain/overworld/level-objectives.ts
src/domain/overworld/objective-placement.ts
src/domain/overworld/level-content-generator.ts
src/domain/overworld/resolve-overworld-action.ts
src/domain/overworld/level-service-sites.ts
src/domain/overworld/service-site-placement.ts
src/domain/economy/economy.ts
src/domain/entities/item-registry.ts
src/domain/entities/item-affixes.ts
src/domain/entities/monster-registry.ts
src/domain/entities/monster-strategies.ts
src/domain/entities/trap-registry.ts
src/encounters/apply-encounter-result.ts
src/save/campaign-state.schema.ts
src/save/local-save-repository.ts
src/minigames/pipe/pipe-model.ts
src/minigames/pipe/pipe-dream.scene.ts
src/minigames/lock/lock-model.ts
src/minigames/lock/lockpick.scene.ts
src/minigames/shooter/shooter-model.ts
src/minigames/shooter/shooter.scene.ts
src/minigames/platformer/platformer-level-generator.ts
src/minigames/platformer/platformer-model.ts
src/minigames/platformer/platformer.scene.ts
src/minigames/circuit/circuit-model.ts
src/minigames/circuit/circuit.scene.ts
src/minigames/horsemaster/horsemaster-model.ts
src/minigames/horsemaster/horsemaster.scene.ts
src/minigames/zapper/zapper-model.ts
src/minigames/zapper/zapper.scene.ts
src/minigames/heist/casino-heist-model.ts
src/minigames/heist/casino-heist.scene.ts
src/minigames/casino/cards.ts
src/minigames/casino/blackjack-model.ts
src/minigames/casino/blackjack.scene.ts
src/minigames/casino/holdem-model.ts
src/minigames/casino/holdem.scene.ts
src/scenes/overworld.scene.ts
assets/objective-sprites.png
assets/space-sprites.png
assets/space-sprites.json
scripts/generate-objective-sprites.mjs
```

Architecture requirements:

- `OverworldScene` consumes persisted objective definitions instead of recomputing one placement from a pristine maze.
- `OverworldScene` translates controls and renders `resolveOverworldAction()` events; it does not independently collect loot, advance individual monsters, apply contact damage, or handle defeat.
- Encounter seeds derive from `campaign.overworld.seed`, objective ID, and attempt number, not the app migration seed.
- Objective definitions centralize trigger IDs, prerequisites, flags, labels, and icons.
- Optional service definitions and placements are persisted separately from required objectives.
- Objective roster size and exit requirement are derived from the level number, capped at eight, while persisted four-, five-, and six-game rosters retain compatible requirements.
- Encounter launch derives passive item modifiers once from the saved player inventory and equipment; models receive only validated configuration values and never mutate campaign items.
- All generated entities have stable IDs.
- Maze topology and overworld content have separate persisted generator IDs. Static placement/types/affixes and dynamic per-monster decisions use the named independent streams in section 5.1.
- One atomic `levelContentInitialized` transaction replaces the three legacy initialization flags.
- Semantic item/monster sprite registries are the only layer that knows numeric frame indices.
- Models accept `RandomSource` and configuration rather than reading global time or `Math.random()`.
- Casino models own card rules and bankroll arithmetic; Phaser scenes only translate input/render state, while Overworld persists the absolute wallet after each settled hand.
- Casino Heist success uses the same atomic encounter-effect path to credit `$1000` once; its scene never writes the wallet directly.
- New-campaign creation accepts an injectable `CampaignSeedSource`; only its production adapter reads Web Crypto.
- Each real-time model declares a fixed simulation step. Scenes accumulate frame time and consume deterministic substeps; generation validators replay with the same model and step. Hidden-tab time is handled by auto-pause rather than silently dropping active gameplay time.
- A model may enter one terminal state only once. A scene emits one result for that state, atomically and idempotently applies it, and removes input listeners, timers, tweens, and subscriptions on shutdown or retry. A stale callback from a previous run ID cannot mutate the campaign.
- If an encounter result reduces campaign health to zero, result application invokes the same pure overworld defeat reducer before the one campaign save; it either performs automatic retreat or persists the Feather choice while atomically committing/clearing the encounter. Scenes never implement a second death path.
- Terminal outcome submission happens before decorative result animation. The shell/Overworld, not a stopping minigame scene, owns the post-result Retry/Return overlay.
- `main.ts`, `CreateMazeGameOptions`, and `OverworldScene.preload()` carry the typed objective-atlas URL end to end; the same options chain supplies the Space atlas image/data URLs to `ShooterScene.preload()`.
- `index.html`, `game-shell.ts`, and `phaser-shell-controls.ts` jointly own responsive layout, accessible status, pause, and shared input preferences; individual scenes must not create incompatible shell behavior.
- Development-only dataset hooks may expose terminal state for E2E tests, but tests must not depend exclusively on hidden solutions.

## 14. Test plan and acceptance criteria

### 14.1 Maze and objectives

- For native version-2 levels, the same seed plus pinned generator IDs reproduces topology, materials, objective positions, fully rolled items, monsters/variants/drops, and traps. Migrated-v1 levels instead preserve and round-trip their grandfathered content.
- For the fixed corpus `campaignSeed = 0..99`, level 1, size 21, `wilson-v1`, and the production material registry, at least 95 unique topology signatures and independently 95 unique placement signatures occur. A topology signature joins rows of `#`/`.` with `/`; a placement signature joins registry-ordered `objectiveId:x,y` entries with `|`.
- At least 90 of those 100 ordinary 21×21 levels satisfy the preferred objective bands and unrelaxed separation floor. Every relaxation reports diagnostics proving the stronger candidate set was exhausted.
- Injected campaign-seed sources make New Game and Restart consume exact known unsigned values. An unavailable/throwing source shows the blocking error and leaves storage unchanged.
- Reload preserves the exact maze and objective positions.
- Every playable odd size from 21 through 99 is exercised, and a larger seed corpus preserves connectivity, perimeter, spawn, and exit.
- Size-5 material assignment with more material IDs than walls deterministically uses only the registry prefix that fits; the full production registry is exercised at playable sizes.
- Every selected objective cell is unique, reachable, correctly spaced, and collision-free for roster sizes four through eight.
- Pipe shortcut tests cover the preferred and relaxed path-reduction thresholds, mining protection, format-1 assignment, invalid native-save rejection, failure/abandon preservation, and atomic success transform + field clear + flag exactly once.
- Objective icon registry maps Pipe → pipe, Lock → chest, Space → spaceship, Platformer → lift, Circuit Crush → circuit chip, Horsemaster → horse car, Zapper → slime blaster, and Casino Heist → getaway car.
- The objective atlas is exactly 256×32 RGBA with eight 32×32 frames, and a missing/invalid atlas produces the specified blocking error.
- Migration-eligible, semantically valid format-1 saves migrate without losing progress; migration is idempotent and covers Pipe-complete and Pipe-incomplete cases.
- Migration tests prove the current maze is never regenerated, current objective placement uses the preserved normalized legacy level seed, and future levels use the version-2 formula.
- Migration tests cover legacy player/monster overlap relocation, stable item/monster IDs and exact new-field defaults, player/item/monster collision reservations, schema-valid but impossible prerequisite chains, partial objective data, invalid entities, grandfathered content-origin exemptions, and a rejected slot remaining byte-for-byte unchanged.
- Loading a valid version-2 `levelContentInitialized: false` state performs one deterministic, atomic full-content initialization; reloading the result does not reroll it.
- A valid active-attempt descriptor survives refresh and retries with the same run ID/seed; Return clears it without effects, and terminal application clears it exactly once.
- Active-attempt tests cover first ordinal 0, one committed failure producing ordinal 1, uncommitted refresh preserving the ordinal, campaign-global counting on a later level, and save/reload while the player occupies the objective.
- Invalid or mismatched active-attempt descriptors are rejected.

### 14.2 Roguelike maze layer

- Across 500 fixed seeds for every tier/preset combination, loot/threat/entity/trap caps, safe radii, route-window budgets, Sentry cover, complex-trap wait cells, and all guaranteed placements hold.
- Item placement remains identical when item type/affix tables change under an injected test content version; monster placement likewise remains independent of type, variant, loot, and AI rolls.
- Same monster ID/turn/action count produces the same choice after save/reload, array reorder, or insertion of an unrelated monster; a monster that executes an attack cannot also move or prepare another intent in that player turn.
- Loot is pre-rolled once, remains identical after reload/defeat, and cannot respawn or duplicate.
- The schema round-trips backpack/equipment/quick slots, quantities/charges/affixes/Orb choices, weapon recovery, partial monster HP/status/intent/regeneration/drop, trap phase/owner, pending hazards/defeat/reward, sanctuary claims, death count, content origin, and mercy state.
- Schema tests reject duplicate ownership/IDs, invalid coordinates, impossible stacks/charges/HP, incompatible affixes/equipment, broken quick-slot references, invalid trap phases, and unknown content generator IDs.
- Version-1 migration preserves positions and mining progress, gives the baseline kit, converts legacy item/monster instances without rerolling, adds no surprise traps to the current level, and remains atomic/idempotent.
- Every `OverworldAction` verifies exact turn consumption and resolution order; blocked/inspection/modal actions cost zero, while Wait and valid combat/use/equip/disarm actions cost one.
- Objective/exit entry resolves one complete world turn, remains safe by exclusion rule, autosaves, and cannot be exploited to freeze monster actions.
- Player bump/ranged attacks always hit legal targets; empty Bow and empty inventory still leave a one-damage fallback that can clear every required-path blocker.
- Monsters never stack or move-and-damage in one turn; every attack/volatile area is avoidable for one full decision and conflicting movement resolves by stable ID.
- Story/Standard/Expert incoming-damage and simultaneous-intent caps hold with multiple attackers, traps, armor, wards, poison, and volatile explosions.
- Every base archetype, numeric detection/leash and return-home rule, behavior cadence, telegraph cancellation, variant compatibility, persisted regeneration, status, armor, death, and drop has deterministic model coverage.
- Every weapon, active consumable, utility, quality weight, affix, salvage value, full-backpack choice, full-health potion rule, quick slot, and ammo/tool cap has boundary tests.
- Spike/Snare/Gas/Arc/Flame reveal, wait, trigger, cooldown, disarm, neutral-monster interaction, and Multitool behavior have deterministic tests.
- Every material interaction is tag/hardness-driven; mutation immunity for perimeter/objectives/Pipe shortcut and power-2/3/4 mining are covered.
- The canonical cumulative tactical witness replays its stored full action list from the exact turn-0 snapshot, uses only physically collected guarantees, carries resources through every selected objective segment, and covers expansion-cap rejection, salted retry, and the known-good fallback.
- Defeat from monster, trap, Volatile hazard, and minigame result invokes recovery exactly once; nonlethal status damage followed by a separate lethal hit uses the same path. Recovery preserves all specified state, resets surviving monsters/intents, and grants three grace turns.
- Revival Feather pending choice, nonlethal damage-over-time, mercy Potion placement beside an existing drop/occupied cell, sanctuary claim IDs, and the pending level-reward transition remain exact and cannot duplicate through reload.
- Item/monster atlases validate as 320×160 RGBA/50 frames, every active semantic ID maps in range, and strategy behavior never depends on numeric frame.
- Desktop and mobile E2E cover bump combat, ranged targeting/cancel, inventory focus, quick use, Wait, trap inspection/disarm, defeat/recovery, save/reload continuation, and readable intent/live-region feedback.

### 14.2A Optional economy, Blackjack, and Texas Hold’em

- Schema versions 1, 2, and 3 migrate to version 4 with `$40`, preserve existing campaign content, deterministically backfill service sites when needed, and initialize the saved reinforcement schedule without regenerating the current level.
- Blackjack and Hold’em placements are reachable, unique, collision-free, stable across reload, and never count toward required-objective status or exit requirements.
- A fixed 100-seed corpus includes both shop-present and shop-absent levels while always including both card tables.
- Every monster archetype/variant/elite combination awards its exact deterministic money value once; dead monsters cannot award again after reload.
- While active overworld play is unobstructed, a deterministic reinforcement countdown spawns a money-bearing monster every 30–60 seconds. The countdown and ordinal persist across reload, pause during encounters/modals/defeat, cap the living population at eight, and leave an overdue spawn pending until a fair cell is available.
- Shop tests cover insufficient money, item stacking, full inventory, duplicate permanent upgrades, caps, exact debit, and stable purchased-item IDs.
- Blackjack tests cover naturals, dealer blackjack, soft aces, Hit, Stand, Double Down, bust, dealer draw/stand, win/loss/push, 3:2 payout, repeated hands, and insufficient bankroll.
- Hold’em tests cover all nine hand categories, wheel straights, complete tie breakers, every legal action set, computer checks/bets/calls/folds, all four streets, burn cards, showdown, split pots, and repeated hands.
- Desktop and mobile E2E enter both card tables from persisted map sites, settle a hand, verify autosaved wallet parity, deal a second hand, leave, and purchase a shop item.

### 14.3 Pipe

- Every generated puzzle is solvable and not initially complete.
- For attempt seeds `0..99` at Standard, stable serialization of source, sink, route, obstacles, and queue yields at least 90 unique puzzle signatures.
- The stored witness can be replayed through the production model and timing rules to reach the sink.
- Placement never rotates a piece.
- Overwrite replaces one dry piece, consumes one queue piece, and advances flow by exactly one configured step.
- Wet cells cannot be replaced.
- Incremental flow, pause, empty/mismatch/edge leaks, pressure-loop failure, sink success, and retry are deterministic.
- Empty queue plus a completed route can still succeed; empty queue plus an incomplete route fails only when liquid reaches the invalid connection.
- Grade and score boundaries use active model time and exact overwrite penalties.
- Desktop keyboard and mobile touch can both complete and fail an encounter.

### 14.4 Lock

- Same seed reproduces pins, binding order, and tension bands. For attempt seeds `0..99` at Standard, stable serialization of those values yields at least 90 unique Lock signatures.
- Every generated lock has distinct target depths with visible original-seam
  notches and lift trails, while every successfully set seam still aligns to
  the common shear line.
- Binding, loose, springy, jammed, and set feedback each have model tests.
- Alarm, integrity, pin drop, success, failure, and pause are deterministic.
- Every row of the attempt-resolution table is covered across Story, Standard, and Expert, including tier caps at six pins.
- The tutorial can be completed, skipped, and replayed.
- Turning the cylinder before all pins are set gives direct feedback and cannot accidentally succeed.
- The next binding pin is marked and selected after every set, and an enabled
  `TURN NOW` opens from a normal desktop or mobile tap.
- Grade and score boundaries use active model time and exact jam/slip/drop penalties.
- A mobile player can complete the encounter without multi-touch.

### 14.5 Space

- An available Space landmark offers either the normal mission or an atomic `$100` objective purchase. The purchase records the canonical completion flag, creates no fake shooter result/history, and cannot charge for a locked or already completed objective.
- Player movement is continuous, bounded, and never lane-snapped.
- For attempt seeds `0..99` at Standard, stable serialization of director templates, spawn timing/paths, hazards, upgrade drops, and boss-pattern variants yields at least 90 unique mission signatures.
- No player-owned primary or companion-drone projectile is spawned unless caused by a player primary-fire action; there is no autonomous targeting or firing.
- Charge damage/penetration/cooldown rounding, Splitter/Beam/Drone math, and bomb consumption/damage targets are exact; bombs clear allowed projectiles but cannot instantly defeat the boss.
- Each enemy archetype and pickup has deterministic tests.
- Standard director transitions through Approach/Wreck/Elite at 20/50/65 seconds. The global mission timer expires at 300 seconds on tier 0 and gains 30 seconds per tier up to 450 seconds; boss health scales from 46 total component health at tier 0 to 69 at tier 5.
- Every boss phase transition is deterministically reachable. Boss destruction succeeds, hull loss fails, and global time expiration produces a distinct Warden-escaped failure.
- Destroying the final boss core is authoritative success even when the hit shares the exact frame with time expiration, player destruction, or a stale failure marker; the overworld must show `OBJECTIVE COMPLETE`, never `ATTEMPT ENDED`.
- Space/fire key repeats cannot dismiss the terminal result card or spill into overworld turns. Accepted success is committed exactly once before the card appears, and only a deliberate non-repeat Enter, Escape, or visible action closes it.
- The base-weapon witness defeats every supported-tier boss within its 50-second feasibility bound.
- Every required Space atlas frame validates, and missing/invalid art produces the specified blocking error.
- All generated finite missions end in success or failure; no exhausted-wave softlock remains.
- Campaign modifiers help without enabling auto-fire or skipping phases.
- Score, 10% unstable roll/difficulty offer caps, each unstable player-power overclock, threat increase, Security Alert rank/caps, final speed multiplier, grade, shield cap, pause-excluded time, and module-overlay input clearing have exact boundary tests.
- E2E can inject a deterministic simulation clock/content budget so it exercises approach, formation, elite, and boss transitions without waiting through 120 seconds of wall-clock time.

### 14.6 Platformer

- Same seed reproduces a level. For campaign seeds `0..99` at Standard level tier 2, canonical full-level serialization yields at least 90 unique signatures across section order, enemies, surfaces, and collectibles as one combined result. The signature is stable JSON of ordered template IDs, geometry/surface tuples, enemy archetype/socket tuples, and collectible kind/socket tuples; it excludes the seed and generated entity IDs.
- Hundreds of seeds and modifier combinations pass the reachability validator.
- Every required core and the exit are reachable with baseline abilities.
- Every locally offered required-core order remains completable and returns to the main route.
- Exit contact before full collection remains locked and reports the missing count.
- Normal, ice, conveyor, crumble, bounce, and lift behavior have model tests.
- Enemy contact, projectiles, invulnerability, knockback, health, weapon ammo, kills, checkpoints, and respawn persistence have model tests.
- Emptying all ammo before later threats cannot block a required core or the exit; respawn restores the checkpoint minimum.
- Level tiers never exceed section, enemy, core, telegraph, or reachability caps.
- Grade, score, optional-salvage grant, exact result flags, and success/failure/abandon effects have boundary tests.
- Desktop and mobile controls can collect all required objects, use a weapon, and finish.

### 14.6A Zapper

- Same seed reproduces the four-lane order schedule, alien appearances, blaster styles, slime flavors, travel speeds, and assembly timing; retries derive a distinct valid schedule.
- Generation validation proves the 12-order default quota remains reachable with three starting lives and never begins with an impossible arrival burst.
- Hold-to-fill, lane change, full-gun slide, same-lane catch, handoff, wrong-lane/unfilled rejection, missed return, alien-at-desk loss, success, and quota-unreachable failure have deterministic model coverage.
- The Multitool fill-speed and Lantern catch-tolerance modifiers apply exactly and are named in the HUD.
- Keyboard and one-contact-at-a-time touch controls can both complete and fail a shift.

### 14.6B Casino Heist

- The marker is locked before `casino-heist-unlocked` and becomes available after either a rare maze-car pickup or the exact `$100` shop purchase. A selected locked Heist always produces a reachable shop.
- Same seed reproduces route length, obstacles, interceptor speeds/paths, spiked-wheel threats, enemy firing cadence, weapon/ammo drops, and safe-space validation.
- Every attempt starts with no weapon and zero ammunition. A weapon pickup enables Fire, each shot consumes one round, and additional ammo pickups restore only the configured finite amount.
- Enemy projectiles originate from the front of the firing car and follow the telegraphed forward path. Obstacles, spikes, bullets, invulnerability, hull loss, and collision ordering have deterministic coverage.
- Reaching the route end with hull remaining atomically credits exactly `$1000` once; failure, abandonment, retry, reload, and duplicate terminal input cannot duplicate or partially apply the payout.
- Shield hull and Compass handling modifiers apply exactly and are named in the HUD. Keyboard and touch controls can both finish the escape.

### 14.6C Passive item bonuses

- Every mapping in section 6.14 has a positive, no-item, backpack-item, and equipped-item test.
- Launch, failure, abandonment, retry, and success preserve the source item’s identity, quantity, charges, equipment slot, and affixes.
- Scene telemetry and visible HUD copy agree on the applied modifier, and unknown or irrelevant items produce no bonus.

### 14.7 Full campaign

- Deterministic E2E seeds prove that levels 1–4 offer four selected games, levels 5–8 offer five through eight, and the required counts are exactly 1 through 8.
- A deterministic E2E seed completes the selected requirement and advances to a larger new level.
- The path uses at least one persistent weapon, monster kill/drop, material shortcut, trap counter, sanctuary recovery, and level-completion reward.
- At least one E2E path exercises failure and a newly seeded retry for each of the eight required minigames.
- Refresh during exploration and after each objective preserves progression, placements, rolled features, partial combat/trap state, and the unfinished level exactly.
- Starting a new campaign through an injected new seed rerolls topology and every content signature.
- The exit remains locked until the completed selected-objective count reaches `min(levelNumber, 8, persistedRosterSize)`.
- Completing all eight objectives and entering the level-8 exit persists `campaign-victory`, presents the success music and dancing-horse celebration, and never generates level 9.
- Mobile E2E covers 320×568 portrait and 568×320 landscape, verifies effective CSS touch-target sizes and readable instructions without page scrolling, and completes Space and Platformer with at most two simultaneous contacts.
- E2E verifies minigame-specific canvas labels, live-region objective/damage/result announcements, DOM overlay labels/focus, and reduced-motion/reduced-flashing behavior.
- Pause, hidden-tab auto-pause, resume input clearing, abandon confirmation, and listener cleanup are exercised for every encounter.
- Terminal-result application is exactly once even after double input, scene restart, or a delayed callback.

### 14.8 Quality gates

The existing gate remains mandatory:

```sh
npm run check
npm run test:e2e
```

Run the quality gates with Node.js 22 LTS and npm available on `PATH`; the commands are the same on Windows, macOS, and Linux. Generation and validation should complete at p95 within 100 ms for the initial level and p95 within 500 ms at the maximum 99×99 maze. Benchmark the production build under Node 22 on the baseline two-core x64/7 GB CI worker, after 20 warm-up runs and across 100 measured seeds; exclude the optional visual reveal. Gameplay targets 60 FPS and remains rules-correct at 30 FPS because model time is fixed-step and deterministic.

## 15. Implementation sequence

### Milestone 1: generation and persistence foundation

- Add entropy-backed campaign seeds and named seed derivation.
- Define the versioned semantic item/monster/affix/trap registries, immutable content tables, rolled-instance interfaces, pending-choice/hazard interfaces, and complete version-2 schema validation before writing migration or generation.
- Persist maze/content generator IDs, objective positions, protected Pipe shortcut, full rolled entity state, and active-attempt descriptor.
- Add format 1 → 2 migration.
- Implement atomic level-content initialization and validated distributed objective placement.
- Add the eight-icon objective atlas and marker registry.
- Update overworld initialization, HUD, seed-source injection, and deterministic E2E setup.

### Milestone 2: roguelike maze layer

- Replace scene-ordered movement/contact damage with the pure atomic turn reducer.
- Add backpack/equipment/quick slots, weapons, qualities/affixes, recovery/tools, and pickup choices using the existing item atlas.
- Add killable telegraphed monster archetypes, variants, statuses, drops, and stable-ID AI using the existing monster atlas.
- Add material-driven traps, material/tool interactions, generation budgets, tactical validation, sanctuaries, and recoverable defeat.
- Implement the registry strategies, desktop/mobile controls, inspect UI, live announcements, and the complete overworld test matrix.

### Milestone 3: Pipe rebuild

- Replace rotation board with solvable queued placement.
- Add overwrite penalty, incremental liquid, failure, pause, scoring, and help.
- Update unit and mobile E2E tests.

### Milestone 4: Lock rebuild

- Implement the pin-tumbler model, continuous tension, binding order, integrity/alarm, failure, and tutorial.
- Replace abstract rectangles with the cutaway presentation.
- Update unit and mobile E2E tests.

### Milestone 5: Space rebuild

- Implement continuous movement, projectiles, formations, hazards, pickups, alternate bombs, and the boss.
- Remove auto-fire and lane-specific interfaces/tests.
- Add the original Space atlas, finite-stage validation, and base-weapon boss witness.

### Milestone 6: Platformer rebuild

- Add seeded section generation and simulation-based reachability.
- Add behavioral surfaces, required cores, locked exit, enemies, health, weapons, and combat controls.
- Add distinct player/enemy/surface states, scoring, and result presentation.
- Convert campaign bonuses into alternate routes.

### Milestone 6A: expanded eight-game roster

- Add Circuit Crush, Horsemaster, Zapper, and Casino Heist as seeded fixed-rule models with keyboard/touch Phaser scenes.
- Add the rare Getaway Car pickup, exact `$100` shop offer, persistent unlock, forced-shop anti-deadlock rule, and atomic `$1000` Heist payout.
- Add passive maze-item modifier derivation and visible bonus labels across all eight required minigames.
- Scale stable objective selection and exit requirements through level 8 while preserving compatible four-, five-, and six-game saves.

### Milestone 7: integration and balance

- Tune duration, difficulty curves, rewards, grades, and failure consequences.
- Complete accessibility, reduced-motion, touch-target, and pause audits.
- Run the full desktop/mobile campaign matrix across multiple seeds.
- Update `README.md`, controls, sprite documentation, and content notes.

## 16. Confirmed product choices

1. Any selected objective with an unmet explicit unlock appears visibly locked and names the requirement when found.
2. An unfinished level remains stable; a new campaign rerolls all procedural content.
3. Platformer uses an elevator/lift objective icon.
4. Rare unstable Space powerups increase both player power and threat.
5. Skilled Standard Space play may finish near 120 seconds, while the forgiving hard limit scales from 5:00 at tier 0 to 7:30 at tier 5.
6. The campaign contains eight required minigames and ends only after all eight are completed on level 8.
7. Levels 1–4 offer four stable random objectives; levels 5–8 offer five through eight and require exactly the level number.
8. Zapper uses fill, slide, catch, and handoff timing in an alien nanotech laboratory.
9. Casino Heist requires a persistent Getaway Car obtained as rare loot or for exactly `$100`, starts unarmed, uses finite-ammo road pickups, and pays `$1000` on success.
10. Carried and equipped maze items provide small passive, non-consuming minigame bonuses.

These choices are normative for implementation.
