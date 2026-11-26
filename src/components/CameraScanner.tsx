import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { tr } from '@/i18n';

/**
 * Camera barcode scanner that works on every phone and computer.
 *
 * Uses the browser's built-in BarcodeDetector where it exists (Chrome on Android, macOS); everywhere else
 * (iPhone/iPad Safari, Chrome on Windows, Firefox) it falls back to ZXing, loaded only when the camera opens.
 * Phone boxes carry the IMEI as a Code 128 barcode; every 15-digit number found in a code is handed to `onImei`.
 */

export interface ScanFeedback {
  ok: boolean;
  message: string;
}

const NATIVE_FORMATS = ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix'];
const REPEAT_MS = 2500;

type NativeDetector = { detect: (el: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeCtor = (new (opts?: { formats: string[] }) => NativeDetector) & { getSupportedFormats?: () => Promise<string[]> };

/** Every IMEI-shaped number (15 digits) in a scanned code, e.g. "IMEI1: 356938035643809". */
export function imeisInCode(text: string): string[] {
  // Exactly 15 digits: a longer number (a serial, a box code) is not an IMEI.
  return [...new Set(text.match(/(?<!\d)\d{15}(?!\d)/g) ?? [])];
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (!window.isSecureContext) return 'Kamera inahitaji anwani salama (https). Fungua app kupitia link yake rasmi.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Ruhusa ya kamera imekataliwa. Iruhusu kwenye mipangilio ya browser, kisha jaribu tena.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera haipatikani kwenye kifaa hiki';
  if (name === 'NotReadableError') return 'Kamera inatumiwa na programu nyingine. Ifunge, kisha jaribu tena.';
  return 'Imeshindikana kufungua kamera. Jaribu tena.';
}

export function CameraScanner({
  onImei,
  className,
  height = 200,
}: {
  /** Called for each new IMEI read; return feedback to show under the picture. */
  onImei: (imei: string) => ScanFeedback | void;
  className?: string;
  height?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onImeiRef = useRef(onImei);
  onImeiRef.current = onImei;
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopZxing: (() => void) | undefined;
    const lastSeen = new Map<string, number>();

    const handleText = (text: string) => {
      const imeis = imeisInCode(text);
      if (!imeis.length) {
        setFeedback({ ok: false, message: tr('Barcode hii si IMEI. Elekeza kamera kwenye barcode ya IMEI.') });
        return;
      }
      const now = Date.now();
      for (const imei of imeis) {
        if (now - (lastSeen.get(imei) ?? 0) < REPEAT_MS) continue; // the same box held in front of the camera
        lastSeen.set(imei, now);
        const result = onImeiRef.current(imei);
        if (result) setFeedback(result);
        if (result?.ok !== false) navigator.vibrate?.(60);
      }
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus('scanning');

        // 1) The browser's own detector, when it has one that reads Code 128.
        const Native = (window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
        const supported = Native ? await Native.getSupportedFormats?.().catch(() => [] as string[]) : [];
        if (Native && supported?.includes('code_128')) {
          const detector = new Native({ formats: NATIVE_FORMATS.filter((f) => supported.includes(f)) });
          const tick = async () => {
            if (cancelled) return;
            try {
              for (const c of await detector.detect(video)) handleText(c.rawValue);
            } catch {
              /* a frame that could not be read */
            }
            timer = window.setTimeout(tick, 200);
          };
          void tick();
          return;
        }

        // 2) Everywhere else (iPhone, Windows, Firefox): ZXing, loaded on demand.
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.ITF, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 600 });
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) handleText(result.getText());
        });
        stopZxing = () => controls.stop();
        if (cancelled) stopZxing();
      } catch (e) {
        if (cancelled) return;
        setError(cameraError(e));
        setStatus('error');
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={cx('overflow-hidden rounded-[14px] bg-ink', className)}>
      <div className="relative" style={{ height }}>
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
        {status === 'scanning' && (
          // Aim box: a barcode is long and thin.
          <div aria-hidden className="pointer-events-none absolute inset-x-[8%] top-1/2 h-[38%] -translate-y-1/2 rounded-[12px] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
            <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500/90" />
          </div>
        )}
        {status !== 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] font-medium text-white">
            {status === 'starting' ? tr('Inafungua kamera…') : tr(error)}
          </div>
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cx(
          'min-h-[40px] px-3.5 py-2.5 text-[12.5px] font-medium',
          !feedback ? 'text-white/80' : feedback.ok ? 'bg-ok-bg text-ok-fg' : 'bg-bad-bg text-bad-fg',
        )}
      >
        {feedback ? feedback.message : tr('Elekeza kamera kwenye barcode ya IMEI kwenye boksi au chini ya betri.')}
      </p>
    </div>
  );
}
