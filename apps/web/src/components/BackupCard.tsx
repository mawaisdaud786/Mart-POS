import { Download, HardDriveDownload, Upload } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { deleteLegacyDatabase, legacyDataSummary, readLegacyBackup } from '../lib/legacy';
import { useSession } from '../lib/session';
import { invalidate, notifyChange, useLiveQuery } from '../lib/store';
import { Button, Card, useAction } from './ui';

/** Backups come from the shop server. The owner can also copy an old browser-only database to the server once. */
export function BackupCard() {
  const run = useAction();
  const { has } = useSession();
  const allowed = has('data.export_all');
  const legacy = useLiveQuery(() => (allowed ? legacyDataSummary() : null), [allowed]);

  const exportAll = async () => {
    const payload = await apiRequest<unknown>('/shop/export');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const fileName = `retailos-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  };

  const restore = async (body: unknown, confirmWord: string, question: string) => {
    if (window.prompt(`${question}\n\nType ${confirmWord} to confirm.`)?.trim() !== confirmWord) throw new Error('Cancelled. Nothing was changed.');
    const result = await apiRequest<{ imported: number }>('/shop/import', { method: 'POST', json: body });
    invalidate();
    notifyChange();
    return result.imported;
  };

  const restoreFile = (file: File) =>
    run(async () => {
      const json = JSON.parse(await file.text()) as { app?: string };
      if (json.app !== 'retailos') throw new Error('This is not a RetailOS backup file.');
      const n = await restore(json, 'RESTORE DATA', 'This replaces ALL current shop records on the server with the records in this file.');
      alert(`Backup restored: ${n} records.`);
    }, undefined);

  const moveLegacy = () =>
    run(async () => {
      const backup = await readLegacyBackup();
      if (!backup) throw new Error('No old data found in this browser.');
      const n = await restore(
        backup,
        'MOVE DATA',
        `Copy the old data from this browser to the server? It replaces the records now on the server (${legacy?.products ?? 0} products, ${legacy?.sales ?? 0} sales and ${legacy?.customers ?? 0} customers are in the old data).`,
      );
      if (window.confirm(`Copied ${n} records to the server.\n\nDelete the old copy from this browser now? (Recommended: the server is now the only copy.)`)) await deleteLegacyDatabase();
      notifyChange();
    }, 'Old data moved to the server');

  return (
    <Card title="Backup & restore">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-slate-600">
          Your shop&apos;s data is stored on the shop server, not in this browser. Download a backup file regularly and keep it somewhere safe (a USB drive or Google Drive). The server host should also back up the database every day.
        </p>
        {allowed ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(exportAll, 'Backup downloaded')}>
              <Download size={16} /> Download backup
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
              <Upload size={16} /> Restore from file
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void restoreFile(file);
                }}
              />
            </label>
          </div>
        ) : (
          <p className="text-slate-500">Only the owner can download or restore backups.</p>
        )}
        {allowed && legacy && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <div className="font-medium">Old data found in this browser</div>
            <p className="mt-1 text-xs">
              An earlier version stored {legacy.products} products, {legacy.sales} sales and {legacy.customers} customers here. Copy them to the server once; people&apos;s old PINs are not copied.
            </p>
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => void moveLegacy()}>
              <HardDriveDownload size={14} /> Copy old data to the server
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
