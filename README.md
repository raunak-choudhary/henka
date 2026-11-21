# henka

A TypeScript bot for the Mech Royale track of the Builders Buildathon 2026: a 16-mech battle royale where each bot speaks the `mechfight/1` JSON-lines protocol on stdin and stdout.

Entry for the Builders Buildathon 2026 (Mech Royale track), team Neural Forge.

## Build and run

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
