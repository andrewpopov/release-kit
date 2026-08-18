---
kind: fixed
summary: the signal-terminated merge-base hygiene test no longer fails as a 5s timeout; it needs an explicit timeout because the git shim's own sleep still runs.
---

`hygiene-git-failures` builds a `git` shim that self-terminates on `merge-base`
to reproduce the `status: null, signal set` shape PKG-140 finding C is about.
The shim's comment claimed this happened "instantly"; it does not — the shim's
own `sleep 5` still runs, and hygiene invokes `merge-base` twice, so the test
lands just over vitest's 5s default and failed as a **timeout** rather than on
its assertions.

It has been red on `master`, unnoticed, because this repo had no pre-push gate
to run the suite. Given an explicit 30s timeout the test passes and asserts
what it was written to assert. The stale "instantly" comment is corrected.
