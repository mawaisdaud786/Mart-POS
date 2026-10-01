import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';
import { db, type Sale } from '../lib/db';
import { fmtDateTime, lineTotal, qty, rs } from '../lib/format';
import { useSession } from '../lib/session';
import { Button, Modal } from './ui';

/** Thermal-printer style receipt (80 mm). Printing prints only this block. */
export function ReceiptView({ sale }: { sale: Sale }) {
  const { settings } = useSession();
  const customer = useLiveQuery(() => (sale.customerId ? db.customers.get(sale.customerId) : undefined), [sale.customerId]);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cashier = useLiveQuery(() => db.users.get(sale.userId), [sale.userId]);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Payment';

  return (
    <div id="receipt-print" className="mx-auto w-[300px] bg-white font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <div className="text-base font-bold">{settings?.shopName}</div>
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>Ph: {settings.phone}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between">
        <span>Invoice: {sale.no}</span>
        {sale.status === 'void' && <b>VOID</b>}
      </div>
      <div>Date: {fmtDateTime(sale.date)}</div>
      {cashier && <div>Cashier: {cashier.name}</div>}
      {customer && <div>Customer: {customer.name}</div>}
      <div className="my-2 border-t border-dashed border-black" />
      {sale.items.map((i, idx) => (
        <div key={idx} className="mb-1">
          <div>{i.name}</div>
          <div className="flex justify-between">
            <span>
              {qty(i.qty)} {i.unit} × {rs(i.price)}
            </span>
            <span>{rs(lineTotal(i.price, i.qty) - i.discount)}</span>
          </div>
          {i.discount > 0 && <div className="text-right">(disc {rs(i.discount)})</div>}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-black" />
      <Row label="Subtotal" value={rs(sale.subtotal)} />
      {sale.discount > 0 && <Row label="Discount" value={`-${rs(sale.discount)}`} />}
      <Row label="TOTAL" value={rs(sale.total)} bold />
      {sale.payments.map((p, i) => (
        <Row key={i} label={accName(p.accountId)} value={rs(p.amount)} />
      ))}
      {sale.change > 0 && <Row label="Change" value={rs(sale.change)} />}
      {sale.credit > 0 && <Row label="Udhaar (on khata)" value={rs(sale.credit)} bold />}
      {sale.returnedTotal > 0 && <Row label="Returned" value={`-${rs(sale.returnedTotal)}`} />}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">{settings?.receiptFooter}</div>
      <div className="mt-1 text-center text-[10px]">Powered by RetailOS</div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ReceiptModal({ sale, onClose, autoPrint }: { sale: Sale; onClose: () => void; autoPrint?: boolean }) {
  return (
    <Modal
      title={`Receipt ${sale.no}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()} autoFocus={autoPrint}>
            <Printer size={16} /> Print
          </Button>
        </>
      }
    >
      <div className="rounded-lg bg-slate-50 p-4">
        <ReceiptView sale={sale} />
      </div>
    </Modal>
  );
}
