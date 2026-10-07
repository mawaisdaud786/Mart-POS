/** Small helpers that keep data from becoming code: HTML, spreadsheet formulas and window.open. */

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text before putting it into an HTML string (for example a window opened with document.write). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * One quoted CSV cell. Text that starts with = + - @ (or a tab/carriage return) would be run as a formula by
 * Excel/Sheets ("CSV injection"), so it gets a leading apostrophe. Real numbers are left alone.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Open another site without giving it access to this window (reverse tabnabbing) or sending a referrer. */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
