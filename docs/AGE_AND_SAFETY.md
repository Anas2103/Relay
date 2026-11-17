# Age restrictions and user safety

What Relay enforces, where in the code, and why.

## Minimum age: 16

`MIN_AGE` in [`shared/legal.ts`](../shared/legal.ts). Why 16:

- Relay lets people message, call and share media with each other, including people they found by username.
- 16 is the highest "age of digital consent" in the EU (GDPR art. 8). Below it, many countries require verified parental consent; under 13, US COPPA rules apply. Supporting those would need a parental-consent flow and extra protections for minors.
- Morocco's Law 09-08 has no specific digital-consent age, so the EU rule is the strictest one Relay is likely to meet.

To change it, edit `MIN_AGE` in `shared/legal.ts` (used by the server and the app) **and** the copy at the top of `scripts/legal-pages.mjs`, then run `npm run legal:build`.

## How the age gate works

1. The sign-up form asks for a **date of birth** (a date field with no default value and no hint of the "right" answer), plus an **unticked** "I agree to the Terms and Privacy Policy" box.
2. The **server** checks it (`register` in [`worker/index.ts`](../worker/index.ts), using `parseBirthDate` and `ageOn`): impossible dates (2001-02-30), future dates and dates before 1900 are refused.
3. Under 16: the request is refused, **nothing is stored**, and the response sets a short-lived cookie, `relay_age_block` (24 hours, HttpOnly, contains only `1`). While it's present, sign-up refuses any date, so the person can't simply try an older date straight away.
4. 16 or over: the account is created with `birth_date`, `terms_version` and `terms_accepted_at`.

**Why store the full birth date** and not just "over 16 on date X": if 18+ features are ever added, the date lets the server tell when someone turns 18 without asking again. It's never shown to anyone, and it's included in the user's data export.

**Limits:** a self-declared birth date can be lied about. That is the normal standard for a general-audience chat app. Stronger checks (ID scans, facial age estimation through providers such as Yoti, Persona or Stripe Identity) are only needed for 18+ content or where a law requires them, neither of which applies today. They would also mean sending identity documents to a third party.

## Accounts created before the age gate

`me.needsConsent` / `me.needsBirthDate` (from `loadMe` in [`worker/auth.ts`](../worker/auth.ts)). The app shows [`ConsentScreen`](../src/components/ConsentScreen.tsx) instead of the chats until the person accepts the current terms (and gives a birth date if the account has none). `POST /api/account/consent` ([`worker/consent.ts`](../worker/consent.ts)) checks the age again. An existing account that turns out to be under 16 is **not deleted automatically**: it stays behind that screen until the owner reviews it.

## When the terms change

Bump `TERMS_VERSION` in `shared/legal.ts`. Everyone whose stored version differs sees the consent screen on their next visit.

## Safety tools (already in Relay)

| Tool                                                                                       | Where                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Friend requests: strangers can't message you until you accept                              | `worker/rooms.ts`, `status = 'pending'`                           |
| Block: blocks messages, typing, calls, uploads, presence, search and new chats             | `worker/rooms.ts` (`roomHasBlock`), `worker/users.ts`             |
| Report a message or a person (the reported text is copied, so deleting it doesn't hide it) | `worker/moderation.ts`, `ReportDialog`                            |
| Admin reports queue: resolve, dismiss, suspend                                             | Admin panel → Reports                                             |
| Restrict (read-only), timed suspension with a reason, delete                               | `worker/policy.ts`, `worker/owner.ts`                             |
| Group admins: remove, ban, slow mode, announcement mode                                    | `worker/features.ts`, `worker/moderation.ts`                      |
| Owner switches to turn features off for everyone                                           | Admin panel → Site                                                |
| Audit log of every admin action                                                            | `admin_audit` table                                               |
| Rate limits on sign-up, sign-in, 2FA, messages, uploads, reports, exports, game moves      | `rateLimit` in `worker/auth.ts`, token bucket in `worker/room.ts` |
| Appeals                                                                                    | Contact link in the Terms and Community Guidelines                |

## Account controls

Edit profile, change password, devices list with sign-out, 2FA, passcode lock, notification and privacy settings, **Export** (JSON: profile, settings, devices, blocks, stories, messages) and **Delete account** (immediate and permanent: profile, sessions, 1:1 chats and your messages). All under Settings.

## Not built (and why)

- **Parental consent:** not needed while the minimum age is 16.
- **Automated content filtering / image moderation:** would need an external moderation API. Moderation is by reports and admins.
- **Email/phone verification:** Relay doesn't collect either (data minimisation).
