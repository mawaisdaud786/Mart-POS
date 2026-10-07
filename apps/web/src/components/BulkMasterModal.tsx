import { useState } from 'react';
import { bulkMasterRecords } from '../lib/ops';
import { Button, Field, Input, Modal, Select, useAction } from './ui';

type Entity = 'categories' | 'customers' | 'suppliers';

export function BulkMasterModal({ entity, ids, onClose }: { entity: Entity; ids: string[]; onClose: () => void }) {
  const run = useAction();
  const [mode, setMode] = useState<'create' | 'update' | 'delete'>('create');
  const [names, setNames] = useState('');
  const [field, setField] = useState(entity === 'customers' ? 'shopkeeperPricing' : 'company');
  const [value, setValue] = useState('');
  const records = names.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const canUpdate = entity !== 'categories';
  const validUpdate = field === 'shopkeeperPricing' ? value !== '' :
    field === 'leadDays' || field === 'orderDay'
      ? value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= (field === 'orderDay' ? 6 : 365)
      : true;

  const save = () => run(async () => {
    if (mode === 'create') {
      if (records.length > 500) throw new Error('Add no more than 500 names at a time');
      if (records.length === 0) throw new Error('Enter at least one name');
      await bulkMasterRecords(entity, 'create', { records: records.map((name) => ({ name })) });
    } else if (mode === 'delete') {
      if (!ids.length) throw new Error('Select records first');
      await bulkMasterRecords(entity, 'delete', { ids });
    } else {
      if (!ids.length) throw new Error('Select records first');
      const updates = field === 'shopkeeperPricing'
        ? { shopkeeperPricing: value === 'true' }
        : field === 'leadDays'
          ? { leadDays: Number(value) }
          : field === 'orderDay'
            ? { orderDay: Number(value) }
            : field === 'phone'
              ? { phone: value.trim() }
              : field === 'address'
                ? { address: value.trim() }
                : { company: value.trim() };
      await bulkMasterRecords(entity, 'update', { ids, updates });
    }
    onClose();
  }, mode === 'create' ? 'Records added' : mode === 'delete' ? 'Selected records deleted' : 'Selected records updated');

  return (
    <Modal
      title={`Bulk ${entity}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={mode === 'create' ? records.length === 0 : ids.length === 0 || (mode === 'update' && !validUpdate)} onClick={save}>
            {mode === 'create' ? `Add ${records.length}` : mode === 'delete' ? `Delete ${ids.length}` : `Update ${ids.length}`}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={mode === 'create' ? 'primary' : 'secondary'} onClick={() => setMode('create')}>Bulk add</Button>
        {canUpdate && <Button size="sm" variant={mode === 'update' ? 'primary' : 'secondary'} onClick={() => setMode('update')}>Bulk edit</Button>}
        <Button size="sm" variant={mode === 'delete' ? 'danger' : 'secondary'} onClick={() => setMode('delete')}>Bulk delete</Button>
      </div>
      {mode === 'create' ? (
        <Field label="Names (one per line)" hint="Up to 500 records. Existing names are not duplicated.">
          <textarea className="min-h-36 w-full rounded-lg border border-slate-300 p-3 text-sm" value={names} onChange={(event) => setNames(event.target.value)} />
        </Field>
      ) : mode === 'delete' ? (
        <p className="text-sm text-slate-600">
          Delete {ids.length} selected {entity}. The server will prevent deletion if products or transaction history depend on them.
        </p>
      ) : (
        <div className="grid gap-3">
          <Field label="Field">
            <Select value={field} onChange={(event) => setField(event.target.value)}>
              {entity === 'customers' ? (
                <>
                  <option value="shopkeeperPricing">Special / shopkeeper pricing</option>
                  <option value="phone">Phone</option>
                  <option value="address">Address</option>
                </>
              ) : (
                <>
                  <option value="company">Company</option>
                  <option value="phone">Phone</option>
                  <option value="leadDays">Delivery lead days</option>
                  <option value="orderDay">Weekly order day (0 Sunday – 6 Saturday)</option>
                </>
              )}
            </Select>
          </Field>
          {field === 'shopkeeperPricing' ? (
            <Field label="Set pricing">
              <Select value={value} onChange={(event) => setValue(event.target.value)}>
                <option value="">Choose setting</option>
                <option value="true">Enable</option>
                <option value="false">Disable</option>
              </Select>
            </Field>
          ) : (
            <Field label="New value">
              <Input type={field === 'leadDays' || field === 'orderDay' ? 'number' : 'text'} min={0} max={field === 'orderDay' ? 6 : 365} maxLength={field === 'address' ? 300 : field === 'phone' ? 30 : 120} value={value} onChange={(event) => setValue(event.target.value)} />
            </Field>
          )}
        </div>
      )}
      {mode !== 'create' && <p className="mt-3 text-xs text-slate-500">{ids.length} selected. Financial history is never changed.</p>}
    </Modal>
  );
}
