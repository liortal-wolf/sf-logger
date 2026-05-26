// Pure helpers for normalizing Discord conversation text.
// The DOM-touching wrapper lives in src/discord/ui.ts and just calls these.

const TYPING_RE = /\[?\s*[\w_]+ is typing\.+\s*\]?/gi;
const REACTION_ONLY_RE = /^[\p{Emoji}\s]+ ?\d+$/u;

export function extractFromSelectionText(rawText: string): string {
  return rawText
    .split('\n')
    .map(line => line.replace(TYPING_RE, '').trim())
    .filter(line => line.length > 0)
    .filter(line => !REACTION_ONLY_RE.test(line))
    .join('\n');
}

export function detectCounterpartyFromDocumentTitle(title: string): string {
  const match = title.match(/@([a-zA-Z0-9_.]+)\s*-\s*Discord$/);
  return match ? match[1] : '';
}
