import { describe, it, expect } from 'vitest';
import { extractFromSelectionText, detectCounterpartyFromDocumentTitle } from '../../src/discord/selection';

describe('Discord selection extraction', () => {
  it('passes through clean selection text', () => {
    const raw = 'joe_acme — Yesterday at 4:30 PM\nyes we renew Q2\nlior_tal — Today at 9:01 AM\ngreat';
    const out = extractFromSelectionText(raw);
    expect(out).toContain('joe_acme');
    expect(out).toContain('yes we renew Q2');
  });

  it('strips typing indicators but passes other content to the LLM for cleanup', () => {
    const raw = '[Lior is typing...]\njoe_acme — Yesterday at 4:30 PM\nyes we renew Q2\n👍 3';
    const out = extractFromSelectionText(raw);
    expect(out).not.toMatch(/typing/i);
    expect(out).toContain('yes we renew Q2');
    // Reaction-only lines are kept; the LLM handles them in summarize step
    expect(out).toContain('👍 3');
  });

  it('detects counterparty from a typical Discord DM document title', () => {
    expect(detectCounterpartyFromDocumentTitle('@joe_acme - Discord')).toBe('joe_acme');
    expect(detectCounterpartyFromDocumentTitle('(2) @joe_acme - Discord')).toBe('joe_acme');
  });

  it('returns empty string when title does not have @username form', () => {
    expect(detectCounterpartyFromDocumentTitle('#general | Acme Inc - Discord')).toBe('');
    expect(detectCounterpartyFromDocumentTitle('Discord')).toBe('');
  });
});
