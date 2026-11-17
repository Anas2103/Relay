# Contributing

Thanks for helping! Relay is a personal project, so open an issue to discuss bigger changes before writing code.

## Setup

See [docs/SETUP.md](docs/SETUP.md).

## Branches

`main` is what's deployed. Work on a branch named after the change: `feat/chat-folders`, `fix/call-reconnect`, `docs/api`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `perf:`, `docs:`, `test:`, `style:`, `chore:`, `ci:`. One focused change per commit, written in the imperative ("add", not "added").

## Code style

- Prettier formats everything (`npm run format`); oxlint must report nothing (`npm run lint`).
- TypeScript strict mode. Rules both sides need go in `shared/`, and the server always enforces them.
- Comments explain _why_, not _what_.
- Every schema change is a new numbered file in `migrations/` that only adds things.
- User-facing text: short, plain, sentence case, and helpful when something fails.

## Pull request checklist

- [ ] `npm run check` passes
- [ ] `npm run test:e2e` passes, and new behaviour has a test
- [ ] Works on a phone-sized screen and in dark mode
- [ ] Keyboard and screen-reader friendly (see docs/ACCESSIBILITY.md)
- [ ] New personal data? Update docs/PRIVACY_DATA_MAP.md and the Privacy Policy (`scripts/legal-pages.mjs`)
- [ ] Docs and CHANGELOG updated
