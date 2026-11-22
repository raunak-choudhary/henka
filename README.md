# henka

A TypeScript bot for the Mech Royale track of the Builders Buildathon 2026: a 16-mech battle royale where each bot speaks the `mechfight/1` JSON-lines protocol on stdin and stdout.

Entry for the Builders Buildathon 2026 (Mech Royale track), team Neural Forge.

## What is in this repository

| Branch | What it is | Best practice score |
| --- | --- | --- |
| `x/a2` | **Our final entry.** An unmodified import of Apex-Go v3 by ahmad-ovh (see Credits). | 6.52 |
| `giddy/peak` | Our C bot with the "peak-health" rule (below). | 5.82 |
| `giddy/hunt` | Our C bot with the weapon hunt. | 5.89 |
| `fork/automata` | A credited import of jason-scheffel/automata, tried before the final entry. | 6.06 |
| `main` | Our first bot, written in TypeScript. | — |

## How the final entry plays

The final entry is Apex-Go v3. We did not write it; this is our reading of why it scores well.

- **It hunts for the whole match.** A match scores one point for every mech that dies before you, and
  house bots do not fight each other, so points come from kills. The bot keeps closing on the nearest
  known enemy until late in the match and only then moves to a hiding stance.
- **It only believes it is in a free-for-all on weapon-beam evidence,** so a drone or zone death does
  not scare it into hiding early.
- **It stays out of lightning reach.** Lightning hits instantly inside about 45 m and chains, so the bot
  is pushed away from every visible enemy carrying it.
- **It punishes laser cooldown.** After an enemy laser fires, the bot treats that laser as offline for
  about two seconds and pushes in.
- **It reloads behind cover** and avoids exposing its rear to enemies.

## Our own work

Before using Apex-Go we built and tuned our own bot overnight:

- A **C port** of giddygiddyboy's MIT Go bot (`cbot/` on the `giddy/*` branches), with a free-for-all
  detector and practice/FFA profiles.
- **Weapon hunt** (`giddy/hunt`): about a third of our matches ended with the bot dying early holding
  only its starting gun, so it now explores for a second weapon, preferring a laser. Practice scores
  rose from about 5.35 to about 5.65 on average (best 5.89).
- **Peak-health play** (`giddy/peak`): retreat at 55% health, heal to 95%, take supply drops, and only
  start a fight at 90% health or more with a second weapon. One practice draw: 5.82.
- What did not work on the official board, despite gains in our local simulator: a tighter fight range
  with boost-strafing, removing the early "not practice" latch, and our own lightning avoidance. Our
  simulator mis-models how the house bots aim, so its gains did not transfer.

Our own bot did not reach the top-32 cut, so we entered the final with Apex-Go v3.

## Credits

- **Final entry (`x/a2`): Apex-Go v3 by ahmad-ovh**, https://github.com/ahmad-ovh/Buildathon at commit
  `56e0f76`, MIT licence. The code is unchanged and its LICENSE file is kept on that branch.
- `fork/automata`: jason-scheffel/automata, MIT licence, unchanged, LICENSE kept.
- `giddy/*`: a C port of giddygiddyboy's MIT-licensed Go bot; the weapon hunt builds on an idea from
  Bryantan65/mech-royale-bot (MIT).

## Build and run (`main`, the TypeScript bot)

The image runs the bot with Bun (`oven/bun:1.4.4-slim`); there are no runtime dependencies.

```sh
docker build --platform linux/amd64 -t henka .
```

Conformance check, from the organisers' kit folder (`mechfight-kit/`):

```sh
python3 check/check.py -- node --experimental-strip-types path/to/henka/src/main.ts
python3 check/check.py --map-dir /arena -- docker run --rm -i --network none --cpus 1 --memory 512m \
  --read-only --tmpfs /tmp:rw,size=64m --user 65534:65534 -v "$PWD/arena:/arena:ro" henka
```

Unit tests (Node 22): `npm test`.

## Third-party files

- `src/mechfight.ts` is the organisers' TypeScript wrapper from the mechfight bot kit, used unchanged.
- The Dockerfile is based on the kit's `ts/Dockerfile`.
- Dev dependencies only (not in the image): `typescript`, `bun`, `@types/node`, pinned in `package.json`.

## License

MIT, see `LICENSE`.
