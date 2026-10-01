import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Plus, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, PageHeader, Select, Textarea, cx, td, th, useAction } from '../components/ui';
import { db, uid, type Account, type Role, type User } from '../lib/db';
import { useSession } from '../lib/session';

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <ShopCard />
        <UsersCard />
        <AccountsCard />
        <BackupCard />
        <VoiceLogCard />
      </div>
    </div>
  );
}

function ShopCard() {
  const { settings } = useSession();
  const run = useAction();
  const [f, setF] = useState(settings);
  useEffect(() => setF(settings), [settings]);
  if (!f) return null;
  return (
    <Card title="Shop & receipt">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Shop name">
          <Input value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Receipt footer" className="sm:col-span-2">
          <Textarea rows={2} value={f.receiptFooter} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} />
        </Field>
        <Field label="Default supplier delivery days" hint="Used for reorder suggestions">
          <Input inputMode="numeric" value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Cashier max discount (%)">
          <Input inputMode="decimal" value={f.cashierMaxDiscount} onChange={(e) => setF({ ...f, cashierMaxDiscount: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Cash difference needing explanation (Rs)">
          <MoneyInput value={f.discrepancyLimit} onChange={(v) => setF({ ...f, discrepancyLimit: v })} />
        </Field>
        <div className="flex items-end">
          <Button onClick={() => run(() => db.settings.put(f), 'Settings saved')}>Save</Button>
        </div>
      </div>
    </Card>
  );
}

function UsersCard() {
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  return (
    <Card
      title="Users & PINs"
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add user
        </Button>
      }
    >
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Name</th>
            <th className={th}>Role</th>
            <th className={th}>Status</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => (
            <tr key={u.id}>
              <td className={cx(td, 'font-medium')}>{u.name}</td>
              <td className={cx(td, 'capitalize')}>{u.role}</td>
              <td className={td}>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</td>
              <td className={cx(td, 'text-right')}>
                <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                  Edit
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 pb-3 text-xs text-slate-500">
        Owner: everything. Manager: everything except settings and owner withdrawals. Cashier: POS, own sales, customer payments, Easypaisa and blind cash count — no cost or profit.
      </p>
      {editing && <UserForm user={editing === 'new' ? null : editing} users={users} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function UserForm({ user, users, onClose }: { user: User | null; users: User[]; onClose: () => void }) {
  const run = useAction();
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'cashier');
  const [pin, setPin] = useState(user?.pin ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const owners = users.filter((u) => u.role === 'owner' && u.active);
  return (
    <Modal
      title={user ? 'Edit user' : 'Add user'}
      onClose={onClose}
      footer={
        <Button
          disabled={!name.trim() || !/^\d{4,6}$/.test(pin)}
          onClick={() =>
            run(async () => {
              const losingOwner = user?.role === 'owner' && (role !== 'owner' || !active) && owners.length <= 1;
              if (losingOwner) throw new Error('Keep at least one active owner');
              if (users.some((u) => u.pin === pin && u.id !== user?.id && u.active)) throw new Error('Another user already has this PIN');
              await db.users.put({ id: user?.id ?? uid(), name: name.trim(), role, pin, active });
              onClose();
            }, 'User saved')
          }
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
            <option value="cashier">Cashier</option>
          </Select>
        </Field>
        <Field label="PIN (4–6 digits)">
          <Input value={pin} inputMode="numeric" onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
      </div>
    </Modal>
  );
}

function AccountsCard() {
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? [];
  const run = useAction();
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('bank');
  return (
    <Card title="Payment accounts">
      <ul className="divide-y divide-slate-100">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <input
              className="flex-1 rounded px-1 py-0.5 hover:bg-slate-50"
              defaultValue={a.name}
              onBlur={(e) => e.target.value.trim() && db.accounts.update(a.id, { name: e.target.value.trim() })}
            />
            <span className="text-xs capitalize text-slate-500">
              {a.type}
              {a.provider && ' · retailer'}
            </span>
            {a.type !== 'cash' && (
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={a.active} onChange={(e) => db.accounts.update(a.id, { active: e.target.checked })} /> Active
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-slate-100 p-3">
        <Input placeholder="New account, e.g. Meezan Bank" value={name} onChange={(e) => setName(e.target.value)} />
        <Select className="w-32" value={type} onChange={(e) => setType(e.target.value as Account['type'])}>
          <option value="bank">Bank</option>
          <option value="wallet">Wallet</option>
          <option value="cash">Cash</option>
        </Select>
        <Button
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              await db.accounts.add({ id: uid(), name: name.trim(), type, active: true });
              setName('');
            }, 'Account added')
          }
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

/** All data lives on this computer, so regular backups to a USB/Google Drive file matter. */
function BackupCard() {
  const run = useAction();
  const lastBackup = localStorage.getItem('retailos.lastBackup');

  const exportAll = async () => {
    const data: Record<string, unknown[]> = {};
    for (const table of db.tables) data[table.name] = await table.toArray();
    const blob = new Blob([JSON.stringify({ app: 'retailos', version: 1, exportedAt: new Date().toISOString(), data })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `retailos-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('retailos.lastBackup', new Date().toISOString());
  };

  const importAll = (file: File) =>
    run(async () => {
      const json = JSON.parse(await file.text());
      if (json.app !== 'retailos' || !json.data) throw new Error('This is not a RetailOS backup file');
      if (!confirm('Restore this backup? ALL current data on this computer will be replaced.')) return;
      await db.transaction('rw', db.tables, async () => {
        for (const table of db.tables) {
          await table.clear();
          const rows = json.data[table.name];
          if (Array.isArray(rows) && rows.length) await table.bulkAdd(rows);
        }
      });
      location.reload();
    }, 'Backup restored');

  return (
    <Card title="Backup & restore">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-slate-600">
          All data is saved in this browser on this computer. Download a backup every day and keep it on a USB or Google Drive.
        </p>
        <p className="text-slate-500">Last backup: {lastBackup ? new Date(lastBackup).toLocaleString('en-PK') : 'never'}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(exportAll, 'Backup downloaded')}>
            <Download size={16} /> Download backup
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
            <Upload size={16} /> Restore from file
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
          </label>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (prompt('This deletes ALL data on this computer. Type DELETE to confirm.') === 'DELETE') {
                db.delete().then(() => {
                  localStorage.removeItem('retailos.userId');
                  location.reload();
                });
              }
            }}
          >
            Delete all data and start again
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Last voice commands, for checking what the assistant heard and understood. */
function VoiceLogCard() {
  const logs = useLiveQuery(() => db.voiceLogs.orderBy('date').reverse().limit(25).toArray(), []) ?? [];
  return (
    <Card title="Voice command log" className="xl:col-span-2">
      {logs.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No voice commands yet. Audio is never saved — only the recognised text.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Time</th>
                <th className={th}>Heard</th>
                <th className={th}>Understood as</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className={cx(td, 'whitespace-nowrap text-slate-600')}>{new Date(l.date).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className={td}>{l.spokenText}</td>
                  <td className={cx(td, 'font-mono text-xs text-slate-600')}>{JSON.stringify(l.parsed)}</td>
                  <td className={td}>
                    <Badge tone={l.status === 'success' ? 'green' : l.status === 'partial' ? 'amber' : 'red'}>{l.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
