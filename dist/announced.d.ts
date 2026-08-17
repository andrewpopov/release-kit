/**
 * Announce-once ledger: tracks which release versions have already been
 * posted to Discord so `announceReleaseToDiscord` can skip a re-announce
 * when a deploy-kit `deliveryEvent` hook fires more than once for the same
 * release (every deploy, not every release).
 */
import type { ReleaseKitConfig } from './config';
export interface ResolveAnnouncementStatePathOptions {
    /** Explicit override, e.g. from `announceReleaseToDiscord({ stateFile })`. */
    stateFile?: string;
}
export type AnnouncementStatePathSource = 'option' | 'env' | 'config' | 'deploy-kit-shared' | 'sibling-shared' | 'fallback';
export interface AnnouncementStatePathResolution {
    path: string;
    /**
     * False only for the last-resort `fallback` source: that path lives inside
     * the release directory deploy-kit swaps out wholesale on each deploy, so
     * state written there does not survive across deploys.
     */
    durable: boolean;
    source: AnnouncementStatePathSource;
}
export interface AnnouncedVersionEntry {
    version: string;
    at: string;
    /**
     * Which product recorded this entry. Optional so legacy ledger entries
     * (written before namespacing existed) still match: a missing `product`
     * is treated as matching any product, so production ledgers written
     * pre-namespacing don't cause a spurious re-announce.
     */
    product?: string;
}
export interface AnnouncedVersionsFile {
    announced: AnnouncedVersionEntry[];
}
/**
 * Resolves where the announce-once ledger lives. First hit wins, in order:
 * an explicit `options.stateFile`, `RELEASE_ANNOUNCE_STATE`,
 * `config.paths.announcementStateFile`, deploy-kit's shared dir
 * (`DEPLOY_KIT_SHARED_DIR` + `/release-announcements.json`), a sibling
 * `../shared/release-announcements.json` directory (deploy-kit's releases
 * layout convention, only if that directory actually exists), and finally a
 * fallback file inside `rootDir` itself.
 */
export declare function resolveAnnouncementStatePath(config: ReleaseKitConfig, options?: ResolveAnnouncementStatePathOptions): AnnouncementStatePathResolution;
/**
 * Reads the announce-once ledger. Never throws: a missing file, an empty
 * file, unparseable JSON, or JSON with junk in place of `announced` all
 * degrade to `{ announced: [] }`.
 */
export declare function readAnnouncedVersions(statePath: string): AnnouncedVersionsFile;
/**
 * Whether `version` is already recorded in the ledger at `statePath` for
 * `product`. A ledger entry with no `product` (written before namespacing
 * existed) matches any product.
 */
export declare function hasAnnouncedVersion(statePath: string, version: string, product?: string): boolean;
/**
 * Records `version` (namespaced by `product`, when given) as announced,
 * replacing any existing matching entry so the ledger doesn't grow
 * duplicates on a forced re-announce. Best-effort bookkeeping: creates
 * parent directories as needed, writes atomically (temp file + rename) so a
 * concurrent reader never sees a partially-written file, and never
 * throws — a write failure is logged via `console.warn` and swallowed
 * rather than failing the caller.
 */
export declare function recordAnnouncedVersion(statePath: string, version: string, product?: string): void;
