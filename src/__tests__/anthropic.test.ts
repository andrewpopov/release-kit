import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAnthropicReleaseSummaryGenerator } from '../anthropic';
import type { AnthropicFetch } from '../anthropic';
import type { AiReleaseSummaryRequest } from '../announcement';

const request: AiReleaseSummaryRequest = {
  systemPrompt: 'Summarize accurately.',
  input: '{"releasedWork":[]}',
  maxCharacters: 500,
};

const originalApiKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

describe('createAnthropicReleaseSummaryGenerator', () => {
  test('calls the Anthropic Messages API with the expected contract', async () => {
    const fetch = vi.fn<AnthropicFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'A concise release summary.' }] }),
      text: async () => '',
    }));
    const generate = createAnthropicReleaseSummaryGenerator({
      apiKey: 'test-api-key',
      fetch,
    });

    await expect(generate(request)).resolves.toBe('A concise release summary.');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-api-key',
          'anthropic-version': '2023-06-01',
        },
      }),
    );
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.input }],
    });
  });

  test('reads ANTHROPIC_API_KEY at request time', async () => {
    process.env.ANTHROPIC_API_KEY = 'environment-api-key';
    const fetch = vi.fn<AnthropicFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'Summary.' }] }),
      text: async () => '',
    }));

    await createAnthropicReleaseSummaryGenerator({ fetch })(request);

    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('environment-api-key');
  });

  test('fails before making a request when the API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetch = vi.fn<AnthropicFetch>();

    await expect(createAnthropicReleaseSummaryGenerator({ fetch })(request)).rejects.toThrow(
      /Missing Anthropic API key/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test('surfaces API errors without exposing the key', async () => {
    const fetch = vi.fn<AnthropicFetch>(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid x-api-key' } }),
      text: async () => '',
    }));

    await expect(
      createAnthropicReleaseSummaryGenerator({ apiKey: 'secret-key-value', fetch })(request),
    ).rejects.toThrow('Anthropic Messages API failed with status 401: invalid x-api-key');
    await expect(
      createAnthropicReleaseSummaryGenerator({ apiKey: 'secret-key-value', fetch })(request),
    ).rejects.not.toThrow(/secret-key-value/);
  });

  test('rejects successful responses without text content', async () => {
    const fetch = vi.fn<AnthropicFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'tool_use' }] }),
      text: async () => '',
    }));

    await expect(
      createAnthropicReleaseSummaryGenerator({ apiKey: 'test-api-key', fetch })(request),
    ).rejects.toThrow(/no text content/);
  });
});
