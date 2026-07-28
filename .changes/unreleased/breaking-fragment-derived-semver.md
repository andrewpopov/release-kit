---
kind: breaking
summary: The version bump is now derived from fragment kinds, so a breaking change no longer ships as a patch
---

`stableSemver().next()` incremented the patch component unconditionally, so `release:cut` labelled any batch as a patch no matter what was in it — deploy-kit shipped a breaking change as `0.14.1`. Fragment kinds are now read: a `breaking` fragment produces a major bump (a minor while pre-1.0, since `0.x` already declares an unstable API), `added` produces a minor, and anything else a patch. Declare `bump` on a `ReleaseKindDef` to weight a non-conventional kind id. An explicit `--version` still overrides everything. Two consequences for existing consumers: repos whose fragments include `added` or `breaking` will now see minor and major bumps where they previously saw patches, and a **custom** `VersionStrategy` must declare `bumpLevelSupport: 'supported' | 'ignored'` — release-kit refuses an implicit non-patch cut through a strategy that has not said whether it honours fragment kinds, rather than silently mislabeling the release.
