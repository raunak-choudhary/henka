# henka

A TypeScript bot for the Mech Royale track of the Builders Buildathon 2026: a 16-mech battle royale where each bot speaks the `mechfight/1` JSON-lines protocol on stdin and stdout.

Entry for the Builders Buildathon 2026 (Mech Royale track), team Neural Forge.

## How the final entry plays

The final entry is Apex-Go v3. 

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


## Third-party files

- `src/mechfight.ts` is the organisers' TypeScript wrapper from the mechfight bot kit, used unchanged.
- The Dockerfile is based on the kit's `ts/Dockerfile`.
- Dev dependencies only (not in the image): `typescript`, `bun`, `@types/node`, pinned in `package.json`.

## License

MIT, see `LICENSE`.
