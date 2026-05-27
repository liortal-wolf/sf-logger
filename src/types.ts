export interface LearnedMapping {
  oppId: string;
  oppName: string;
  lastUsed: string; // ISO 8601
}

// One entry per Opportunity visited in Salesforce. Account info is nested
// inline because there's a 1:1 relationship Opp → Account, and the picker
// is Opportunity-centric (you log activities against Opps, not Accounts).
export interface RecentOpportunity {
  id: string;
  name: string;
  visitedAt: string;       // ISO 8601
  lastFocusedAt: string;   // ISO 8601
  account?: { id: string; name: string };
}

// Contacts are tracked separately because they have an M:N relationship with
// Opportunities — a Contact can appear on multiple deals.
export interface RecentContact {
  id: string;
  name: string;
  visitedAt: string;
  lastFocusedAt: string;
  discordUsername?: string;  // value of the "Discord" custom field on the Contact, if present
}

// Back-compat alias so older imports keep compiling. Prefer RecentOpportunity
// in new code.
export type RecentSFRecord = RecentOpportunity;

export interface Settings {
  anthropicApiKey: string;
  anthropicModel: string;          // default: 'claude-haiku-4-5-20251001'
  subjectPrefix: string;           // default: 'Discord: '
  skipPopupWhenConfident: boolean; // default: false
  sfDomain: string;                // e.g. 'overwolf.lightning.force.com'
}

export interface CapturedDiscordContext {
  text: string;
  counterpartyUsername: string;
  channelType: 'dm' | 'group-dm' | 'server-channel';
  channelLabel: string;
}

export interface SummarizedConversation {
  subject: string;
  description: string;
}

export type IdentifyStrategy =
  | { kind: 'open-sf-tab'; record: RecentOpportunity }
  | { kind: 'learned-mapping'; record: RecentOpportunity }
  | { kind: 'picker'; choices: RecentOpportunity[] }
  | { kind: 'manual' };
