export interface LearnedMapping {
  oppId: string;
  oppName: string;
  lastUsed: string; // ISO 8601
}

export interface RecentOpportunity {
  id: string;
  name: string;
  visitedAt: string;       // ISO 8601
  lastFocusedAt: string;   // ISO 8601
  account?: { id: string; name: string };
  contacts?: Array<{ id: string; name: string; lastSeenAt: string }>;
}

export interface RecentContact {
  id: string;
  name: string;
  visitedAt: string;
  lastFocusedAt: string;
  discordUsername?: string;
  discordUserId?: string;
  opps?: Array<{
    id: string;
    name: string;
    accountName?: string;
    stage?: string;
    lastSeenAt: string;
  }>;
}

export type RecentSFRecord = RecentOpportunity;

export interface Settings {
  anthropicApiKey: string;
  anthropicModel: string;
  subjectPrefix: string;
  skipPopupWhenConfident: boolean;
  sfDomain: string;
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

export interface DiscordCounterparty {
  username: string;
  userId?: string;
}

export type IdentifyStrategy =
  | { kind: 'open-sf-tab'; record: RecentOpportunity }
  | { kind: 'learned-mapping'; record: RecentOpportunity }
  | {
      kind: 'contact-scoped-picker';
      contact: { id: string; name: string; discordUsername?: string; discordUserId?: string };
      choices: Array<{ id: string; name: string; accountName?: string; stage?: string }>;
    }
  | { kind: 'picker'; choices: RecentOpportunity[] }
  | { kind: 'manual' };
