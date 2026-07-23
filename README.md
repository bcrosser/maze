# Maze

A playable TypeScript and Phaser checkpoint for a multi-genre game set inside a procedural maze overworld.

## Checkpoint status

The default game currently includes one integrated level loop:

1. Explore a seeded material maze with collectible items, mining, moving monsters, pursuit, combat, pause, and autosave.
2. Restore coolant routing in a Pipe Dream-style puzzle. Success powers a physical shortcut in the same maze.
3. Enter that shortcut and pick the archive lock. Success grants persistent mining power, charges, and flight intelligence.
4. Use the archive uplink to play a lane shoot-em-up. Pipe power becomes shields and lock intelligence shortens the hostile wave requirement.
5. Return to the repaired elevator for a side-scrolling platformer. Earlier results add bridges, a checkpoint, and a powered lift to its authored level.
6. When the HUD changes from `Exit Locked 0/4` to `Exit Ready 4/4`, reach the red marker to generate the next larger maze. Higher levels repeat the same integrated sequence so the game can continue indefinitely while more content is developed.

Successes, failures, and abandoned encounters commit typed campaign consequences. Slot 1 autosaves to local storage and restores the maze, player position, items, monsters, upgrades, world systems, encounter history, and altered routes after refresh.

This is not the complete planned game. Distinct later acts, additional lock families, unique level content, final art/audio, settings, save-slot UI, and broader content remain to be built.

## Creative direction

New content should generally follow this mix:

- 30% non-sequitur humor
- 30% dark-future post-apocalypse
- 10% original pop-culture homage and memes
- 30% heart-warming retro-game nostalgia

This applies across the campaign, not to every scene. See [the content guide](docs/content-guide.md) for examples and reference rules.

## Run

Requirements: Node.js 22 or newer and npm.

```powershell
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173/`. The Phaser campaign is the default. The original single-file game remains temporarily available at `http://localhost:5173/?runtime=legacy` as a parity reference.

For a production build:

```powershell
npm run build
npm run preview
```

## Controls

- Overworld: arrows or WASD; phones display a directional pad.
- Pipe routing: click/tap a tile to rotate it; arrows select and Enter/Space rotates.
- Lock: select tension and probe pins by click/tap; arrows select pins, Q/E adjusts tension, and Enter/Space probes.
- Shooter: arrows or A/D change lanes; Space/Enter or the fire control shoots. Archive intelligence enables auto-fire.
- Platformer: arrows or A/D move; Up/W/Space jumps. Touch controls appear on the canvas.
- Escape or the HUD menu pauses where appropriate. Encounter close buttons abandon with a recoverable consequence.
- Restart Game clears checkpoint slot 1 and starts a fresh campaign.

## Project layout

- `src/domain/`: framework-independent campaign, maze, movement, item, monster, and random-seed rules.
- `src/encounters/`: validated encounter contracts and atomic result application.
- `src/minigames/`: pure models and Phaser scenes for Pipe, lock, shooter, and platformer play.
- `src/scenes/`: the Phaser overworld projection and encounter orchestration.
- `src/save/`: versioned runtime validation and three-slot local save repository.
- `tests/unit/`: deterministic domain and minigame tests.
- `tests/e2e/`: desktop and mobile Playwright campaign flows.

## Wall materials

`MATERIALS` in `src/domain/materials/materials.ts` is the typed wall-material registry. Each entry has a stable ID, display name, color, tags, and optional mining hardness. The generated maze assigns all 24 materials to clustered wall regions. The inline legacy runtime retains a mirrored registry until it is retired.

Gameplay should query materials through `getWallMaterial()` or `getAdjacentWallMaterials()`. Compare IDs, tags, or hardness rather than rendered colors. To add a material:

1. Add one entry to `MATERIALS`.
2. Give it a distinct color and reusable gameplay tags.
3. Add `hardness` only when the material is intended to be mineable.

The clustered assignment reads `MATERIAL_IDS` automatically, so no generator change is needed.

## Sprite sheets

| Catalog | File | Active examples |
| --- | --- | --- |
| Items | `assets/item-sprites.png` | Health potion, mining pick |
| Monsters | `assets/monster-sprites.png` | Moss slime, ember hound |

Both sheets are transparent 320x160 PNGs containing a 10x5 grid of 32x32 frames. Frame indices run left-to-right and top-to-bottom from 0 through 49. For index `i`:

```text
sourceX = (i % 10) * 32
sourceY = floor(i / 10) * 32
```

Keep artwork inside its frame with transparent padding and do not add grid lines. Runtime type definitions use semantic `spriteId` values; only `ITEM_SPRITES` and `MONSTER_SPRITES` map those IDs to numeric indices.

### Item slots

```text
 0 health-potion     10 gold-key          20 emerald          30 axe             40 ring
 1 mining-pick       11 crystal-key       21 bread            31 sword           41 amulet
 2 mana-potion       12 compass           22 apple            32 dagger          42 crown
 3 antidote          13 map-scroll        23 mushroom         33 spear           43 hourglass
 4 fire-ward         14 spell-scroll      24 meat             34 bow             44 mirror
 5 ice-ward          15 tome              25 water-flask      35 arrow-bundle    45 feather
 6 lightning-ward    16 coin              26 bomb             36 shield          46 bone
 7 torch             17 diamond           27 snare            37 helmet          47 seed
 8 lantern           18 ruby              28 rope             38 boots           48 gear
 9 iron-key          19 sapphire          29 shovel           39 gloves          49 mystery-orb
```

### Monster slots

```text
 0 moss-slime        10 sporeling         20 lizard-warrior   30 centipede       40 warlock
 1 ember-hound       11 frost-wraith      21 horned-brute     31 jelly-cube      41 necromancer
 2 stone-golem       12 storm-wisp        22 cyclops          32 cave-blob       42 vampire
 3 vine-crawler      13 water-elemental   23 minotaur         33 fire-elemental  43 werewolf
 4 skeleton          14 earth-elemental   24 harpy            34 lava-serpent    44 zombie
 5 specter           15 shadow-stalker    25 gargoyle         35 ice-golem       45 mummy
 6 cave-bat          16 crystal-beetle    26 mimic            36 bone-knight     46 ember-imp
 7 giant-spider      17 iron-beetle       27 floating-eye     37 dark-knight     47 dragon-hatchling
 8 tunnel-rat        18 scarab            28 tunnel-worm      38 masked-acolyte  48 hydra-head
 9 viper             19 cave-raider       29 scorpion         39 witch           49 maze-guardian
```

The PNGs are generated from the named drawing entries in `scripts/generate-sprites.mjs`. Regeneration requires Node.js and ImageMagick's `magick` executable, but neither is required to play:

```powershell
node .\scripts\generate-sprites.mjs
```

## Item strategies

An item type in `ITEM_TYPES` owns presentation metadata: label, `spriteId`, fallback color, and `strategyId`. Its behavior lives separately in `ITEM_STRATEGIES` and implements:

```javascript
onPickup(context) {
	// Apply an effect through context, then return true to consume the item.
	return true;
}
```

To activate another item sprite:

1. Add a strategy to `ITEM_STRATEGIES` or choose a reusable existing strategy.
2. Add a type to `ITEM_TYPES` using one of the documented `spriteId` values.
3. Generated items receive that type and are passed through `attachItemStrategy()` automatically.

The health potion demonstrates capped stat restoration. The mining pick demonstrates a persistent player upgrade and interaction with mineral material tags and hardness.

## Monster strategies

A monster type in `MONSTER_TYPES` owns presentation and timing metadata. Its `strategyId` resolves through `MONSTER_STRATEGIES`, whose contract is:

```javascript
update(context) {
	// Choose movement or another timed action.
}

onContact(context) {
	// Attack or apply another contact effect.
}
```

To activate another monster sprite:

1. Add or reuse a strategy in `MONSTER_STRATEGIES`.
2. Add a type to `MONSTER_TYPES` with a `spriteId`, movement delay, and attack cooldown.
3. Generated monsters receive the shared strategy through `attachMonsterStrategy()`.

The moss slime demonstrates random legal movement. The ember hound demonstrates breadth-first pursuit and a contact attack that gains damage beside walls tagged `hot`.

Strategy registry objects are shared and should remain stateless. Put mutable timers, counters, targets, or phases on the generated entity. Strategies should use their supplied context helpers and must not depend on canvas rendering or sprite indices.

## Validation

Run the normal checkpoint gate:

```powershell
npm run check
```

Run the complete desktop/mobile acceptance gate:

```powershell
npx playwright install chromium
npm run check:all
```

`npm run check` covers strict TypeScript, deterministic unit tests, the original runtime parity suite, and a production Vite build. `npm run test:e2e` covers default launch, nonblank WebGL rendering, keyboard/touch movement, pause, save/reload, success/failure/retry behavior, all four genres, and the complete Act I chain on desktop and mobile viewports.
