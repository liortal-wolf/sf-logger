import { describe, it, expect } from 'vitest';
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
