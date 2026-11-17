# 5. oxlint instead of ESLint

**Status:** accepted · **Date:** 2026-11-17

**Context.** Relay uses TypeScript 7 (the native compiler). `typescript-eslint` supports only TypeScript < 6.1.

**Decision.** Use oxlint (with its TypeScript, React, React-hooks, import and unicorn rules), run with `--deny-warnings` in CI.

**Consequences.** Fast linting that works with TypeScript 7. No type-aware lint rules; type safety comes from `tsc` in strict mode.
