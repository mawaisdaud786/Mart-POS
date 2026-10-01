/** Rupees typed by the user → paisa. */
export function toPaisa(rupees: number | string): number {
  const n = typeof rupees === 'string' ? Number(rupees.replace(/,/g, '')) : rupees;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Paisa → rupees number (for input fields). */
export function toRupees(paisa: number): number {
  return Math.round(paisa) / 100;
}

const nf0 = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Paisa → "Rs 1,250" (shows paisa only when not whole rupees). */
export function rs(paisa: number): string {
  const v = Math.round(paisa);
  const text = v % 100 === 0 ? nf0.format(Math.abs(v) / 100) : nf2.format(Math.abs(v) / 100);
  return `${v < 0 ? '-' : ''}Rs ${text}`;
}

export function qty(n: number): string {
  return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 3 }).format(n);
}

export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Line total = price × qty, rounded to paisa. */
export function lineTotal(price: number, q: number): number {
  return Math.round(price * q);
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Local calendar date "YYYY-MM-DD" (Pakistan time on the shop's PC). */
export function dayKey(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start/end ISO strings for local days [from, to] inclusive. */
export function rangeIso(from: string, to: string): [string, string] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  return [start.toISOString(), end.toISOString()];
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
}
