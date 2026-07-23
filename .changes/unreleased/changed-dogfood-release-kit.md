---
kind: changed
summary: Manage release-kit's own releases with release-kit (dogfooding changelogTarget)
---

release-kit now cuts its own releases through its own `changelogTarget()`: describe each change as a fragment under `.changes/unreleased/` and run `npm run release:cut`. The config self-references the local build (`./dist/index.js`) since the package cannot depend on itself.
