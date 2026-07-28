---
kind: added
summary: verifyPackedBins() and a `verify-bins` CLI verb assert every package.json#bin is executable in the packed tarball
---

deploy-kit and release-kit each shipped a CLI at mode 644, giving every `github:` consumer `Permission denied`, and both repos' `verify:pack` claimed to check the bin and passed anyway. The reason is structural: `npm install` chmods a bin target to 755 on the way in, so a check that inspects an installed consumer tree — even one that spawns the installed binary — can never see the defect. Only the packed tarball carries the truth. `verifyPackedBins()` packs (or takes a pre-packed tarball), reads the stored mode of every declared `bin` target, and reports each one as missing or not-executable; `release-kit verify-bins` exposes it as a CLI. Packages that declare no `bin` pass trivially, so it drops into any repo's gate unchanged.
