# Maze

Escape the maze by playing minigames.

Maze is a complete browser game written in TypeScript and Phaser. You explore a seeded maze of textured wall materials, hunt down the minigames buried inside
it, and play your way out. Clear the eighth level and the campaign ends the only way it reasonably could: a fanfare and a dancing horse.

## The Maze

Each maze level is 21×21 and each level it grows.

1. **Every level deals a random roster of objectives** from the eight required  minigames. Levels 1–4 offer four of them; levels 5, 6, 7, and 8 offer five, six, seven, and all eight.
2. **The exit unlocks once you finish as many objectives as the level number.** Level 1 asks for one of the four on offer. Level 8 asks for all eight.
3. **Levels 1–7 hand you a persistent reward** and generate the next maze. Finishing level 8 wins the game.

While you explore, a new monster enters the maze every 30–60 seconds, up to eight living monsters at once.  Losing all your health means you lose items and progress, not the game.

Every game generates a new seed that keeps all the randomly generated content the same until you restart the game.  The game seed controls the objectives, loot, gambling, monsters and traps.  The game is saved seamlessly when you move.

The first time you enter a maze, a short guided tour points out the movement pad, the objective and exit readouts, your health, the action buttons, and the
backpack. Skip it at any time; it is replayable from the **TUTORIAL** button in the maze legend.

## Controls

Every scene shares one on-screen control deck below the canvas: a drag-anywhere movement pad plus at most six labelled buttons. Each scene declares a control scheme in [`src/app/control-scheme.ts`](src/app/control-scheme.ts), so the buttons are relabelled per game and a game that needs two buttons shows two wide buttons rather than four dead ones.

Positional interactions stay inside the canvas: pipe cells, circuit chips, the lock pins and tension bar, the safe dial, the Space drag-to-fly area, and the
corner EXIT/HELP buttons.

In the maze, arrows/WASD or the pad move and bump-attack. `F`/Attack selects a ranged direction, `1`–`3` or the three quick-slot buttons use assigned items,
`E`/Interact interacts or disarms, `I`/Items opens the backpack, `H` or the HUD `?` opens the maze legend, `.` or Space waits, and the `↻` beside the Objective
readout tracks a different objective. Escape or the HUD menu pauses.  You can exit all the minigames and restart them before finishing them.

## The games

### The maze itself

The maze is generated using [Wilson's Algorithm](https://en.wikipedia.org/wiki/Maze_generation_algorithm#Wilson's_algorithm).  The maze uses 24 clustered wall materials, each with its own texture so a wall's make-up is readable without relying on colour. It holds persistent loot, weapons, visible mining charges, five kinds of traps, fourteen monster archetypes, autosave and minable walls.  Walking into a wall mines it if your pick is strong enough; walking into a monster attacks it.

### Pipe

Emergency coolant routing is a [Pipe Dream](https://en.wikipedia.org/wiki/Pipe_Mania) inspired minigame. Fixed-orientation pipe pieces arrive in a queue and you place them ahead of a creeping wall of liquid. The liquid and its per-joint timer start together after the guide, stepping every six to ten seconds depending on difficulty. Overwriting a dry piece is legal but shoves the liquid one step onward.

Boards run 5×5 to 6×6 with routes of 7 to 18 segments and one to seven obstacles. Press **Finish Placing** or `F` to lock the layout and run the visible coolant at 4× speed. Win by reaching the sink; lose to an empty cell, a mismatched joint, an obstacle, the board edge, or a pressure loop. 

Controls: tap a dry cell to place, or move the cursor with the arrows and place with Enter/Space.

### Lock — three different locks

The Lock objective is not one game. Which mechanism you get rotates with the level number, and **every retry rotates it again**, so a failed attempt always hands you a different lock rather than the one that just beat you.

- **Archive lock (pin tension).** Hold tension inside a moving feedback band while lifting the numbered gold `NEXT` pin to its seam, then release. The next binding
  pin is selected for you; when every pin is cyan, tap `TURN NOW`. Four to six pins and seven down to four integrity depending on difficulty. A jam costs
  integrity, raises the alarm, and on harder settings can drop the pin you just set. Controls: Set Pin, Ease, Grip, Turn.
- **Vault dial (safe cracking).** A 100-position dial and a stethoscope needle that rises as you close on the current gate. Feedback runs cold → faint → warm →
  hot. Set three or four gates in order, then pull the Handle. Gates sit at least twelve clicks apart, and a false gate costs focus and raises the alarm.
  Controls: Left/Right move one click, Up/Down move five, then Set Gate and Handle.
- **Relic tumblers (timing).** No stick at all. Tumblers bounce back and forth and latch strictly left to right; press Latch while the ring sits in its gold band,
  then Turn Cam. Four to six tumblers, each successive one faster than the last. A miss costs wear and can drop the previous latch.

All three fail the same two ways: run the mechanism's durability to zero, or let the alarm reach 100.

### Space

A continuous-motion horizontal assault through an orbital corridor inspired by [R-Type](https://en.wikipedia.org/wiki/R-Type), in four phases: approach, wreckage, elites, and the Corridor Warden boss. Hold and release primary fire for charged shots; `B` or the alternate touch button spends a bomb. Fire is always manual. Pickups add splitter cores, beam coils, companion drones, shield cells, and bomb refills, some of them unstable enough to offer a choice.

A visible bar counts down from 5:00 on the lowest level tier, gaining 30 seconds per tier up to 7:30, and turns urgent for the final 30 seconds. The Warden's two component nodes must break before its one-HP core is exposed for the finishing shot; destroying the core on the exact zero frame still wins. If time expires first, the result explicitly reports that the Warden escaped. A result card ignores fire input and closes only with a deliberate Enter, Escape, or button choice.

At a Spaceship landmark you can pay `$100` to clear the objective instead of flying it.

### Platformer

A descent through Sublevel 9, assembled from reachable sections inspired by [Super Mario Bros](https://en.wikipedia.org/wiki/Super_Mario_Bros.). Collect every required power core — three to five, scaling with level tier — and reach the goal; the exit reports itself locked while any core is missing.

Crumbling floors shake and shed dust before they fail, ice shows facets and icicles, and bounce plates show their springs. Conveyors, lifts, patrollers,
hoppers, turrets, drones, and sentries fill the rest. Every pickup carries a name tag. You get seven, five, or three deaths depending on difficulty.

Controls: arrows/A/D move, Up/W/Space jumps, Down/S drops through a raised platform, and `F` fires a collected weapon.

### Circuit Crash

A match-three on a certified-solvable 7×7 or 8×8 board of five chip colours inspired by [Candy Crush](https://en.wikipedia.org/wiki/Candy_Crush_Saga) Red short-circuit overlays ride their chips and are only repaired when the carrier chip is consumed, so clearing every short inside 18 moves is a routing problem rather than a shuffling one. Matches build row, column, burst, and colour specials, and the board auto-shuffles when no legal move remains.

Every failed or abandoned retry receives a newly certified board.

Controls: tap two neighbouring chips, or move with arrows/WASD and press Enter/Space. `1` Overclocks, `2` traces a recommended move, `3` arms a targeted pulse, and `4` reroutes the board.

### Horsemaster

A [Frogger](https://en.wikipedia.org/wiki/Frogger)-style crossing to the Ultra Horse Gym. Hop a horse through five lanes of bicycles on hoof, rest on the safe median, then ride the exercise machines bolted to passing traffic: green buses are slow and carry two machine slots, yellow cars carry one, and red cars are faster.

Down hops **back** a lane even mid-ride, so a machine heading for the screen edge is escapable — though the landing still has to find another machine or the median.
Riding off the edge, touching a bicycle, missing a machine, or picking the wrong building door each cost a heart. Finish through the marked GYM door before three
hearts are gone.

Controls: arrows/WASD or the pad and the HOP button.

### Zapper

A four-lane service shift countering alien nanotech inspired by [Tapper](https://en.wikipedia.org/wiki/Tapper_(video_game)) Hold `F`/Fill to load a space blaster with slime, then press Enter/Space/`E` or Slide to send it down the lane to a waiting customer. Blasters slide briskly and customers arrive close enough together that several lanes stay live at once. Move into the same lane to catch the completed gun coming back, then press the action again to hand it over.

Complete the tier-scaled shift quota before three mistakes — a missed outgoing blaster, a missed return, or an alien reaching the counter — end the shift.

Controls: Up/Down or the pad to change lane, then Fill and Slide.

### Casino Heist

You robbed a casino and trying to escape in your souped up getaway car, inspired by [Spy Hunter](https://en.wikipedia.org/wiki/Spy_Hunter).  This game is only unlocked by finding a rare Getaway Car in the maze or buying one from a shop. You navigate your car in a six-lane road with turns and splits while avoiding traffic and enemy vehicles.

Traffic consists of cars, buses, trucks, motorcycles, all of which you must avoid, either by navigating around or shooting with your guns.  Anytime a car is destroyed it spins off the road.  Cop cars and SWAT vans ram you toward the edge of the road, and helicopters drop spike strips to stop you.

The car starts unarmed. Collect the pulse gun, ammunition, and the oil-slick, smoke-screen, and flamethrower devices on the road, or buy them as permanent car
modules at a maze shop. Reach the marked turn-off and drop into the storm drain to vanish with `$1000`; drive past it and the road runs out.

Controls: arrows/A/D steer, Up/Down close on traffic or hang back, `Q`/Deploy spends the armed device, and `E`/Switch arms the next one.

### Blackjack and Texas Hold'em

Both are optional service sites rather than objectives, and both are guaranteed on every level. You wager persistent money against computer players.

- **Blackjack**: choose an even wager and Deal, then Hit, Stand, or Double. A natural pays 2.5×. Keyboard shortcuts are Enter, `H`, `S`, and `D`.
- **Texas Hold'em**: choose an ante and Deal, then Fold, Check/Call, Bet, or Raise through preflop, flop, turn, and river. The computer acts automatically and   another hand can be dealt immediately.

### Shops and salvage

Shops appear on most levels and allow you to buy consumables, upgraded weapons, permanent
upgrades and sell salvage.  Items you can buy include things like: Expedition Packs, that widen the backpack, the getaway car, which unlocks the casino heist.  Prices rise 30% of base per level, and each Expedition Pack costs twice the last.

**SELL** opens the counter that buys salvage at `$2` each and buys carried loot; quick-slotted items are never sold out from under you. Salvage is scrap you strip
off gear you do not want, and it also pays for healing and tool recharges at sanctuaries. Your current salvage is listed in the Items menu alongside your money and free slots.

Use Left/Right or Page Up/Page Down to change shop pages and `1`–`4` to buy by keyboard.

## Maze-item minigame bonuses

Useful maze loot follows you into minigames as a visible passive bonus; starting or retrying a game never consumes the item. Multitools and Mining Picks slow Pipe
pressure, Lanterns and Compasses assist Lock, Shields and Bombs reinforce Space, Shields and Ammo Bundles help Platformer, Compasses and Multitools add Circuit
boosters, Map Scrolls add a Horsemaster recovery, Multitools and Lanterns help Zapper, and Shields and Compasses reinforce Casino Heist.

## Run

### Prerequisites

- [Node.js](https://nodejs.org/) 22 LTS or newer
- npm (included with Node.js)

The same commands work from PowerShell, Command Prompt, Terminal, and other standard shells on Windows, macOS, and Linux. From the project root, install the
locked dependencies and start the development server:

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

The production files are written to `dist/`. Deploy that directory to any static web host; Node.js is required to install dependencies and build the project, but
it is not required by browsers playing the deployed game.

### Deploy

`npm run deploy` builds the project and copies `dist/` to the local web root:

```sh
npm run deploy
```

The default destination is `E:\xampp\htdocs\rpg5`. Options (note the `--` separator required by npm):

| Option | Effect |
| --- | --- |
| `--target <dir>` | Copy somewhere else instead of the default destination. |
| `--ga <id>` | Build with the Google Analytics tag for that measurement id. |
| `--no-ga` | Build without analytics even when an id is configured. |
| `--clean` | Delete the destination contents before copying, removing stale builds. |
| `--skip-build` | Copy the existing `dist/` output without rebuilding. |

```sh
npm run deploy -- --ga G-XXXXXXXXXX --clean
```

### Google Analytics

The measurement id is never committed. Supply it in one of two ways:

- Pass `npm run deploy -- --ga G-XXXXXXXXXX` for a one-off deploy.
- Copy `.env.example` to `.env.local` and set `GA_MEASUREMENT_ID` (and optionally `DEPLOY_TARGET`). `.env.local` is git-ignored, so `npm run deploy`, `npm run build`, and `npm run dev` all pick the id up automatically.

When an id is present the standard `gtag.js` loader and `gtag('config', ...)` snippet are injected into `<head>` at build time. With no id, the markup is omitted entirely, so untagged builds stay the default for anyone cloning the repository. Ids are validated against `^[A-Za-z0-9_-]{4,64}$` before they reach the HTML.

## Project layout

- `src/app/`: the DOM shell, the shared control deck, the per-scene control schemes, and the first-run tour.
- `src/content/`: shared procedural art such as the horse drawn by both Horsemaster and the victory screen.
- `src/domain/`: framework-independent campaign, maze, movement, item, monster, weapon-stat, and random-seed rules.
- `src/encounters/`: validated encounter contracts and atomic result application.
- `src/minigames/`: pure models and Phaser scenes for Pipe, the three locks, Space, Platformer, Circuit Crash, Horsemaster, Zapper, Casino Heist, Blackjack, and Texas Hold'em.
- `src/scenes/`: the Phaser overworld projection and encounter orchestration.
- `src/save/`: versioned runtime validation and three-slot local save repository.
- `tests/unit/`: deterministic domain and minigame tests.
- `tests/e2e/`: desktop and mobile Playwright campaign flows.

## Wall materials

`MATERIALS` in [`src/domain/materials/materials.ts`](src/domain/materials/materials.ts) is the typed wall-material registry. Each entry has a stable ID, display name,
color, tags, and optional mining hardness. The generated maze assigns all 24 materials to clustered wall regions.

Gameplay should query materials through `getWallMaterial()`,`getAdjacentWallMaterials()`, `getMaterialHardness()`, or `canMineMaterial()`. Compare IDs, tags, or hardness rather than rendered colors. Each material's tags also drive its wall texture in the overworld. To add a material:

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

The item and monster sheets are transparent 320×160 PNGs containing a 10×5 grid of 32×32 frames. Frame indices run left-to-right and top-to-bottom from 0 through
49. For index `i`:

```text
sourceX = (i % 10) * 32
sourceY = floor(i / 10) * 32
```

The objective sheet follows the same frame convention with one frame per objective. The Space sheet is a JSON-described atlas rather than a fixed grid.

Keep artwork inside its frame with transparent padding and do not add grid lines. Runtime type definitions use semantic `spriteId` values; only `ITEM_SPRITES` and
`MONSTER_SPRITES` map those IDs to numeric indices.

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

The PNGs are generated from the named drawing entries in [`scripts/generate-sprites.mjs`](scripts/generate-sprites.mjs). Regeneration requires Node.js and ImageMagick's `magick` executable, but neither is required to play:

```sh
npm run assets:generate
```

## Extending items and monsters

Items are declared in `ITEM_DEFINITIONS` and monsters in `MONSTER_DEFINITIONS`. These registries own stable IDs, labels, sprite frames, categories or behavior
families, and base statistics. Persistent state is represented by `ItemInstance` and `MonsterState`; turn behavior is resolved by the pure overworld reducer.

When adding content:

1. Add the stable type ID and definition to the appropriate registry.
2. Map its semantic sprite ID to an atlas frame.
3. Add generation compatibility and budget rules.
4. Implement its reducer behavior and deterministic tests.
5. Extend save validation for any new persisted fields or invariants.

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

`npm run check` covers strict TypeScript, deterministic unit tests, and a production Vite build. `npm run test:e2e` covers launch, nonblank WebGL rendering, the first-run tour, keyboard/touch movement, pause, save/reload, success/failure/retry behavior, all eight required minigames, both optional card games, the economy loop, and the level-eight victory on desktop and mobile viewports.
