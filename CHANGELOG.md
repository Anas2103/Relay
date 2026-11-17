# Changelog

All notable changes are listed here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Terms of Service, Privacy Policy, Cookies & storage, Community Guidelines, Accessibility statement and Help & FAQ pages, linked from sign-up and Settings.
- Age check at sign-up (16+, checked on the server; under-age attempts store nothing and can't be retried for 24 hours).
- Terms acceptance stored with its version; a "Before you continue" screen when the terms change or for older accounts.
- Show/hide password on sign-in and sign-up.
- Data export now includes devices, blocks, stories, birth date and terms acceptance.
- Open Graph image, sitemap, robots.txt, security.txt and structured data.
- Linting (oxlint), formatting (Prettier), `npm run check`, CI quality job with bundle budget and dependency audit, Dependabot.
- Automated accessibility tests (axe) and tests for the age gate, consent, export and legal pages.
- Documentation in `docs/`.

### Changed

- Avatar colours, timestamps and secondary text darkened in light mode to meet WCAG AA contrast; the "add story" button is larger.
- Sign-up inputs use 16 px text on phones so iOS doesn't zoom in.
- Game moves cost a quarter of a message in the rate limiter, so quick Pair Up rounds aren't refused.

### Fixed

- Location sharing was blocked on the live site by the `Permissions-Policy` header.
- After visiting a legal page, the offline app could open as that page.
- Block Drop's touch buttons were recreated on every frame.
- Old rate-limit counters (keyed by IP address) and expired sessions are now deleted automatically.

## [0.1.0] - 2026-11-16

First public version: chats, groups, secret chats, calls, stories, Chill, chat games, chat themes and the admin/owner tools.
