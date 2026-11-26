import { describe, expect, it } from 'vitest';
import { BarcodeFormat, BinaryBitmap, Code128Reader, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';
import { imeisInCode } from './CameraScanner';

/** Draws a 15-digit IMEI as Code 128 (Set C for 14 digits, Set B for the last), like a phone box label. */
function code128Imei(imei: string, moduleWidth = 3, height = 70): { pixels: Int32Array; w: number; h: number } {
  const patterns = (Code128Reader as unknown as { CODE_PATTERNS: Int32Array[] }).CODE_PATTERNS;
  const codes = [105]; // Start C
  for (let i = 0; i < 14; i += 2) codes.push(Number(imei.slice(i, i + 2)));
  codes.push(100, imei.charCodeAt(14) - 32); // Code B, last digit
  const check = codes.reduce((sum, c, i) => sum + (i === 0 ? c : c * i), 0) % 103;
  codes.push(check, 106); // checksum, Stop
  const modules: boolean[] = Array(12).fill(false); // quiet zone
  for (const c of codes) Array.from(patterns[c]).forEach((width, i) => modules.push(...Array(width).fill(i % 2 === 0)));
  modules.push(...Array(12).fill(false));
  const w = modules.length * moduleWidth;
  const pixels = new Int32Array(w * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = modules[Math.floor(x / moduleWidth)] ? 0xff000000 : 0xffffffff;
  return { pixels, w, h: height };
}

describe('reading IMEIs from a scanned code', () => {
  it('takes exactly-15-digit numbers, with or without a label', () => {
    expect(imeisInCode('356938035643809')).toEqual(['356938035643809']);
    expect(imeisInCode('IMEI1: 356938035643809 / IMEI2: 490154203237518')).toEqual(['356938035643809', '490154203237518']);
  });

  it('ignores longer or shorter numbers (serials, box codes)', () => {
    expect(imeisInCode('3569380356438091')).toEqual([]);
    expect(imeisInCode('S/N R58N12345678')).toEqual([]);
    expect(imeisInCode('6971234567890')).toEqual([]); // EAN-13 product barcode
  });
});

describe('ZXing (the reader used on iPhone, Windows and Firefox)', () => {
  it('decodes a Code 128 IMEI barcode like the one on a phone box', () => {
    const imei = '356938035643809';
    const { pixels, w, h } = code128Imei(imei);
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, w, h)));
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.ITF]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const result = new MultiFormatReader().decode(bitmap, hints);
    expect(imeisInCode(result.getText())).toEqual([imei]);
  });
});
