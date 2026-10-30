import type { CustomerStatus } from '@shared/customers';
import type { DebtStatus } from '@shared/debts';
import { formatTZS } from '@/lib/format';
import { Badge } from '@/components/ui';
import { tr } from '@/i18n';

/** Debt (with the amount next to it) / Paid / No purchases. */
export function CustomerStatusBadge({ status, debt, showAmount }: { status: CustomerStatus; debt?: number; showAmount?: boolean }) {
  if (status === 'DEBT') return <Badge tone="warn" className="whitespace-nowrap">{tr('Deni')}{showAmount && debt != null ? `: ${formatTZS(debt)}` : ''}</Badge>;
  if (status === 'PAID') return <Badge tone="ok" className="whitespace-nowrap">{tr('Amelipa')}</Badge>;
  return <Badge tone="navy" className="whitespace-nowrap bg-slate-100 text-slate-600">{tr('Hajanunua')}</Badge>;
}

const DEBT_TONE: Record<DebtStatus, 'ok' | 'warn' | 'bad' | 'blue'> = { OUTSTANDING: 'blue', PARTIAL: 'warn', OVERDUE: 'bad', PAID: 'ok' };
export const DEBT_LABEL: Record<DebtStatus, string> = { OUTSTANDING: 'Anadaiwa', PARTIAL: 'Amelipa sehemu', OVERDUE: 'Amechelewa', PAID: 'Imelipwa' };

export function DebtStatusBadge({ status }: { status: DebtStatus }) {
  return <Badge tone={DEBT_TONE[status]} className="whitespace-nowrap">{tr(DEBT_LABEL[status])}</Badge>;
}
