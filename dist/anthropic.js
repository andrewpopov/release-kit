"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnthropicReleaseSummaryGenerator = createAnthropicReleaseSummaryGenerator;
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
function readApiKey(explicitApiKey) {
    const apiKey = String(explicitApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error('Missing Anthropic API key. Set ANTHROPIC_API_KEY or pass apiKey explicitly.');
    }
    return apiKey;
}
function validateMaxTokens(maxTokens) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
        throw new Error('Anthropic maxTokens must be a positive integer.');
    }
}
async function readAnthropicError(response) {
    try {
        const parsed = (await response.json());
        const message = String(parsed?.error?.message || '').trim();
        if (message) {
            return message.slice(0, 300);
        }
    }
    catch {
        try {
            return String(await response.text()).trim().slice(0, 300);
        }
        catch {
            return '';
        }
    }
    return '';
}
async function generateWithAnthropic(request, options) {
    const apiKey = readApiKey(options.apiKey);
    const model = String(options.model || DEFAULT_ANTHROPIC_MODEL).trim();
    if (!model) {
        throw new Error('Anthropic model must not be empty.');
    }
    const maxTokens = options.maxTokens ?? 1024;
    validateMaxTokens(maxTokens);
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') {
        throw new Error('No fetch implementation is available for the Anthropic request.');
    }
    const response = await fetcher(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: request.systemPrompt,
            messages: [{ role: 'user', content: request.input }],
        }),
    });
    if (!response.ok) {
        const detail = await readAnthropicError(response);
        throw new Error(`Anthropic Messages API failed with status ${response.status}${detail ? `: ${detail}` : '.'}`);
    }
    const message = (await response.json());
    const text = (message.content || [])
        .filter((block) => block.type === 'text')
        .map((block) => String(block.text || '').trim())
        .filter(Boolean)
        .join('\n\n');
    if (!text) {
        throw new Error('Anthropic Messages API returned no text content.');
    }
    return text;
}
/** Creates an AI summary generator backed by Anthropic's Messages API. */
function createAnthropicReleaseSummaryGenerator(options = {}) {
    return (request) => generateWithAnthropic(request, options);
}
