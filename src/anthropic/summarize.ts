import type { SummarizedConversation } from '../types';

export interface SummarizeInput {
  apiKey: string;
  model: string;
  transcript: string;
  counterparty: string;
}

const SYSTEM_PROMPT = `You are summarizing a Discord conversation for logging into Salesforce.
Output a JSON object with exactly two fields:
- "subject": a single sentence (max 80 chars) capturing the most important outcome or topic
- "description": a cleaned-up version of the transcript suitable for the SF Description field. Strip Discord noise (typing indicators, reactions, edit markers); preserve who said what and in what order; use ISO timestamps if available.
Do not include any other text, markdown, or commentary. Output only the JSON object.`;

export async function summarizeForSalesforce(
  input: SummarizeInput
): Promise<SummarizedConversation> {
  const userPrompt = `Conversation with @${input.counterparty}:\n\n${input.transcript}`;

  const responseText = await callAnthropic(input.apiKey, input.model, [
    { role: 'user', content: userPrompt }
  ]);

  try {
    const parsed = JSON.parse(responseText);
    if (typeof parsed.subject === 'string' && typeof parsed.description === 'string') {
      return { subject: parsed.subject, description: parsed.description };
    }
  } catch {
    // fall through to fallback below
  }

  return { subject: 'Discord', description: input.transcript };
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
