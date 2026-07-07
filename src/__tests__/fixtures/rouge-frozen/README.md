# Frozen rouge fixtures (release-kit golden parity)

Byte-frozen copies of rouge's **pre-adoption** release tooling and published
release notes, captured from `andrewpopov/rouge` at commit `8f733623b` — the
commit immediately before rouge adopted `@andrewpopov/release-kit`.

- `scripts/{cut-release,release-notes,check-release-hygiene}.js` +
  `scripts/lib/release-notes-core.js` — the original, self-contained
  (node-builtins-only) release engine. The golden test drives these through
  their `run()` entry points and byte-diffs the result against release-kit's
  CLI, proving the extraction stays faithful. **Do not edit** — they are the
  parity oracle; re-freeze only to intentionally re-baseline.
- `releases/*.md` — real published release notes, used to prove `titleTemplate`
  back-compat (parsing historical artifacts unchanged).

Freezing these makes the golden **hermetic**: it needs no external rouge
checkout, so it runs in CI too, and it never becomes circular now that the live
rouge scripts are thin wrappers over this package.
