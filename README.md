<h1 align="center">Henka</h1>

<h3 align="center">A battle-royale mech pilot in plain TypeScript.</h3>

<p align="center">
  An autonomous bot for the <strong>Mech Royale</strong> track of the <strong>Builders Buildathon 2026</strong>. It reads the arena, plans paths, picks fights, and answers every tick inside a <strong>50 ms budget</strong>, with <strong>no runtime dependencies</strong>.
</p>

<p align="center">
  <img alt="Language: TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6">
  <img alt="Runtime: Bun" src="https://img.shields.io/badge/runtime-Bun%201.4-f5b82e">
  <img alt="Tests: 65 passing" src="https://img.shields.io/badge/tests-65%20passing-22c55e">
  <img alt="Licence: all rights reserved" src="https://img.shields.io/badge/licence-all%20rights%20reserved-8b6cff">
</p>

I built Henka for the Builders Buildathon 2026 under the team name **Neural Forge**. Mech Royale drops 16 mechs into a shrinking arena. Each bot is a container that speaks the `mechfight/1` JSON-lines protocol on stdin and stdout: one `hello` with the map, then an observation every tick, and one action back before the deadline.

## Contents

1. [Status](#status)
2. [The game](#the-game)
3. [How it works](#how-it-works)
4. [What the scoreboard taught me](#what-the-scoreboard-taught-me)
5. [Project layout](#project-layout)
6. [Running it](#running-it)
7. [Testing and tools](#testing-and-tools)
8. [Third-party files](#third-party-files)
9. [License](#license)
10. [Built by](#built-by)

## Status

Final, November 2026. The event is over and the code is kept here as it was written during the weekend.

| | |
|---|---|
| Event | Builders Buildathon 2026, Mech Royale track |
| Team | Neural Forge |
| Field | 418 teams |
| Best practice-board score | 4.98 placement points per match |
| Code | About 2,900 lines of TypeScript, 65 unit tests |

## The game

A match scores `16 − place`, so every mech that dies before you is a point, and the board reports the mean over many matches. Practice matches put one entry against 15 house bots that share vision, hunt the weakest mech first, and never fight each other. The final rounds are a free-for-all between team bots.

Three constraints shaped the design:

- **A hard deadline.** A late answer is a lost tick, so every decision has to fit in 50 ms on one CPU.
- **Partial information.** A mech only sees what is in line of sight, plus sounds and beams.
- **A closing zone.** Standing in the wrong place costs more health than most fights.

## How it works

Each tick runs the same pipeline:

```
observation ─► normalise ─► tracker ─► mode ─► movement intent ─► motion (A*) ─► action
                                          └──► aim and fire (decided separately) ──┘
```

- **Movement is one intent per tick, first match wins.** The order is fixed: leave the zone, break line of sight, retreat, loot, evade, heal, fight, collect cubes, farm crates and drones, stalk, walk to the zone, stay. Aim and fire are decided on their own, so the bot keeps shooting while it loots, dodges or walks.
- **The world is built once.** The 1 m height field becomes a 2 m walk grid with wall cells, clearance distances and connected components. Paths come from a capped A* (8-connected, octile heuristic, extra cost for hugging walls), with periodic re-planning and stuck recovery in the motion layer.
- **Line of sight is computed, not guessed.** A ray is blocked when the surface rises above it anywhere along the segment. Targeting, cover search and head aim (used when the centre ray is blocked) all go through the same check.
- **A tracker remembers what the observation forgets.** It keeps every mech's last position, velocity, health, weapons and charge state, the shots coming in, and who damaged whom.
- **Fights are selective.** The bot engages mechs that are close, weak, closing, aiming at it or hitting it, and leaves the rest alone so its health can regenerate. When it is idle and healthy it stalks: it walks to laser range of the nearest known enemy, to a cell with sight of the target and as little exposure to everyone else as possible.
- **Dodging is weapon-aware.** Boost is saved for sidestepping a charging laser that is aimed at the bot. Bullets get a walking sidestep.
- **A lose rule ends bad fights.** Outnumbered and under a health threshold, the bot backs into cover while still firing, with hysteresis so it doesn't flicker.
- **A mode detector tells practice from free-for-all** using observations only: deaths it cannot explain, health lost to other mechs, beams landing on third parties, and being shot in the first seconds.
- **A deadline guard watches the clock.** Wall-clock time is read in one place. Past 30 ms the optional stages, such as cover searches, are skipped and the bot answers with what it has.
- **Malformed input never costs a decision.** Every observation is normalised first, so a missing or broken field falls back to the last good value.

Every threshold lives in [`src/config.ts`](src/config.ts), with one flag per behaviour. That made each scoreboard experiment a one-line change.

## What the scoreboard taught me

The practice board was the only measurement I trusted, so I changed one thing at a time and kept what it rewarded.

| Change | Result |
|---|---|
| Stalk toward the nearest known enemy when idle and healthy | 4.58 → 4.98, the best score |
| Hold the rim of the next circle and stand still | 4.19, reverted |
| Remember cubes out of view and fetch kill drops | 4.54, reverted |
| Pocket-edge hysteresis | 4.40, reverted |

The lessons I'd carry into the next one:

- **Passive play loses.** Points come from others dying first, and house bots don't fight each other. Waiting scores nothing.
- **Changes under about 0.2 are noise.** Single-knob tuning can't be read on the board.
- **A local simulator is a guard, not a judge.** Mine replays recorded matches around the bot. It catches crashes, stalls and time-outs well, and it can't predict a score, because nobody in a replay reacts.
- **Prove a switch fires before shipping it.** A feature that never triggers in a real match scores exactly the same as not having it.

## Project layout

```
src/
  main.ts            protocol loop
  brain.ts           decision loop: intent, aim, fire
  config.ts          every tunable threshold
  guard.ts           deadline guard
  motion.ts          path following, re-planning, stuck recovery
  state/             tracker (mechs, shots, damage) and mode detector
  tactics/           aim, dodge, loot, position, target, upgrades, zone
  world/             terrain, walk grid, A*, line of sight
test/                65 unit tests
tools/               replay, closed-loop simulator, benchmark
```

## Running it

The image runs the bot with Bun and has no runtime dependencies.

```sh
docker build --platform linux/amd64 -t henka .
```

To check it against the organisers' kit, run this from the kit folder (`mechfight-kit/`):

```sh
python3 check/check.py -- node --experimental-strip-types path/to/henka/src/main.ts

python3 check/check.py --map-dir /arena -- docker run --rm -i --network none --cpus 1 --memory 512m \
  --read-only --tmpfs /tmp:rw,size=64m --user 65534:65534 -v "$PWD/arena:/arena:ro" henka
```

## Testing and tools

The tests need Node 22 and a copy of the organisers' kit. Point `MECH_KIT` at it.

```sh
npm install
MECH_KIT=/path/to/mechfight-kit npm test
npm run typecheck
```

The tests cover geometry and line of sight, the walk grid and path planner, combat decisions, robustness against malformed observations, and a golden hash that pins the bot's actions over the kit's recorded stream.

| Tool | What it does |
|---|---|
| `tools/replay.ts` | Drives the bot in-process over a recorded stream and reports timing and stalls |
| `tools/sim.ts` | Closed-loop harness: the bot moves over the real map while everyone else replays a recorded match |
| `tools/bench.ts` | Times the world build and path queries |
| `tools/latch.ts` | Measures how quickly the mode detector recognises a free-for-all |

## Third-party files

- `src/mechfight.ts` is the organisers' TypeScript wrapper from the mechfight bot kit, used unchanged.
- The `Dockerfile` follows the kit's TypeScript image.
- `typescript`, `bun` and `@types/node` are development dependencies only and are not in the image.

## License

Copyright © 2026 Raunak Choudhary. All rights reserved. No licence is granted to use, copy, modify or distribute this code.

## Built by

**Raunak Choudhary**, for the Builders Buildathon 2026, team Neural Forge.
