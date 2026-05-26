// AI is responsible ONLY for producing a short subject + bulleted TL;DR.
// The actual conversation transcript is kept verbatim (captured in Discord
// content script) and composed into the final description by the caller.

export interface SummarizeInput {
  apiKey: string;
  model: string;
  transcript: string;
  counterparty: string;
}

export interface AISummary {
  subject: string;
  tldr: string;
}

const SYSTEM_PROMPT = `You generate a Salesforce activity headline + TL;DR from a Discord conversation excerpt.

Output a single JSON object with exactly two string fields:
- "subject": one short sentence (max 80 chars) capturing what happened. DO NOT start with "Discord" or "Discord:" — the caller adds that prefix. Be specific ("Joe confirmed Q2 renewal", "Pricing pushback on enterprise tier", "Forwarded email asking about beta access timing").
- "tldr": 1-3 short bullet points, each on its own line prefixed with "- ", covering outcomes, commitments, action items, asks. Skip pleasantries. Aim for ~30-60 words total. If the conversation is too sparse to bullet, write a single short sentence summary instead.

Output only the JSON object. No markdown fences. No commentary.`;

export async function summarizeForSalesforce(input: SummarizeInput): Promise<AISummary> {
  const userPrompt = `Conversation with @${input.counterparty || 'unknown'}:\n\n${input.transcript}`;

  const responseText = await callAnthropic(input.apiKey, input.model, [
    { role: 'user', content: userPrompt }
  ]);

  const parsed = tryParseJson(responseText);
  if (parsed && typeof parsed.subject === 'string') {
    return {
      subject: stripDiscordPrefix(parsed.subject),
      tldr: typeof parsed.tldr === 'string' ? parsed.tldr.trim() : ''
    };
  }

  return { subject: 'general update', tldr: '' };
}

// Compose the final SF Description: AI's TL;DR at the top, separator, then the
// verbatim transcript the user captured.
export function composeDescription(tldr: string, verbatimTranscript: string): string {
  const trimmedTldr = tldr.trim();
  const trimmedTranscript = verbatimTranscript.trim();
  if (trimmedTldr && trimmedTranscript) {
    return `TL;DR\n${trimmedTldr}\n\n---\n\nFull conversation:\n${trimmedTranscript}`;
  }
  if (trimmedTranscript) return trimmedTranscript;
  if (trimmedTldr) return `TL;DR\n${trimmedTldr}`;
  return '';
}

function tryParseJson(
  text: string
): { subject?: unknown; tldr?: unknown } | null {
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
        max_tokens: 600,
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
