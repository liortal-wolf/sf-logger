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
    expect(url).toContain('%E2%80%94');
    expect(url).toContain('%22');
    expect(url).toContain('%25');
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
