import { MessageCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, type Customer, type Sale, type ShopSettings } from '../lib/db';
import { openExternal } from '../lib/safe';
import { useSession, useUser } from '../lib/session';
import { useLiveQuery } from '../lib/store';
import {
  buildWhatsAppUrl,
  getWhatsAppTemplates,
  normalizeWhatsAppPhone,
  renderWhatsAppMessage,
  type WhatsAppLanguage,
  type WhatsAppTemplate,
  type WhatsAppTemplateKind,
} from '../lib/whatsapp';
import { Button, Field, Input, Modal, Select } from './ui';

const LANGUAGE_LABELS: Record<WhatsAppLanguage, string> = {
  en: 'English',
  ur: 'اردو',
  roman: 'Roman Urdu',
};

export function WhatsAppMessageModal({
  kind,
  customer,
  shop,
  sale,
  balance,
  paymentAmount,
  paymentDate,
  onClose,
}: {
  kind: WhatsAppTemplateKind;
  customer: Customer;
  shop?: ShopSettings;
  sale?: Sale;
  balance?: number;
  paymentAmount?: number;
  paymentDate?: string;
  onClose: () => void;
}) {
  const user = useUser();
  const { has } = useSession();
  const pref = useLiveQuery(() => db.prefs.get(`u:${user.id}`), [user.id]);
  const templates = getWhatsAppTemplates(pref?.whatsappTemplates);
  const [language, setLanguage] = useState<WhatsAppLanguage>('en');
  const [templateId, setTemplateId] = useState('');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const activeTemplates = templates.filter((template) => template.kind === kind && template.active);
  const languageTemplates = activeTemplates.filter((template) => template.language === language);
  const template: WhatsAppTemplate | undefined = languageTemplates.find((item) => item.id === templateId) ?? languageTemplates[0];
  const currentLanguage = language;
  const phoneResult = normalizeWhatsAppPhone(phone);
  const message = useMemo(() => template
    ? renderWhatsAppMessage(template, { kind, customer, shop, sale, balance, paymentAmount, paymentDate })
    : '', [template, kind, customer, shop, sale, balance, paymentAmount, paymentDate]);
  const canConfirm = has('settings.manage');

  const openChat = () => {
    if (!template || !canConfirm || !confirmed) return;
    const url = buildWhatsAppUrl(phone, message);
    if (url) openExternal(url);
  };

  return (
    <Modal
      wide
      title={kind === 'invoice' ? `WhatsApp invoice · ${sale?.no ?? ''}` : `WhatsApp khata · ${customer.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="success" onClick={openChat} disabled={!template || !phoneResult.valid || !canConfirm || !confirmed}>
            <MessageCircle size={16} /> Open WhatsApp chat
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          WhatsApp click-to-chat only opens a chat with this text prefilled. It does not send a message or create/attach an invoice file.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <Input value={customer.name} readOnly />
          </Field>
          <Field label="WhatsApp number" hint={phoneResult.valid ? `Chat number: +${phoneResult.number}` : phoneResult.error}>
            <Input value={phone} onChange={(event) => { setPhone(event.target.value); setConfirmed(false); }} aria-invalid={!phoneResult.valid} />
          </Field>
          <Field label="Language">
            <Select
              value={currentLanguage}
              onChange={(event) => { setLanguage(event.target.value as WhatsAppLanguage); setTemplateId(''); setConfirmed(false); }}
            >
              {(Object.keys(LANGUAGE_LABELS) as WhatsAppLanguage[]).map((code) => <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>)}
            </Select>
          </Field>
          <Field label="Template">
            <Select value={template?.id ?? ''} onChange={(event) => { setTemplateId(event.target.value); setConfirmed(false); }} disabled={!languageTemplates.length}>
              {languageTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              {!languageTemplates.length && <option value="">No active {kind} templates</option>}
            </Select>
          </Field>
        </div>
        {message && (
          <div>
            <div className="mb-1 text-sm font-semibold text-slate-800">Preview</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900">{message}</pre>
          </div>
        )}
        {!canConfirm ? (
          <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Only an account with the shop settings-management permission can confirm and open a customer chat.</p>
        ) : (
          <label className="flex items-start gap-2 rounded-lg border border-slate-300 p-3 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I reviewed the customer, phone number, and complete message and approve opening this WhatsApp chat.</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
