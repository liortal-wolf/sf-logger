import { describe, it, expect, afterEach } from 'vitest';
import { __testing__ } from '../../src/salesforce/content-script';

const { parseContactRelatedOppsFromDom } = __testing__ as unknown as {
  parseContactRelatedOppsFromDom: (root: ParentNode) => Array<{
    id: string;
    name: string;
    accountName?: string;
    stage?: string;
  }>;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('parseContactRelatedOppsFromDom', () => {
  it('extracts opp id + name from rows with /Opportunity/<id> anchors', () => {
    document.body.innerHTML = `
      <div>
        <a href="/lightning/r/Opportunity/006AA00000000A1/view"><span>Acme Q3 Renewal</span></a>
        <a href="/lightning/r/Opportunity/006AA00000000A2/view"><span>Beta Expansion</span></a>
      </div>
    `;
    const rows = parseContactRelatedOppsFromDom(document);
    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe('006AA00000000A1');
    expect(rows[0].name).toBe('Acme Q3 Renewal');
    expect(rows[1].id).toBe('006AA00000000A2');
  });

  it('skips anchors whose href does not match an Opportunity record', () => {
    document.body.innerHTML = `
      <div>
        <a href="/lightning/r/Opportunity/006AA00000000A1/view"><span>Acme</span></a>
        <a href="/lightning/o/Opportunity/home"><span>All Opportunities</span></a>
        <a href="/lightning/r/Account/001AA/view"><span>Account link</span></a>
      </div>
    `;
    const rows = parseContactRelatedOppsFromDom(document);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('006AA00000000A1');
  });

  it('deduplicates by id (related lists sometimes render the same row twice)', () => {
    document.body.innerHTML = `
      <div>
        <a href="/lightning/r/Opportunity/006AA00000000A1/view"><span>Acme</span></a>
        <a href="/lightning/r/Opportunity/006AA00000000A1/view"><span>Acme</span></a>
      </div>
    `;
    const rows = parseContactRelatedOppsFromDom(document);
    expect(rows.length).toBe(1);
  });

  it('returns an empty array when no Opportunity rows are present', () => {
    document.body.innerHTML = '<div></div>';
    expect(parseContactRelatedOppsFromDom(document)).toEqual([]);
  });
});
