---
kind: fixed
summary: aggregate verification now proves build freshness and release readiness
---

`npm run verify` now includes `verify:dist-fresh` and `release:check`, preventing
stale generated output or invalid pending fragments from surviving the
authoritative pre-push lane.
