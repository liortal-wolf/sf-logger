import { describe, it, expect, afterEach } from 'vitest';
import { __testing__ } from '../../src/salesforce/content-script';

const { readDiscordFromVisibleText } = __testing__;

function setBodyInnerText(text: string): void {
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    get: () => text
  });
}

describe('readDiscordFromVisibleText', () => {
  afterEach(() => {
    // restore default behavior
    Object.defineProperty(document.body, 'innerText', {
      configurable: true,
      get: () => ''
    });
  });

  it('reads the value on the line after a standalone "Discord" label', () => {
    setBodyInnerText('Account Name\nTest Account - Lior Discord Tool\nDiscord\nmutualmagic\nTitle\nCEO');
    expect(readDiscordFromVisibleText()).toBe('mutualmagic');
  });

  it('strips a leading @ from the captured value', () => {
    setBodyInnerText('Discord\n@kesem.overwolf\nEmail\nkesem@example.com');
    expect(readDiscordFromVisibleText()).toBe('kesem.overwolf');
  });

  it('returns null when the next line is a placeholder dash', () => {
    setBodyInnerText('Discord\n-\nTitle\nCEO');
    expect(readDiscordFromVisibleText()).toBeNull();
  });

  it('ignores "Edit Discord" inline-edit button text', () => {
    setBodyInnerText('Lior Discord Tool\nOpen Test Account - Lior Discord Tool Preview\nEdit Discord\nTitle');
    expect(readDiscordFromVisibleText()).toBeNull();
  });

  it('returns null when "Discord" appears only embedded in another phrase', () => {
    setBodyInnerText('Test Account - Lior Discord Tool\nCEO\nTitle\nNothing here');
    expect(readDiscordFromVisibleText()).toBeNull();
  });

  it('bails out when the captured value looks like a next field label', () => {
    setBodyInnerText('Discord\nTitle\nCEO');
    expect(readDiscordFromVisibleText()).toBeNull();
  });
});
