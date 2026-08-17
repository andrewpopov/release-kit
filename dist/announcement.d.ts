import type { ReleaseKitConfig } from './config';
import type { Fragment } from './fragments';
import { type ReleaseWorkSummary } from './work-summary';
export interface AiReleaseSummaryRequest {
    systemPrompt: string;
    input: string;
    maxCharacters: number;
}
export type AiReleaseSummaryGenerator = (request: AiReleaseSummaryRequest) => Promise<string>;
export interface GenerateAiReleaseSummaryOptions {
    version: string;
    generate: AiReleaseSummaryGenerator;
    audience?: string;
    maxCharacters?: number;
}
export interface DiscordEmbedField {
    name: string;
    value: string;
    inline: false;
}
export interface DiscordReleasePayload {
    username?: string;
    avatar_url?: string;
    embeds: Array<{
        title: string;
        description: string;
        url?: string;
        fields: DiscordEmbedField[];
    }>;
}
export interface BuildDiscordReleasePayloadOptions {
    version: string;
    aiSummary: string;
    releaseUrl?: string;
    username?: string;
    avatarUrl?: string;
}
export interface DiscordFetchResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
}
export type DiscordFetch = (url: string, init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
}) => Promise<DiscordFetchResponse>;
export interface PostReleaseToDiscordOptions {
    webhookUrl: string;
    payload: DiscordReleasePayload;
    fetch?: DiscordFetch;
}
export interface AnnounceReleaseToDiscordOptions extends Omit<BuildDiscordReleasePayloadOptions, 'aiSummary'> {
    config: ReleaseKitConfig;
    fragments: Fragment[];
    generate: AiReleaseSummaryGenerator;
    webhookUrl: string;
    audience?: string;
    maxSummaryCharacters?: number;
    fetch?: DiscordFetch;
    /** Explicit override for the announce-once ledger path; see `resolveAnnouncementStatePath`. */
    stateFile?: string;
    /** Post even if this version is already recorded as announced. Default false. */
    force?: boolean;
    /** Skip a version already recorded as announced. Default true. */
    announceOnce?: boolean;
}
export interface ReleaseAnnouncementPosted {
    skipped: false;
    aiSummary: string;
    work: ReleaseWorkSummary;
    payload: DiscordReleasePayload;
}
export interface ReleaseAnnouncementSkipped {
    skipped: true;
    version: string;
    statePath: string;
}
export type ReleaseAnnouncementResult = ReleaseAnnouncementPosted | ReleaseAnnouncementSkipped;
export declare function buildAiReleaseSummaryPrompt(config: ReleaseKitConfig, work: ReleaseWorkSummary, options: Pick<GenerateAiReleaseSummaryOptions, 'version' | 'audience' | 'maxCharacters'>): AiReleaseSummaryRequest;
export declare function generateAiReleaseSummary(config: ReleaseKitConfig, work: ReleaseWorkSummary, options: GenerateAiReleaseSummaryOptions): Promise<string>;
export declare function buildDiscordReleasePayload(config: ReleaseKitConfig, work: ReleaseWorkSummary, options: BuildDiscordReleasePayloadOptions): DiscordReleasePayload;
export declare function postReleaseToDiscord(options: PostReleaseToDiscordOptions): Promise<void>;
export declare function announceReleaseToDiscord(options: AnnounceReleaseToDiscordOptions): Promise<ReleaseAnnouncementResult>;
