import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerSchema } from '@shared/schemas';
import type { CustomerStatus } from '@shared/customers';
import { useAuth } from '@/lib/auth';
import { displayPhone, formatDate, formatTZS } from '@/lib/format';
import { exportCustomersPdf } from '@/lib/exportCustomersPdf';
import {
  checkCustomerDuplicates,
  getCustomerProfile,
  getCustomerReport,
  getDebtOverview,
  listCustomers,
  saveCustomer,
  SimilarCustomerError,
  type Customer,
  type CustomerListItem,
  type CustomerProfile,
  type CustomerSaleRow,
} from '@/mock/sales';
import { Avatar, Badge, Button, Card, PageHeader, Spinner, Tabs, cx } from '@/components/ui';
import { PlusIcon, SearchIcon } from '@/components/ui/icons';
import Modal from '@/components/Modal';
import ReceivePayment from '@/components/ReceivePayment';
import ReportDialog from '@/components/ReportDialog';
import { CustomerStatusBadge } from '@/components/badges';
import { tr } from '@/i18n';

type Filter = 'all' | 'debt' | 'paid' | 'none';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Wateja wote' },
  { value: 'debt', label: 'Wenye deni' },
  { value: 'paid', label: 'Waliolipa kikamilifu' },
  { value: 'none', label: 'Hawajanunua' },
];
const STATUS_OF: Record<Exclude<Filter, 'all'>, CustomerStatus> = { debt: 'DEBT', paid: 'PAID', none: 'NONE' };

const day = (ymd: string) => formatDate(new Date(`${ymd}T00:00:00`));
const phoneOf = (c: Customer) => (c.phone ? displayPhone(c.phone) : '–');

export default function Customers() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<{ edit?: Customer } | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const [report, setReport] = useState<{ customerId?: number } | null>(null);
  const { data: list } = useQuery({ queryKey: ['customers', q], queryFn: () => listCustomers(q) });
  const { data: debts } = useQuery({ queryKey: ['debts'], queryFn: getDebtOverview });

  if (!list) return <Spinner variant="table" />;
  const selectedId = Number(params.get('c')) || null;
  const select = (id: number | null) => setParams(id ? { c: String(id) } : {}, { replace: true });
  const counts = {
    all: list.length,
    debt: list.filter((x) => x.status === 'DEBT').length,
    paid: list.filter((x) => x.status === 'PAID').length,
    none: list.filter((x) => x.status === 'NONE').length,
  };
  const rows = list.filter((x) => filter === 'all' || x.status === STATUS_OF[filter]);
  const payRows = paying ? (debts?.rows.filter((r) => r.customer.id === paying) ?? []) : [];

  return (
    <>
      <PageHeader
        title="Wateja"
        subtitle="Taarifa za kila mteja, manunuzi yake, malipo na deni."
        actions={
          <>
            <Button variant="outline" onClick={() => setReport({})}>{tr('Pakua PDF')}</Button>
            <Button onClick={() => setForm({})}>
              <PlusIcon width={18} height={18} /> {tr('Sajili mteja')}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input h-10 min-h-0 pl-10"
            placeholder={tr('Jina au namba ya simu…')}
            aria-label={tr('Tafuta mteja')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Tabs
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: `${tr(f.label)} (${counts[f.value]})` }))}
        />
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-muted">
          {list.length === 0 && !q ? tr('Hakuna wateja bado. Bonyeza "Sajili mteja" kuanza.') : tr('Hakuna mteja aliyepatikana.')}
        </Card>
      ) : (
        <>
          {/* Desktop / tablet: compact table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-slate-50/80 text-left text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">{tr('Mteja')}</th>
                  <th className="py-3">{tr('Namba ya simu')}</th>
                  <th className="py-3 pl-5 text-right">{tr('Manunuzi')}</th>
                  <th className="py-3 pl-5 text-right">{tr('Jumla ya manunuzi')}</th>
                  <th className="py-3 pl-5 text-right">{tr('Deni analodaiwa')}</th>
                  <th className="py-3 pl-4">{tr('Hali')}</th>
                  <th className="px-4 py-3 text-right">{tr('Vitendo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.customer.id} className="border-t border-line-soft hover:bg-slate-50/70">
                    <td className="max-w-[220px] px-4 py-2.5">
                      <button type="button" onClick={() => select(x.customer.id)} className="flex min-w-0 items-center gap-2.5 text-left">
                        <Avatar name={x.customer.name} size={32} />
                        <span className="truncate font-bold text-ink hover:text-primary-link">{x.customer.name}</span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap text-body">{phoneOf(x.customer)}</td>
                    <td className="tabular pl-5 text-right">{x.purchases}</td>
                    <td className="tabular text-right">{formatTZS(x.totalPurchased)}</td>
                    <td className={cx('tabular pl-5 text-right', x.debt > 0 ? 'font-extrabold text-warn-fg' : 'text-muted')}>{x.debt > 0 ? formatTZS(x.debt) : '–'}</td>
                    <td className="pl-4"><CustomerStatusBadge status={x.status} /></td>
                    <td className="px-4">
                      <div className="flex items-center justify-end gap-1">
                        {x.debt > 0 && <Button variant="soft" className="min-h-[34px] px-3 text-[13px]" onClick={() => setPaying(x.customer.id)}>{tr('Pokea')}</Button>}
                        <Button variant="ghost" className="min-h-[34px] px-3 text-[13px]" onClick={() => select(x.customer.id)}>{tr('Tazama')}</Button>
                        <Button variant="ghost" className="min-h-[34px] px-3 text-[13px]" onClick={() => setForm({ edit: x.customer })}>{tr('Hariri')}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: compact cards */}
          <ul className="space-y-2.5 md:hidden">
            {rows.map((x) => (
              <MobileCard key={x.customer.id} x={x} onView={() => select(x.customer.id)} onEdit={() => setForm({ edit: x.customer })} onPay={() => setPaying(x.customer.id)} />
            ))}
          </ul>
        </>
      )}

      {selectedId && (
        <Profile
          id={selectedId}
          onClose={() => select(null)}
          onEdit={(c) => setForm({ edit: c })}
          onPay={() => setPaying(selectedId)}
          onPdf={() => setReport({ customerId: selectedId })}
        />
      )}
      {form && (
        <CustomerForm
          edit={form.edit}
          onClose={() => setForm(null)}
          onSaved={(c) => {
            setForm(null);
            if (!form.edit) select(c.id);
          }}
        />
      )}
      {paying && payRows.length > 0 && <ReceivePayment rows={payRows} onClose={() => setPaying(null)} />}
      {report && (
        <ReportDialog
          title={tr('Ripoti ya wateja (PDF)')}
          scopes={[
            { value: 'all', label: 'Wateja wote' },
            { value: 'customer', label: 'Mteja mmoja' },
          ]}
          customers={list.map((x) => ({ id: x.customer.id, name: x.customer.name }))}
          initialScope={report.customerId ? 'customer' : 'all'}
          initialCustomerId={report.customerId}
          onClose={() => setReport(null)}
          onGenerate={async (c) => exportCustomersPdf(await getCustomerReport(c.range, c.scope === 'customer' ? c.customerId : undefined))}
        />
      )}
    </>
  );
}

function MobileCard({ x, onView, onEdit, onPay }: { x: CustomerListItem; onView: () => void; onEdit: () => void; onPay: () => void }) {
  return (
    <li className="card card-hover p-3.5">
      <button type="button" onClick={onView} className="flex w-full items-center gap-3 text-left">
        <Avatar name={x.customer.name} size={38} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold text-ink">{x.customer.name}</span>
          <span className="block text-[12.5px] text-muted">{phoneOf(x.customer)}</span>
        </span>
        <CustomerStatusBadge status={x.status} debt={x.debt} showAmount />
      </button>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line-soft pt-2.5 text-[12.5px] text-muted">
        <span>{tr('Manunuzi')}: {x.purchases} · {formatTZS(x.totalPurchased)}</span>
        <span className="flex shrink-0 gap-1">
          {x.debt > 0 && <Button variant="soft" className="min-h-[34px] px-3 text-[13px]" onClick={onPay}>{tr('Pokea')}</Button>}
          <Button variant="ghost" className="min-h-[34px] px-3 text-[13px]" onClick={onEdit}>{tr('Hariri')}</Button>
        </span>
      </div>
    </li>
  );
}

function Profile({ id, onClose, onEdit, onPay, onPdf }: { id: number; onClose: () => void; onEdit: (c: Customer) => void; onPay: () => void; onPdf: () => void }) {
  const { data: p } = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomerProfile(id) });

  return (
    <Modal title={tr('Wasifu wa mteja')} onClose={onClose} wide>
      {!p ? <Spinner variant="list" /> : <ProfileBody p={p} onClose={onClose} onEdit={onEdit} onPay={onPay} onPdf={onPdf} />}
    </Modal>
  );
}

function ProfileBody({ p, onClose, onEdit, onPay, onPdf }: { p: CustomerProfile; onClose: () => void; onEdit: (c: Customer) => void; onPay: () => void; onPdf: () => void }) {
  const c = p.customer;
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: tr('Jumla ya manunuzi'), value: formatTZS(p.totalPurchased) },
    { label: tr('Jumla aliyolipa'), value: formatTZS(p.paid), tone: 'text-ok-fg' },
    { label: tr('Deni analodaiwa'), value: formatTZS(p.debt), tone: p.debt > 0 ? 'text-warn-fg' : 'text-ok-fg' },
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Avatar name={c.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[19px] font-extrabold text-ink">{c.name}</h2>
            <CustomerStatusBadge status={p.status} debt={p.debt} showAmount />
          </div>
          <dl className="mt-1 space-y-0.5 text-[13px] text-muted">
            <div>{tr('Namba ya simu')}: <span className="text-body">{phoneOf(c)}</span></div>
            {c.email && <div>{tr('Barua pepe')}: <span className="text-body">{c.email}</span></div>}
            {c.area && <div>{tr('Anwani')}: <span className="text-body">{c.area}</span></div>}
            <div>{tr('Alisajiliwa')}: <span className="text-body">{formatDate(new Date(c.createdAt))}</span></div>
            {c.notes && <div>{tr('Maelezo ya mteja')}: <span className="text-body">{c.notes}</span></div>}
          </dl>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-[13px] font-semibold text-muted">{tr('Funga')}</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {p.debt > 0 && <Button onClick={onPay}>{tr('Pokea malipo')}</Button>}
        <Button variant="outline" onClick={() => onEdit(c)}>{tr('Hariri')}</Button>
        <Button variant="outline" onClick={onPdf}>{tr('Pakua PDF')}</Button>
      </div>

      <div className="grid grid-cols-1 divide-y divide-line-soft overflow-hidden rounded-field border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {cells.map((x) => (
          <div key={x.label} className="px-4 py-3">
            <p className="text-[12px] text-muted">{x.label}</p>
            <p className={cx('tabular mt-0.5 text-[19px] font-extrabold leading-tight', x.tone)}>{x.value}</p>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-[12.5px] text-muted">
        {p.purchases} {tr('manunuzi')}
        {p.lastPurchase && <> · {tr('Ya mwisho')}: {day(p.lastPurchase)}</>}
      </p>

      <History rows={p.history} />
    </div>
  );
}

const PAY_BADGE: Record<CustomerSaleRow['payStatus'], { tone: 'ok' | 'warn' | 'bad' | 'blue'; label: string }> = {
  PAID: { tone: 'ok', label: 'Imelipwa' },
  PARTIAL: { tone: 'warn', label: 'Sehemu' },
  UNPAID: { tone: 'bad', label: 'Hajalipa' },
  VOID: { tone: 'bad', label: 'Imefutwa' },
};

function History({ rows }: { rows: CustomerSaleRow[] }) {
  return (
    <div>
      <h3 className="mb-2 text-[15px] font-bold text-ink">{tr('Historia ya manunuzi')}</h3>
      {rows.length === 0 ? (
        <p className="rounded-field bg-app p-4 text-[13.5px] text-muted">{tr('Mteja huyu hajanunua bado.')}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-field border border-line md:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">{tr('Tarehe')}</th>
                  <th className="py-2">{tr('Risiti')}</th>
                  <th className="py-2">{tr('Bidhaa')}</th>
                  <th className="py-2 text-right">{tr('Jumla')}</th>
                  <th className="py-2 text-right">{tr('Amelipa')}</th>
                  <th className="py-2 text-right">{tr('Salio')}</th>
                  <th className="px-3 py-2">{tr('Hali')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.saleId} className="border-t border-line-soft align-top">
                    <td className="whitespace-nowrap px-3 py-2.5">{day(h.date)}</td>
                    <td className="whitespace-nowrap py-2.5"><Link to={`/sales/${h.saleId}`} className="font-semibold text-primary-link hover:underline">{h.receiptNo}</Link></td>
                    <td className="max-w-[200px] py-2.5 pr-2">{h.items}</td>
                    <td className="tabular py-2.5 text-right">{formatTZS(h.amount)}</td>
                    <td className="tabular py-2.5 text-right">{formatTZS(h.paid)}</td>
                    <td className={cx('tabular py-2.5 text-right', h.balance > 0 && 'font-bold text-warn-fg')}>{h.balance > 0 ? formatTZS(h.balance) : '–'}</td>
                    <td className="px-3 py-2.5"><Badge tone={PAY_BADGE[h.payStatus].tone}>{tr(PAY_BADGE[h.payStatus].label)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((h) => (
              <li key={h.saleId} className="rounded-field border border-line p-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/sales/${h.saleId}`} className="font-bold text-primary-link">{h.receiptNo}</Link>
                  <Badge tone={PAY_BADGE[h.payStatus].tone}>{tr(PAY_BADGE[h.payStatus].label)}</Badge>
                </div>
                <p className="mt-0.5 text-muted">{day(h.date)} · {h.items}</p>
                <p className="tabular mt-1.5 flex justify-between gap-2">
                  <span>{tr('Jumla')} {formatTZS(h.amount)}</span>
                  <span>{tr('Amelipa')} {formatTZS(h.paid)}</span>
                  <span className={h.balance > 0 ? 'font-bold text-warn-fg' : 'text-muted'}>{tr('Salio')} {formatTZS(h.balance)}</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CustomerForm({ edit, onClose, onSaved }: { edit?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [v, setV] = useState({
    name: edit?.name ?? '',
    phone: edit?.phone ? displayPhone(edit.phone) : '',
    email: edit?.email ?? '',
    area: edit?.area ?? '',
    notes: edit?.notes ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, string>>>({});
  const set = (k: keyof typeof v, val: string) => {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    save.reset();
  };

  // Possible duplicates are shown while typing, before anything is saved.
  const { data: dups = [] } = useQuery({
    queryKey: ['customer-dups', v.name, v.phone, edit?.id],
    queryFn: () => checkCustomerDuplicates({ name: v.name, phone: v.phone }, edit?.id),
    enabled: v.name.trim().length >= 2 || v.phone.trim().length >= 9,
  });
  const phoneDup = dups.find((d) => d.reason === 'PHONE');
  const nameDups = dups.filter((d) => d.reason === 'NAME');

  const save = useMutation({
    mutationFn: (allowSimilarName: boolean) => saveCustomer(v, edit?.id, { allowSimilarName, by: user?.name }),
    onSuccess: (c) => {
      for (const k of ['customers', 'customer', 'debts', 'customer-search']) void qc.invalidateQueries({ queryKey: [k] });
      onSaved(c);
    },
  });

  const submit = () => {
    const parsed = customerSchema.safeParse(v);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const i of parsed.error.issues) next[i.path[0] as keyof typeof v] ??= i.message;
      setErrors(next);
      return;
    }
    if (phoneDup) return;
    save.mutate(nameDups.length > 0 || save.error instanceof SimilarCustomerError);
  };
  const similar = !phoneDup && (nameDups.length > 0 || save.error instanceof SimilarCustomerError);
  const serverError = save.isError && !(save.error instanceof SimilarCustomerError) ? (save.error as Error).message : '';

  return (
    <Modal title={edit ? tr('Hariri mteja') : tr('Sajili mteja')} onClose={onClose}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3.5">
        <h2 className="text-[18px] font-extrabold text-ink">{edit ? tr('Hariri mteja') : tr('Sajili mteja')}</h2>
        <Input label={tr('Jina la mteja')} required value={v.name} onChange={(x) => set('name', x)} error={errors.name} autoFocus />
        <Input label={tr('Namba ya simu')} optional value={v.phone} onChange={(x) => set('phone', x)} error={errors.phone} inputMode="tel" placeholder="07XX XXX XXX" />
        <Input label={tr('Barua pepe')} optional value={v.email} onChange={(x) => set('email', x)} error={errors.email} inputMode="email" />
        <Input label={tr('Anwani')} optional value={v.area} onChange={(x) => set('area', x)} error={errors.area} />
        <label className="block">
          <span className="label">{tr('Maelezo ya mteja')} <Optional /></span>
          <textarea className="input min-h-[72px] py-2" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
          {errors.notes && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(errors.notes)}</span>}
        </label>

        {phoneDup && (
          <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">
            {tr('Namba hii tayari imesajiliwa kwa {name}', { name: phoneDup.name })}
          </p>
        )}
        {similar && nameDups.length > 0 && (
          <div role="alert" className="rounded-field bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-fg">
            <p className="font-semibold">{tr('Mteja mwenye jina linalofanana tayari yupo:')}</p>
            <ul className="mt-1 space-y-0.5">
              {nameDups.map((d) => (
                <li key={d.id}>{d.name}{d.phone && ` · ${displayPhone(d.phone)}`}</li>
              ))}
            </ul>
            <p className="mt-1 text-[12.5px]">{tr('Kama ni mteja mwingine, bonyeza "Hifadhi hata hivyo".')}</p>
          </div>
        )}
        {serverError && <p role="alert" className="rounded-field bg-bad-bg px-3.5 py-2 text-[13px] font-medium text-bad-fg">{tr(serverError)}</p>}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button variant="outline" onClick={onClose}>{tr('Ghairi')}</Button>
          <Button loading={save.isPending} type="submit" disabled={save.isPending || !!phoneDup}>
            {save.isPending ? tr('Inahifadhi…') : similar ? tr('Hifadhi hata hivyo') : tr('Hifadhi')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const Optional = () => <span className="font-normal text-muted">({tr('hiari')})</span>;

function Input({
  label,
  required,
  optional,
  value,
  onChange,
  error,
  ...rest
}: { label: string; required?: boolean; optional?: boolean; value: string; onChange: (v: string) => void; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <label className="block">
      <span className="label">
        {label} {required && <span className="text-bad-fg" aria-hidden>*</span>}
        {optional && <Optional />}
      </span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-required={required} {...rest} />
      {error && <span className="mt-1 block text-[12px] font-medium text-bad-fg">{tr(error)}</span>}
    </label>
  );
}
