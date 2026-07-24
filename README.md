# Maze

A playable TypeScript and Phaser checkpoint for a multi-genre game set inside a procedural maze overworld.

## Checkpoint status

The default game now includes a replayable, seeded campaign loop:

1. Explore a fresh Wilson-generated material maze with persistent loot, weapons, mining, traps, telegraphed monsters, recoverable defeat, pause, and autosave.
2. Find a stable, randomized objective roster drawn from eight required minigames. Levels 1–4 offer four games; levels 5, 6, 7, and 8 offer five, six, seven, and all eight respectively.
3. Find guaranteed Blackjack and Texas Hold’em tables on every level, wager persistent money against computer players, and spend monster rewards or winnings at shops that appear on some levels.
4. Route fixed-orientation pipe pieces ahead of advancing liquid, then pick a readable pin-tumbler lock.
5. Fly a continuous-motion horizontal assault with charge shots, bombs, add-ons, escalating formations, and the Corridor Warden boss.
6. Cross a seeded platformer assembled from reachable sections, collect every required power core, use temporary weapons, and survive enemies and material-driven surfaces.
7. Play Circuit Crush on a certified-solvable 8×8 board, using circuit specials and limited boosters to clear every short before moves run out.
8. Become Horsemaster by jumping a horse between exercise machines strapped to moving cars and reaching the Ultra Horse Gym.
9. Run Zapper's alien nanotech counter: fill slime-powered space blasters, slide them to waiting customers, and catch the completed guns before they fall.
10. Unlock Casino Heist by finding a rare Getaway Car in the maze or buying one from a shop for exactly `$100`, then survive an armed highway escape for a `$1000` payout.
11. Complete as many selected minigames as the level number: one on level 1 through all eight on level 8. Levels 1–7 award a persistent reward and generate the next maze. Completing all eight objectives on level 8 ends the campaign with a fanfare and dancing horse.

New campaigns use Web Crypto entropy. Named deterministic seed streams keep an unfinished level stable across refreshes while a new campaign rerolls its maze, objectives, optional services, loot features, monsters, traps, and encounters. While the overworld is active, a new money-bearing monster enters every deterministic 30–60 seconds, up to eight living monsters; the saved countdown resumes after refresh. Slot 1 uses the version-4 save format and migrates valid version-1, version-2, and version-3 saves without regenerating their current maze.

This is not the complete planned game. Distinct later acts, additional lock families, unique level content, final art/audio, settings, save-slot UI, and broader content remain to be built.

## Creative direction

New content should generally follow this mix:

- 30% non-sequitur humor
- 30% dark-future post-apocalypse
- 10% original pop-culture homage and memes
- 30% heart-warming retro-game nostalgia

This applies across the campaign, not to every scene. See [the content guide](docs/content-guide.md) for examples and reference rules.

## Run

### Prerequisites

- [Node.js](https://nodejs.org/) 22 LTS or newer
- npm (included with Node.js)

The same commands work from PowerShell, Command Prompt, Terminal, and other standard shells on Windows, macOS, and Linux. From the project root, install the locked dependencies and start the development server:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173/`. Phaser is the sole game runtime.

For a production build and local preview:

```sh
npm run build
npm run preview
```

The production files are written to `dist/`. Deploy that directory to any static web host; Node.js is required to install dependencies and build the project, but it is not required by browsers playing the deployed game.

## Controls

- Overworld: arrows/WASD or the D-pad move and bump-attack. `F`/Attack selects a ranged direction, `Q`/Use activates the first quick slot, `E` interacts or disarms, `I` opens the backpack, and `.` or Space waits.
- Pipe routing: tap/click a dry cell to place the next fixed-orientation piece. The liquid and its per-joint timer start together after the guide, with a slow eight-second Standard flow step. Replacing a dry piece is allowed but advances the liquid clock. When the route is ready, press **Finish Placing** or `F` to lock the layout and run the visible coolant at 4× speed. Arrows move the cursor and Enter/Space places.
- Lock: follow the numbered gold `NEXT` marker, keep tension inside its shown feedback band, and lift each distinct pin seam to gold. The next binding pin is selected automatically; when all pins are cyan, tap `TURN NOW`.
- Space: at an available Spaceship landmark, fly the mission or pay `$100` to clear the objective. During the mission, arrows/WASD or drag movement is continuous. Hold and release primary fire for charged shots; `B` or the alternate touch button spends a bomb. Fire is always manual. A visible bar counts down from 5:00 on level tier 0, gains 30 seconds per tier up to 7:30, and turns urgent for the final 30 seconds. The introductory Warden has 46 total component health; its health rises gradually with the same tier progression. A critical one-HP core remains exposed for the finishing shot, and destroying it on the exact zero frame still wins. If time expires first, the result explicitly reports that the Warden escaped in a bounded two-line card. A result card ignores Space/fire input and closes only with a deliberate Enter, Escape, or button choice.
- Platformer: arrows/A/D move, Up/W/Space jumps, and `F` fires a collected weapon. Two-thumb touch controls support movement, jump, and fire.
- Circuit Crush: tap two neighboring chips, or move with arrows/WASD and press Enter/Space, to swap. Clear all red short-circuit overlays within 18 moves. `1` Overclocks, `2` traces a recommended move, `3` arms a targeted pulse, and `4` reroutes the board. Every failed or abandoned retry receives a new certified board.
- Horsemaster: Up/W/Space or the large touch button jumps toward the next road lane; Left/Right aligns the horse with a moving exercise machine. Wide green machines are forgiving, while narrow red machines are faster. Three recoverable road impacts are available before the attempt ends.
- Zapper: use Up/Down or the lane buttons, hold `F`/Fill to load a blaster with slime, then press Enter/Space/`E` or Slide to send it to the waiting alien. Move into the same lane to catch the completed returning gun, then press the action again to hand it over. Complete the tier-scaled shift quota before three mistakes end the shift.
- Casino Heist: first acquire the Getaway Car as rare maze loot or buy it for exactly `$100`. Steer continuously with arrows/A/D or touch, dodge obstacles, spiked luxury cars, and their forward-firing guns, and use Fire only after collecting a road weapon. The car starts unarmed, ammunition is finite, and additional road pickups keep the escape armed. Survive to the casino exit to steal `$1000`.
- Blackjack: choose an even wager and Deal, then use Hit, Stand, or Double. Keyboard shortcuts are Enter, `H`, `S`, and `D`; every control is also tappable.
- Texas Hold’em: choose an ante and Deal, then Fold, Check/Call, Bet, or Raise through preflop, flop, turn, and river. The computer acts automatically, and another hand can be dealt immediately.
- Shop: stand on a `$` marker and interact to buy consumables, upgraded weapons, permanent upgrades, or the `$100` Getaway Car. Use Left/Right or Page Up/Page Down to change pages and `1`–`4` to buy by keyboard. Shops normally appear on a deterministic 60% of generated levels; a level that selects a still-locked Casino Heist guarantees access to a shop so the campaign cannot deadlock.
- Escape or the HUD menu pauses where appropriate. Encounter close buttons abandon with a recoverable consequence.
- Restart Game clears checkpoint slot 1 and starts a fresh campaign.

## Maze-item minigame bonuses

Useful maze loot now follows the player into minigames as a visible passive bonus; starting or retrying a game never consumes the item. Multitools and Mining Picks slow Pipe pressure, Lanterns and Compasses assist Lock, Shields and Bombs reinforce Space, Shields and Ammo Bundles help Platformer, Compasses and Multitools add Circuit boosters, Map Scrolls add a Horsemaster recovery, Multitools and Lanterns help Zapper, and Shields and Compasses reinforce Casino Heist.

## Project layout

- `src/domain/`: framework-independent campaign, maze, movement, item, monster, and random-seed rules.
- `src/encounters/`: validated encounter contracts and atomic result application.
- `src/minigames/`: pure models and Phaser scenes for Pipe, Lock, Space, Platformer, Circuit Crush, Horsemaster, Zapper, Casino Heist, Blackjack, and Texas Hold’em play.
- `src/scenes/`: the Phaser overworld projection and encounter orchestration.
- `src/save/`: versioned runtime validation and three-slot local save repository.
- `tests/unit/`: deterministic domain and minigame tests.
- `tests/e2e/`: desktop and mobile Playwright campaign flows.

## Wall materials

`MATERIALS` in `src/domain/materials/materials.ts` is the typed wall-material registry. Each entry has a stable ID, display name, color, tags, and optional mining hardness. The generated maze assigns all 24 materials to clustered wall regions.

Gameplay should query materials through `getWallMaterial()` or `getAdjacentWallMaterials()`. Compare IDs, tags, or hardness rather than rendered colors. To add a material:

1. Add one entry to `MATERIALS`.
2. Give it a distinct color and reusable gameplay tags.
3. Add `hardness` only when the material is intended to be mineable.

The clustered assignment reads `MATERIAL_IDS` automatically, so no generator change is needed.

## Sprite sheets

| Catalog | File | Active examples |
| --- | --- | --- |
| Items | `assets/item-sprites.png` | Recovery, tools, weapons, utilities, mystery orb |
| Monsters | `assets/monster-sprites.png` | Slime, hound, bat, sentry, mimic, golem |
| Objectives | `assets/objective-sprites.png` | Pipe, chest, spaceship, elevator, circuit chip, horse car, slime blaster, getaway car |
| Space | `assets/space-sprites.png` + `.json` | Player, five enemy families, modules, projectiles, Corridor Warden |

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
 6 lightning-ward    16 coin              26 bomb             36 shield          46 getaway-car
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

```sh
npm run assets:generate
```

## Extending items and monsters

Items are declared in `ITEM_DEFINITIONS` and monsters in `MONSTER_DEFINITIONS`. These registries own stable IDs, labels, sprite frames, categories or behavior families, and base statistics. Persistent state is represented by `ItemInstance` and `MonsterState`; turn behavior is resolved by the pure overworld reducer.

When adding content:

1. Add the stable type ID and definition to the appropriate registry.
2. Map its semantic sprite ID to an atlas frame.
3. Add generation compatibility and budget rules.
4. Implement its reducer behavior and deterministic tests.
5. Extend version-4 save validation for any new persisted fields or invariants.

Rendering must remain a projection of model state. Do not put combat, pickup, movement, or completion decisions in Phaser callbacks.

## Validation

Run the normal checkpoint gate:

```sh
npm run check
```

Run the complete desktop/mobile acceptance gate:

```sh
npx playwright install chromium
npm run check:all
```

`npm run check` covers strict TypeScript, deterministic unit tests, and a production Vite build. `npm run test:e2e` covers launch, nonblank WebGL rendering, keyboard/touch movement, pause, save/reload, success/failure/retry behavior, all eight required minigames, both optional card games, the economy loop, and the level-eight victory on desktop and mobile viewports.
