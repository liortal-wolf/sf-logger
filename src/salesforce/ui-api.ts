// Salesforce Lightning UI API client. Verified against the user's Overwolf
// org on 2026-05-28: see docs/superpowers/specs/2026-05-28-sf-ui-api-switch-design.md
// for endpoint shapes and example payloads.

const API_VERSION = 'v60.0';
const API_BASE = `/services/data/${API_VERSION}/ui-api`;

let sessionBlocked = false;

function logFetchFailure(endpoint: string, reason: string): void {
  console.warn(`[discord-sf-logger] UI API ${endpoint} failed: ${reason}`);
}

async function fetchJson<T = unknown>(path: string): Promise<T | null> {
  if (sessionBlocked) return null;
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin' });
  } catch (err) {
    logFetchFailure(path, `network error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    sessionBlocked = true;
    logFetchFailure(path, `auth ${res.status} — pausing UI API for the rest of this session`);
    return null;
  }
  if (!res.ok) {
    logFetchFailure(path, `HTTP ${res.status}`);
    return null;
  }
  try {
    return await res.json() as T;
  } catch (err) {
    logFetchFailure(path, `malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface UiApiContact {
  id: string;
  name: string;
  discordUsername: string | null;
  account?: { id: string; name: string };
}

interface RawUiRecord {
  id?: string;
  fields?: Record<string, RawUiField | undefined>;
}

interface RawUiField {
  value: unknown;
  displayValue?: string | null;
}

function readFieldValue(field: RawUiField | undefined): string | null {
  if (!field) return null;
  const v = field.value;
  return typeof v === 'string' ? v : null;
}

function readAccountFromRecord(fields: Record<string, RawUiField | undefined> | undefined): { id: string; name: string } | undefined {
  if (!fields) return undefined;
  const accountField = fields.Account;
  const accountId = readFieldValue(fields.AccountId);
  const accountName = accountField?.displayValue ?? null;
  const nestedId =
    accountField?.value && typeof accountField.value === 'object' && 'id' in (accountField.value as object)
      ? ((accountField.value as { id?: unknown }).id)
      : undefined;
  const id = accountId ?? (typeof nestedId === 'string' ? nestedId : null);
  if (id && accountName) return { id, name: accountName };
  return undefined;
}

export async function fetchContact(id: string): Promise<UiApiContact | null> {
  const fields = ['Contact.Name', 'Contact.Discord__c', 'Contact.AccountId', 'Contact.Account.Name'].join(',');
  const body = await fetchJson<RawUiRecord>(`${API_BASE}/records/${id}?fields=${fields}`);
  if (!body?.fields) return null;
  const name = readFieldValue(body.fields.Name);
  if (!name || !body.id) return null;
  return {
    id: body.id,
    name,
    discordUsername: readFieldValue(body.fields.Discord__c),
    account: readAccountFromRecord(body.fields)
  };
}

export interface UiApiOpportunity {
  id: string;
  name: string;
  stage?: string;
  account?: { id: string; name: string };
}

export async function fetchOpportunity(id: string): Promise<UiApiOpportunity | null> {
  const fields = ['Opportunity.Name', 'Opportunity.StageName', 'Opportunity.AccountId', 'Opportunity.Account.Name'].join(',');
  const body = await fetchJson<RawUiRecord>(`${API_BASE}/records/${id}?fields=${fields}`);
  if (!body?.fields) return null;
  const name = readFieldValue(body.fields.Name);
  if (!name || !body.id) return null;
  // Prefer displayValue for StageName (it's the user-facing picklist label);
  // fall back to value for orgs without translations enabled.
  const stageDisplay = body.fields.StageName?.displayValue ?? null;
  const stageValue = readFieldValue(body.fields.StageName);
  const stage = stageDisplay ?? stageValue ?? undefined;
  return {
    id: body.id,
    name,
    stage,
    account: readAccountFromRecord(body.fields)
  };
}

export const __testing__ = {
  resetSessionState(): void { sessionBlocked = false; },
  isSessionBlocked(): boolean { return sessionBlocked; }
};
