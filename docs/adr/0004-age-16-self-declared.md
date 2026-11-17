# 4. Minimum age 16, self-declared birth date checked on the server

**Status:** accepted · **Date:** 2026-11-17

**Context.** Relay lets people message each other. Under 16 (EU) or 13 (US), parental-consent rules apply.

**Decision.** Ask for the date of birth at sign-up, compute the age on the server, refuse under 16 without storing anything, block an immediate retry for 24 hours with a non-identifying cookie. No ID verification.

**Consequences.** Simple and privacy-friendly; people can lie about their age, which is the accepted standard for general-audience apps. 18+ features or a law requiring verification would need a verification provider (see AGE_AND_SAFETY.md).
