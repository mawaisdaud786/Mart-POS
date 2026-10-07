import { useLiveQuery } from '../lib/store';
import { MessageCircle, Printer } from 'lucide-react';
import { useState } from 'react';
import { db, type Sale } from '../lib/db';
import { fmtDateTime, lineTotal, qty, rs } from '../lib/format';
import { usePeopleNames, useSession } from '../lib/session';
import { Button, Modal } from './ui';
import { WhatsAppMessageModal } from './WhatsAppMessageModal';

/** Thermal-printer style receipt (80 mm). Printing prints only this block. */
export function ReceiptView({ sale }: { sale: Sale }) {
  const { settings } = useSession();
  const customer = useLiveQuery(() => (sale.customerId ? db.customers.get(sale.customerId) : undefined), [sale.customerId]);
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const cashier = usePeopleNames().get(sale.userId);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Payment';
  const lineDiscount = sale.items.reduce((sum, item) => sum + item.discount, 0);
  const totalDiscount = lineDiscount + sale.discount;

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
      {cashier && <div>Cashier: {cashier}</div>}
      <div>Customer: {customer?.name ?? 'Walk-in Customer'}</div>
      {sale.pricingMode === 'business' && <div className="font-bold">SHOPKEEPER / BUSINESS RATE</div>}
      {sale.pricingMode === 'cost' && <div className="font-bold">RECORDED PURCHASE COST</div>}
      {sale.deliveryAddress && <div>Delivery address: {sale.deliveryAddress}</div>}
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
      {totalDiscount > 0 && <Row label={`Discount (${(sale.subtotal > 0 ? totalDiscount * 100 / sale.subtotal : 0).toFixed(1)}%)`} value={`-${rs(totalDiscount)}`} />}
      {(sale.deliveryAddress || (sale.deliveryFee ?? 0) > 0) && <Row label="Home delivery" value={(sale.deliveryFee ?? 0) > 0 ? rs(sale.deliveryFee!) : 'Free'} />}
      <Row label="TOTAL" value={rs(sale.total)} bold />
      {sale.payments.map((p, i) => (
        <Row key={i} label={accName(p.accountId)} value={rs(p.amount)} />
      ))}
      {sale.change > 0 && <Row label="Change" value={rs(sale.change)} />}
      {(sale.credit > 0 || sale.paymentMethod === 'credit') && <Row label="UDHAAR (on khata)" value={rs(sale.credit || sale.total)} bold />}
      {sale.returnedTotal > 0 && <Row label="Returned" value={`-${rs(sale.returnedTotal)}`} />}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="text-center">{settings?.receiptFooter}</div>
      <div className="mt-1 text-center text-[10px]">Powered by mirwal.pk</div>
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
  const [shareInvoice, setShareInvoice] = useState(false);
  const { settings } = useSession();
  const customer = useLiveQuery(() => (sale.customerId ? db.customers.get(sale.customerId) : undefined), [sale.customerId]);
  return (
    <Modal
      title={`Receipt ${sale.no}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {sale.status === 'completed' && sale.customerId && customer && (
            <Button variant="secondary" onClick={() => setShareInvoice(true)}>
              <MessageCircle size={16} /> WhatsApp invoice
            </Button>
          )}
          <Button onClick={() => window.print()} autoFocus={autoPrint}>
            <Printer size={16} /> Print
          </Button>
        </>
      }
    >
      <div className="rounded-lg bg-slate-50 p-4">
        <ReceiptView sale={sale} />
      </div>
      {shareInvoice && customer && (
        <WhatsAppMessageModal kind="invoice" customer={customer} sale={sale} shop={settings} onClose={() => setShareInvoice(false)} />
      )}
    </Modal>
  );
}
