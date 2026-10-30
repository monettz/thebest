import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@shared/schemas';
import { useAuth } from '@/lib/auth';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button, Field } from '@/components/ui';
import { BackspaceIcon } from '@/components/ui/icons';
import { BrandMark } from '@/components/BrandMark';
import { tr } from '@/i18n';

const CHIPS = ['Store', 'Duka (POS)', 'Madeni', 'SMS'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: '', pin: '', remember: true },
  });
  const pin = watch('pin');

  if (user) return <Navigate to="/" replace />;

  const submit = handleSubmit(async (v) => {
    const res = await login(v.phone, v.pin, v.remember ?? false);
    if (res.ok) navigate('/', { replace: true });
    else {
      setServerError(res.message);
      setValue('pin', '');
    }
  });

  const press = (k: (typeof KEYS)[number]) => {
    if (!k) return;
    setServerError('');
    setValue('pin', k === 'del' ? pin.slice(0, -1) : (pin + k).slice(0, 4), { shouldValidate: false });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app md:p-8">
      <div className="grid w-full max-w-[1100px] overflow-hidden bg-white md:min-h-[560px] md:grid-cols-2 md:rounded-[28px] md:border md:border-line md:shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        {/* Brand panel */}
        <div className="hidden flex-col justify-between bg-navy p-12 text-white md:flex">
          <div className="flex items-center gap-3">
            <BrandMark size={44} />
            <span className="text-[19px] font-extrabold tracking-wide">{tr('THE BEST')}</span>
          </div>
          <div>
            <h2 className="text-[34px] font-extrabold leading-[1.15] tracking-tight">
              {tr('Store, duka na madeni')}
              <br />
              {tr('mahali pamoja.')}
            </h2>
            <p className="mt-4 text-[15px] text-slate-300">{tr('Mfumo wa mauzo kwa simu na accessories.')}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <span key={c} className="rounded-full border border-white/20 px-3.5 py-1.5 text-[13px] text-slate-200">
                  {tr(c)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Form panel */}
        <form onSubmit={submit} className="relative flex flex-col justify-center px-6 py-10 md:px-12" noValidate>
          <div className="absolute right-4 top-4 md:right-6 md:top-5">
            <LanguageSwitch compact />
          </div>
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <BrandMark size={44} />
            <span className="text-[19px] font-extrabold tracking-wide">{tr('THE BEST')}</span>
          </div>

          <h1 className="text-[28px] font-extrabold tracking-tight">{tr('Karibu tena')}</h1>
          <p className="mb-6 mt-1 text-[14px] text-muted">{tr('Ingia ili kuendelea.')}</p>

          <Field label="Namba ya simu" error={errors.phone?.message}>
            <input
              {...register('phone')}
              className="input"
              inputMode="tel"
              autoComplete="username"
              placeholder="07XX XXX XXX"
              onChange={(e) => {
                setServerError('');
                void register('phone').onChange(e);
              }}
            />
          </Field>

          {/* Desktop PIN field */}
          <Field label="PIN" error={errors.pin?.message} className="mt-4 hidden md:block">
            <input
              {...register('pin')}
              className="input tracking-[0.4em]"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoComplete="current-password"
              placeholder="••••"
            />
          </Field>

          {/* Mobile PIN keypad */}
          <div className="mt-5 md:hidden">
            <p className="label">{tr('PIN')}</p>
            <div className="mb-4 flex justify-center gap-4" aria-live="polite">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? 'bg-primary' : 'border-2 border-bar-1'}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {KEYS.map((k, i) =>
                k ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => press(k)}
                    aria-label={k === 'del' ? tr('Futa') : k}
                    className="flex h-14 items-center justify-center rounded-2xl bg-app text-[22px] font-bold active:bg-primary-tint"
                  >
                    {k === 'del' ? <BackspaceIcon /> : k}
                  </button>
                ) : (
                  <span key={i} />
                ),
              )}
            </div>
            {errors.pin && <p className="mt-2 text-center text-[12px] font-medium text-bad-fg">{tr(errors.pin.message ?? '')}</p>}
          </div>

          <div className="mt-5 flex items-center justify-between text-[14px]">
            <label className="flex min-h-touch items-center gap-2.5">
              <input type="checkbox" {...register('remember')} className="h-4 w-4 accent-primary" />
              {tr('Nikumbuke')}
            </label>
            <a href="#" onClick={(e) => e.preventDefault()} className="font-semibold text-primary-link">
              {tr('Umesahau PIN?')}
            </a>
          </div>

          {serverError && (
            <p role="alert" className="mt-3 rounded-field bg-bad-bg px-3.5 py-2.5 text-[13px] font-medium text-bad-fg">
              {tr(serverError)}
            </p>
          )}

          <Button type="submit" block className="mt-5 min-h-[52px] text-[15px]">
            {tr('Ingia')}
          </Button>
          <p className="mt-4 text-center text-[12.5px] text-muted">{tr('Mmiliki anaweza kuongeza wauzaji kwenye Mipangilio.')}</p>
        </form>
      </div>
    </div>
  );
}
