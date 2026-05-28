import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearLocalCache } from '../../src/settings/settings-ui';
import { setSetting, getSettings } from '../../src/storage/settings';

describe('clearLocalCache', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('deletes the three cache keys', () => {
    GM_setValue('recent_sf_records', [{ id: '006A', name: 'Acme' }]);
    GM_setValue('recent_contacts', [{ id: '003A', name: 'Kesem' }]);
    GM_setValue('learned_mappings', { 'un:joe': { oppId: '006A', oppName: 'Acme', lastUsed: 't' } });

    clearLocalCache();

    expect(GM_getValue('recent_sf_records', null)).toBeNull();
    expect(GM_getValue('recent_contacts', null)).toBeNull();
    expect(GM_getValue('learned_mappings', null)).toBeNull();
  });

  it('preserves settings (API key, SF domain, subject prefix)', () => {
    setSetting('anthropicApiKey', 'sk-ant-preserve-me');
    setSetting('sfDomain', 'mycompany.lightning.force.com');
    setSetting('subjectPrefix', 'CustomPrefix: ');
    GM_setValue('recent_sf_records', [{ id: '006A', name: 'Acme' }]);

    clearLocalCache();

    const s = getSettings();
    expect(s.anthropicApiKey).toBe('sk-ant-preserve-me');
    expect(s.sfDomain).toBe('mycompany.lightning.force.com');
    expect(s.subjectPrefix).toBe('CustomPrefix: ');
  });

  it('is idempotent when caches are already empty', () => {
    clearLocalCache();
    clearLocalCache();
    expect(GM_listValues()).not.toContain('recent_sf_records');
  });
});
