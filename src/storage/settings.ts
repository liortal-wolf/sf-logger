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
