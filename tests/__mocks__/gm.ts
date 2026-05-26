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
  var GM_openInTab: (url: string, options?: { active?: boolean; insert?: boolean }) => { close: () => void; closed: boolean; onclose?: () => void };
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

(globalThis as any).GM_xmlhttpRequest = (_details: GMXHRDetails) => {
  // Tests should override this per-case via vi.spyOn / vi.fn
  throw new Error('GM_xmlhttpRequest not mocked in this test; use vi.spyOn(globalThis, "GM_xmlhttpRequest")');
};

(globalThis as any).GM_registerMenuCommand = () => 0;

(globalThis as any).GM_openInTab = (url: string) => {
  openedTabs.push(url);
  const control = {
    closed: false,
    close: () => { control.closed = true; },
    onclose: undefined as (() => void) | undefined
  };
  return control;
};

(globalThis as any).__resetGM = () => {
  store.clear();
  openedTabs.length = 0;
};

export const __getOpenedTabs = () => [...openedTabs];
