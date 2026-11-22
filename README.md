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
2. [The challenge](#the-challenge)
3. [My approach](#my-approach)
4. [How the bot works](#how-the-bot-works)
5. [What worked](#what-worked)
6. [What failed](#what-failed)
7. [What I learned](#what-i-learned)
8. [Project layout](#project-layout)
9. [Running it](#running-it)
10. [Testing and tools](#testing-and-tools)
11. [Third-party files](#third-party-files)
12. [License](#license)
13. [Built by](#built-by)

## Status

Final, November 2026. The event is over. `main` is the build that earned my best score with this bot, 4.98, and the experiments that scored lower are kept in the code as switches that are off by default.

| | |
|---|---|
| Event | Builders Buildathon 2026, Mech Royale track |
| Team | Neural Forge |
| Field | 418 teams |
| Best score with this bot | 4.98 placement points per match on the practice board |
| Outcome | Did not reach the 32-team final |
| Code | About 2,900 lines of TypeScript, 65 unit tests |

## The challenge

Mech Royale is a 16-mech battle royale on a 3D map with buildings, roofs and a shrinking safe zone. Each team submits a container. The organisers run it in a sandbox with one CPU, 512 MB of memory and no network, and talk to it over the `mechfight/1` JSON-lines protocol:

1. A `hello` message with the map and the match settings.
2. An observation every tick: the bot's own state, the mechs it can see, shots, beams, sounds, pickups and the zone.
3. One action back per tick: move, aim, fire, jump, boost, pick up, choose an upgrade.

The task comes with four hard parts:

- **A deadline.** Each answer is due within 50 ms. A late answer is a lost tick.
- **Partial information.** A mech only sees what is in its line of sight.
- **A closing zone.** The safe circle shrinks, and standing outside it drains health faster than most fights.
- **A placement score.** A match scores `16 − place`, so every mech that dies before you is a point. The board shows the mean over many matches.

Practice matches put one entry against 15 house bots. They share vision, hunt the weakest mech first, and never fight each other. The top 32 teams on the practice board go on to a free-for-all between team bots.

## My approach

I wrote the bot from scratch in TypeScript, with no runtime dependencies, around four ideas:

- **Build the world once.** Turn the height field into a walk grid at start-up, so path planning and line-of-sight checks are cheap enough to run many times per tick.
- **One movement decision per tick.** A fixed priority list picks a single movement intent. Aiming and firing are decided separately, so the bot keeps shooting while it moves.
- **Every behaviour behind a flag.** All thresholds live in [`src/config.ts`](src/config.ts). An experiment is a one-line change and can be switched off again without touching the logic.
- **Let the scoreboard decide.** Change one thing, submit it, read the score, keep it or revert it.

## How the bot works

```
observation ─► normalise ─► tracker ─► mode ─► movement intent ─► motion (A*) ─► action
                                          └──► aim and fire (decided separately) ──┘
```

- **Movement intents, first match wins.** In order: leave the zone, break line of sight, retreat, loot, evade, heal, fight, collect cubes, stalk, walk to the zone, wander.
- **Walk grid and A\*.** The 1 m height field becomes a 2 m grid with wall cells, clearance distances and connected components. Paths come from a capped A\* (8-connected, octile heuristic, extra cost for hugging walls). The motion layer re-plans periodically and recovers when the mech gets stuck.
- **Computed line of sight.** A ray is blocked when the surface rises above it anywhere along the segment. Targeting and cover search use the same check.
- **A tracker.** It remembers every mech's last position, velocity, health, weapons and charge state, the shots coming in, and who damaged whom.
- **Selective fights.** The bot engages mechs that are close, weak, closing, aiming at it or hitting it, and leaves the rest alone so its health can regenerate.
- **Stalking.** When it is idle and healthy, it walks to laser range of the nearest known enemy and picks a cell with sight of the target and as little exposure to everyone else as possible.
- **A mode detector.** It tells practice from free-for-all using observations only: deaths it cannot explain, health lost to other mechs, beams landing on third parties, and being shot in the first seconds.
- **A deadline guard.** Wall-clock time is read in one place. Past 30 ms the optional stages, such as cover searches, are skipped and the bot answers with what it has.
- **Input normalisation.** Every observation is cleaned first, so a missing or broken field falls back to the last good value and never costs a decision.

## What worked

| Change | Score |
|---|---|
| First complete bot with the mode detector | 4.48 |
| Selective engagement: fight only mechs that are close, weak or attacking | 4.58 |
| Stalking toward the nearest known enemy when idle and healthy | **4.98** |

Stalking was the biggest single gain, +0.40. Before it, the bot spent its quiet time idling. Points come from other mechs dying first, so time spent away from the fight earned nothing.

The engineering held up too. The bot never missed the 50 ms budget in the organisers' conformance check, and the robustness tests kept malformed observations from ever crashing a match.

## What failed

Each of these was built, tested, submitted and then switched off because it scored lower than the build before it.

| Experiment | Score | Against |
|---|---|---|
| Hold the rim of the next circle and stand still when idle | 4.19 | 4.58 |
| Pocket-edge hysteresis | 4.40 | 4.58 |
| Remember cubes out of view and fetch kill drops | 4.54 | 4.58 |
| Squad core bundle: farm crates and drones, armour-first upgrades, visible-only targets, head aim, laser-only boost, lose-rule retreat | 4.83 | 4.98 |
| Stalking with visible-only targets and head aim | 4.81 | 4.98 |
| Stalking with farming only | 4.92 | 4.98 |
| Squad core without the retreat rule | 4.94 | 4.98 |
| Faster tempo: engage from further away and sooner | 4.90 | 4.98 |

The pattern was the same each time. Anything that made the bot more careful, such as holding position, retreating or waiting for a clean shot, took it out of contact and cost points. After stalking, every variant landed between 4.81 and 4.98, which is inside the board's noise. I had reached a plateau that small changes could not break, and I ran out of time to find the structural change that would. 4.98 was not enough for the 32-team final.

The squad-core pieces are still in the code, each behind its own flag in `src/config.ts`, all off.

## What I learned

- **Passive play loses.** The score rewards outliving others, and house bots don't fight each other, so waiting scores nothing.
- **Changes under about 0.2 are noise.** Single-knob tuning can't be read on the board.
- **A bundle hides its parts.** Six features shipped together scored 4.83, and it took four more submissions to see which pieces hurt.
- **A local simulator is a guard, not a judge.** Mine replays recorded matches around the bot. It catches crashes, stalls and time-outs, and it can't predict a score, because nobody in a replay reacts.
- **Study the field early.** I spent the first day tuning my own bot and looked at how the leading teams played too late to change direction.

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
