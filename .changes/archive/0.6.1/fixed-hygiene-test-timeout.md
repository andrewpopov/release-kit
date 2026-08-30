---
kind: fixed
summary: slow git-subprocess hygiene tests now have enough time to assert their intended failures
---

The hygiene regression suites exercise real temporary repositories, shallow
clones, and a `git` shim that self-terminates on `merge-base`. Those subprocesses
can exceed Vitest's five-second unit-test default under a cold install, causing
a timeout instead of the intended assertion.

Only the subprocess-heavy suites now have explicit 30-second bounds. The
signal-terminated shim's stale "instantly" comment is also corrected.
