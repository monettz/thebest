import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABEL, ROLES, type Role } from '@shared/constants';
import { validateSecret } from '@shared/passwords';
import { normalizePhone } from '@shared/schemas';
import { useAuth } from '@/lib/auth';
import { displayPhone, formatDate } from '@/lib/format';
import { localUsers, type UserInput, type UserView } from '@/mock/users';
import { Avatar, Badge, Button, Card, PageHeader, Spinner } from '@/components/ui';
import { PlusIcon } from '@/components/ui/icons';
import Modal from '@/components/Modal';
import { tr } from '@/i18n';

/**
 * Users (owner only). Data comes from the local development store in `@/mock/users`; the page only
 * talks to the `UsersRepo` interface, so Supabase can replace the store without touching this file.
 */
export default function Users() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => localUsers.list() });
  const [form, setForm] = useState<{ edit?: UserView } | null>(null);

  const toggle = useMutation({
    mutationFn: (u: UserView) => localUsers.update(user!, u.id, { name: u.name, phone: u.phone, role: u.role, isActive: !u.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  if (!users) return <Spinner variant="table" />;

  return (
    <>
      <PageHeader
        title="Watumiaji"
        subtitle="Ongeza wauzaji, badilisha taarifa zao na simamia akaunti zao."
        actions={
          <Button onClick={() => setForm({})}>
            <PlusIcon width={18} height={18} /> {tr('Ongeza muuzaji')}
          </Button>
        }
      />

      <p role="note" className="mb-4 rounded-field bg-warn-bg px-4 py-2.5 text-[12.5px] leading-relaxed text-warn-fg">
        {tr('Watumiaji wanahifadhiwa kwenye kivinjari hiki tu kwa majaribio (nenosiri limefichwa kwa hash, lakini hii si usalama kamili). Akaunti halisi zitahamia Supabase.')}
      </p>
      {toggle.isError && <p role="alert" className="mb-3 rounded-field bg-bad-bg px-4 py-2.5 text-[13px] font-medium text-bad-fg">{tr((toggle.error as Error).message)}</p>}

      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">{tr('Mtumiaji')}</th>
              <th className="py-3">{tr('Namba ya simu')}</th>
              <th className="py-3">{tr('Jukumu')}</th>
              <th className="py-3">{tr('Hali ya akaunti')}</th>
              <th className="py-3">{tr('Alisajiliwa')}</th>
              <th className="px-4 py-3 text-right">{tr('Vitendo')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-line-soft">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5"><Avatar name={u.name} size={32} /><b className="text-ink">{u.name}</b></span>
                </td>
                <td className="whitespace-nowrap text-body">{displayPhone(u.phone)}</td>
                <td><RoleBadge role={u.role} /></td>
                <td><StatusBadge active={u.isActive} /></td>
                <td className="text-muted">{formatDate(new Date(u.createdAt))}</td>
                <td className="px-4">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="min-h-[34px] px-3 text-[13px]" onClick={() => setForm({ edit: u })}>{tr('Hariri')}</Button>
                    <Button loading={toggle.isPending} variant="ghost" className="min-h-[34px] px-3 text-[13px]" disabled={toggle.isPending || u.id === user!.id} onClick={() => toggle.mutate(u)}>
                      {u.isActive ? tr('Zima') : tr('Washa')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="space-y-2.5 md:hidden">
        {users.map((u) => (
          <li key={u.id} className="card p-3.5">
            <div className="flex items-center gap-3">
              <Avatar name={u.name} size={38} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold text-ink">{u.name}</p>
                <p className="text-[12.5px] text-muted">{displayPhone(u.phone)}</p>
              </div>
              <StatusBadge active={u.isActive} />
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
              <RoleBadge role={u.role} />
              <span className="flex gap-1">
                <Button variant="ghost" className="min-h-[36px] px-3 text-[13px]" onClick={() => setForm({ edit: u })}>{tr('Hariri')}</Button>
                <Button loading={toggle.isPending} variant="soft" className="min-h-[36px] px-3 text-[13px]" disabled={toggle.isPending || u.id === user!.id} onClick={() => toggle.mutate(u)}>
                  {u.isActive ? tr('Zima') : tr('Washa')}
                </Button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-muted">{tr('Muuzaji haoni faida wala bei za kununua, na hawezi kufuta mauzo.')}</p>

      {form && <UserForm edit={form.edit} onClose={() => setForm(null)} />}
    </>
  );
}

const RoleBadge = ({ role }: { role: Role }) => <Badge tone={role === 'owner' ? 'navy' : 'blue'}>{tr(ROLE_LABEL[role])}</Badge>;
const StatusBadge = ({ active }: { active: boolean }) => <Badge tone={active ? 'ok' : 'bad'}>{active ? tr('Hai') : tr('Imezimwa')}</Badge>;

function UserForm({ edit, onClose }: { edit?: UserView; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: edit?.name ?? '', phone: edit?.phone ? displayPhone(edit.phone) : '', password: '', confirm: '', role: (edit?.role ?? 'seller') as Role, isActive: edit?.isActive ?? true });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'phone' | 'password' | 'confirm', string>>>({});

  const save = useMutation({
    mutationFn: (input: UserInput) => (edit ? localUsers.update(user!, edit.id, input) : localUsers.create(user!, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    save.reset();
  };

  const submit = () => {
    const next: typeof errors = {};
    if (v.name.trim().length < 2) next.name = 'Weka jina kamili';
    if (!normalizePhone(v.phone)) next.phone = 'Namba ya simu si sahihi';
    const wantsPassword = !edit || v.password !== '' || v.confirm !== '';
    if (wantsPassword) {
      if (!/^\d{4}$/.test(v.password)) next.password = 'Nenosiri lazima liwe tarakimu 4 (ndiyo PIN ya kuingia)';
      else if (validateSecret(v.password, v.confirm)) next.confirm = 'Nenosiri halifanani';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate({ name: v.name, phone: v.phone, role: v.role, isActive: v.isActive, password: v.password, confirm: v.confirm });
  };

  return (
    <Modal title={edit ? tr('Hariri mtumiaji') : tr('Ongeza muuzaji')} onClose={onClose}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3.5">
        <h2 className="text-[18px] font-extrabold text-ink">{edit ? tr('Hariri mtumiaji') : tr('Ongeza muuzaji')}</h2>
        <Text label={tr('Jina kamili')} value={v.name} onChange={(x) => set('name', x)} error={errors.name} autoFocus />
        <Text label={tr('Namba ya simu')} value={v.phone} onChange={(x) => set('phone', x)} error={errors.phone} inputMode="tel" placeholder="07XX XXX XXX" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label={edit ? tr('Nenosiri jipya (hiari)') : tr('Nenosiri')} value={v.password} onChange={(x) => set('password', x.replace(/\D/g, '').slice(0, 4))} error={errors.password} type="password" inputMode="numeric" autoComplete="new-password" placeholder="••••" />
          <Text label={tr('Thibitisha nenosiri')} value={v.confirm} onChange={(x) => set('confirm', x.replace(/\D/g, '').slice(0, 4))} error={errors.confirm} type="password" inputMode="numeric" autoComplete="new-password" placeholder="••••" />
        </div>
        <p className="-mt-1.5 text-[12px] text-muted">{tr('Nenosiri ni tarakimu 4; ndiyo PIN ya kuingia kwenye skrini ya login.')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">{tr('Jukumu')}</span>
            <select className="input" value={v.role} onChange={(e) => set('role', e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{tr(ROLE_LABEL[r])}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">{tr('Hali ya akaunti')}</span>
            <select className="input" value={v.isActive ? 'on' : 'off'} onChange={(e) => set('isActive', e.target.value === 'on')} disabled={edit?.id === user?.id}>
              <option value="on">{tr('Hai')}</option>
              <option value="off">{tr('Imezimwa')}</option>
            </select>
          </label>
        </div>
        {save.isError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr((save.error as Error).message)}</p>}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button variant="outline" onClick={onClose}>{tr('Ghairi')}</Button>
          <Button loading={save.isPending} type="submit" disabled={save.isPending}>{save.isPending ? tr('Inahifadhi…') : tr('Hifadhi')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Text({ label, value, onChange, error, ...rest }: { label: string; value: string; onChange: (v: string) => void; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} {...rest} />
      {error && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(error)}</span>}
    </label>
  );
}
