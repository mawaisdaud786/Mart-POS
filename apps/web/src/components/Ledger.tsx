import { useState } from 'react';
import { useLiveQuery } from '../lib/store';
import { db, type PartyEntry } from '../lib/db';
import { fmtDateTime, rs } from '../lib/format';
import { compareListValues, ListControls } from './ListControls';
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
  const [search, setSearch] = useState('');
  const [entryType, setEntryType] = useState('all');
  const [sortBy, setSortBy] = useState<'oldest' | 'newest' | 'amount'>('oldest');
  const entries =
    useLiveQuery(() => db.partyEntries.where('[partyType+partyId]').equals([partyType, partyId]).sortBy('date'), [partyType, partyId]) ?? [];
  let running = 0;
  const allRows = entries.map((e) => {
    running += e.amount;
    return { e, balance: running };
  });
  const query = search.trim().toLocaleLowerCase();
  const rows = allRows
    .filter(({ e }) => entryType === 'all' || e.type === entryType)
    .filter(({ e }) => !query || LABEL[e.type].toLocaleLowerCase().includes(query) || (e.note ?? '').toLocaleLowerCase().includes(query) || fmtDateTime(e.date).toLocaleLowerCase().includes(query))
    .sort((a, b) => sortBy === 'amount'
      ? Math.abs(b.e.amount) - Math.abs(a.e.amount)
      : sortBy === 'newest'
        ? b.e.date.localeCompare(a.e.date)
        : sortBy === 'oldest'
          ? a.e.date.localeCompare(b.e.date)
          : compareListValues(a.e.date, b.e.date));
  return (
    <>
    <ListControls
      search={search}
      onSearch={setSearch}
      placeholder="Search entry detail or date…"
      filters={[{ label: 'Entry type', value: entryType, options: [{ value: 'all', label: 'All entries' }, ...Object.entries(LABEL).map(([value, label]) => ({ value, label }))], onChange: setEntryType }]}
      sortValue={sortBy}
      sortOptions={[{ value: 'oldest', label: 'Date · oldest first' }, { value: 'newest', label: 'Date · newest first' }, { value: 'amount', label: 'Amount · highest' }]}
      onSort={(value) => setSortBy(value as typeof sortBy)}
    />
    {entries.length === 0 ? <Empty title="No entries yet" /> : rows.length === 0 ? <Empty title="No matching entries" /> : <table className="w-full">
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
    </table>}
    </>
  );
}
