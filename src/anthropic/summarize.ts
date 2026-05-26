import type { SummarizedConversation } from '../types';

export interface SummarizeInput {
  apiKey: string;
  model: string;
  transcript: string;
  counterparty: string;
}

const SYSTEM_PROMPT = `You are summarizing a Discord conversation for logging into a Salesforce Opportunity activity. The input transcript was captured from Discord's web client and may be noisy: it can include date dividers, partial embed text, forwarded email snippets, mentions, and stripped attachments.

Your output MUST be a single JSON object with exactly two string fields:
- "subject": a short single sentence (max 80 characters) describing what happened or what was discussed. DO NOT start with "Discord" or "Discord:" — that prefix is added by the calling code. Use specific, useful language ("Joe confirmed Q2 renewal", "Pricing pushback on enterprise tier", "Forwarded email about beta access timing"). If the input is sparse but you can infer the topic from context, use the inference (e.g. "Forwarded email about [topic]" if a forwarded email is visible).
- "description": a clean, readable rendering of the conversation suitable for a Salesforce Comments field. Preserve who said what and in what order. Include forwarded email subjects/bodies if present in the transcript. Strip Discord-specific noise (typing indicators, reaction counts, edit markers, "today at" timestamps if you have ISO dates). If the input is extremely sparse (e.g. only a date divider), still try to produce a useful description by noting what was visible ("User forwarded an email dated 10/31/24; full content not captured").

Output only the JSON object. No markdown fences. No commentary. No leading or trailing whitespace.`;

export async function summarizeForSalesforce(
  input: SummarizeInput
): Promise<SummarizedConversation> {
  const userPrompt = `Conversation with @${input.counterparty || 'unknown'}:\n\n${input.transcript}`;

  const responseText = await callAnthropic(input.apiKey, input.model, [
    { role: 'user', content: userPrompt }
  ]);

  const parsed = tryParseJson(responseText);
  if (parsed && typeof parsed.subject === 'string' && typeof parsed.description === 'string') {
    return {
      subject: stripDiscordPrefix(parsed.subject),
      description: parsed.description
    };
  }

  return { subject: 'general update', description: input.transcript };
}

function tryParseJson(text: string): { subject?: unknown; description?: unknown } | null {
  // Strip common LLM wrappers (markdown fences, leading text)
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to find the first { ... } block
    const braceMatch = candidate.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function stripDiscordPrefix(subject: string): string {
  return subject.replace(/^\s*discord\s*:?\s*/i, '').trim() || 'general update';
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

function callAnthropic(
  apiKey: string,
  model: string,
  messages: AnthropicMessage[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      data: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      }),
      onload: (response: { status: number; responseText: string }) => {
        if (response.status !== 200) {
          reject(new Error(`Anthropic API returned ${response.status}: ${response.responseText}`));
          return;
        }
        try {
          const body = JSON.parse(response.responseText);
          const text = body?.content?.[0]?.text;
          if (typeof text !== 'string') {
            reject(new Error('Anthropic response missing content[0].text'));
            return;
          }
          resolve(text);
        } catch (e) {
          reject(e);
        }
      },
      onerror: (err: unknown) => reject(err)
    });
  });
}
