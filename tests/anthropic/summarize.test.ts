import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeForSalesforce, composeDescription } from '../../src/anthropic/summarize';

describe('anthropic summarize', () => {
  beforeEach(() => __resetGM());
  afterEach(() => {
    __resetGM();
    vi.restoreAllMocks();
  });

  it('calls Anthropic API with the correct headers and body, returns subject+tldr', async () => {
    const xhrSpy = vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      expect(details.url).toBe('https://api.anthropic.com/v1/messages');
      expect(details.method).toBe('POST');
      expect(details.headers['x-api-key']).toBe('sk-ant-test');
      expect(details.headers['anthropic-version']).toBe('2023-06-01');
      expect(details.headers['content-type']).toBe('application/json');
      const body = JSON.parse(details.data);
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.max_tokens).toBeGreaterThan(0);

      details.onload({
        status: 200,
        responseText: JSON.stringify({
          content: [{
            type: 'text',
            text: JSON.stringify({
              subject: 'Joe confirmed renewal',
              tldr: '- Joe committed to Q2 renewal at current pricing'
            })
          }]
        })
      });
    });

    const result = await summarizeForSalesforce({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5-20251001',
      transcript: '[2026-05-26] joe_acme: yes we renew Q2',
      counterparty: 'joe_acme'
    });

    expect(result.subject).toBe('Joe confirmed renewal');
    expect(result.tldr).toBe('- Joe committed to Q2 renewal at current pricing');
    expect(xhrSpy).toHaveBeenCalledOnce();
  });

  it('rejects when Anthropic returns a non-200 status', async () => {
    vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      details.onload({ status: 401, responseText: '{"error": "invalid api key"}' });
    });

    await expect(summarizeForSalesforce({
      apiKey: 'bad-key',
      model: 'claude-haiku-4-5-20251001',
      transcript: 'hi',
      counterparty: 'joe'
    })).rejects.toThrow(/401/);
  });

  it('falls back to subject="general update" and empty tldr if JSON parsing fails', async () => {
    vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      details.onload({
        status: 200,
        responseText: JSON.stringify({
          content: [{ type: 'text', text: 'this is not valid JSON output' }]
        })
      });
    });

    const result = await summarizeForSalesforce({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5-20251001',
      transcript: 'raw transcript here',
      counterparty: 'joe'
    });
    expect(result.subject).toBe('general update');
    expect(result.tldr).toBe('');
  });

  it('strips a leading "Discord:" prefix from the LLM subject to avoid double-prefixing', async () => {
    vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      details.onload({
        status: 200,
        responseText: JSON.stringify({
          content: [{
            type: 'text',
            text: JSON.stringify({
              subject: 'Discord: Joe confirmed Q2 renewal',
              tldr: '- something'
            })
          }]
        })
      });
    });

    const result = await summarizeForSalesforce({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5-20251001',
      transcript: 'transcript here',
      counterparty: 'joe'
    });
    expect(result.subject).toBe('Joe confirmed Q2 renewal');
  });

  it('parses JSON even when LLM wraps it in markdown fences', async () => {
    vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      details.onload({
        status: 200,
        responseText: JSON.stringify({
          content: [{
            type: 'text',
            text: '```json\n{"subject": "Fenced subject", "tldr": "- Fenced bullet"}\n```'
          }]
        })
      });
    });

    const result = await summarizeForSalesforce({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5-20251001',
      transcript: 'x',
      counterparty: 'joe'
    });
    expect(result.subject).toBe('Fenced subject');
    expect(result.tldr).toBe('- Fenced bullet');
  });
});

describe('composeDescription', () => {
  it('joins TL;DR + transcript with a separator when both are present', () => {
    const out = composeDescription('- Point A\n- Point B', 'joe: yes\nlior: great');
    expect(out).toBe(
      'TL;DR\n- Point A\n- Point B\n\n---\n\nFull conversation:\njoe: yes\nlior: great'
    );
  });

  it('returns the transcript alone when there is no TL;DR', () => {
    expect(composeDescription('', 'transcript only')).toBe('transcript only');
  });

  it('returns the TL;DR alone when there is no transcript', () => {
    expect(composeDescription('- Point A', '')).toBe('TL;DR\n- Point A');
  });

  it('returns empty string when both are empty', () => {
    expect(composeDescription('', '')).toBe('');
  });

  it('trims whitespace from both inputs', () => {
    const out = composeDescription('  - X  ', '  joe: hi  ');
    expect(out).toBe('TL;DR\n- X\n\n---\n\nFull conversation:\njoe: hi');
  });
});
