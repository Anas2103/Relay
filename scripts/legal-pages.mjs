/*
 * Builds Relay's legal and help pages into public/legal/*.html.
 *
 *   node scripts/legal-pages.mjs
 *
 * Each page is plain static HTML (fast, works without JavaScript, printable, indexable).
 * Edit the text here, then run the script. When the Terms or the Privacy Policy change
 * in a way people must agree to, also bump TERMS_VERSION in shared/legal.ts so everyone
 * is asked to accept them again.
 *
 * DRAFT — must be reviewed by a qualified legal professional before launch.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const UPDATED = "17 November 2026";
const OWNER = "Hardouch Anas";
const SITE = "https://relay-chat.bunbunchat.workers.dev";
const REPO = "https://github.com/Anas2103/Relay";
// Keep in sync with MIN_AGE in shared/legal.ts.
const MIN_AGE = 16;

const PAGES = [
  ["terms", "Terms of Service"],
  ["privacy", "Privacy Policy"],
  ["cookies", "Cookies & storage"],
  ["guidelines", "Community Guidelines"],
  ["accessibility", "Accessibility"],
  ["help", "Help & FAQ"],
];

const contact = `<a href="${REPO}/issues">github.com/Anas2103/Relay/issues</a>`;

const content = {
  terms: `
<p>These terms are an agreement between you and ${OWNER}, who runs Relay (“we”, “us”). By creating an account or using Relay you accept them. If you don't agree, please don't use Relay.</p>

<h2>1. Who can use Relay</h2>
<ul>
  <li>You must be at least <strong>${MIN_AGE} years old</strong>. We ask for your date of birth when you sign up and check it on our server.</li>
  <li>You must not have been banned from Relay before, and using Relay must be legal where you live.</li>
</ul>

<h2>2. Your account</h2>
<ul>
  <li>Keep your password private and turn on two-step verification if you can. You're responsible for what happens in your account.</li>
  <li>Choose a username and display name that don't pretend to be someone else.</li>
  <li>You can download your data or delete your account at any time in Settings.</li>
</ul>

<h2>3. Acceptable use</h2>
<p>Follow the <a href="/legal/guidelines.html">Community Guidelines</a>. In short, don't use Relay to:</p>
<ul>
  <li>harass, threaten, bully or impersonate anyone;</li>
  <li>share content that sexually exploits children, promotes terrorism or violence, or is otherwise illegal;</li>
  <li>send spam, scams, malware or phishing links;</li>
  <li>share someone's private information or intimate images without their consent;</li>
  <li>attack, overload, scrape or try to break into Relay or other people's accounts.</li>
</ul>

<h2>4. Your content</h2>
<p>Messages, photos, voice notes, stories and other things you share stay yours. You give us only the permission we need to store them, deliver them to the people you send them to, and show them in the app. You confirm you have the right to share them.</p>
<p>Secret chats are end-to-end encrypted: we can't read them. Other chats are stored on our servers and, as explained in the <a href="/legal/privacy.html">Privacy Policy</a>, the site owner can review them, for example to investigate a report.</p>

<h2>5. Moderation and termination</h2>
<p>We may remove content, restrict, suspend or delete accounts that break these terms or the law, or that put others at risk. Where we can, we tell you why. If you think we got it wrong, contact us (section 10) and we'll look again.</p>

<h2>6. Third-party content</h2>
<p>Some features show content from other services (for example YouTube videos, music previews, radio stations and podcasts). That content belongs to its owners and is covered by their own terms.</p>

<h2>7. Relay is provided “as is”</h2>
<p>Relay is a personal, free project. We work to keep it available and secure, but we can't promise it will always be available, free of errors, or that messages will never be lost. Keep your own copy of anything important.</p>

<h2>8. Limitation of liability</h2>
<p>To the extent the law allows, we aren't liable for indirect or consequential losses, or for content other people share. Nothing in these terms limits rights you have under consumer-protection law that can't be limited.</p>

<h2>9. Changes</h2>
<p>We may update these terms. If a change matters, Relay will ask you to accept the new version before you continue. The date at the top shows the latest version.</p>

<h2>10. Law and contact</h2>
<p>These terms are governed by the laws of the Kingdom of Morocco, without affecting mandatory rights you have where you live. Questions: ${contact}.</p>`,

  privacy: `
<p>This policy explains what personal data Relay collects, why, how long we keep it and what your rights are. It describes what the app actually does today. The controller is ${OWNER}, who runs Relay from Morocco.</p>

<div class="note">Short version: we collect what's needed to run a chat app, we don't sell data, there are no ads and no analytics or tracking cookies, and you can download or delete your data yourself in Settings.</div>

<h2>1. What we collect and why</h2>
<table>
  <thead><tr><th>Data</th><th>Why</th><th>How long</th></tr></thead>
  <tbody>
    <tr><td>Username, display name, password (stored only as a salted PBKDF2 hash)</td><td>Your account and signing in</td><td>Until you delete your account</td></tr>
    <tr><td>Date of birth</td><td>Checking you're ${MIN_AGE} or older. Never shown to anyone</td><td>Until you delete your account</td></tr>
    <tr><td>Which version of the Terms and this policy you accepted, and when</td><td>Proof of your agreement</td><td>Until you delete your account</td></tr>
    <tr><td>Profile picture, bio, status, settings (theme, colors, privacy choices)</td><td>Your profile and how the app looks for you</td><td>Until you change them or delete your account</td></tr>
    <tr><td>Messages, photos, videos, voice notes, documents, reactions, polls, stickers, pinned and starred messages, chat themes</td><td>Delivering your conversations</td><td>Until you or the other person delete them, the chat's disappearing-messages timer runs out, or you delete your account</td></tr>
    <tr><td>Secret chats</td><td>Stored only as encrypted data we can't read; the keys stay on your devices</td><td>Until the secret chat is ended or deleted</td></tr>
    <tr><td>Stories</td><td>Showing them to your contacts</td><td>24 hours</td></tr>
    <tr><td>Locations you choose to share in a chat</td><td>Showing them to the people in that chat</td><td>Like any other message</td></tr>
    <tr><td>Signed-in devices: browser and system name, approximate city and country (from Cloudflare, not GPS), first and last activity</td><td>The Devices list, new sign-in alerts and security</td><td>Until you sign out, or the session expires (you choose 1 week to 1 year)</td></tr>
    <tr><td>Two-step verification secret and hashed recovery codes</td><td>Two-step verification, if you turn it on</td><td>Until you turn it off</td></tr>
    <tr><td>Online status and “last seen”</td><td>Showing your contacts when you're around (you can hide it)</td><td>Last value only</td></tr>
    <tr><td>Push-notification subscription</td><td>Notifications when Relay is closed, if you allow them</td><td>Until you turn notifications off</td></tr>
    <tr><td>Reports you send or receive, and blocks</td><td>Safety and moderation</td><td>Until resolved and as long as needed for safety; blocks until you unblock</td></tr>
    <tr><td>Rate-limit counters keyed by IP address or username</td><td>Stopping spam, password guessing and abuse</td><td>2 days at most</td></tr>
    <tr><td>Admin audit log (which admin did what to which account)</td><td>Accountability for moderation actions</td><td>As long as needed for that purpose</td></tr>
  </tbody>
</table>
<p>We don't collect your email address, phone number, contacts list or precise location (unless you share a location in a chat yourself).</p>

<h2>2. Legal bases</h2>
<ul>
  <li><strong>Contract</strong>: to provide the service you signed up for (account, messages, calls, settings).</li>
  <li><strong>Legitimate interests</strong>: security, preventing abuse and moderation.</li>
  <li><strong>Consent</strong>: optional features such as push notifications, location sharing and microphone or camera access. You can withdraw it at any time.</li>
  <li><strong>Legal obligation</strong>: when the law requires us to keep or hand over data.</li>
</ul>

<h2>3. Who can see your data</h2>
<ul>
  <li><strong>People you chat with</strong> see what you send them and your profile.</li>
  <li><strong>The site owner</strong> can review non-secret conversations, for example to investigate a report. Every such access is written to an audit log. <strong>Other admins can manage accounts but can't read messages.</strong> Nobody, including the owner, can read secret chats.</li>
  <li><strong>Service providers</strong> that process data for us:
    <ul>
      <li><strong>Cloudflare, Inc.</strong>: hosting, database, storage, calls relay (TURN) and network security. Data may be processed in data centers outside Morocco, including the EU and the United States.</li>
      <li><strong>Cloudflare Workers AI</strong>: only when you press “Transcribe” or “Translate” on a message; that text or voice note is processed to produce the result.</li>
      <li><strong>Browser push services</strong> (Google, Apple, Mozilla, Microsoft, depending on your browser): deliver notifications if you turn them on. Notifications carry no message content: the push service only learns that something happened, and your device shows a generic “New message”.</li>
    </ul>
  </li>
  <li><strong>Chill</strong> (music, videos, radio, podcasts, trivia) searches YouTube, Apple iTunes, Radio Browser, Open Trivia DB and JokeAPI <em>through our server</em>, so those services don't see who you are. When you play a YouTube video, it loads from youtube-nocookie.com and Google's privacy policy applies.</li>
</ul>
<p>We never sell your data and we don't show ads.</p>

<h2>4. International transfers</h2>
<p>Because Relay runs on Cloudflare's global network, your data may be stored or processed outside your country. Cloudflare offers standard contractual clauses and the EU–US Data Privacy Framework for these transfers.</p>

<h2>5. Security</h2>
<p>Passwords are salted and hashed, sign-in tokens are stored only as hashes, all traffic uses HTTPS, and strict security headers protect every page. Secret chats use end-to-end encryption. No system is perfectly secure; if a breach affects you, we'll tell you and the authorities as the law requires.</p>

<h2>6. Your rights</h2>
<p>You can:</p>
<ul>
  <li><strong>Access and take your data</strong>: Settings → Your data → Export (a JSON file).</li>
  <li><strong>Correct it</strong>: edit your profile in Settings.</li>
  <li><strong>Delete it</strong>: Settings → Your data → Delete account. Your account, profile, sessions and the messages you sent are deleted straight away. One-to-one chats are deleted for both people; messages others sent in groups stay with the group.</li>
  <li><strong>Object or restrict</strong>, and <strong>withdraw consent</strong> for optional features at any time.</li>
  <li><strong>Complain</strong> to a data-protection authority. In Morocco that's the <a href="https://www.cndp.ma">CNDP</a> (Commission Nationale de contrôle de la protection des Données à caractère Personnel). If you live in the EU or UK, you can also contact your local authority.</li>
</ul>
<p>For anything you can't do in the app, contact us: ${contact}.</p>

<h2>7. Children</h2>
<p>Relay is not for anyone under ${MIN_AGE}. We check age at sign-up. If we learn that someone under ${MIN_AGE} has an account, we close it and delete its data.</p>

<h2>8. Cookies and local storage</h2>
<p>Relay uses one sign-in cookie and stores some preferences on your device. No tracking or advertising cookies. Details: <a href="/legal/cookies.html">Cookies &amp; storage</a>.</p>

<h2>9. Changes</h2>
<p>When this policy changes in a way that matters, Relay will ask you to read and accept it again. The date at the top shows the latest version.</p>`,

  cookies: `
<p>Relay only uses what it needs to work. There are <strong>no analytics, advertising or tracking cookies</strong>, so there's nothing to opt in or out of, and no cookie banner.</p>

<h2>Cookies</h2>
<table>
  <thead><tr><th>Name</th><th>Purpose</th><th>Lifetime</th></tr></thead>
  <tbody>
    <tr><td><code>sid</code></td><td>Keeps you signed in. HttpOnly, Secure, SameSite.</td><td>Until you sign out, or the sign-in expires (1 week to 1 year, your choice)</td></tr>
    <tr><td><code>relay_age_block</code></td><td>Set only if someone enters a birth date under ${MIN_AGE} at sign-up, so they can't retry straight away. Contains no personal data.</td><td>24 hours</td></tr>
  </tbody>
</table>

<h2>Storage on your device</h2>
<p>Relay saves some things in your browser's local storage and IndexedDB, which never leave your device:</p>
<ul>
  <li>your appearance settings, so the app opens with the right theme;</li>
  <li>drafts, sound and device choices (microphone, camera, speakers), game best scores;</li>
  <li>a copy of recent chats for offline use, and the app itself (service worker), so Relay opens without a connection;</li>
  <li>secret-chat keys, which can't be exported, and your passcode lock if you set one.</li>
</ul>
<p>Signing out clears your offline copy. You can remove everything with your browser's “clear site data”.</p>

<h2>Embedded content</h2>
<p>Videos in Chill and “Watch together” load from youtube-nocookie.com only when you play them. YouTube's own policy applies to that player.</p>`,

  guidelines: `
<p>Relay is for talking with friends. These rules keep it safe and friendly. Breaking them can get content removed or an account restricted, suspended or deleted.</p>

<h2>Be respectful</h2>
<ul>
  <li>No harassment, bullying, threats or hate based on who someone is.</li>
  <li>Don't keep contacting someone who has blocked you or declined your friend request.</li>
  <li>Don't impersonate other people.</li>
</ul>

<h2>Keep it legal and safe</h2>
<ul>
  <li>Never share sexual content involving anyone under 18. We report it to the authorities.</li>
  <li>No intimate images of anyone without their consent.</li>
  <li>No content that promotes terrorism, violence, self-harm or illegal activity.</li>
  <li>Don't share other people's private information (addresses, IDs, documents).</li>
</ul>

<h2>No spam or abuse of Relay</h2>
<ul>
  <li>No spam, scams, phishing or malware.</li>
  <li>No automated accounts, scraping or attempts to break Relay's security.</li>
</ul>

<h2>Reporting and blocking</h2>
<p>If something's wrong, <strong>report</strong> the message or the person (press and hold a message, or open someone's profile → Report). The report keeps a copy of the reported text, so deleting it later doesn't hide it. You can also <strong>block</strong> anyone: they can't message, call or find you anymore.</p>
<p>If you or someone else is in danger, contact your local emergency services first.</p>

<h2>What happens after a report</h2>
<p>An admin reviews it and can remove content, warn, restrict (read-only for a while), suspend for a set time, or delete the account. Every action is logged. If you think a decision about your account was wrong, contact us: ${contact}.</p>`,

  accessibility: `
<p>We want everyone to be able to use Relay, including people who use a screen reader, a keyboard only, zoom or other assistive technology.</p>

<h2>What we do</h2>
<ul>
  <li>Relay aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2, level AA.</li>
  <li>Everything works with a keyboard. <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> jumps to any chat, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> moves between chats, <kbd>Esc</kbd> closes dialogs.</li>
  <li>Buttons and controls have text labels for screen readers, and new messages and notices are announced.</li>
  <li>Light and dark themes, text size from 85% to 125%, larger message text, reduced motion, and a <strong>Simple mode</strong> with bigger text and buttons and fewer options.</li>
  <li>Voice messages can be transcribed to text, and messages can be read aloud.</li>
</ul>

<h2>Known limitations</h2>
<ul>
  <li>Relay is in English only for now; French and Arabic (with right-to-left layout) are planned.</li>
  <li>Some games are visual and don't yet have full screen-reader descriptions of the board.</li>
  <li>Videos from YouTube depend on YouTube's own player and captions.</li>
</ul>

<h2>Feedback</h2>
<p>If something is hard to use, tell us and we'll fix it: ${contact}.</p>`,

  help: `
<p>Relay is a free real-time chat app in the spirit of Telegram and Discord, built and run by ${OWNER} as a personal project.</p>

<h2>Getting started</h2>
<details><summary>How do I start a chat?</summary><p>Search for a friend's username in the search box. They get a friend request; once they accept, you can chat, call and play together.</p></details>
<details><summary>How do I make a group?</summary><p>Press the pencil (or the + in the left bar on a computer) → New group, then pick friends. Group admins can add people, share an invite link, turn on slow mode or let only admins post.</p></details>
<details><summary>Can I install Relay like an app?</summary><p>Yes. On Android/Chrome use “Install app” or “Add to Home screen”; on iPhone open the Share menu → “Add to Home Screen”. It then works like an app, with notifications and offline reading.</p></details>

<h2>Privacy and security</h2>
<details><summary>What is a secret chat?</summary><p>An end-to-end encrypted 1:1 chat. Open a chat's info → Secret chat. Its keys exist only on your two devices, so nobody else, not even the site owner, can read it. It only works on the device where you started it.</p></details>
<details><summary>Who can read my normal chats?</summary><p>The people in them, and the site owner when reviewing a report (every access is logged). Admins can't read messages. See the <a href="/legal/privacy.html">Privacy Policy</a>.</p></details>
<details><summary>How do I protect my account?</summary><p>Settings → Privacy &amp; security: turn on two-step verification, check your signed-in devices and sign out the ones you don't recognise. You can also set a passcode lock on a device.</p></details>
<details><summary>How do I block or report someone?</summary><p>Open their profile → Block or Report. To report a single message, press and hold it (or right-click) → Report.</p></details>

<h2>Your data</h2>
<details><summary>How do I download my data?</summary><p>Settings → Your data → Export. You get a JSON file with your profile, devices and messages.</p></details>
<details><summary>How do I delete my account?</summary><p>Settings → Your data → Delete account. It's immediate and can't be undone.</p></details>

<h2>Fun</h2>
<details><summary>How do I play a game with a friend?</summary><p>In a chat, press the paperclip → Game / Watch. Team games (Word Team, Crack the Code, Pair Up) are played by everyone in the chat together; head-to-head games are you against whoever moves first.</p></details>
<details><summary>How do I change a chat's theme?</summary><p>Open the chat's info → Theme. Everyone in the chat sees the theme you choose. If you prefer your own colors, turn off “Show chat themes” in Settings → Appearance.</p></details>

<h2>Contact</h2>
<p>Questions, bugs or ideas: ${contact}. Security issues: please report them privately, see <a href="/.well-known/security.txt">security.txt</a>.</p>`,
};

const page = (slug, title) => `<!doctype html>
<!-- DRAFT — must be reviewed by a qualified legal professional before launch. Generated by scripts/legal-pages.mjs; edit there. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · Relay</title>
<meta name="description" content="${title} for Relay, a real-time chat app.">
<link rel="canonical" href="${SITE}/legal/${slug}">
<meta property="og:title" content="${title} · Relay">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/legal/${slug}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/legal/legal.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28">Relay</a>
  <a class="open" href="/">Open Relay</a>
</header>
<main id="main">
<h1>${title}</h1>
<p class="updated">Last updated: ${UPDATED}</p>
${content[slug].trim()}
</main>
<footer>
  <nav aria-label="Legal">
${PAGES.map(([s, t]) => `    <a href="/legal/${s}.html"${s === slug ? ' aria-current="page"' : ""}>${t}</a>`).join("\n")}
  </nav>
  <p>© 2026 ${OWNER}. Relay is a personal project.</p>
</footer>
</body>
</html>
`;

mkdirSync(new URL("../public/legal/", import.meta.url), { recursive: true });
for (const [slug, title] of PAGES) {
  writeFileSync(new URL(`../public/legal/${slug}.html`, import.meta.url), page(slug, title));
}
console.log(`Wrote ${PAGES.length} pages to public/legal/`);
