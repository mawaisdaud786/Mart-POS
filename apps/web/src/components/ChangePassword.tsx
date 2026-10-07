import { useState } from 'react';
import { apiRequest } from '../lib/api';
import { Button, Field, Input, Modal, useAction } from './ui';

/** Everyone can change their own password. Other devices signed in with it are signed out. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const run = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again.length > 0 && again !== next;
  return (
    <Modal
      title="Change my password"
      onClose={onClose}
      footer={
        <Button
          disabled={!current || next.length < 10 || next !== again}
          onClick={() =>
            run(async () => {
              await apiRequest('/shop/me/password', { method: 'POST', json: { current, next } });
              onClose();
            }, 'Password changed. Your other devices were signed out.')
          }
        >
          Change password
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="New password" hint="At least 10 characters. A sentence works well, like: blue lantern over hills">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Type the new password again" hint={mismatch ? 'The two passwords are not the same' : undefined}>
          <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
