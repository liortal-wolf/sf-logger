import type { SummarizedConversation } from '../types';

export interface SummarizeInput {
  apiKey: string;
  model: string;
  transcript: string;
  counterparty: string;
}

const SYSTEM_PROMPT = `You are summarizing a Discord conversation for logging into a Salesforce Opportunity activity. The input transcript was captured from Discord's web client and may be noisy: date dividers, partial embed text, forwarded email snippets, mentions, stripped attachments.

Output a single JSON object with exactly THREE string fields:
- "subject": one short sentence (max 80 chars) capturing what happened. DO NOT start with "Discord" or "Discord:" — the calling code adds that prefix. Be specific ("Joe confirmed Q2 renewal", "Pricing pushback on enterprise tier", "Forwarded email asking about beta access timing").
- "tldr": 1-3 short bullet points (each on its own line, prefixed with "- ") covering the key takeaways. Focus on outcomes, commitments, action items, asks. Skip pleasantries. Aim for ~30-60 words total.
- "transcript": a clean, readable rendering of the conversation suitable for full context. Preserve who said what and in what order. Include forwarded email subjects/bodies if present. Strip Discord noise (typing indicators, reaction counts, edit markers, "today at" timestamps when you have ISO dates). If the input is extremely sparse, still produce something useful ("User forwarded an email dated 10/31/24; full content not captured").

Output only the JSON object. No markdown fences. No commentary. No leading or trailing whitespace.`;

export async function summarizeForSalesforce(
  input: SummarizeInput
): Promise<SummarizedConversation> {
  const userPrompt = `Conversation with @${input.counterparty || 'unknown'}:\n\n${input.transcript}`;

  const responseText = await callAnthropic(input.apiKey, input.model, [
    { role: 'user', content: userPrompt }
  ]);

  const parsed = tryParseJson(responseText);
  if (parsed && typeof parsed.subject === 'string') {
    const subject = stripDiscordPrefix(parsed.subject);
    const tldr = typeof parsed.tldr === 'string' ? parsed.tldr.trim() : '';
    const transcript = typeof parsed.transcript === 'string'
      ? parsed.transcript
      : (typeof parsed.description === 'string' ? parsed.description : input.transcript);
    return {
      subject,
      description: formatDescription(tldr, transcript)
    };
  }

  return { subject: 'general update', description: formatDescription('', input.transcript) };
}

function formatDescription(tldr: string, transcript: string): string {
  if (tldr && transcript) {
    return `TL;DR\n${tldr}\n\n---\n\nFull conversation:\n${transcript}`;
  }
  if (transcript) return transcript;
  if (tldr) return `TL;DR\n${tldr}`;
  return '';
}

function tryParseJson(
  text: string
): { subject?: unknown; tldr?: unknown; transcript?: unknown; description?: unknown } | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
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
        max_tokens: 1500,
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
