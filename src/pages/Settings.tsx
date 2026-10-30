import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABEL } from '@shared/constants';
import { normalizePhone } from '@shared/schemas';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import { getSettings, listUsers, saveSettings } from '@/mock/api';
import type { Settings as SettingsT } from '@/mock/seed';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Avatar, Badge, Button, Card, Field, PageHeader, Spinner, Toggle } from '@/components/ui';
import { LogoutIcon } from '@/components/ui/icons';
import { runDailyReport, runDebtReminders, type DailyReportOutcome } from '@/mock/jobs';
import { listSmsLogs } from '@/mock/sms';
import { smsSegments } from '@shared/sms';
import { tr } from '@/i18n';

const SMS_TOGGLES: { key: keyof SettingsT; title: string; sub: string }[] = [
  { key: 'smsDaily', title: 'Ripoti ya siku kwa mmiliki', sub: 'Mauzo, matumizi, faida halisi na madeni' },
  { key: 'smsPurchase', title: 'Uthibitisho wa ununuzi kwa mteja', sub: 'Bidhaa, alicholipa na deni lililobaki' },
  { key: 'smsDebtPayment', title: 'Uthibitisho wa malipo ya deni', sub: 'Kila mteja anapolipa sehemu ya deni' },
  { key: 'smsReminders', title: 'Kukumbusha madeni', sub: 'Siku 2 kabla ya tarehe na baada ya kupita' },
];

export default function Settings() {
  const { user, logout } = useAuth();
  const role = user!.role;
  const qc = useQueryClient();
  const { data: saved } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => listUsers(role) });
  const [s, setS] = useState<SettingsT | null>(null);
  const [phoneErr, setPhoneErr] = useState('');

  useEffect(() => {
    if (saved) setS(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: (v: SettingsT) => saveSettings(user!, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (!s || !users) return <Spinner variant="form" />;
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setS({ ...s, [k]: v });

  const onSave = () => {
    if (s.ownerPhone && !normalizePhone(s.ownerPhone)) {
      setPhoneErr('Namba ya simu si sahihi');
      return;
    }
    setPhoneErr('');
    save.mutate(s);
  };

  return (
    <>
      <PageHeader
        title="Mipangilio"
        subtitle="Inaonekana kwa mmiliki tu."
        actions={
          <>
            <Link to="/audit" className="inline-flex min-h-touch items-center rounded-field border border-line px-4 text-[14px] font-semibold text-primary-link">{tr('Kumbukumbu')}</Link>
            <Button loading={save.isPending} onClick={onSave} disabled={save.isPending}>
              {tr('Hifadhi mabadiliko')}
            </Button>
          </>
        }
      />
      {save.isSuccess && <p className="mb-4 rounded-field bg-ok-bg px-4 py-2.5 text-[13.5px] font-medium text-ok-fg">{tr('Mabadiliko yamehifadhiwa.')}</p>}
      {save.isError && <p className="mb-4 rounded-field bg-bad-bg px-4 py-2.5 text-[13.5px] font-medium text-bad-fg">{tr((save.error as Error).message)}</p>}

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="text-[17px] font-bold">Language / Lugha</h2>
          <p className="text-[12.5px] text-muted">{tr('Lugha ya mfumo inabadilika mara moja. SMS na risiti zinazotumwa kwa wateja zinabaki kwa Kiswahili.')}</p>
        </div>
        <LanguageSwitch />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 text-[17px] font-bold">{tr('Taarifa za duka')}</h2>
          <div className="space-y-4">
            <Field label="Jina la duka"><input className="input" value={s.shopName} onChange={(e) => set('shopName', e.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Namba ya simu"><input className="input" placeholder={tr('[Namba ya duka]')} value={s.shopPhone} onChange={(e) => set('shopPhone', e.target.value)} /></Field>
              <Field label="Mahali"><input className="input" placeholder={tr('[Mtaa, mji]')} value={s.shopAddress} onChange={(e) => set('shopAddress', e.target.value)} /></Field>
            </div>
            <Field label="Maandishi ya chini ya risiti"><input className="input" value={s.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} /></Field>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="mb-2 text-[17px] font-bold">{tr('SMS notification')}</h2>
          <ul className="divide-y divide-line-soft">
            {SMS_TOGGLES.map((t) => (
              <li key={t.key} className="flex items-center justify-between gap-4 py-3.5">
                <div>
                  <p className="text-[14.5px] font-semibold">{tr(t.title)}</p>
                  <p className="text-[12.5px] text-muted">{tr(t.sub)}</p>
                </div>
                <Toggle label={tr(t.title)} checked={Boolean(s[t.key])} onChange={(v) => set(t.key, v as never)} />
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Muda wa ripoti ya siku"><input type="time" className="input" value={s.dailyTime} onChange={(e) => set('dailyTime', e.target.value)} /></Field>
            <Field label="Namba ya mmiliki" error={phoneErr}><input className="input" placeholder={tr('[Namba ya mmiliki]')} value={s.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} /></Field>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-bold">{tr('Watumiaji')}</h2>
            <Link to="/users" className="inline-flex min-h-[38px] items-center rounded-xl bg-primary-tint px-4 text-[13.5px] font-semibold text-primary-link">{tr('Simamia watumiaji')}</Link>
          </div>
          <ul className="divide-y divide-line-soft">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-3">
                <Avatar name={u.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{u.name}</p>
                  <p className="text-[12.5px] text-muted">{displayPhone(u.phone)}</p>
                </div>
                {!u.isActive && <Badge tone="bad">{tr('Imezimwa')}</Badge>}
                <Badge tone={u.role === 'owner' ? 'navy' : 'blue'}>{tr(ROLE_LABEL[u.role])}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 text-[17px] font-bold">{tr('Mauzo, stock na risiti')}</h2>
          <div className="space-y-4">
            <Field label="Kiwango cha chini cha kawaida (hiari)">
              <input className="input" inputMode="numeric" value={s.defaultMinStock} onChange={(e) => set('defaultMinStock', Number(e.target.value) || 0)} />
            </Field>
            <Field label="Printer ya risiti">
              <select className="input" value={s.printerWidth} onChange={(e) => set('printerWidth', e.target.value as '80' | '58')}>
                <option value="80">{tr('Thermal 80mm')}</option>
                <option value="58">{tr('Thermal 58mm')}</option>
              </select>
            </Field>
            <Field label="Punguzo la juu analoweza kutoa muuzaji (%)">
              <input className="input" inputMode="numeric" value={s.maxDiscountPct} onChange={(e) => set('maxDiscountPct', Math.min(100, Number(e.target.value) || 0))} />
            </Field>
          </div>
        </Card>
      </div>

      <SmsPanel />

      <div className="mt-6 md:hidden">
        <Button variant="outline" block onClick={logout}><LogoutIcon width={18} height={18} /> {tr('Toka')}</Button>
      </div>
    </>
  );
}

// Swahili source text; translated when shown (calling tr() here would freeze the language at load time).
const DAILY_TEXT: Record<DailyReportOutcome, string> = {
  SENT: 'Ripoti ya leo imetumwa (kwenye logi).',
  DUPLICATE: 'Ripoti ya leo ilishatumwa; haitumwi mara mbili.',
  FAILED: 'Imeshindikana kutuma.',
  DISABLED: 'Ripoti ya siku imezimwa kwenye mipangilio ya SMS.',
  NO_PHONE: 'Weka namba ya mmiliki kwanza (kisha bonyeza "Hifadhi mabadiliko").',
};

/** Same jobs Vercel Cron will run; here they run on demand so the owner can check the wording. */
function SmsPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: logs } = useQuery({ queryKey: ['sms-logs'], queryFn: () => listSmsLogs(user!.role) });
  const [note, setNote] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sms-logs'] });

  const daily = useMutation({
    mutationFn: () => runDailyReport(),
    onSuccess: (r) => {
      setNote(DAILY_TEXT[r]);
      refresh();
    },
  });
  const reminders = useMutation({
    mutationFn: () => runDebtReminders(),
    onSuccess: (r) => {
      setNote(r.disabled ? 'Vikumbusho vimezimwa kwenye mipangilio ya SMS.' : `Vikumbusho: ${r.sent} vimetumwa, ${r.duplicates} vilishatumwa leo, ${r.failed} vimeshindikana.`);
      refresh();
    },
  });

  return (
    <Card className="mt-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold">{tr('Majaribio na historia ya SMS')}</h2>
          <p className="text-[12.5px] text-muted">{tr('Hali ya majaribio: ujumbe unaandikwa kwenye logi tu, hautumwi kwa mtandao. Kila ujumbe wa siku unatumwa mara moja tu.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button loading={daily.isPending} variant="outline" disabled={daily.isPending} onClick={() => daily.mutate()}>{tr('Tuma ripoti ya leo sasa')}</Button>
          <Button loading={reminders.isPending} variant="outline" disabled={reminders.isPending} onClick={() => reminders.mutate()}>{tr('Tuma vikumbusho sasa')}</Button>
        </div>
      </div>
      {note && <p role="status" className="mt-3 rounded-field bg-primary-tint px-4 py-2.5 text-[13.5px] text-primary-link">{tr(note)}</p>}
      <ul className="mt-3 divide-y divide-line-soft">
        {(logs ?? []).map((l) => (
          <li key={l.id} className="py-3 text-[13px]">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={l.status === 'SENT' ? 'ok' : 'bad'}>{l.status === 'SENT' ? tr('Imetumwa') : tr('Imeshindikana')}</Badge>
              <b>{l.to}</b>
              <span className="text-muted">{l.type} · {new Date(l.sentAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · SMS {smsSegments(l.body).segments}</span>
            </p>
            <p className="mt-1 text-body">{l.body}</p>
            {l.error && <p className="text-bad-fg">{l.error}</p>}
          </li>
        ))}
        {logs?.length === 0 && <li className="py-3 text-muted">{tr('Hakuna SMS bado.')}</li>}
      </ul>
    </Card>
  );
}
