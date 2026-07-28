---
kind: fixed
summary: The release-kit CLI is executable again, and stays that way across builds.
---

`dist/cli.js` was committed as mode 100644, so a `github:` install linked `node_modules/.bin/release-kit` at a non-executable file and any invocation failed with `Permission denied`. The committed mode is now 100755, and `build` runs `chmod +x dist/cli.js` after `tsc` — without that, the next build would silently revert it, since `dist/` is generated and tsc writes 644.
