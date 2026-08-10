---
kind: fixed
summary: hygiene no longer requires a patch note for a test-only change
---

`isReleaseRelevantFile` matched on broad path prefixes (e.g. `src/`), and
test files live under those same prefixes, so a change that added only test
coverage was classified release-relevant and blocked at push time for a
change no user can observe. `hygiene.excludePatterns` (default: common test
file shapes — `__tests__/`, `__mocks__/`, `*.test.*`, `*.spec.*`) now exempts
a genuinely test-only change; it applies only to prefix-based matches, never
to a repo's curated exact `relevantFiles`/`relevantDocFiles` lists, and a
change that also touches real source under the same prefix still requires a
note. Configurable per repo, defaults to the common test-file shapes.
