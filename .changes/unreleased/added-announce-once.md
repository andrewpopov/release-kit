---
kind: added
summary: announceReleaseToDiscord gains announce-once semantics
---

`announceReleaseToDiscord` now posts a given version at most once by default, tracked in a small on-disk ledger, so wiring it into deploy-kit's `deliveryEvent` hook (which fires once per deploy, not once per release) no longer re-posts the same announcement on every redeploy. New options: `announceOnce` (default `true`), `force` to post anyway, and `stateFile` to pin the ledger location. The ledger path otherwise resolves via `RELEASE_ANNOUNCE_STATE`, the new `config.paths.announcementStateFile`, `DEPLOY_KIT_SHARED_DIR`, a sibling `shared/` directory, or a non-durable fallback inside `rootDir`. The result type is now a discriminated union on `skipped`, and the new `resolveAnnouncementStatePath`/`readAnnouncedVersions`/`hasAnnouncedVersion`/`recordAnnouncedVersion` primitives are exported directly.
