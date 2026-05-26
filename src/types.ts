export interface LearnedMapping {
  oppId: string;
  oppName: string;
  lastUsed: string; // ISO 8601
}

export interface RecentSFRecord {
  id: string;
  name: string;
  type: 'Opportunity' | 'Account' | 'Contact';
  visitedAt: string;       // ISO 8601
  lastFocusedAt: string;   // ISO 8601
  accountName?: string;    // For Opportunity records: the linked Account name (if found)
  accountId?: string;      // For Opportunity records: the linked Account ID (if found)
}

export interface Settings {
  anthropicApiKey: string;
  anthropicModel: string;          // default: 'claude-haiku-4-5-20251001'
  subjectPrefix: string;           // default: 'Discord: '
  skipPopupWhenConfident: boolean; // default: false
  sfDomain: string;                // e.g. 'overwolf.lightning.force.com'
}

export interface CapturedDiscordContext {
  text: string;
  counterpartyUsername: string;  // e.g. 'joe_acme'; empty string if unknown
  channelType: 'dm' | 'group-dm' | 'server-channel';
  channelLabel: string;          // e.g. 'DM with joe_acme' or 'Acme Inc / #partners'
}

export interface SummarizedConversation {
  subject: string;       // one-line, will be prefixed with subjectPrefix later
  description: string;   // cleaned transcript for SF Description field
}

export type IdentifyStrategy =
  | { kind: 'open-sf-tab'; record: RecentSFRecord }
  | { kind: 'learned-mapping'; record: RecentSFRecord }
  | { kind: 'picker'; choices: RecentSFRecord[] }
  | { kind: 'manual' };
