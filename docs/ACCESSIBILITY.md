# Accessibility

Target: **WCAG 2.2 level AA**. The public statement is at `/legal/accessibility`.

## Automated

`tests/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1/2.2 A and AA rules) on sign-in, sign-up, a legal page, a chat in light and dark mode, Settings, and the phone chat list. Any violation fails the test. Lighthouse accessibility: 100 on the live site and on the legal pages.

## Manual checks (do these before a release)

1. **Keyboard only:** Tab through sign-in, the chat list, a chat, the composer, Settings and a dialog. Focus must always be visible, and Esc closes dialogs.
2. **Screen reader:** NVDA (Windows) or VoiceOver (macOS/iOS). Check that buttons are announced by name and new messages are read.
3. **Zoom to 200%** and Settings → text size 125%: nothing cut off or overlapping.
4. **Reduced motion:** turn it on in the OS; animations should stop.
5. **Colour alone:** online status, unread state and errors also have text or shape.

## Rules for new UI

- Use real `<button>`/`<a>`/`<label>`; icon-only buttons need `aria-label`.
- Grey text on white: `text-zinc-600` or darker (zinc-500 fails on tinted backgrounds). On dark: `text-zinc-400` or lighter.
- Touch targets at least 24×24 px (44×44 for main controls).
- Form inputs at least 16 px text on phones (`text-base sm:text-sm`) so iOS doesn't zoom.
