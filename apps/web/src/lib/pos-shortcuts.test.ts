import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTION_SHORTCUTS, parseShortcutKeys, shortcutFromKeyboardEvent, validatePosShortcutSettings } from './pos-shortcuts';

describe('POS shortcut settings', () => {
  it('normalizes and de-duplicates action keys', () => {
    expect(parseShortcutKeys('f9, F10, f9')).toEqual(['F9', 'F10']);
  });

  it('normalizes configurable modifier shortcuts and keyboard events', () => {
    expect(parseShortcutKeys('alt+r, Shift+ArrowUp')).toEqual(['ALT+R', 'SHIFT+ARROWUP']);
    expect(shortcutFromKeyboardEvent({ key: 'ArrowUp', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }))
      .toBe('ALT+ARROWUP');
    expect(shortcutFromKeyboardEvent({ key: ' ', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }))
      .toBe('SPACE');
  });

  it('accepts unique product-letter shortcuts alongside action keys', () => {
    expect(validatePosShortcutSettings({
      actionShortcuts: DEFAULT_ACTION_SHORTCUTS,
      productShortcuts: [{ key: 'c', productId: 'capstan' }, { key: 'e', productId: 'eggs' }],
    })).toBeUndefined();
  });

  it('rejects duplicate keys and product shortcuts that are not one letter', () => {
    expect(validatePosShortcutSettings({
      actionShortcuts: { ...DEFAULT_ACTION_SHORTCUTS, pay: ['c'] },
      productShortcuts: [{ key: 'c', productId: 'capstan' }],
    })).toMatch(/assigned to both/);
    expect(validatePosShortcutSettings({
      actionShortcuts: DEFAULT_ACTION_SHORTCUTS,
      productShortcuts: [{ key: 'cc', productId: 'capstan' }],
    })).toMatch(/single letter/);
  });
});
