---
kind: fixed
summary: hygiene rejects a placeholder body on changed fragments
---

`release-kit hygiene` — the check consumers run in pre-push hooks — previously
only confirmed that a patch-note fragment existed for release-relevant
changes; it never looked at the body, so a fragment left holding the
generated scaffold placeholder sailed through every push and only failed
later, at `check`/`publish` time, after the code was already deployed. hygiene
now rejects a placeholder body too, scoped to only the fragments the current
change adds or modifies (added/modified fragments still on disk), so it never
retroactively fails a push over pre-existing placeholder fragments elsewhere
in the repo. `HygieneResult` gains a `placeholderPatchNoteFiles` field and the
CLI prints the offending file(s) by name.
