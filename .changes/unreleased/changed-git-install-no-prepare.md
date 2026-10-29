---
kind: changed
summary: Packages installed from git no longer trigger a full dependency install
---

`prepare` is gone (use `npm run hooks`), `build` is now `compile`, and `release:check` gains the opt-in `installFromGit` rule.
