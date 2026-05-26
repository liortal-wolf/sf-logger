# Discord-to-Salesforce Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tampermonkey userscript that captures highlighted Discord conversations, summarizes them with Anthropic, and opens a pre-filled Salesforce Task page on the right Opportunity — distributed via a public GitHub repo with auto-update.

**Architecture:** Single TypeScript codebase bundled by Vite + `vite-plugin-monkey` into one `.user.js` artifact. Two content-script modes (Discord web, Salesforce Lightning) dispatched by URL match. State in Tampermonkey local storage. Anthropic API calls via `GM_xmlhttpRequest` (bypasses CORS). Salesforce updates via Lightning URL hacking (no SF API needed).

**Tech Stack:** TypeScript, Vite, vite-plugin-monkey, Vitest + happy-dom for tests, Tampermonkey `GM_*` APIs. No UI framework (vanilla DOM for the small popup).

**Spec:** [docs/superpowers/specs/2026-05-25-discord-to-salesforce-logger-design.md](../specs/2026-05-25-discord-to-salesforce-logger-design.md)

---

## File Structure

```
discord-sf-logger/
├── package.json
├── tsconfig.json
├── vite.config.ts            # Userscript metadata (@updateURL, @grant, @connect, etc.)
├── vitest.config.ts          # Test config with happy-dom + GM mocks
├── .gitignore                # already exists
├── README.md                 # Install + usage + troubleshooting
├── src/
│   ├── main.ts               # Entry point; routes to Discord or Salesforce by location.hostname
│   ├── types.ts              # Shared types (LearnedMapping, RecentSFRecord, etc.)
│   ├── storage/
│   │   ├── settings.ts       # API key + user prefs (CRUD on GM storage)
│   │   ├── mappings.ts       # Learned Discord-user → SF-record mappings
│   │   └── recent-sf.ts      # Recent SF records visited (rolling 20)
│   ├── salesforce/
│   │   ├── content-script.ts # Watch Opp/Account page nav, record to storage
│   │   └── url-builder.ts    # Construct the prefilled SF Task URL
│   ├── anthropic/
│   │   └── summarize.ts      # Call Anthropic via GM_xmlhttpRequest, return Subject + Description
│   ├── matching/
│   │   └── identify.ts       # A→B→C→D strategy chain to resolve SF target
│   ├── discord/
│   │   ├── content-script.ts # Inject button into Discord UI
│   │   ├── selection.ts      # Pure DOM-text extraction logic
│   │   └── ui.ts             # Button + right-click integration
│   ├── popup/
│   │   ├── popup.ts          # Confirmation panel logic
│   │   ├── popup-template.ts # HTML template literal
│   │   └── popup-styles.ts   # CSS template literal
│   └── settings/
│       └── settings-ui.ts    # API key entry UI registered via GM_registerMenuCommand
└── tests/
    ├── __mocks__/
    │   └── gm.ts             # In-memory mock of GM_setValue / GM_getValue / etc.
    ├── storage/
    │   ├── settings.test.ts
    │   ├── mappings.test.ts
    │   └── recent-sf.test.ts
    ├── salesforce/
    │   └── url-builder.test.ts
    ├── matching/
    │   └── identify.test.ts
    ├── anthropic/
    │   └── summarize.test.ts
    └── discord/
        └── selection.test.ts
```

Each module has one responsibility and a narrow public API. The split makes each file small enough to hold in context. Tests target pure logic; browser glue (content scripts, UI) is kept thin and verified manually in Task 16.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `README.md`
- Working directory for all subsequent tasks: `C:\Users\Lior\Documents\Claude\discord\`

- [ ] **Step 1: Initialize npm project**

Run:
```bash
npm init -y
```
Expected: `package.json` is created.

- [ ] **Step 2: Install runtime + dev dependencies**

Run:
```bash
npm install --save-dev typescript vite vite-plugin-monkey vitest happy-dom @types/node
```
Expected: `node_modules/` populated; `package-lock.json` created; no errors.

- [ ] **Step 3: Write `package.json` scripts and metadata**

Overwrite `package.json` with:
```json
{
  "name": "discord-sf-logger",
  "version": "0.1.0",
  "private": true,
  "description": "Tampermonkey userscript to log Discord web conversations to Salesforce Opportunities",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vite-plugin-monkey": "^4.0.0",
    "vitest": "^1.5.0",
    "happy-dom": "^14.0.0",
    "@types/node": "^20.0.0"
  }
}
```
Note: actual version pins will be whatever npm installed in Step 2 — use those.

- [ ] **Step 4: Write `tsconfig.json`**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite-plugin-monkey/global"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Write `vite.config.ts` (userscript metadata)**

Create `vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// IMPORTANT: Set REPO_OWNER and REPO_NAME below before publishing the first release.
// The @updateURL/@downloadURL must point at the public GitHub raw URL or auto-update will not work.
const REPO_OWNER = 'CHANGE_ME';
const REPO_NAME = 'discord-sf-logger';
const SCRIPT_FILENAME = 'discord-sf-logger.user.js';
const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/dist/${SCRIPT_FILENAME}`;

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Discord → Salesforce Logger',
        namespace: 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME,
        version: '0.1.0',
        description: 'Log highlighted Discord conversations to Salesforce Opportunities with AI summaries',
        author: 'Overwolf',
        match: [
          'https://discord.com/*',
          'https://*.lightning.force.com/*'
        ],
        grant: [
          'GM_setValue',
          'GM_getValue',
          'GM_listValues',
          'GM_deleteValue',
          'GM_addValueChangeListener',
          'GM_xmlhttpRequest',
          'GM_registerMenuCommand',
          'GM_openInTab',
          'unsafeWindow'
        ],
        connect: ['api.anthropic.com'],
        updateURL: RAW_URL,
        downloadURL: RAW_URL,
        supportURL: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`
      },
      build: {
        fileName: SCRIPT_FILENAME
      }
    })
  ]
});
```

- [ ] **Step 6: Write `vitest.config.ts`**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./tests/__mocks__/gm.ts'],
    include: ['tests/**/*.test.ts']
  }
});
```

- [ ] **Step 7: Create entry point stub**

Create `src/main.ts`:
```ts
// Entry point. Dispatch to discord or salesforce based on hostname.
const host = window.location.hostname;

if (host === 'discord.com') {
  console.log('[discord-sf-logger] running on Discord');
} else if (host.endsWith('.lightning.force.com')) {
  console.log('[discord-sf-logger] running on Salesforce Lightning');
}
```

- [ ] **Step 8: Verify build produces a userscript**

Run:
```bash
npm run build
```
Expected: `dist/discord-sf-logger.user.js` exists and starts with `// ==UserScript==`. Open the file in an editor and confirm the header includes all `@grant`, `@match`, `@connect`, `@updateURL`, `@downloadURL` lines.

- [ ] **Step 9: Verify test runner works**

Run:
```bash
npm test
```
Expected: vitest reports "No test files found". This is the expected state before we write any tests.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts src/main.ts
echo "node_modules/" >> .gitignore
echo "dist/" >> .gitignore
git add .gitignore
git commit -m "chore: scaffold vite + vite-plugin-monkey + vitest project

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: GM API mock for testing

**Files:**
- Create: `tests/__mocks__/gm.ts`

Tampermonkey injects `GM_*` functions into the userscript's global scope. In tests we need an in-memory mock so storage tests can run without a real browser extension. This mock will be auto-loaded by vitest via `setupFiles`.

- [ ] **Step 1: Write the GM mock**

Create `tests/__mocks__/gm.ts`:
```ts
// In-memory mock of Tampermonkey GM_* APIs for use in vitest.
// Exposes a `__resetGM()` helper to clear state between tests.

declare global {
  // eslint-disable-next-line no-var
  var GM_setValue: (key: string, value: unknown) => void;
  var GM_getValue: <T>(key: string, defaultValue?: T) => T;
  var GM_listValues: () => string[];
  var GM_deleteValue: (key: string) => void;
  var GM_xmlhttpRequest: (details: GMXHRDetails) => void;
  var GM_registerMenuCommand: (caption: string, fn: () => void) => number;
  var GM_addValueChangeListener: (
    key: string,
    listener: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void
  ) => number;
  var GM_openInTab: (url: string, options?: { active?: boolean; insert?: boolean }) => void;
  // eslint-disable-next-line no-var
  var __resetGM: () => void;
}

interface GMXHRDetails {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: string;
  onload?: (response: { status: number; responseText: string }) => void;
  onerror?: (err: unknown) => void;
}

const store = new Map<string, unknown>();
const openedTabs: string[] = [];

(globalThis as any).GM_setValue = (key: string, value: unknown) => {
  store.set(key, structuredClone(value));
};

(globalThis as any).GM_getValue = <T>(key: string, defaultValue?: T): T => {
  if (!store.has(key)) return defaultValue as T;
  return structuredClone(store.get(key)) as T;
};

(globalThis as any).GM_listValues = (): string[] => Array.from(store.keys());

(globalThis as any).GM_deleteValue = (key: string) => {
  store.delete(key);
};

(globalThis as any).GM_addValueChangeListener = () => 0;

(globalThis as any).GM_xmlhttpRequest = (details: GMXHRDetails) => {
  // Tests should override this per-case via vi.spyOn / vi.fn
  throw new Error('GM_xmlhttpRequest not mocked in this test; use vi.spyOn(globalThis, "GM_xmlhttpRequest")');
};

(globalThis as any).GM_registerMenuCommand = () => 0;

(globalThis as any).GM_openInTab = (url: string) => {
  openedTabs.push(url);
};

(globalThis as any).__resetGM = () => {
  store.clear();
  openedTabs.length = 0;
};

export const __getOpenedTabs = () => [...openedTabs];
```

- [ ] **Step 2: Write a smoke test that verifies the mock loads**

Create `tests/storage/_smoke.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('GM mock smoke test', () => {
  beforeEach(() => __resetGM());

  it('round-trips a value through GM_setValue / GM_getValue', () => {
    GM_setValue('foo', { a: 1 });
    expect(GM_getValue<{ a: number }>('foo')).toEqual({ a: 1 });
  });

  it('returns default when key absent', () => {
    expect(GM_getValue<string>('missing', 'default')).toBe('default');
  });
});
```

- [ ] **Step 3: Run the smoke test, expect pass**

Run:
```bash
npm test
```
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add GM API mock and smoke test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/types.ts`

Lock down the shapes used across modules so later tasks reference consistent names.

- [ ] **Step 1: Write the types module**

Create `src/types.ts`:
```ts
export interface LearnedMapping {
  oppId: string;
  oppName: string;
  lastUsed: string; // ISO 8601
}

export interface RecentSFRecord {
  id: string;
  name: string;
  type: 'Opportunity' | 'Account';
  visitedAt: string;       // ISO 8601
  lastFocusedAt: string;   // ISO 8601
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
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: define shared types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Settings storage

**Files:**
- Create: `src/storage/settings.ts`
- Test: `tests/storage/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, setSetting } from '../../src/storage/settings';

describe('settings storage', () => {
  beforeEach(() => __resetGM());

  it('returns defaults when nothing is stored', () => {
    const s = getSettings();
    expect(s.anthropicApiKey).toBe('');
    expect(s.anthropicModel).toBe('claude-haiku-4-5-20251001');
    expect(s.subjectPrefix).toBe('Discord: ');
    expect(s.skipPopupWhenConfident).toBe(false);
    expect(s.sfDomain).toBe('overwolf.lightning.force.com');
  });

  it('persists a single setting and reads it back', () => {
    setSetting('anthropicApiKey', 'sk-ant-test');
    expect(getSettings().anthropicApiKey).toBe('sk-ant-test');
  });

  it('leaves other fields untouched when updating one', () => {
    setSetting('anthropicApiKey', 'sk-ant-test');
    setSetting('subjectPrefix', 'D: ');
    const s = getSettings();
    expect(s.anthropicApiKey).toBe('sk-ant-test');
    expect(s.subjectPrefix).toBe('D: ');
    expect(s.anthropicModel).toBe('claude-haiku-4-5-20251001'); // unchanged default
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

Run:
```bash
npm test -- settings
```
Expected: FAIL with module-not-found error for `src/storage/settings`.

- [ ] **Step 3: Implement settings storage**

Create `src/storage/settings.ts`:
```ts
import type { Settings } from '../types';

const STORAGE_KEY = 'settings';

const DEFAULTS: Settings = {
  anthropicApiKey: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  subjectPrefix: 'Discord: ',
  skipPopupWhenConfident: false,
  sfDomain: 'overwolf.lightning.force.com'
};

export function getSettings(): Settings {
  const stored = GM_getValue<Partial<Settings>>(STORAGE_KEY, {});
  return { ...DEFAULTS, ...stored };
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const current = getSettings();
  GM_setValue(STORAGE_KEY, { ...current, [key]: value });
}
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- settings
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/settings.ts tests/storage/settings.test.ts
git commit -m "feat: settings storage with defaults

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Learned mappings storage

**Files:**
- Create: `src/storage/mappings.ts`
- Test: `tests/storage/mappings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/mappings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordMapping, getMappingFor, listMappings } from '../../src/storage/mappings';

describe('learned mappings', () => {
  beforeEach(() => __resetGM());

  it('returns null when no mapping for a username', () => {
    expect(getMappingFor('joe_acme')).toBeNull();
  });

  it('records and retrieves a mapping', () => {
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const m = getMappingFor('joe_acme');
    expect(m).not.toBeNull();
    expect(m!.oppId).toBe('006Hu000ABC');
    expect(m!.oppName).toBe('Acme Q2 Renewal');
    expect(typeof m!.lastUsed).toBe('string');
  });

  it('overwrites an existing mapping and updates lastUsed', async () => {
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const first = getMappingFor('joe_acme')!.lastUsed;
    await new Promise(r => setTimeout(r, 5));
    recordMapping('joe_acme', '006Hu000XYZ', 'Acme Q3 Expansion');
    const second = getMappingFor('joe_acme')!;
    expect(second.oppId).toBe('006Hu000XYZ');
    expect(second.oppName).toBe('Acme Q3 Expansion');
    expect(second.lastUsed > first).toBe(true);
  });

  it('listMappings returns all stored entries', () => {
    recordMapping('joe_acme', '006A', 'Acme');
    recordMapping('jane_beta', '006B', 'Beta');
    const all = listMappings();
    expect(Object.keys(all).sort()).toEqual(['jane_beta', 'joe_acme']);
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run:
```bash
npm test -- mappings
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement mappings storage**

Create `src/storage/mappings.ts`:
```ts
import type { LearnedMapping } from '../types';

const STORAGE_KEY = 'learned_mappings';

type MappingsMap = Record<string, LearnedMapping>;

export function listMappings(): MappingsMap {
  return GM_getValue<MappingsMap>(STORAGE_KEY, {});
}

export function getMappingFor(discordUsername: string): LearnedMapping | null {
  const all = listMappings();
  return all[discordUsername] ?? null;
}

export function recordMapping(
  discordUsername: string,
  oppId: string,
  oppName: string
): void {
  const all = listMappings();
  all[discordUsername] = {
    oppId,
    oppName,
    lastUsed: new Date().toISOString()
  };
  GM_setValue(STORAGE_KEY, all);
}
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- mappings
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/mappings.ts tests/storage/mappings.test.ts
git commit -m "feat: learned Discord-user to SF-record mappings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Recent SF records storage (rolling 20)

**Files:**
- Create: `src/storage/recent-sf.ts`
- Test: `tests/storage/recent-sf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/recent-sf.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordVisit, listRecent, getMostRecentlyFocused } from '../../src/storage/recent-sf';

describe('recent SF records', () => {
  beforeEach(() => __resetGM());

  it('returns empty list when nothing visited', () => {
    expect(listRecent()).toEqual([]);
  });

  it('records a visit and lists it', () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('006A');
    expect(list[0].type).toBe('Opportunity');
    expect(typeof list[0].visitedAt).toBe('string');
    expect(typeof list[0].lastFocusedAt).toBe('string');
  });

  it('dedups by id, updating lastFocusedAt on repeat visit', async () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const firstFocus = listRecent()[0].lastFocusedAt;
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].lastFocusedAt > firstFocus).toBe(true);
  });

  it('caps the list at 20 entries (oldest dropped)', () => {
    for (let i = 0; i < 25; i++) {
      recordVisit({ id: `006${i}`, name: `Opp ${i}`, type: 'Opportunity' });
    }
    const list = listRecent();
    expect(list.length).toBe(20);
    // The 5 oldest should have been evicted
    const ids = list.map(r => r.id);
    expect(ids).not.toContain('0060');
    expect(ids).not.toContain('0064');
    expect(ids).toContain('0065');
    expect(ids).toContain('00624');
  });

  it('getMostRecentlyFocused returns the entry with newest lastFocusedAt', async () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006B', name: 'Beta', type: 'Opportunity' });
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' }); // re-focus A
    const mr = getMostRecentlyFocused('Opportunity');
    expect(mr?.id).toBe('006A');
  });

  it('getMostRecentlyFocused filters by type', () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    recordVisit({ id: '001B', name: 'Beta Account', type: 'Account' });
    expect(getMostRecentlyFocused('Account')?.id).toBe('001B');
    expect(getMostRecentlyFocused('Opportunity')?.id).toBe('006A');
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run:
```bash
npm test -- recent-sf
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement recent SF records storage**

Create `src/storage/recent-sf.ts`:
```ts
import type { RecentSFRecord } from '../types';

const STORAGE_KEY = 'recent_sf_records';
const MAX_ENTRIES = 20;

export function listRecent(): RecentSFRecord[] {
  return GM_getValue<RecentSFRecord[]>(STORAGE_KEY, []);
}

export function recordVisit(record: {
  id: string;
  name: string;
  type: 'Opportunity' | 'Account';
}): void {
  const now = new Date().toISOString();
  const existing = listRecent();
  const idx = existing.findIndex(r => r.id === record.id);

  if (idx >= 0) {
    // Update existing entry's lastFocusedAt
    existing[idx] = { ...existing[idx], lastFocusedAt: now, name: record.name };
  } else {
    existing.push({
      id: record.id,
      name: record.name,
      type: record.type,
      visitedAt: now,
      lastFocusedAt: now
    });
  }

  // Sort by lastFocusedAt desc, cap at MAX_ENTRIES
  existing.sort((a, b) => b.lastFocusedAt.localeCompare(a.lastFocusedAt));
  const capped = existing.slice(0, MAX_ENTRIES);
  GM_setValue(STORAGE_KEY, capped);
}

export function getMostRecentlyFocused(
  type: 'Opportunity' | 'Account'
): RecentSFRecord | null {
  const matching = listRecent().filter(r => r.type === type);
  if (matching.length === 0) return null;
  // listRecent already sorts by lastFocusedAt desc
  return matching[0];
}
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- recent-sf
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/recent-sf.ts tests/storage/recent-sf.test.ts
git commit -m "feat: recent SF records storage with 20-entry cap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Salesforce URL builder

**Files:**
- Create: `src/salesforce/url-builder.ts`
- Test: `tests/salesforce/url-builder.test.ts`

This is the validated URL recipe from the spec — Subject, Description, WhatId, Status=Completed, ActivityDate.

- [ ] **Step 1: Write the failing tests**

Create `tests/salesforce/url-builder.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSFTaskUrl } from '../../src/salesforce/url-builder';

describe('SF Task URL builder', () => {
  it('builds a basic URL with required fields', () => {
    const url = buildSFTaskUrl({
      sfDomain: 'overwolf.lightning.force.com',
      subject: 'Discord: test',
      description: 'hello',
      whatId: '006Hu000ABC',
      activityDate: '2026-05-26'
    });
    expect(url).toMatch(/^https:\/\/overwolf\.lightning\.force\.com\/lightning\/o\/Task\/new\?/);
    expect(url).toContain('defaultFieldValues=');
    expect(url).toContain('Status%3DCompleted');
    expect(url).toContain('WhatId%3D006Hu000ABC');
    expect(url).toContain('ActivityDate%3D2026-05-26');
  });

  it('URL-encodes special characters in subject and description', () => {
    const url = buildSFTaskUrl({
      sfDomain: 'overwolf.lightning.force.com',
      subject: 'Discord: pricing — pushback',
      description: 'They said: "no way, this is 50% too high"',
      whatId: '006A',
      activityDate: '2026-05-26'
    });
    // em-dash, double quotes, percent sign, comma all must encode safely
    expect(url).toContain('%E2%80%94'); // em-dash
    expect(url).toContain('%22'); // double quote
    expect(url).toContain('%25'); // percent sign
    // The function must not break on a comma inside the subject
    expect(() => new URL(url)).not.toThrow();
  });

  it('the resulting URL parses cleanly with URL constructor', () => {
    const url = buildSFTaskUrl({
      sfDomain: 'overwolf.lightning.force.com',
      subject: 'Discord: Joe confirmed renewal',
      description: 'Line 1\nLine 2\nLine 3',
      whatId: '006Hu000ABC',
      activityDate: '2026-05-26'
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('defaultFieldValues')).toContain('Subject=Discord: Joe confirmed renewal');
    expect(parsed.searchParams.get('defaultFieldValues')).toContain('WhatId=006Hu000ABC');
    expect(parsed.searchParams.get('defaultFieldValues')).toContain('Status=Completed');
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run:
```bash
npm test -- url-builder
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the URL builder**

Create `src/salesforce/url-builder.ts`:
```ts
// Build a Salesforce Lightning URL that opens "New Task" with prefilled fields.
// Validated 2026-05-25 against overwolf.lightning.force.com — produces a record
// visually and functionally equivalent to a manually-logged "Log a Call → Discord" entry.

export interface BuildSFTaskUrlInput {
  sfDomain: string;        // e.g. 'overwolf.lightning.force.com'
  subject: string;
  description: string;
  whatId: string;          // 15- or 18-char Opportunity ID
  activityDate: string;    // YYYY-MM-DD
}

export function buildSFTaskUrl(input: BuildSFTaskUrlInput): string {
  const fields = {
    Subject: input.subject,
    Description: input.description,
    WhatId: input.whatId,
    Status: 'Completed',
    ActivityDate: input.activityDate
  };

  // SF's defaultFieldValues format: key1=val1,key2=val2 — where each val is URL-encoded
  // and the whole thing is URL-encoded again as the value of the defaultFieldValues param.
  const inner = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');

  const url = new URL(`https://${input.sfDomain}/lightning/o/Task/new`);
  url.searchParams.set('defaultFieldValues', inner);
  return url.toString();
}
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- url-builder
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/salesforce/url-builder.ts tests/salesforce/url-builder.test.ts
git commit -m "feat: SF Task URL builder using validated defaultFieldValues recipe

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Anthropic summarize client

**Files:**
- Create: `src/anthropic/summarize.ts`
- Test: `tests/anthropic/summarize.test.ts`

Uses `GM_xmlhttpRequest` (Tampermonkey privileged HTTP) to call Anthropic — required to bypass CORS that would block a plain `fetch()` to `api.anthropic.com` from a `discord.com` origin.

- [ ] **Step 1: Write the failing tests**

Create `tests/anthropic/summarize.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeForSalesforce } from '../../src/anthropic/summarize';

describe('anthropic summarize', () => {
  beforeEach(() => __resetGM());

  it('calls Anthropic API with the correct headers and body', async () => {
    const xhrSpy = vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      // Inspect request
      expect(details.url).toBe('https://api.anthropic.com/v1/messages');
      expect(details.method).toBe('POST');
      expect(details.headers['x-api-key']).toBe('sk-ant-test');
      expect(details.headers['anthropic-version']).toBe('2023-06-01');
      expect(details.headers['content-type']).toBe('application/json');
      const body = JSON.parse(details.data);
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.max_tokens).toBeGreaterThan(0);

      // Respond
      details.onload({
        status: 200,
        responseText: JSON.stringify({
          content: [{
            type: 'text',
            text: JSON.stringify({
              subject: 'Joe confirmed renewal',
              description: '[2026-05-26] joe_acme: yes we renew Q2'
            })
          }]
        })
      });
    });

    const result = await summarizeForSalesforce({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5-20251001',
      transcript: '[2026-05-26] joe_acme: yes we renew Q2',
      counterparty: 'joe_acme'
    });

    expect(result.subject).toBe('Joe confirmed renewal');
    expect(result.description).toBe('[2026-05-26] joe_acme: yes we renew Q2');
    expect(xhrSpy).toHaveBeenCalledOnce();
  });

  it('rejects when Anthropic returns a non-200 status', async () => {
    vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      details.onload({ status: 401, responseText: '{"error": "invalid api key"}' });
    });

    await expect(summarizeForSalesforce({
      apiKey: 'bad-key',
      model: 'claude-haiku-4-5-20251001',
      transcript: 'hi',
      counterparty: 'joe'
    })).rejects.toThrow(/401/);
  });

  it('falls back to subject="Discord" and raw transcript if JSON parsing fails', async () => {
    vi.spyOn(globalThis as any, 'GM_xmlhttpRequest').mockImplementation((details: any) => {
      details.onload({
        status: 200,
        responseText: JSON.stringify({
          content: [{ type: 'text', text: 'this is not valid JSON output' }]
        })
      });
    });

    const result = await summarizeForSalesforce({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-4-5-20251001',
      transcript: 'raw transcript here',
      counterparty: 'joe'
    });
    expect(result.subject).toBe('Discord');
    expect(result.description).toBe('raw transcript here');
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run:
```bash
npm test -- summarize
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement summarize**

Create `src/anthropic/summarize.ts`:
```ts
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

  // Fallback: use raw transcript as description, generic subject
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
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- summarize
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/anthropic/ tests/anthropic/
git commit -m "feat: Anthropic summarize via GM_xmlhttpRequest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: SF record identification strategy chain

**Files:**
- Create: `src/matching/identify.ts`
- Test: `tests/matching/identify.test.ts`

Implements the A→B→C→D strategy from spec §7.

- [ ] **Step 1: Write the failing tests**

Create `tests/matching/identify.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { identifyTarget } from '../../src/matching/identify';
import { recordVisit } from '../../src/storage/recent-sf';
import { recordMapping } from '../../src/storage/mappings';

describe('identifyTarget strategy chain', () => {
  beforeEach(() => __resetGM());

  it('returns open-sf-tab when a recently focused Opportunity exists', () => {
    recordVisit({ id: '006OPP', name: 'Acme Opp', type: 'Opportunity' });
    const result = identifyTarget({ counterparty: 'joe' });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006OPP');
    }
  });

  it('falls back to learned-mapping when no open SF tab matches', () => {
    // No recordVisit calls
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const result = identifyTarget({ counterparty: 'joe_acme' });
    expect(result.kind).toBe('learned-mapping');
    if (result.kind === 'learned-mapping') {
      expect(result.record.id).toBe('006Hu000ABC');
      expect(result.record.name).toBe('Acme Q2 Renewal');
    }
  });

  it('falls back to picker when neither open tab nor learned mapping exists, and history has recent records', () => {
    // Visit some accounts but no current opportunity
    recordVisit({ id: '001A', name: 'Acme Account', type: 'Account' });
    const result = identifyTarget({ counterparty: 'new_user' });
    expect(result.kind).toBe('picker');
    if (result.kind === 'picker') {
      expect(result.choices.length).toBeGreaterThan(0);
    }
  });

  it('falls back to manual when no history exists at all', () => {
    const result = identifyTarget({ counterparty: 'totally_new' });
    expect(result.kind).toBe('manual');
  });

  it('prioritizes open-sf-tab over learned-mapping even when both exist', () => {
    recordVisit({ id: '006TAB', name: 'Currently Open Opp', type: 'Opportunity' });
    recordMapping('joe', '006LEARNED', 'Learned Opp');
    const result = identifyTarget({ counterparty: 'joe' });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006TAB');
    }
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run:
```bash
npm test -- identify
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement identifyTarget**

Create `src/matching/identify.ts`:
```ts
import type { IdentifyStrategy, RecentSFRecord } from '../types';
import { getMostRecentlyFocused, listRecent } from '../storage/recent-sf';
import { getMappingFor } from '../storage/mappings';

export interface IdentifyInput {
  counterparty: string;
}

export function identifyTarget(input: IdentifyInput): IdentifyStrategy {
  // Strategy A: Open SF tab on an Opportunity
  const openOpp = getMostRecentlyFocused('Opportunity');
  if (openOpp && isRecent(openOpp.lastFocusedAt)) {
    return { kind: 'open-sf-tab', record: openOpp };
  }

  // Strategy B: Learned mapping for this Discord counterparty
  const mapping = getMappingFor(input.counterparty);
  if (mapping) {
    const record: RecentSFRecord = {
      id: mapping.oppId,
      name: mapping.oppName,
      type: 'Opportunity',
      visitedAt: mapping.lastUsed,
      lastFocusedAt: mapping.lastUsed
    };
    return { kind: 'learned-mapping', record };
  }

  // Strategy C: Picker from recent SF records
  const recent = listRecent().filter(r => r.type === 'Opportunity');
  if (recent.length > 0) {
    return { kind: 'picker', choices: recent };
  }

  // Strategy D: Manual entry
  return { kind: 'manual' };
}

// "Recent" means focused within the last 30 minutes — guards against an Opp tab
// that's been open for a week being preferred over a relevant learned mapping.
const RECENCY_THRESHOLD_MS = 30 * 60 * 1000;

function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RECENCY_THRESHOLD_MS;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- identify
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/matching/ tests/matching/
git commit -m "feat: SF target identification strategy chain (A->B->C->D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Salesforce content script

**Files:**
- Create: `src/salesforce/content-script.ts`

This script runs on `*.lightning.force.com/*`. Its only job: watch URL changes (Lightning is a SPA, so it doesn't reload between records), extract the record ID + name when on an Opportunity or Account page, and call `recordVisit()`.

- [ ] **Step 1: Implement the content script**

Create `src/salesforce/content-script.ts`:
```ts
import { recordVisit } from '../storage/recent-sf';

// Lightning is a SPA — popstate fires on history changes; hashchange catches some.
// We also poll every 2s as a safety net (cheap, idempotent because recordVisit dedups by id).
const POLL_INTERVAL_MS = 2000;

let lastSeenUrl = '';

interface SFPageRef {
  id: string;
  name: string;
  type: 'Opportunity' | 'Account';
}

export function startSalesforceWatcher(): void {
  const tick = () => {
    if (window.location.href === lastSeenUrl) return;
    lastSeenUrl = window.location.href;
    const page = parseLightningUrl(window.location.href);
    if (!page) return;
    // Best effort: try to read the record name from the page H1; fall back to ID
    const name = readRecordName() ?? page.id;
    recordVisit({ id: page.id, name, type: page.type });
  };

  window.addEventListener('popstate', tick);
  window.addEventListener('hashchange', tick);
  // Also tick on focus, because user often Alt-Tabs to SF after using Discord.
  window.addEventListener('focus', tick);
  setInterval(tick, POLL_INTERVAL_MS);
  // Initial tick
  tick();
}

function parseLightningUrl(url: string): { id: string; type: 'Opportunity' | 'Account' } | null {
  // Matches: /lightning/r/Opportunity/<id>/... and /lightning/r/Account/<id>/...
  const match = url.match(/\/lightning\/r\/(Opportunity|Account)\/([a-zA-Z0-9]{15,18})/);
  if (!match) return null;
  return { type: match[1] as 'Opportunity' | 'Account', id: match[2] };
}

function readRecordName(): string | null {
  // Lightning record header H1 — selector is somewhat stable but best-effort.
  const h1 = document.querySelector('h1.slds-page-header__title, h1.slds-var-p-around_xx-small');
  const text = h1?.textContent?.trim();
  return text && text.length > 0 ? text : null;
}
```

- [ ] **Step 2: Manually verify parseLightningUrl by writing a quick unit test**

Append to `tests/salesforce/url-builder.test.ts` a new describe block... actually no, keep that file focused. Create `tests/salesforce/parse-url.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
// Re-export parseLightningUrl for testing by exporting it from the module.
// (Adjust the import path/name to match the named export below.)
import { __testing__ } from '../../src/salesforce/content-script';

describe('parseLightningUrl', () => {
  const { parseLightningUrl } = __testing__;

  it('parses an Opportunity URL', () => {
    const r = parseLightningUrl('https://overwolf.lightning.force.com/lightning/r/Opportunity/006Hu000ABC/view');
    expect(r).toEqual({ type: 'Opportunity', id: '006Hu000ABC' });
  });

  it('parses an Account URL', () => {
    const r = parseLightningUrl('https://overwolf.lightning.force.com/lightning/r/Account/001Hu000XYZ/view');
    expect(r).toEqual({ type: 'Account', id: '001Hu000XYZ' });
  });

  it('returns null for non-record pages', () => {
    expect(parseLightningUrl('https://overwolf.lightning.force.com/lightning/o/Opportunity/list')).toBeNull();
    expect(parseLightningUrl('https://overwolf.lightning.force.com/lightning/o/Task/new?defaultFieldValues=...')).toBeNull();
  });
});
```

- [ ] **Step 3: Export parseLightningUrl for testing**

Modify `src/salesforce/content-script.ts` — append at the bottom:
```ts
export const __testing__ = { parseLightningUrl };
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- parse-url
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/salesforce/content-script.ts tests/salesforce/parse-url.test.ts
git commit -m "feat: SF content script records visited Opportunities and Accounts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Discord selection capture (pure logic)

**Files:**
- Create: `src/discord/selection.ts`
- Test: `tests/discord/selection.test.ts`

The DOM-touching is thin. The testable piece is: given a Selection-or-fallback, produce a normalized transcript string + counterparty.

- [ ] **Step 1: Write the failing tests**

Create `tests/discord/selection.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractFromSelectionText, detectCounterpartyFromDocumentTitle } from '../../src/discord/selection';

describe('Discord selection extraction', () => {
  it('passes through clean selection text', () => {
    const raw = 'joe_acme — Yesterday at 4:30 PM\nyes we renew Q2\nlior_tal — Today at 9:01 AM\ngreat';
    const out = extractFromSelectionText(raw);
    expect(out).toContain('joe_acme');
    expect(out).toContain('yes we renew Q2');
  });

  it('strips reaction-only lines and typing indicators', () => {
    const raw = '[Lior is typing...]\njoe_acme — Yesterday at 4:30 PM\nyes we renew Q2\n👍 3';
    const out = extractFromSelectionText(raw);
    expect(out).not.toMatch(/typing/i);
    expect(out).not.toMatch(/^👍 3$/m);
    expect(out).toContain('yes we renew Q2');
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
```

- [ ] **Step 2: Run tests, expect fail**

Run:
```bash
npm test -- selection
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement selection helpers**

Create `src/discord/selection.ts`:
```ts
// Pure helpers for normalizing Discord conversation text.
// The DOM-touching wrapper lives in src/discord/ui.ts and just calls these.

const TYPING_RE = /\[?\s*[\w_]+ is typing\.+\s*\]?/gi;
const REACTION_ONLY_RE = /^[\p{Emoji}\s]+ ?\d+$/u; // a line that is just an emoji + count

export function extractFromSelectionText(rawText: string): string {
  return rawText
    .split('\n')
    .map(line => line.replace(TYPING_RE, '').trim())
    .filter(line => line.length > 0)
    .filter(line => !REACTION_ONLY_RE.test(line))
    .join('\n');
}

export function detectCounterpartyFromDocumentTitle(title: string): string {
  // Discord DM title format: "@username - Discord" or "(N) @username - Discord"
  const match = title.match(/@([a-zA-Z0-9_.]+)\s*-\s*Discord$/);
  return match ? match[1] : '';
}
```

- [ ] **Step 4: Run tests, expect pass**

Run:
```bash
npm test -- selection
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/discord/selection.ts tests/discord/selection.test.ts
git commit -m "feat: Discord selection text + counterparty extraction

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Confirmation popup UI

**Files:**
- Create: `src/popup/popup.ts`, `src/popup/popup-template.ts`, `src/popup/popup-styles.ts`

The popup is the only UI component. It floats over Discord (rendered into a shadow DOM container we inject). Shows resolved SF target, AI-generated subject + description, with editable fields and a Send button.

- [ ] **Step 1: Write the HTML template**

Create `src/popup/popup-template.ts`:
```ts
export const popupHTML = (data: {
  targetLabel: string;
  strategyLabel: string;
  subject: string;
  description: string;
  pickerChoices: Array<{ id: string; name: string }>;
  showPicker: boolean;
  showManual: boolean;
}) => `
<div class="dsfl-popup">
  <header class="dsfl-popup__header">
    <h2>Log to Salesforce</h2>
    <button class="dsfl-popup__close" data-action="close" aria-label="Close">×</button>
  </header>

  <div class="dsfl-popup__field">
    <label>Salesforce target <span class="dsfl-popup__strategy">(${escapeHTML(data.strategyLabel)})</span></label>
    <div class="dsfl-popup__target" id="dsfl-target-label">${escapeHTML(data.targetLabel)}</div>
    ${data.showPicker ? `
      <select class="dsfl-popup__picker" data-action="pick-target">
        <option value="">Pick a record…</option>
        ${data.pickerChoices.map(c =>
          `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`
        ).join('')}
      </select>
    ` : ''}
    ${data.showManual ? `
      <input class="dsfl-popup__manual-id" data-action="manual-id" placeholder="Paste Opportunity ID (e.g. 006Hu000ABC)" />
    ` : ''}
  </div>

  <div class="dsfl-popup__field">
    <label>Subject</label>
    <input class="dsfl-popup__subject" data-action="edit-subject" value="${escapeHTML(data.subject)}" />
  </div>

  <div class="dsfl-popup__field">
    <label>Description</label>
    <textarea class="dsfl-popup__description" data-action="edit-description" rows="10">${escapeHTML(data.description)}</textarea>
  </div>

  <footer class="dsfl-popup__footer">
    <button data-action="cancel">Cancel</button>
    <button data-action="send" class="dsfl-popup__send">Send to Salesforce</button>
  </footer>
</div>
`;

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Write the styles**

Create `src/popup/popup-styles.ts`:
```ts
export const popupCSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.dsfl-popup {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  width: 520px;
  max-width: 90vw;
  background: #fff;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  z-index: 2147483647;
  color: #1f1f1f;
  padding: 0;
}
.dsfl-popup__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}
.dsfl-popup__header h2 { margin: 0; font-size: 16px; font-weight: 600; }
.dsfl-popup__close {
  background: none; border: none; font-size: 22px; cursor: pointer; line-height: 1;
}
.dsfl-popup__field { padding: 12px 20px; }
.dsfl-popup__field label {
  display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #555;
}
.dsfl-popup__strategy { font-weight: 400; color: #888; font-size: 11px; }
.dsfl-popup__target { font-size: 14px; padding: 8px 10px; background: #f4f4f4; border-radius: 4px; }
.dsfl-popup__picker, .dsfl-popup__manual-id, .dsfl-popup__subject {
  width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc;
  border-radius: 4px; margin-top: 6px; box-sizing: border-box;
}
.dsfl-popup__description {
  width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid #ccc;
  border-radius: 4px; font-family: monospace; box-sizing: border-box; resize: vertical;
}
.dsfl-popup__footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 20px; border-top: 1px solid #eee;
}
.dsfl-popup__footer button {
  padding: 8px 14px; font-size: 14px; border-radius: 4px; cursor: pointer;
  border: 1px solid #ccc; background: #fff;
}
.dsfl-popup__send {
  background: #5865f2; color: #fff; border-color: #5865f2;
}
`;
```

- [ ] **Step 3: Implement the popup controller**

Create `src/popup/popup.ts`:
```ts
import { popupHTML } from './popup-template';
import { popupCSS } from './popup-styles';
import type { IdentifyStrategy } from '../types';

export interface PopupInput {
  strategy: IdentifyStrategy;
  initialSubject: string;
  initialDescription: string;
}

export interface PopupResult {
  oppId: string;
  oppName: string;
  subject: string;
  description: string;
}

export function showPopup(input: PopupInput): Promise<PopupResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'dsfl-popup-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);

    const style = document.createElement('style');
    style.textContent = popupCSS;
    shadow.appendChild(style);

    const targetLabel = strategyTargetLabel(input.strategy);
    const strategyLabel = strategyDescriptor(input.strategy);
    const showPicker = input.strategy.kind === 'picker';
    const showManual = input.strategy.kind === 'manual';
    const pickerChoices = input.strategy.kind === 'picker'
      ? input.strategy.choices.map(c => ({ id: c.id, name: c.name }))
      : [];

    const container = document.createElement('div');
    container.innerHTML = popupHTML({
      targetLabel,
      strategyLabel,
      subject: input.initialSubject,
      description: input.initialDescription,
      pickerChoices,
      showPicker,
      showManual
    });
    shadow.appendChild(container);

    let chosenOppId = input.strategy.kind === 'open-sf-tab' || input.strategy.kind === 'learned-mapping'
      ? input.strategy.record.id : '';
    let chosenOppName = input.strategy.kind === 'open-sf-tab' || input.strategy.kind === 'learned-mapping'
      ? input.strategy.record.name : '';

    const close = (result: PopupResult | null) => {
      host.remove();
      resolve(result);
    };

    shadow.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const action = t.getAttribute('data-action');
      if (!action) return;
      if (action === 'close' || action === 'cancel') close(null);
      if (action === 'send') {
        if (!chosenOppId) {
          alert('Please pick a Salesforce target first.');
          return;
        }
        const subject = (shadow.querySelector('.dsfl-popup__subject') as HTMLInputElement).value;
        const description = (shadow.querySelector('.dsfl-popup__description') as HTMLTextAreaElement).value;
        close({ oppId: chosenOppId, oppName: chosenOppName, subject, description });
      }
    });

    shadow.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      if (t.getAttribute('data-action') === 'pick-target') {
        const opt = (t as HTMLSelectElement).selectedOptions[0];
        chosenOppId = opt.value;
        chosenOppName = opt.textContent ?? '';
        (shadow.getElementById('dsfl-target-label') as HTMLElement).textContent = chosenOppName;
      }
    });

    shadow.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      if (t.getAttribute('data-action') === 'manual-id') {
        chosenOppId = (t as HTMLInputElement).value.trim();
        chosenOppName = chosenOppId; // best effort; the user can rename later in SF
        (shadow.getElementById('dsfl-target-label') as HTMLElement).textContent = chosenOppName;
      }
    });
  });
}

function strategyTargetLabel(s: IdentifyStrategy): string {
  if (s.kind === 'open-sf-tab' || s.kind === 'learned-mapping') return s.record.name;
  if (s.kind === 'picker') return '(pick below)';
  return '(paste ID below)';
}

function strategyDescriptor(s: IdentifyStrategy): string {
  switch (s.kind) {
    case 'open-sf-tab': return 'detected from open SF tab';
    case 'learned-mapping': return 'remembered from last log';
    case 'picker': return 'pick from recent records';
    case 'manual': return 'paste manually';
  }
}
```

- [ ] **Step 4: Commit (no tests — UI is verified manually in Task 16)**

```bash
git add src/popup/
git commit -m "feat: confirmation popup UI rendered in shadow DOM

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Discord content script (button injection + click handler)

**Files:**
- Create: `src/discord/ui.ts`, `src/discord/content-script.ts`

- [ ] **Step 1: Implement the UI injection**

Create `src/discord/ui.ts`:
```ts
// Injects a small "Log to SF" button into Discord's chat-header area.
// Discord's DOM uses obfuscated class names; we anchor on stable ARIA attributes where possible.

export function injectButton(onClick: () => void): void {
  let injected = false;

  const tryInject = () => {
    if (injected && document.contains(document.getElementById('dsfl-btn'))) return;
    // The chat header has role="banner" inside the chat region (role="main").
    const header = document.querySelector('[role="main"] section[aria-label]');
    if (!header) return;

    const btn = document.createElement('button');
    btn.id = 'dsfl-btn';
    btn.textContent = 'Log to SF';
    btn.title = 'Capture the current selection and log to Salesforce';
    Object.assign(btn.style, {
      marginLeft: '8px',
      padding: '4px 10px',
      borderRadius: '4px',
      border: '1px solid #5865f2',
      background: '#5865f2',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '600',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    header.appendChild(btn);
    injected = true;
  };

  // Re-inject on SPA navigation
  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body, { childList: true, subtree: true });
  tryInject();
}
```

- [ ] **Step 2: Implement the Discord-side orchestration**

Create `src/discord/content-script.ts`:
```ts
import { injectButton } from './ui';
import { extractFromSelectionText, detectCounterpartyFromDocumentTitle } from './selection';
import { getSettings } from '../storage/settings';
import { summarizeForSalesforce } from '../anthropic/summarize';
import { identifyTarget } from '../matching/identify';
import { showPopup } from '../popup/popup';
import { buildSFTaskUrl } from '../salesforce/url-builder';
import { recordMapping } from '../storage/mappings';

export function startDiscordIntegration(): void {
  injectButton(handleLogClick);
}

async function handleLogClick(): Promise<void> {
  const settings = getSettings();
  if (!settings.anthropicApiKey) {
    alert('Discord → SF Logger: please set your Anthropic API key in the Tampermonkey menu first.');
    return;
  }

  // 1. Capture text from current selection (or visible messages as fallback)
  const selection = window.getSelection()?.toString() ?? '';
  if (!selection.trim()) {
    alert('Discord → SF Logger: please highlight some messages first.');
    return;
  }
  const transcript = extractFromSelectionText(selection);
  const counterparty = detectCounterpartyFromDocumentTitle(document.title);

  // 2. Identify SF target
  const strategy = identifyTarget({ counterparty });

  // 3. Summarize via Anthropic (let popup open with placeholder while it runs)
  let summary;
  try {
    summary = await summarizeForSalesforce({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      transcript,
      counterparty
    });
  } catch (err) {
    console.error('[discord-sf-logger] Anthropic failed, using raw transcript fallback', err);
    summary = { subject: 'Discord', description: transcript };
  }

  // 4. Show popup for confirmation
  const result = await showPopup({
    strategy,
    initialSubject: `${settings.subjectPrefix}${summary.subject}`,
    initialDescription: summary.description
  });

  if (!result) return; // user cancelled

  // 5. Open SF prefill URL in a new tab
  const url = buildSFTaskUrl({
    sfDomain: settings.sfDomain,
    subject: result.subject,
    description: result.description,
    whatId: result.oppId,
    activityDate: new Date().toISOString().slice(0, 10)
  });
  GM_openInTab(url, { active: true });

  // 6. Record learned mapping for next time
  if (counterparty) {
    recordMapping(counterparty, result.oppId, result.oppName);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/discord/
git commit -m "feat: Discord button injection and click-to-log handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Settings UI (Tampermonkey menu command)

**Files:**
- Create: `src/settings/settings-ui.ts`

A minimal prompt-based UI registered via `GM_registerMenuCommand`. Pops up when the user clicks "Discord → SF Settings" in the Tampermonkey extension menu.

- [ ] **Step 1: Implement the settings UI**

Create `src/settings/settings-ui.ts`:
```ts
import { getSettings, setSetting } from '../storage/settings';

export function registerSettingsMenu(): void {
  GM_registerMenuCommand('Discord → SF: Set Anthropic API key', () => {
    const current = getSettings().anthropicApiKey;
    const next = prompt(
      'Paste your Anthropic API key (sk-ant-...). Leave blank to clear.',
      current
    );
    if (next === null) return; // user cancelled
    setSetting('anthropicApiKey', next.trim());
    alert('API key saved.');
  });

  GM_registerMenuCommand('Discord → SF: Set SF domain', () => {
    const current = getSettings().sfDomain;
    const next = prompt(
      'Salesforce Lightning domain (e.g. overwolf.lightning.force.com).',
      current
    );
    if (next === null) return;
    setSetting('sfDomain', next.trim());
    alert('SF domain saved.');
  });

  GM_registerMenuCommand('Discord → SF: Set subject prefix', () => {
    const current = getSettings().subjectPrefix;
    const next = prompt(
      "Subject prefix added to every logged conversation (default 'Discord: ').",
      current
    );
    if (next === null) return;
    setSetting('subjectPrefix', next);
    alert('Subject prefix saved.');
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings/
git commit -m "feat: Tampermonkey menu commands for API key and prefs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Wire everything together in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace the stub entry with the dispatcher**

Overwrite `src/main.ts`:
```ts
import { startDiscordIntegration } from './discord/content-script';
import { startSalesforceWatcher } from './salesforce/content-script';
import { registerSettingsMenu } from './settings/settings-ui';

// Settings menu is registered on every page where the script runs.
registerSettingsMenu();

const host = window.location.hostname;

if (host === 'discord.com') {
  startDiscordIntegration();
} else if (host.endsWith('.lightning.force.com')) {
  startSalesforceWatcher();
}
```

- [ ] **Step 2: Build and verify the userscript artifact**

Run:
```bash
npm run build
```
Expected: `dist/discord-sf-logger.user.js` exists. Open it; verify the header includes all `@grant` lines from Task 1 and that the body contains code from all the modules (search for distinctive strings like `defaultFieldValues`, `api.anthropic.com`).

- [ ] **Step 3: Run the full test suite**

Run:
```bash
npm test
```
Expected: All tests pass — settings, mappings, recent-sf, url-builder, summarize, identify, parse-url, selection. Should be ~28 tests total.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire main.ts to dispatch by hostname

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md`:
```markdown
# Discord → Salesforce Logger

Tampermonkey userscript that captures highlighted Discord conversations, summarizes them with Anthropic Claude, and creates a pre-filled "Log a Call" activity on the right Salesforce Opportunity. Built for Overwolf's BD / AM team.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome or Edge.
2. Click this link with Tampermonkey installed:
   `https://raw.githubusercontent.com/<REPO_OWNER>/<REPO_NAME>/main/dist/discord-sf-logger.user.js`
   Tampermonkey will prompt to install.
3. Open the Tampermonkey extension menu in your browser. You'll see three commands:
   - **Discord → SF: Set Anthropic API key** — paste your Anthropic API key (get one at console.anthropic.com).
   - **Discord → SF: Set SF domain** — defaults to `overwolf.lightning.force.com`; change if your org uses a different domain.
   - **Discord → SF: Set subject prefix** — defaults to `Discord: `; change if you want a different prefix.

## Use

1. Open a Discord conversation in your web browser (`discord.com`).
2. **Highlight** the messages you want to log.
3. Click the **"Log to SF"** button in the chat header.
4. A confirmation popup appears with an AI-generated subject + cleaned-up transcript.
   - If you have a Salesforce Opportunity tab open recently, that's the default target.
   - Otherwise the popup either remembers your last log for this contact, lets you pick from recent records, or asks you to paste an Opportunity ID.
5. Review, edit if needed, click **Send to Salesforce**.
6. Salesforce opens in a new tab with a pre-filled New Task form. Click **Save**. Done.

## How it works

- Uses **Salesforce Lightning URL prefill** (the documented `defaultFieldValues` query parameter). No SF API access required — runs in your existing logged-in browser session.
- Calls **Anthropic Claude Haiku** via Tampermonkey's `GM_xmlhttpRequest` (bypasses browser CORS).
- Stores everything (API key, learned mappings) in **Tampermonkey local storage** — never leaves your machine except for the Anthropic call.

## Auto-updates

Bump the `version` in `vite.config.ts`, build, push to `main`. Tampermonkey re-checks the script's `@updateURL` daily and prompts users to update.

## Development

```bash
npm install
npm run build       # builds dist/discord-sf-logger.user.js
npm test            # runs the test suite
npm run dev         # starts vite dev server with hot reload
```

## Known limitations

- Discord web only (no desktop app support).
- Logs to Opportunities only (not Accounts or Leads).
- One Salesforce org per installation (hardcoded in settings).
- Discord bot DM access is impossible by design (Discord ToS) — this script reads only what your own browser session can see.

## Troubleshooting

- **Button doesn't appear in Discord** — make sure you're on `discord.com`, not the desktop app. Check the Tampermonkey extension is enabled.
- **"Please pick a Salesforce target"** — the popup needs an Opportunity. Either open the right SF Opp tab first, or paste the Opportunity ID in the popup.
- **Anthropic API error** — check that your API key is valid in the Tampermonkey settings menu. Cost is pennies per month at typical use.
- **Saved Task doesn't appear under Activities** — verify Status was set to Completed; refresh the Opportunity Activity tab.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, use, and dev instructions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: First end-to-end manual test

**Files:**
- None (manual verification)

This task has no code — it's the critical first integration test on a live SF org. Plan-internal checkpoint.

- [ ] **Step 1: Build the userscript fresh**

Run:
```bash
npm run build
```
Expected: `dist/discord-sf-logger.user.js` exists.

- [ ] **Step 2: Install the local userscript in Tampermonkey**

In Chrome with Tampermonkey installed:
- Open `chrome-extension://...` Tampermonkey dashboard
- Click "+ Create new userscript"
- Paste the entire contents of `dist/discord-sf-logger.user.js` (overwrite the template)
- Save

This is the "dev install" — bypasses the GitHub @updateURL flow and uses your local build.

- [ ] **Step 3: Set the API key via the Tampermonkey menu**

- Open any tab matching `*.lightning.force.com/*` or `discord.com/*`
- Click the Tampermonkey extension icon → "Discord → SF: Set Anthropic API key"
- Paste your `sk-ant-...` key

- [ ] **Step 4: Prime the SF history**

- In another tab, navigate to a test Opportunity on Salesforce (the `test opp lior discord tool` from the validation phase)
- Stay on it for a few seconds so the SF content script registers the visit (you can verify by opening Tampermonkey's storage inspector and looking for `recent_sf_records`)

- [ ] **Step 5: Trigger a log from Discord**

- Open `discord.com` in another tab, navigate to any DM
- Highlight a few messages
- Click the new "Log to SF" button in the chat header
- Verify: popup appears with strategy "detected from open SF tab", target = the Opportunity you visited, subject prefixed with `Discord: `, description showing cleaned transcript

- [ ] **Step 6: Send to Salesforce**

- Click "Send to Salesforce"
- A new tab opens at `/lightning/o/Task/new?defaultFieldValues=...`
- Verify the form has Subject, Description, Related To (the Opp), Status=Completed, Due Date=today all prefilled
- Click Save

- [ ] **Step 7: Verify the activity appears correctly**

- Navigate back to the Opportunity
- Click the Activity tab
- Verify the new entry appears under **Past Activity** (not Upcoming/Overdue)
- Verify it has the same green Task icon as your previously manually-logged Discord entries
- Open the saved Task — verify Subject, Comments, Status=Completed all look correct

- [ ] **Step 8: Verify the learned mapping was stored**

- Reopen Tampermonkey's storage inspector
- Find `learned_mappings`
- Verify it contains an entry like `{ "joe_acme": { "oppId": "...", "oppName": "...", "lastUsed": "..." } }`

- [ ] **Step 9: Repeat from Discord without an open SF tab**

- Close the SF Opportunity tab
- Wait 31 minutes (or in the meantime, manually clear `recent_sf_records` from Tampermonkey storage to simulate)
- Go back to Discord, highlight messages from the same counterparty, click "Log to SF"
- Verify the popup now shows strategy "remembered from last log" with the same Opportunity as the default
- Cancel — don't actually log this one

- [ ] **Step 10: Capture any bugs / friction in an issues file**

If anything broke or felt awkward, add notes to a `KNOWN_ISSUES.md` (don't commit fixes inline — those become Task 18+).

---

## After this plan

- **Publish to GitHub:** create the public repo `overwolf/discord-sf-logger` (or chosen owner), push, edit `REPO_OWNER`/`REPO_NAME` in `vite.config.ts`, rebuild, push the built artifact.
- **Share install URL with teammates:** the raw GitHub URL to the `.user.js`. They click → Tampermonkey installs → done.
- **Iterate on real usage:** the spec's "Out of scope for v1" list (attachments, dedup, multi-org, Accounts/Leads) becomes the v0.2 backlog if there's demand after a few weeks of use.

## Self-review pass

- **Spec coverage:** every section of the design doc maps to a task or set of tasks. §4 validated assumptions → Tasks 7, 17. §5 architecture → Tasks 1, 15. §6 user journey → Task 17 walks through it. §7 strategies → Task 9. §8 components → Tasks 4–14. §9 storage → Tasks 4, 5, 6. §10 distribution → Tasks 1, 16. §11 API key → Tasks 4, 14. §12 risks → handled inline (selection capture handles typing indicators; popup shows text before send; fallback to raw transcript if Anthropic fails).
- **Placeholders:** `REPO_OWNER = 'CHANGE_ME'` is intentional and called out in Task 1 + the "After this plan" section — it's a runtime config, not a TBD. No other TODOs.
- **Type consistency:** `LearnedMapping`, `RecentSFRecord`, `Settings`, `IdentifyStrategy`, `SummarizedConversation`, `CapturedDiscordContext`, `BuildSFTaskUrlInput`, `SummarizeInput`, `PopupInput`, `PopupResult` — all defined once and referenced consistently. Method names: `getSettings`/`setSetting`, `recordMapping`/`getMappingFor`/`listMappings`, `recordVisit`/`listRecent`/`getMostRecentlyFocused`, `buildSFTaskUrl`, `summarizeForSalesforce`, `identifyTarget`, `showPopup`, `startDiscordIntegration`, `startSalesforceWatcher`, `registerSettingsMenu` — checked, all match across tasks.
