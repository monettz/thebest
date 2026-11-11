import { tr } from '@/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LABEL } from '@shared/constants';
import { useAuth } from '@/lib/auth';
import { displayPhone, formatDate, formatNumber, formatTZS } from '@/lib/format';
import { getSettings } from '@/mock/api';
import { getPaymentReceipt, getReceipt, type PaymentReceiptView, type ReceiptView } from '@/mock/sales';
import type { Settings } from '@/mock/seed';
import { Button, Spinner, cx } from '@/components/ui';
import { useSuccess } from '@/components/SuccessDialog';
import { ChevronRight, CloseIcon, DownloadIcon, FileIcon, PrinterIcon, ShareIcon } from '@/components/ui/icons';
import { canShareFiles, downloadBlob, shareFile } from '@/lib/saveFile';
import {
  buildPaymentReceiptPdf,
  buildSaleReceiptPdf,
  paymentReceiptText,
  receiptFileName,
  saleReceiptText,
} from '@/lib/receiptPdf';

/** Calls window.print() once when the page was opened with ?print=1 and the data is ready. */
function useAutoPrint(ready: boolean) {
  const [params] = useSearchParams();
  const printed = useRef(false);
  useEffect(() => {
    if (ready && params.get('print') === '1' && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [ready, params]);
}

export default function Receipt() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (!user) return <Navigate to="/login" replace />;
  return params.get('payment') ? <PaymentReceipt /> : <SaleReceipt />;
}

/**
 * Everything around a receipt: share (system share sheet with the PDF), a preview you can tap to see the
 * receipt with Download and Print, and the usual Print button. The receipt itself is passed in as `article`.
 */
function ReceiptShell({
  article,
  filename,
  build,
  text,
  phone,
  links,
}: {
  article: ReactNode;
  filename: string;
  build: () => Promise<Blob>;
  text: string;
  phone?: string;
  links: ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<'share' | 'pdf' | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const cache = useRef<Blob | null>(null);
  const nativeShare = canShareFiles();

  const blob = async (): Promise<Blob> => {
    cache.current ??= await build();
    return cache.current;
  };

  const run = async (kind: 'share' | 'pdf', fn: () => Promise<void>) => {
    setBusy(kind);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ tone: 'bad', text: (e as Error).message || tr('Imeshindikana. Jaribu tena.') });
    } finally {
      setBusy(null);
    }
  };

  const share = () =>
    run('share', async () => {
      const res = await shareFile(await blob(), filename, { title: filename, text: tr('Risiti kutoka Thebest') });
      if (res === 'unsupported') {
        setNote({ tone: 'bad', text: tr('Kivinjari hiki hakiwezi kushiriki faili moja kwa moja. Tumia "Pakua PDF" au WhatsApp.') });
      }
    });
  const download = () =>
    run('pdf', async () => {
      downloadBlob(await blob(), filename);
      setNote({ tone: 'ok', text: tr('PDF imehifadhiwa.') });
    });
  const print = () => window.print();
  const whatsapp = () => {
    const digits = (phone ?? '').replace(/\D/g, '');
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ tone: 'ok', text: tr('Risiti imenakiliwa.') });
    } catch {
      setNote({ tone: 'bad', text: tr('Imeshindikana kunakili.') });
    }
  };

  return (
    <div className="min-h-screen bg-app py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[360px] flex-wrap gap-2 px-4 print:hidden">
        <Button onClick={() => setSheet(true)} className="min-w-[120px] flex-1 gap-2">
          <ShareIcon width={18} height={18} /> {tr('Shiriki')}
        </Button>
        <Button variant="outline" onClick={print} className="min-w-[120px] flex-1 gap-2">
          <PrinterIcon width={18} height={18} /> {tr('Chapisha')}
        </Button>
        {links}
      </div>

      {article}

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center print:hidden" onClick={() => setSheet(false)}>
          <div
            role="dialog"
            aria-label={tr('Shiriki risiti')}
            className="w-full max-w-[420px] rounded-t-[20px] bg-white p-4 shadow-xl sm:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-ink">{tr('Shiriki risiti')}</h2>
              <button type="button" aria-label={tr('Funga')} onClick={() => setSheet(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-app">
                <CloseIcon width={18} height={18} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setPreview(true)}
              className="flex w-full items-center gap-3 rounded-[14px] border border-line bg-app/60 p-3 text-left transition hover:bg-app"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-primary-tint text-primary">
                <FileIcon width={22} height={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">{filename}</span>
                <span className="block text-[12px] text-muted">PDF · {tr('Gusa kuona risiti, kupakua au kuchapisha')}</span>
              </span>
              <ChevronRight width={18} height={18} className="text-muted" />
            </button>

            <div className="mt-3 grid gap-2">
              <Button onClick={() => void share()} loading={busy === 'share'} disabled={busy !== null} className="gap-2">
                <ShareIcon width={18} height={18} /> {tr('Shiriki kwa…')}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => void download()} loading={busy === 'pdf'} disabled={busy !== null} className="gap-2">
                  <DownloadIcon width={18} height={18} /> {tr('Pakua PDF')}
                </Button>
                <Button variant="outline" onClick={print} className="gap-2">
                  <PrinterIcon width={18} height={18} /> {tr('Chapisha')}
                </Button>
                <Button variant="outline" onClick={whatsapp}>{tr('WhatsApp (maandishi)')}</Button>
                <Button variant="outline" onClick={() => void copy()}>{tr('Nakili maandishi')}</Button>
              </div>
            </div>

            {!nativeShare && (
              <p className="mt-2 text-[12px] text-muted">{tr('Kifaa hiki hakina menyu ya kushiriki faili; tumia Pakua PDF au WhatsApp.')}</p>
            )}
            {note && (
              <p role="status" className={cx('mt-2 rounded-field px-3 py-2 text-[13px] font-medium', note.tone === 'ok' ? 'bg-ok-bg text-ok-fg' : 'bg-bad-bg text-bad-fg')}>
                {note.text}
              </p>
            )}
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-0 sm:p-4 print:hidden" onClick={() => setPreview(false)}>
          <div
            role="dialog"
            aria-label={tr('Hakiki ya risiti')}
            className="flex h-[100dvh] w-full max-w-[460px] flex-col overflow-hidden bg-white shadow-xl sm:h-[90dvh] sm:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <h2 className="truncate text-[15px] font-bold text-ink">{filename}</h2>
              <button type="button" aria-label={tr('Funga')} onClick={() => setPreview(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-app">
                <CloseIcon width={18} height={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-app p-3">
              <div className="pointer-events-none mx-auto w-fit select-none max-[400px]:[zoom:0.9] [&_article]:shadow-md">{article}</div>
            </div>
            <footer className="grid shrink-0 grid-cols-3 gap-2 border-t border-line p-3">
              <Button variant="outline" onClick={() => void download()} loading={busy === 'pdf'} disabled={busy !== null} className="gap-1.5 px-2 text-[13px]">
                <DownloadIcon width={17} height={17} /> {tr('Pakua')}
              </Button>
              <Button variant="outline" onClick={print} className="gap-1.5 px-2 text-[13px]">
                <PrinterIcon width={17} height={17} /> {tr('Chapisha')}
              </Button>
              <Button onClick={() => void share()} loading={busy === 'share'} disabled={busy !== null} className="gap-1.5 px-2 text-[13px]">
                <ShareIcon width={17} height={17} /> {tr('Shiriki')}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

const linkClass =
  'inline-flex min-h-touch min-w-[120px] flex-1 items-center justify-center rounded-field border border-line bg-white text-[14px] font-semibold text-primary-link';

function PaymentReceipt() {
  const { saleId } = useParams();
  const [params] = useSearchParams();
  const paymentId = Number(params.get('payment'));
  const { data: r, isLoading } = useQuery({
    queryKey: ['payment-receipt', saleId, paymentId],
    queryFn: () => getPaymentReceipt(Number(saleId), paymentId),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  useAutoPrint(!!r && !!settings);

  if (isLoading || !settings) return <Spinner />;
  if (!r) return <p className="p-8 text-center text-muted">{tr('Risiti haikupatikana.')}</p>;

  return (
    <ReceiptShell
      article={<PaymentArticle r={r} settings={settings} />}
      filename={receiptFileName(r.paymentNo)}
      build={() => buildPaymentReceiptPdf(r, settings)}
      text={paymentReceiptText(r, settings)}
      phone={r.customer?.phone}
      links={
        <Link to="/debts" className={linkClass}>
          {tr('Rudi kwenye Madeni')}
        </Link>
      }
    />
  );
}

function SaleReceipt() {
  const { saleId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const showSuccess = useSuccess();
  const { data: r, isLoading } = useQuery({ queryKey: ['receipt', saleId], queryFn: () => getReceipt(Number(saleId)) });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  useAutoPrint(!!r && !!settings);

  // Right after checkout (?done=1) show the confirmation once; dropping the flag keeps a reload from showing it again.
  const announced = useRef(false);
  useEffect(() => {
    if (!r || params.get('done') !== '1' || announced.current) return;
    announced.current = true;
    const debt = r.balance > 0;
    showSuccess({
      title: debt ? tr('Mauzo yamehifadhiwa') : tr('Mauzo yamekamilika!'),
      tone: debt ? 'debt' : 'ok',
      badge: debt ? tr('Kuna deni') : undefined,
      message: `${tr('Risiti')} ${r.receiptNo}`,
      rows: [
        ...(r.customer ? [{ label: tr('Mteja'), value: r.customer.name }] : []),
        { label: tr('Jumla'), value: formatTZS(r.total) },
        ...(debt
          ? [
              { label: tr('Amelipa'), value: formatTZS(r.paid) },
              { label: tr('Deni linabaki'), value: formatTZS(r.balance), highlight: true },
              ...(r.dueDate ? [{ label: tr('Lipa kabla ya'), value: formatDate(new Date(r.dueDate)) }] : []),
            ]
          : []),
      ],
      primary: { label: tr('Chapisha risiti'), onClick: () => window.print() },
      secondary: { label: tr('Uza tena'), onClick: () => navigate('/pos') },
    });
    setParams(
      (p) => {
        p.delete('done');
        return p;
      },
      { replace: true },
    );
  }, [r, params, setParams, showSuccess, navigate]);

  if (isLoading || !settings) return <Spinner />;
  if (!r) return <p className="p-8 text-center text-muted">{tr('Risiti haikupatikana.')}</p>;

  return (
    <ReceiptShell
      article={<SaleArticle r={r} settings={settings} />}
      filename={receiptFileName(r.receiptNo)}
      build={() => buildSaleReceiptPdf(r, settings)}
      text={saleReceiptText(r, settings)}
      phone={r.customer?.phone}
      links={
        <>
          <Link to="/pos" className={linkClass}>
            {tr('Mauzo mapya')}
          </Link>
          <Link to={`/sales/${saleId}`} className={linkClass}>
            Maelezo
          </Link>
        </>
      }
    />
  );
}

const paperWidth = (s: Settings) => (s.printerWidth === '58' ? '58mm' : '80mm');

function SaleArticle({ r, settings }: { r: ReceiptView; settings: Settings }) {
  const width = paperWidth(settings);
  const d = new Date(r.createdAt);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <style>{`@page { size: ${width} auto; margin: 0 }`}</style>
      <article
        aria-label="Risiti"
        className="mx-auto bg-white p-4 font-mono text-[12px] leading-snug text-black shadow-sm print:shadow-none"
        style={{ width }}
      >
        <header className="text-center">
          <h1 className="text-[16px] font-bold">{settings.shopName}</h1>
          {settings.shopAddress && <p>{settings.shopAddress}</p>}
          {settings.shopPhone && <p>Simu: {settings.shopPhone}</p>}
        </header>
        <Rule />
        <p>Risiti: <b>{r.receiptNo}</b></p>
        <p>Tarehe: {formatDate(d)} {time}</p>
        <p>Muuzaji: {r.userName}</p>
        {r.customer && <p>Mteja: {r.customer.name} · {displayPhone(r.customer.phone)}</p>}
        <Rule />
        {r.lines.map((l, i) => (
          <div key={i} className="mb-1.5">
            <p className="font-bold">{l.name}</p>
            {l.imei && <p>IMEI: {l.imei}</p>}
            <p className="flex justify-between">
              <span>{l.qty} x {formatNumber(l.unitPrice)}</span>
              <span>{formatNumber(l.qty * l.unitPrice)}</span>
            </p>
          </div>
        ))}
        <Rule />
        <Line label="Jumla ndogo" value={formatNumber(r.subtotal)} />
        {r.discount > 0 && <Line label="Punguzo" value={`-${formatNumber(r.discount)}`} />}
        <Line label="JUMLA" value={formatTZS(r.total)} bold />
        <Rule />
        {r.payments.map((p, i) => (
          <Line key={i} label={PAYMENT_LABEL[p.method]} value={formatNumber(p.amount)} />
        ))}
        <Line label="Amelipa" value={formatNumber(r.paid)} />
        {r.balance > 0 && (
          <>
            <Line label="DENI LINABAKI" value={formatTZS(r.balance)} bold />
            {r.dueDate && <p>Kulipa kabla ya: {formatDate(new Date(`${r.dueDate}T00:00:00`))}</p>}
          </>
        )}
        <Rule />
        <footer className="text-center">{settings.receiptFooter}</footer>
      </article>
    </>
  );
}

function PaymentArticle({ r, settings }: { r: PaymentReceiptView; settings: Settings }) {
  const width = paperWidth(settings);
  const d = new Date(r.paidAt);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <style>{`@page { size: ${width} auto; margin: 0 }`}</style>
      <article
        aria-label="Risiti ya malipo ya deni"
        className="mx-auto bg-white p-4 font-mono text-[12px] leading-snug text-black shadow-sm print:shadow-none"
        style={{ width }}
      >
        <header className="text-center">
          <h1 className="text-[16px] font-bold">{settings.shopName}</h1>
          <p className="font-bold">RISITI YA MALIPO YA DENI</p>
        </header>
        <Rule />
        <p>Risiti: <b>{r.paymentNo}</b></p>
        <p>Mauzo asilia: {r.receiptNo}</p>
        <p>Tarehe: {formatDate(d)} {time}</p>
        <p>Imepokelewa na: {r.userName}</p>
        {r.customer && <p>Mteja: {r.customer.name} · {displayPhone(r.customer.phone)}</p>}
        <Rule />
        <Line label="Jumla ya mauzo" value={formatNumber(r.saleTotal)} />
        <Line label={`Malipo (${PAYMENT_LABEL[r.method]})`} value={formatNumber(r.amount)} bold />
        <Line label="Jumla imelipwa" value={formatNumber(r.paidToDate)} />
        <Line label={r.balance > 0 ? 'DENI LINABAKI' : 'DENI'} value={r.balance > 0 ? formatTZS(r.balance) : 'LIMEKWISHA'} bold />
        {r.dueDate && <p>Kulipa kabla ya: {formatDate(new Date(`${r.dueDate}T00:00:00`))}</p>}
        <Rule />
        <footer className="text-center">{settings.receiptFooter}</footer>
      </article>
    </>
  );
}

const Rule = () => <hr className="my-2 border-t border-dashed border-black" />;

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <p className={`flex justify-between ${bold ? 'text-[14px] font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
