import type { AiReleaseSummaryGenerator } from './announcement';
export interface AnthropicFetchResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
}
export type AnthropicFetch = (url: string, init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
}) => Promise<AnthropicFetchResponse>;
export interface AnthropicReleaseSummaryOptions {
    /** Defaults to `process.env.ANTHROPIC_API_KEY`. */
    apiKey?: string;
    /** Defaults to the low-cost `claude-haiku-4-5` model. */
    model?: string;
    /** Maximum model output tokens. Defaults to `1024`. */
    maxTokens?: number;
    /** Injectable transport for tests. Defaults to Node's global `fetch`. */
    fetch?: AnthropicFetch;
}
/** Creates an AI summary generator backed by Anthropic's Messages API. */
export declare function createAnthropicReleaseSummaryGenerator(options?: AnthropicReleaseSummaryOptions): AiReleaseSummaryGenerator;
