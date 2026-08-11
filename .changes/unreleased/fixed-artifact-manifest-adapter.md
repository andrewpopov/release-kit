---
kind: fixed
summary: artifact generation no longer reads package.json directly, so a custom manifest adapter works without one
---

`createReleaseArtifactV1` unconditionally read `package.json` off `rootDir`
for `product`/`repository`, even though `ReleaseKitConfig.manifest`
(`VersionManifestAdapter`) is the seam every other release operation already
goes through. A consumer with a custom, non-npm manifest adapter and no
`package.json` at the root could cut and validate a release but crashed
(`ENOENT`) trying to produce its `--json` artifact. `VersionManifestAdapter`
gained an optional `readArtifactMetadata(rootDir)` method returning
`{ product?, repository? }`; `createReleaseArtifactV1` calls it instead of
reading `package.json`, falling back to `config.productName`/`rootDir` when
the adapter doesn't implement it or omits a field. `npmPackage()` implements
it with the exact same `name`/`repository` derivation
`createReleaseArtifactV1` used to inline, so its behavior for existing npm
consumers is unchanged.
