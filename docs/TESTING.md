# Testing

```bash
npm run check                               # format, lint, typecheck, build
npm run test:e2e                            # every end-to-end test
npx playwright test tests/legal.spec.ts     # one file
npx playwright test -g "age"                # tests whose name matches
npx playwright show-trace test-results/…/trace.zip   # step through a failure
```

## What's covered

62 Playwright tests in 18 files run real browsers against the real stack (Worker, Durable Objects, local D1). Calls use Chromium's fake camera and microphone, so WebRTC is tested end to end between two browsers.

| Area                                          | Files                                         |
| --------------------------------------------- | --------------------------------------------- |
| Chat basics, groups, requests, blocking       | `chat.spec.ts`, `extras.spec.ts`              |
| Calls, devices, screen share                  | `calls.spec.ts`, `audio-secret.spec.ts`       |
| Secret chats (E2EE)                           | `audio-secret.spec.ts`, `chat.spec.ts`        |
| Admin and owner powers, authorization         | `owner.spec.ts`                               |
| Age gate, terms, consent, export, legal pages | `legal.spec.ts`                               |
| Accessibility (axe, WCAG 2.2 AA)              | `a11y.spec.ts`                                |
| Games, chat themes, rail and tab bar          | `together.spec.ts`, `themes-teamplay.spec.ts` |
| Offline mode, auto-update (production build)  | `offline.spec.ts`, `update.spec.ts`           |
| Stories, stickers, Simple mode, AI, Chill     | the matching files                            |

Game rules are also checked by running `shared/games.ts` directly in Node during development.

## Notes

- Tests share one local database and run one at a time (`workers: 1`). Don't run two suites at once.
- `chill.spec.ts`, `fun.spec.ts` and `ai.spec.ts` call real outside services (Radio Browser, Apple, YouTube, Workers AI) and can fail when those are down.
- New accounts in tests go through `signUp()` in `tests/helpers.ts`, which fills in the birth date and accepts the terms.

## Not covered yet

- Firefox and WebKit projects (the Playwright config only runs Chromium; calls rely on Chromium's fake devices).
- Unit tests for `shared/` and `worker/` logic outside a browser.
- Visual regression screenshots.
