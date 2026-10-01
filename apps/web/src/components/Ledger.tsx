import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PartyEntry } from '../lib/db';
import { fmtDateTime, rs } from '../lib/format';
import { Badge, Empty, cx, td, th } from './ui';

const LABEL: Record<PartyEntry['type'], string> = {
  opening: 'Opening balance',
  sale: 'Udhaar sale',
  purchase: 'Credit purchase',
  payment: 'Payment',
  return: 'Return',
  adjustment: 'Adjustment',
};

/** Khata statement with running balance (oldest first). */
export function LedgerTable({ partyType, partyId }: { partyType: 'customer' | 'supplier'; partyId: string }) {
  const entries =
    useLiveQuery(() => db.partyEntries.where('[partyType+partyId]').equals([partyType, partyId]).sortBy('date'), [partyType, partyId]) ?? [];
  if (entries.length === 0) return <Empty title="No entries yet" />;
  let running = 0;
  const rows = entries.map((e) => {
    running += e.amount;
    return { e, balance: running };
  });
  return (
    <table className="w-full">
      <thead className="bg-slate-50">
        <tr>
          <th className={th}>Date</th>
          <th className={th}>Detail</th>
          <th className={cx(th, 'text-right')}>{partyType === 'customer' ? 'Udhaar (+)' : 'Bill (+)'}</th>
          <th className={cx(th, 'text-right')}>Paid (−)</th>
          <th className={cx(th, 'text-right')}>Balance</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(({ e, balance }) => (
          <tr key={e.id}>
            <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{fmtDateTime(e.date)}</td>
            <td className={td}>
              <Badge tone={e.amount > 0 ? 'amber' : 'green'}>{LABEL[e.type]}</Badge> <span className="text-slate-500">{e.note}</span>
            </td>
            <td className={cx(td, 'text-right tabular-nums')}>{e.amount > 0 ? rs(e.amount) : ''}</td>
            <td className={cx(td, 'text-right tabular-nums')}>{e.amount < 0 ? rs(-e.amount) : ''}</td>
            <td className={cx(td, 'text-right font-medium tabular-nums')}>{rs(balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
