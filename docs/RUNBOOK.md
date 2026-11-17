# Runbook

## The site is down or erroring

1. Open the site in a private window. Check https://www.cloudflarestatus.com.
2. Cloudflare dashboard → Workers → relay-chat → **Logs**: look for repeated errors.
3. If the last deploy caused it: `npx wrangler deployments list`, then `npx wrangler rollback <previous-id>`.
4. If a migration caused it, fix forward with a new migration; restore data only if it was lost (DEPLOYMENT.md → Backups).
5. To keep people out while fixing: Admin panel → Site → Maintenance mode.

## Someone reports abuse

1. Admin panel → Reports: read the copied text and context.
2. Act: remove the content, restrict (read-only), suspend for a set time with a reason, or delete the account. Everything is logged.
3. Illegal content involving minors: preserve what you need, suspend the account and report to the authorities (in Morocco: the DGSN cybercrime unit; internationally: NCMEC / INHOPE hotlines). Don't share the content further.
4. Reply to the reporter if they asked.

## A data breach

1. Contain it: rotate secrets (`wrangler secret put …`), sign everyone out (Owner tools → Sign everyone out), turn on maintenance mode if needed.
2. Work out what data and which accounts were affected (Logs, audit log).
3. Notify the CNDP (Morocco) without undue delay, and, if EU residents are affected, the relevant authority within 72 hours. Tell the affected people what happened and what to do (e.g. change passwords).
4. Write down what happened and what changed so it can't happen again.

## A secret leaked (key pushed to Git, pasted somewhere)

1. Revoke it at the source (Cloudflare TURN key, YouTube API key in Google Cloud, new VAPID pair).
2. Set the new value: `npx wrangler secret put NAME`.
3. If it's in Git history, removing it needs a history rewrite (`git filter-repo`) and a force push. Revoking the key matters more than removing it.

## Someone under 16 has an account

Delete the account (Admin panel → user → Delete). That removes their profile, sessions, 1:1 chats and messages.

## Someone asks for their data or its deletion

Point them to Settings → Your data (Export / Delete account). If they can't sign in, verify it's really them (e.g. through a friend who knows them in the app) before an admin acts.
