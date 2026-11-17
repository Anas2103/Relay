# Deployment

Relay runs on Cloudflare's free plan at `https://relay-chat.bunbunchat.workers.dev`. Everything below is run by the owner from their own machine.

## Every release

```bash
npm run check                 # must pass
npm run test:e2e              # must pass
npx wrangler login            # once per machine
npm run db:migrate:remote     # FIRST: new columns/tables must exist before the new code runs
npm run deploy                # build + wrangler deploy
```

Migrations only add things, so applying them before the code deploys is safe: the old code ignores new columns.

Then open the site, sign in, send a message, and check the browser console for errors.

## Secrets (production)

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put YOUTUBE_API_KEY
```

See `.dev.vars.example` for what each one does. Never commit them.

## Rollback

```bash
npx wrangler deployments list           # find the previous version id
npx wrangler rollback <version-id>      # switch traffic back instantly
```

Rolling back code does **not** undo migrations. That's fine as long as migrations only add columns/tables (the rule in DATABASE.md).

## Backups and restore

D1 keeps **Time Travel**: point-in-time restore for the last 30 days on the free plan.

```bash
npx wrangler d1 time-travel info relay-chat-db                     # current bookmark
npx wrangler d1 time-travel restore relay-chat-db --timestamp=2026-11-17T10:00:00Z
```

An extra off-site copy (do this before every risky change, and keep it private: it contains everyone's data):

```bash
npx wrangler d1 export relay-chat-db --remote --output=relay-backup-YYYY-MM-DD.sql
```

Test a restore once on a throwaway database: `npx wrangler d1 create relay-restore-test`, then `npx wrangler d1 execute relay-restore-test --remote --file=relay-backup-….sql`, then delete it.

Media stored in Durable Objects is not part of D1 backups.

## Domain and email DNS

Relay uses the free `workers.dev` address and sends no email, so no DNS, SPF, DKIM or DMARC records are needed today. With a custom domain: add it in Workers → Settings → Domains, update `SITE` in `scripts/legal-pages.mjs`, the canonical/OG URLs in `index.html`, `public/robots.txt`, `public/sitemap.xml` and `public/.well-known/security.txt`.

## Monitoring

- Workers → relay-chat → **Logs** (observability is on in `wrangler.jsonc`): errors and the cron's "expired…" lines.
- Workers → **Metrics**: requests, errors, CPU time.
- An external uptime check (e.g. UptimeRobot, free) on the home page.
