import type { AiReleaseSummaryGenerator, AiReleaseSummaryRequest } from './announcement';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';

export interface AnthropicFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type AnthropicFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<AnthropicFetchResponse>;

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

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
}

function readApiKey(explicitApiKey?: string): string {
  const apiKey = String(explicitApiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing Anthropic API key. Set ANTHROPIC_API_KEY or pass apiKey explicitly.');
  }
  return apiKey;
}

function validateMaxTokens(maxTokens: number): void {
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error('Anthropic maxTokens must be a positive integer.');
  }
}

async function readAnthropicError(response: AnthropicFetchResponse): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: unknown } };
    const message = String(parsed?.error?.message || '').trim();
    if (message) {
      return message.slice(0, 300);
    }
  } catch {
    try {
      return String(await response.text()).trim().slice(0, 300);
    } catch {
      return '';
    }
  }
  return '';
}

async function generateWithAnthropic(
  request: AiReleaseSummaryRequest,
  options: AnthropicReleaseSummaryOptions,
): Promise<string> {
  const apiKey = readApiKey(options.apiKey);
  const model = String(options.model || DEFAULT_ANTHROPIC_MODEL).trim();
  if (!model) {
    throw new Error('Anthropic model must not be empty.');
  }
  const maxTokens = options.maxTokens ?? 1024;
  validateMaxTokens(maxTokens);
  const fetcher = options.fetch ?? (globalThis.fetch as unknown as AnthropicFetch);
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

  const message = (await response.json()) as AnthropicMessageResponse;
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
export function createAnthropicReleaseSummaryGenerator(
  options: AnthropicReleaseSummaryOptions = {},
): AiReleaseSummaryGenerator {
  return (request) => generateWithAnthropic(request, options);
}
