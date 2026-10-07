export const POS_ACTIONS = [
  { id: 'focusSearch', label: 'Focus product search', defaults: ['F1'] },
  { id: 'customer', label: 'Select customer', defaults: ['F2'] },
  { id: 'hold', label: 'Hold current bill', defaults: ['F3'] },
  { id: 'recall', label: 'Recall held bill', defaults: ['F4'] },
  { id: 'delivery', label: 'Toggle home delivery', defaults: ['F5'] },
  { id: 'clear', label: 'Clear current bill', defaults: ['F6'] },
  { id: 'pay', label: 'Open payment', defaults: ['F7', 'F9', 'F10'] },
  { id: 'voice', label: 'Voice input (hold to speak)', defaults: ['F8', 'SPACE'] },
  { id: 'ration', label: 'Toggle ration order', defaults: ['ALT+R'] },
  { id: 'paymentMode', label: 'Toggle cash / udhaar', defaults: ['ALT+P'] },
  { id: 'increaseQty', label: 'Increase selected item quantity', defaults: ['ALT+ARROWUP'] },
  { id: 'decreaseQty', label: 'Decrease selected item quantity', defaults: ['ALT+ARROWDOWN'] },
  { id: 'remove', label: 'Remove selected item', defaults: ['Delete'] },
] as const;

export type PosActionId = (typeof POS_ACTIONS)[number]['id'];
export type ProductShortcut = { key: string; productId: string };
export type PosShortcutSettings = {
  actionShortcuts: Partial<Record<PosActionId, string[]>>;
  productShortcuts: ProductShortcut[];
};

export const DEFAULT_ACTION_SHORTCUTS = Object.fromEntries(
  POS_ACTIONS.map((action) => [action.id, [...action.defaults]]),
) as Record<PosActionId, string[]>;

export function normalizeShortcutKey(key: string): string {
  const parts = key.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLocaleUpperCase()));
  const modifierOrder = ['CTRL', 'ALT', 'SHIFT', 'META'].filter((modifier) => modifiers.has(modifier));
  const base = (parts.at(-1) ?? '').toLocaleUpperCase();
  return [...modifierOrder, base].join('+');
}

export function parseShortcutKeys(value: string): string[] {
  return [...new Set(value.split(',').map(normalizeShortcutKey).filter(Boolean))];
}

export function isValidShortcutKey(key: string): boolean {
  const parts = key.split('+');
  const base = parts.pop() ?? '';
  const modifiers = parts;
  return new Set(modifiers).size === modifiers.length &&
    modifiers.every((modifier) => ['CTRL', 'ALT', 'SHIFT', 'META'].includes(modifier)) &&
    (/^[A-Z0-9]$/.test(base) || /^F(?:[1-9]|1[0-2])$/.test(base) ||
      ['DELETE', 'SPACE', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'ENTER', 'ESCAPE'].includes(base));
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  const key = event.key === ' ' ? 'SPACE' : event.key;
  const modifiers = [
    event.ctrlKey ? 'CTRL' : '',
    event.altKey ? 'ALT' : '',
    event.shiftKey ? 'SHIFT' : '',
    event.metaKey ? 'META' : '',
  ].filter(Boolean);
  return normalizeShortcutKey([...modifiers, key].join('+'));
}

export function validatePosShortcutSettings(settings: PosShortcutSettings): string | undefined {
  const used = new Map<string, string>();
  for (const action of POS_ACTIONS) {
    const keys = settings.actionShortcuts[action.id] ?? [...action.defaults];
    for (const rawKey of keys) {
      const key = normalizeShortcutKey(rawKey);
      if (!isValidShortcutKey(key)) return `“${rawKey}” is not a supported shortcut key`;
      const existing = used.get(key);
      if (existing) return `${key} is assigned to both ${existing} and ${action.label}`;
      used.set(key, action.label);
    }
  }
  for (const shortcut of settings.productShortcuts) {
    const key = normalizeShortcutKey(shortcut.key);
    if (!/^[A-Z]$/.test(key)) return `Product shortcuts must be a single letter (A–Z): “${shortcut.key}”`;
    const existing = used.get(key);
    if (existing) return `${key} is assigned to both ${existing} and a product`;
    used.set(key, 'a product');
  }
  return undefined;
}
