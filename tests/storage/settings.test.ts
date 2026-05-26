import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSettings, setSetting } from '../../src/storage/settings';

describe('settings storage', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

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
    expect(s.anthropicModel).toBe('claude-haiku-4-5-20251001');
  });
});
