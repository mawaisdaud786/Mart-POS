import { useState } from 'react';
import { Field, Input, Select } from '../components/ui';
import { loginWithPassword, type TenantChoice } from '../lib/api';
import { consumeIdleNotice, useSession } from '../lib/session';

/** Sign in with the email or mobile number and password of the shop account. */
export function Login() {
  const { signIn } = useSession();
  // Set by the idle auto-logout so people know why they are back here.
  const [error, setError] = useState(() => (consumeIdleNotice() ? 'You were signed out after 30 minutes without use.' : ''));
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await loginWithPassword({ identifier, password, ...(tenantId ? { tenantId } : {}) });
      if (result.status === 'choose_tenant') {
        setTenants(result.tenants);
        setTenantId(result.tenants.length === 1 ? result.tenants[0]!.tenantId : '');
      } else {
        setPassword('');
        signIn(result.session);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in to the shop server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[#073b28] p-4 sm:p-8">
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-emerald-300/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 h-96 w-96 rounded-full bg-amber-300/10 blur-3xl" />
      <div className="relative w-full max-w-md rounded-[1.75rem] border border-white/70 bg-white p-7 shadow-2xl shadow-emerald-950/30 sm:p-9">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 grid h-32 w-32 place-items-center overflow-hidden rounded-2xl bg-white p-1 shadow-sm ring-1 ring-emerald-900/10">
            <img src="/al-noor-mart-logo.jpeg" alt="Al Noor Mart logo" className="h-full w-full rounded-xl object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-950">Al Noor Mart</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your shop account</p>
        </div>
        <form className="grid gap-3" onSubmit={submit}>
          <Field label="Email or mobile">
            <Input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          {tenants.length > 0 && (
            <Field label="Shop">
              <Select value={tenantId} onChange={(event) => setTenantId(event.target.value)} required>
                <option value="">Choose shop</option>
                {tenants.map((tenant) => (
                  <option key={tenant.tenantId} value={tenant.tenantId}>
                    {tenant.name} · {tenant.role}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <p className="min-h-5 text-center text-sm text-rose-600" role="alert">
            {error}
          </p>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-md shadow-emerald-900/15 transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-600/50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs font-medium text-slate-400">Powered by <a href="https://mirwal.pk" target="_blank" rel="noreferrer" className="text-emerald-800 hover:text-amber-700">mirwal.pk</a></p>
      </div>
    </div>
  );
}
