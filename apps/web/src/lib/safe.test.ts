import { describe, expect, it } from 'vitest';
import { csvCell, escapeHtml } from './safe';

describe('escapeHtml', () => {
  it('neutralises markup and script', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml('</pre><script>fetch("//evil")</script>')).not.toMatch(/[<>"]/);
    expect(escapeHtml(`Tom & "Jerry's"`)).toBe('Tom &amp; &quot;Jerry&#39;s&quot;');
  });
  it('leaves normal text, Urdu and bullets untouched', () => {
    expect(escapeHtml('• Sooper Biscuit — 12 Packet (1 carton) سپر')).toBe('• Sooper Biscuit — 12 Packet (1 carton) سپر');
  });
});

describe('csvCell', () => {
  it('quotes and escapes quotes', () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(null)).toBe('""');
  });

  it('defuses spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(csvCell('+1+1')).toBe('"\'+1+1"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('@SUM(A1:A9)')).toBe('"\'@SUM(A1:A9)"');
    expect(csvCell('\t=1+1')).toBe('"\'\t=1+1"');
    expect(csvCell('\r=1+1')).toBe('"\'\r=1+1"');
  });

  it('does not touch numbers, including negatives', () => {
    expect(csvCell(-500)).toBe('"-500"');
    expect(csvCell(12.5)).toBe('"12.5"');
    expect(csvCell('-500')).toBe('"-500"');
    expect(csvCell(true)).toBe('"true"');
  });

  it('does not touch ordinary text', () => {
    expect(csvCell('Sooper Biscuit')).toBe('"Sooper Biscuit"');
    expect(csvCell('Rs 50 - pack')).toBe('"Rs 50 - pack"');
  });
});
