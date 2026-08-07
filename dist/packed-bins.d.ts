/**
 * Assert every `package.json#bin` is executable IN THE PACKED TARBALL, not
 * merely on disk. `npm install` chmods a bin to 755 on the way in, so any
 * check that runs after an install (including spawning the installed
 * binary) is structurally blind to a source bin shipped at mode 644 — the
 * packed tarball is the only place that defect survives.
 */
export interface PackedBinFinding {
    /** bin name as declared, e.g. `release-kit`. */
    name: string;
    /** declared target as written in package.json, e.g. `dist/cli.js`. */
    target: string;
    /** matching tarball entry (`package/dist/cli.js`), or null when absent. */
    entry: string | null;
    /** parsed octal mode of that entry, or null when absent. */
    mode: number | null;
    ok: boolean;
    reason?: 'missing' | 'not-executable';
}
export interface VerifyPackedBinsResult {
    ok: boolean;
    /**
     * The tarball that was inspected. When `options.tarballPath` was omitted this
     * names a file inside a temp dir that has ALREADY been removed by the time
     * you read it — it is for diagnostics only. Pass `tarballPath` explicitly if
     * you need the artifact to outlive the call.
     */
    tarballPath: string;
    findings: PackedBinFinding[];
}
export interface VerifyPackedBinsOptions {
    /** Package root. Defaults to `process.cwd()`. */
    rootDir?: string;
    /** Pre-packed tarball. When omitted, `npm pack` runs into a temp dir and is cleaned up after. */
    tarballPath?: string;
}
export declare function verifyPackedBins(options?: VerifyPackedBinsOptions): VerifyPackedBinsResult;
/** Multi-line, human-readable failure report; '' when `result.ok`. */
export declare function formatPackedBinFailures(result: VerifyPackedBinsResult): string;
/**
 * Windows fallback: check the mode git has RECORDED for each declared bin.
 *
 * This is deliberately NOT equivalent to inspecting the packed tarball, and
 * does not replace it. It exists because on Windows the tarball check cannot
 * run at all — `npm pack` reads the filesystem mode, and NTFS has no
 * executable bit, so every entry comes out 0o644 and every bin is condemned.
 *
 * Git records `100755` vs `100644` per file regardless of the OS that wrote
 * it, and these packages are consumed as `github:owner/repo#vX` dependencies,
 * so the mode in the tag is exactly what an installing consumer receives.
 * That makes it a meaningful source-level check rather than a rubber stamp:
 * it still catches a bin committed non-executable — the defect most likely to
 * be introduced on Windows, where git will not infer the bit from the
 * filesystem.
 */
export declare function verifyBinModesInGit(options?: VerifyPackedBinsOptions): VerifyPackedBinsResult;
