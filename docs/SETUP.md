# Setup: from a fresh machine to a running app

## 1. Install the tools

|             | Windows                            | macOS                    | Linux / NixOS                               |
| ----------- | ---------------------------------- | ------------------------ | ------------------------------------------- |
| Node.js 22+ | `winget install OpenJS.NodeJS.LTS` | `brew install node@22`   | distro package, or `nix-shell -p nodejs_22` |
| Git         | `winget install Git.Git`           | `xcode-select --install` | distro package                              |

## 2. Get the code and dependencies

```bash
git clone https://github.com/Anas2103/Relay.git
cd Relay
npm install
npx playwright install chromium     # browser for the tests
```

## 3. Optional secrets

```bash
cp .dev.vars.example .dev.vars      # then fill in only what you need
```

Every value is optional; without them, calls work on most networks, push notifications are off, and Chill → Shorts explains that it needs a key.

## 4. Database and dev server

```bash
npm run db:migrate:local
npm run dev                          # http://localhost:5173
```

Open two browser windows (one private) and sign up twice to chat with yourself. To make an account an admin or the owner locally:

```bash
npx wrangler d1 execute relay-chat-db --local --command "UPDATE users SET role='admin', super_admin=1 WHERE username='YOUR_NAME'"
```

## 5. Before you commit

```bash
npm run check       # format check, lint, typecheck, build
npm run test:e2e    # end-to-end tests (about 15 minutes)
npm run format      # fix formatting automatically
```

## Troubleshooting

| Problem                                       | Fix                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `no such table` / `no such column`            | `npm run db:migrate:local`                                                                                                |
| Port 5173 in use                              | Another dev server is running; stop it or use `npx vite --port 5174`                                                      |
| Sign-up says "Too many attempts" during tests | Tests reset limits; manually: `npx wrangler d1 execute relay-chat-db --local --command "DELETE FROM rate_limits"`         |
| Calls don't connect between two networks      | Set the TURN keys (see `.dev.vars.example`)                                                                               |
| Location sharing fails on the live site       | Check `Permissions-Policy` in `public/_headers` allows `geolocation=(self)`                                               |
| A test fails only in a long run               | Run that file alone with `npx playwright test tests/NAME.spec.ts`; some tests depend on outside services (radio, YouTube) |
