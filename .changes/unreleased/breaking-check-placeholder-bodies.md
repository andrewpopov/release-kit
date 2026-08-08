---
kind: breaking
summary: check and cut reject scaffold-placeholder bodies and trailing-period summaries; parseFragment now takes the full config
---

A fragment whose body was still the configured `fragmentBodyPlaceholder` passed `check` and published verbatim — a consumer repo nearly shipped 28 of 124 placeholder bodies into its release notes and Discord announcement. `parseFragment` now rejects a body equal to the scaffold placeholder and a summary ending in `.` (the renderer emits `**{summary}:**`, so a trailing period renders `**Summary.:**`). The scaffold→edit workflow is intact: `note` only writes, and `hygiene` never parses bodies. Breaking for library callers only: exported `parseFragment` now takes the full `ReleaseKitConfig` instead of `ReleaseKindDef[]` (no known direct callers; the CLI is unaffected).
