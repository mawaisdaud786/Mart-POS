import { Plus } from 'lucide-react';
import { useState } from 'react';
import { apiRequest } from '../lib/api';
import { notifyChange, useLiveQuery } from '../lib/store';
import { useSession } from '../lib/session';
import { compareListValues, ListControls } from './ListControls';
import { Badge, Button, Card, Field, Input, Modal, Select, cx, td, th, useAction } from './ui';

interface Member {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleKey: string | null;
  roleName: string;
  active: boolean;
  lastLoginAt: string | null;
}

const ROLES = [
  { key: 'cashier', label: 'Cashier', help: 'Sells at the counter, takes customer payments and Easypaisa. Sees no cost or profit.' },
  { key: 'manager', label: 'Manager', help: 'Everything for running the shop except settings, staff and owner withdrawals.' },
  { key: 'inventory_manager', label: 'Inventory manager', help: 'Products, stock and purchasing.' },
  { key: 'accountant', label: 'Accountant', help: 'Reports, expenses and accounts.' },
  { key: 'owner', label: 'Owner', help: 'Everything, including staff and settings.' },
];

/** The people who can sign in to this shop. Their accounts, passwords and roles are kept by the server. */
export function TeamCard() {
  const { user, has } = useSession();
  const members = useLiveQuery(() => apiRequest<Member[]>('/shop/users'), [user?.id]) ?? [];
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'role' | 'lastLogin'>('name');
  const run = useAction();
  const selectable = members.filter((member) => member.id !== user?.id);
  const query = search.trim().toLocaleLowerCase();
  const visibleMembers = [...members]
    .filter((member) => statusFilter === 'all' || member.active === (statusFilter === 'active'))
    .filter((member) => !query || member.name.toLocaleLowerCase().includes(query) || (member.email ?? '').toLocaleLowerCase().includes(query) || (member.phone ?? '').includes(query) || member.roleName.toLocaleLowerCase().includes(query))
    .sort((a, b) => sortBy === 'role'
      ? compareListValues(a.roleName, b.roleName)
      : sortBy === 'lastLogin'
        ? compareListValues(b.lastLoginAt ?? '', a.lastLoginAt ?? '')
        : compareListValues(a.name, b.name));
  const visibleSelectable = visibleMembers.filter((member) => member.id !== user?.id);
  const changeSelectedStatus = (active: boolean) => run(async () => {
    try {
      for (const id of selected) {
        await apiRequest(`/shop/users/${id}`, { method: 'PATCH', json: { active } });
      }
    } finally {
      notifyChange();
    }
    setSelected([]);
  }, active ? 'Selected people reactivated' : 'Selected people switched off');
  return (
    <Card
      title="Staff & passwords"
      className="xl:col-span-2"
      actions={
        <div className="flex flex-wrap gap-2">
          {has('users.manage') && (
            <>
              <Button size="sm" variant="secondary" disabled={!selected.length} onClick={() => void changeSelectedStatus(true)}>Reactivate {selected.length || ''}</Button>
              <Button size="sm" variant="secondary" disabled={!selected.length} onClick={() => void changeSelectedStatus(false)}>Switch off {selected.length || ''}</Button>
            </>
          )}
          <Button size="sm" onClick={() => setEditing('new')}><Plus size={14} /> Add person</Button>
        </div>
      }
    >
      <ListControls
        search={search}
        onSearch={setSearch}
        placeholder="Search name, sign-in or role…"
        filters={[{ label: 'Account status', value: statusFilter, options: [{ value: 'all', label: 'All accounts' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Switched off' }], onChange: setStatusFilter }]}
        sortValue={sortBy}
        sortOptions={[{ value: 'name', label: 'Name · A–Z' }, { value: 'role', label: 'Role · A–Z' }, { value: 'lastLogin', label: 'Last sign-in · recent' }]}
        onSort={(value) => setSortBy(value as typeof sortBy)}
      />
      {visibleMembers.length === 0 ? <p className="p-4 text-sm text-slate-500">No matching accounts.</p> : <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              {has('users.manage') && <th className={th}><input aria-label="Select all visible other users" type="checkbox" checked={visibleSelectable.length > 0 && visibleSelectable.every((member) => selected.includes(member.id))} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visibleSelectable.map((member) => member.id)])] : selected.filter((id) => !visibleSelectable.some((member) => member.id === id)))} /></th>}
              <th className={th}>Name</th>
              <th className={th}>Sign-in</th>
              <th className={th}>Role</th>
              <th className={th}>Last sign-in</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleMembers.map((m) => (
              <tr key={m.id}>
                {has('users.manage') && <td className={td}><input type="checkbox" aria-label={`Select ${m.name}`} disabled={m.id === user?.id} checked={selected.includes(m.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))} /></td>}
                <td className={cx(td, 'font-medium')}>
                  {m.name}
                  {m.id === user?.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                </td>
                <td className={td}>{m.email ?? m.phone}</td>
                <td className={td}>{m.roleName}</td>
                <td className={cx(td, 'text-slate-500')}>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</td>
                <td className={td}>{m.active ? <Badge tone="green">Active</Badge> : <Badge>Switched off</Badge>}</td>
                <td className={cx(td, 'text-right')}>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <p className="px-4 pb-3 text-xs text-slate-500">Each person signs in with their own email or mobile number and password, and only sees what their role allows. Switch people off instead of sharing a login.</p>
      {editing && <MemberForm member={editing === 'new' ? null : editing} canMakeOwner={has('roles.manage')} isSelf={editing !== 'new' && editing.id === user?.id} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function MemberForm({ member, canMakeOwner, isSelf, onClose }: { member: Member | null; canMakeOwner: boolean; isSelf: boolean; onClose: () => void }) {
  const run = useAction();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleKey, setRoleKey] = useState(member?.roleKey ?? 'cashier');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(member?.active ?? true);
  const roles = ROLES.filter((r) => r.key !== 'owner' || canMakeOwner || member?.roleKey === 'owner');
  const help = ROLES.find((r) => r.key === roleKey)?.help;

  const save = () =>
    run(async () => {
      if (!member) {
        await apiRequest('/shop/users', { method: 'POST', json: { name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}), roleKey, password } });
      } else {
        await apiRequest(`/shop/users/${member.id}`, {
          method: 'PATCH',
          json: { ...(name.trim() !== member.name ? { name: name.trim() } : {}), ...(roleKey !== member.roleKey ? { roleKey } : {}), ...(active !== member.active ? { active } : {}) },
        });
        if (password) await apiRequest(`/shop/users/${member.id}/password`, { method: 'POST', json: { password } });
      }
      notifyChange();
      onClose();
    }, member ? 'Saved' : 'Person added');

  return (
    <Modal
      title={member ? `Edit ${member.name}` : 'Add a person'}
      onClose={onClose}
      footer={
        <Button disabled={!name.trim() || (!member && (!password || (!email.trim() && !phone.trim())))} onClick={save}>
          Save
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {!member && (
          <>
            <Field label="Email" hint="They sign in with their email or their mobile number">
              <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Mobile number">
              <Input inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
            </Field>
          </>
        )}
        <Field label="Role" hint={help}>
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} disabled={isSelf}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={member ? 'Set a new password (leave empty to keep theirs)' : 'Password'} hint="At least 10 characters. A sentence works well, like: blue lantern over hills. Tell them to change it after the first sign-in.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {member && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} /> Allowed to sign in
          </label>
        )}
      </div>
    </Modal>
  );
}
