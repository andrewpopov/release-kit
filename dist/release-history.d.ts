export declare const RELEASE_SUMMARY_MAX_CHARACTERS = 360;
/** A user-facing release, scoped to one repository. Keep operational details out of notes. */
export interface ReleaseNotesRecord {
    schemaVersion: 1;
    repository: string;
    id: string;
    product: string;
    version: string;
    commit: string;
    releasedAt: string;
    summary: string;
    notesMarkdown: string;
}
export interface ReleaseNotesPage {
    items: ReleaseNotesRecord[];
    page: number;
    pageSize: number;
    hasMore: boolean;
}
export interface ReleaseNotesReader {
    get(repository: string, id: string): Promise<ReleaseNotesRecord | null>;
    list(repository: string, query?: {
        page?: number;
        pageSize?: number;
    }): Promise<ReleaseNotesPage>;
}
export interface ReleaseNotesFiles {
    /** Absolute host-owned directory. Only dated .md files are read. */
    directory: string;
    repository: string;
    product: string;
}
export declare function validateReleaseNotesRecord(value: unknown): ReleaseNotesRecord;
/** Also usable at build time to produce a static manifest for non-Node hosts. */
export declare function readDatedReleaseNotes(options: ReleaseNotesFiles): ReleaseNotesRecord[];
/** Reads the deployed repo's reviewed notes; no network request or database is needed. */
export declare function createFileReleaseNotesReader(options: ReleaseNotesFiles): ReleaseNotesReader;
/** Write during a release PR, then commit the file; runtime readers never call this. */
export declare function writeDatedReleaseNotes(directory: string, input: ReleaseNotesRecord): string;
export declare function releaseNotesUrl(baseUrl: string, id: string): string;
export interface ReleaseNotification {
    title: string;
    summary: string;
    url: string;
}
/** Both Discord and other webhooks use the same bounded summary and stable link. */
export declare function buildReleaseNotification(record: ReleaseNotesRecord, notesBaseUrl: string): ReleaseNotification;
