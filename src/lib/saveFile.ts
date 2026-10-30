/**
 * One place for turning a generated file (PDF, Excel) into something the user keeps or sends.
 * Every export goes through here so downloads behave the same on desktop, Android and the installed app.
 */

/** Saves a Blob as a file. Uses a real <a download>, which works in every browser (jsPDF's save() does not on some phones). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Give the browser time to start the download before the URL is released.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 15_000);
}

export type ShareResult = 'shared' | 'cancelled' | 'unsupported';

/** True when this browser can hand a file to the system share sheet (most phones; some desktops). */
export function canShareFiles(mime = 'application/pdf'): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'test', { type: mime })] });
  } catch {
    return false;
  }
}

/** Opens the system share sheet, so the user chooses where to send the file (WhatsApp, email, Drive, ...). */
export async function shareFile(blob: Blob, filename: string, opts: { title: string; text?: string }): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], title: opts.title, text: opts.text });
    return 'shared';
  } catch (e) {
    // The user closing the share sheet is not an error.
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    throw e;
  }
}
