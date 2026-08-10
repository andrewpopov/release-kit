---
kind: fixed
summary: hygiene rejects a trailing-period summary on changed fragments
---

`release-kit hygiene` validated a changed fragment's body for the scaffold
placeholder but never its summary, so a summary ending in `.` sailed through
every push and only failed later, at `check`/`publish` time — the renderer
emits `**{summary}:**`, so a trailing period renders `**Summary.:**`. hygiene
now applies the same rule `parseFragment` already enforced, through one
shared `validateFragmentContent` helper, scoped to only the fragments the
current change adds or modifies. `HygieneResult` gains a
`trailingPeriodSummaryPatchNoteFiles` field and the CLI prints the offending
file(s) by name.
