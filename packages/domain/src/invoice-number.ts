/**
 * Invoice timestamp in Pakistan local time, independent of the API host/browser timezone.
 * The shop API appends a locked sequence for uniqueness; the device API appends its sale UUID.
 */
export function invoiceNumberPrefix(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid invoice date');

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');
  if (!year || !month || !day || !hour || !minute || !second) throw new Error('Could not format invoice timestamp');
  return `INV-${year}${month}${day}-${hour}${minute}${second}`;
}
