import { Pencil, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db, uid } from '../lib/db';
import { useSession, useUser } from '../lib/session';
import { useLiveQuery } from '../lib/store';
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  getWhatsAppTemplates,
  type WhatsAppLanguage,
  type WhatsAppTemplate,
  type WhatsAppTemplateKind,
} from '../lib/whatsapp';
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, useAction } from './ui';

const languageLabels: Record<WhatsAppLanguage, string> = { en: 'English', ur: 'اردو', roman: 'Roman Urdu' };
const kindLabels: Record<WhatsAppTemplateKind, string> = { invoice: 'Invoice', khata: 'Khata / payment' };

export function WhatsAppTemplatesCard() {
  const user = useUser();
  const { has } = useSession();
  const run = useAction();
  const pref = useLiveQuery(() => db.prefs.get(`u:${user.id}`), [user.id]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>(getWhatsAppTemplates());
  const [editing, setEditing] = useState<WhatsAppTemplate | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => setTemplates(getWhatsAppTemplates(pref?.whatsappTemplates)), [pref?.whatsappTemplates]);

  const save = (next: WhatsAppTemplate[]) => run(async () => {
    const id = `u:${user.id}`;
    const latest = await db.prefs.get(id);
    await db.prefs.put({ ...latest, id, whatsappTemplates: next });
    setTemplates(next);
  }, 'WhatsApp templates saved');

  const toggle = (template: WhatsAppTemplate) => {
    void save(templates.map((entry) => entry.id === template.id ? { ...entry, active: !entry.active } : entry));
  };

  const saveEditor = (template: WhatsAppTemplate) => {
    const next = isNew
      ? [...templates, template]
      : templates.map((entry) => entry.id === template.id ? template : entry);
    void save(next).then((success) => {
      if (success) setEditing(null);
    });
  };

  const restoreDefaults = () => {
    if (window.confirm('Restore the built-in English, Urdu and Roman Urdu invoice and khata templates for your account? Your current template edits will be replaced.')) {
      void save(DEFAULT_WHATSAPP_TEMPLATES.map((template) => ({ ...template })));
    }
  };

  return (
    <>
      <Card
        title="WhatsApp message templates"
        actions={
          has('settings.manage') && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={restoreDefaults}><RotateCcw size={14} /> Restore defaults</Button>
              <Button size="sm" onClick={() => { setIsNew(true); setEditing({ id: uid(), name: '', language: 'en', kind: 'invoice', body: '', active: true }); }}><Plus size={14} /> Create</Button>
            </div>
          )
        }
      >
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Templates are stored in the signed-in user’s private preferences on the shop server. Each account owns its own templates; settings-management permission is required to edit them. WhatsApp remains click-to-chat only.
        </div>
        {!has('settings.manage') && <p className="px-4 py-3 text-sm text-slate-600">Only a user with the shop settings-management permission can edit templates.</p>}
        <div className="divide-y divide-slate-100">
          {templates.map((template) => (
            <div key={template.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{template.name}</span>
                  <Badge tone={template.active ? 'green' : 'default'}>{template.active ? 'Active' : 'Inactive'}</Badge>
                  <span className="text-xs text-slate-500">{kindLabels[template.kind]} · {languageLabels[template.language]}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{template.body}</p>
              </div>
              {has('settings.manage') && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="secondary" onClick={() => { setIsNew(false); setEditing({ ...template }); }}><Pencil size={14} /> Edit</Button>
                  <Button size="sm" variant="secondary" onClick={() => toggle(template)}>{template.active ? 'Deactivate' : 'Activate'}</Button>
                </div>
              )}
            </div>
          ))}
          {!templates.length && <p className="px-4 py-6 text-center text-sm text-slate-500">No templates are configured. Restore defaults to start using the built-in messages.</p>}
        </div>
      </Card>
      {editing && (
        <WhatsAppTemplateEditor
          template={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSave={saveEditor}
        />
      )}
    </>
  );
}

function WhatsAppTemplateEditor({
  template,
  isNew,
  onClose,
  onSave,
}: {
  template: WhatsAppTemplate;
  isNew: boolean;
  onClose: () => void;
  onSave: (template: WhatsAppTemplate) => void;
}) {
  const [draft, setDraft] = useState(template);
  return (
    <Modal
      wide
      title={isNew ? 'Create WhatsApp template' : 'Edit WhatsApp template'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!draft.name.trim() || !draft.body.trim()} onClick={() => onSave({ ...draft, name: draft.name.trim(), body: draft.body.trim() })}>Save template</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus /></Field>
        <Field label="Message type">
          <Select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as WhatsAppTemplateKind })}>
            <option value="invoice">Invoice</option>
            <option value="khata">Khata / payment</option>
          </Select>
        </Field>
        <Field label="Language">
          <Select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as WhatsAppLanguage })}>
            {(Object.keys(languageLabels) as WhatsAppLanguage[]).map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={draft.active ? 'active' : 'inactive'} onChange={(event) => setDraft({ ...draft, active: event.target.value === 'active' })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <Field label="Message text" className="sm:col-span-2" hint="Placeholders: {customerName}, {shopName}, {shopPhone}, {shopAddress}, {invoiceNo}, {date}, {items}, {subtotal}, {discount}, {delivery}, {total}, {paid}, {due}, {balance}, {paymentSummary}.">
          <Textarea rows={9} maxLength={2000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
