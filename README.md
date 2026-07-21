# Maze

A dependency-free canvas maze with material walls, collectible item strategies, moving monster strategies, and 50-frame pixel-art sprite sheets.

## Run

Open `index.html` directly in a browser. No build or local server is required.

- Move with the arrow keys or WASD.
- Reach the red marker to advance.
- Health and mining upgrades persist when advancing to a new level.
- Death regenerates the current level and resets the player to baseline stats.

## Wall materials

`MATERIALS` in `index.html` is the wall-material registry. Each entry has a stable ID, display name, color, tags, and optional mining hardness. The generated maze assigns all 24 materials to clustered wall regions.

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

Run the dependency-free smoke test after changing materials, catalogs, types, or strategies:

```powershell
node .\scripts\smoke-test.mjs
```

It executes the inline game with lightweight browser stubs and checks sprite loading/drawing, catalog order, all 24 material regions, non-overlapping entity placement, strategy attachment, healing, mining, hot-wall attack damage, level progression, and death reset.
