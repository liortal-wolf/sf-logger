import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeForSalesforce } from '../../src/anthropic/summarize';

describe('anthropic summarize', () => {
  beforeEach(() => __resetGM());
  afterEach(() => {
    __resetGM();
    vi.restoreAllMocks();
  });

  it('calls Anthropic API with the correct headers and body', async () => {
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
              description: '[2026-05-26] joe_acme: yes we renew Q2'
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
    expect(result.description).toBe('[2026-05-26] joe_acme: yes we renew Q2');
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

  it('falls back to a generic subject and raw transcript if JSON parsing fails', async () => {
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
    expect(result.description).toBe('raw transcript here');
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
              description: 'transcript here'
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
            text: '```json\n{"subject": "Fenced subject", "description": "Fenced desc"}\n```'
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
    expect(result.description).toBe('Fenced desc');
  });
});
