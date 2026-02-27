import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  generateKeyFile,
  encryptFile,
  decryptFile,
  readEncryptedFileMetadata,
  LOCKED_EXTENSION,
  MAGIC,
  VERSION,
} from '../src/lib/crypto';

// ── generateKeyFile ────────────────────────────────────────────────────────────
describe('generateKeyFile', () => {
  it('produces all required fields', () => {
    const kf = generateKeyFile();
    expect(kf.version).toBe('1.0.0');
    expect(kf.keyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(kf.key).toMatch(/^[0-9a-f]{64}$/); // 32 bytes → 64 hex chars
    expect(typeof kf.createdAt).toBe('string');
  });

  it('generates a unique key every call', () => {
    const a = generateKeyFile();
    const b = generateKeyFile();
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.key).not.toBe(b.key);
  });

  it('key is exactly 32 bytes (256-bit)', () => {
    const kf = generateKeyFile();
    expect(Buffer.from(kf.key, 'hex').length).toBe(32);
  });
});

// ── encryptFile ────────────────────────────────────────────────────────────────
describe('encryptFile', () => {
  let tmp: string;
  let srcFile: string;
  let encFile: string;
  const CONTENT = 'Top-secret payload 🔐';

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-crypto-'));
    srcFile = path.join(tmp, 'plain.txt');
    encFile = path.join(tmp, 'plain.txt' + LOCKED_EXTENSION);
    fs.writeFileSync(srcFile, CONTENT, 'utf8');
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('creates the output file', () => {
    encryptFile(srcFile, encFile, generateKeyFile());
    expect(fs.existsSync(encFile)).toBe(true);
  });

  it('output starts with USLK magic', () => {
    encryptFile(srcFile, encFile, generateKeyFile());
    const data = fs.readFileSync(encFile);
    expect(data.subarray(0, 4).equals(MAGIC)).toBe(true);
  });

  it('output contains the correct version byte', () => {
    encryptFile(srcFile, encFile, generateKeyFile());
    const data = fs.readFileSync(encFile);
    expect(data[4]).toBe(VERSION);
  });

  it('ciphertext differs from plaintext', () => {
    encryptFile(srcFile, encFile, generateKeyFile());
    const plain = fs.readFileSync(srcFile);
    const cipher = fs.readFileSync(encFile);
    expect(plain.equals(cipher)).toBe(false);
  });

  it('returns metadata with matching keyId and originalFilename', () => {
    const kf = generateKeyFile();
    const meta = encryptFile(srcFile, encFile, kf);
    expect(meta.keyId).toBe(kf.keyId);
    expect(meta.originalFilename).toBe('plain.txt');
    expect(meta.originalSize).toBe(Buffer.from(CONTENT).length);
    expect(meta.version).toBe(VERSION);
  });

  it('each encryption uses a fresh IV (different ciphertexts)', () => {
    const kf = generateKeyFile();
    const enc1 = path.join(tmp, 'a.locked');
    const enc2 = path.join(tmp, 'b.locked');
    encryptFile(srcFile, enc1, kf);
    encryptFile(srcFile, enc2, kf);
    expect(fs.readFileSync(enc1).equals(fs.readFileSync(enc2))).toBe(false);
  });
});

// ── decryptFile ────────────────────────────────────────────────────────────────
describe('decryptFile', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-crypto-'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function roundTrip(content: Buffer | string, filename = 'file.bin') {
    const src = path.join(tmp, filename);
    const enc = src + LOCKED_EXTENSION;
    const dec = path.join(tmp, 'out-' + filename);
    fs.writeFileSync(src, content);
    const kf = generateKeyFile();
    encryptFile(src, enc, kf);
    decryptFile(enc, dec, kf);
    return { dec, kf, enc };
  }

  it('restores UTF-8 text content', () => {
    const { dec } = roundTrip('Hello, USB Locker! 🔑', 'text.txt');
    expect(fs.readFileSync(dec, 'utf8')).toBe('Hello, USB Locker! 🔑');
  });

  it('restores binary content byte-for-byte', () => {
    const bin = Buffer.from([0x00, 0xff, 0x42, 0x13, 0x37, 0xde, 0xad, 0xbe]);
    const { dec } = roundTrip(bin);
    expect(fs.readFileSync(dec).equals(bin)).toBe(true);
  });

  it('handles a 1 MB file', () => {
    const big = Buffer.alloc(1024 * 1024, 0xab);
    const { dec } = roundTrip(big, 'big.bin');
    expect(fs.readFileSync(dec).equals(big)).toBe(true);
  });

  it('throws on wrong key (key mismatch)', () => {
    const src = path.join(tmp, 'secret.txt');
    const enc = src + LOCKED_EXTENSION;
    const dec = path.join(tmp, 'out.txt');
    fs.writeFileSync(src, 'data');
    encryptFile(src, enc, generateKeyFile());
    expect(() => decryptFile(enc, dec, generateKeyFile())).toThrow(/Key mismatch/);
  });

  it('throws on invalid magic bytes', () => {
    const bad = path.join(tmp, 'bad.locked');
    fs.writeFileSync(bad, Buffer.from('XXXX bad data here'));
    expect(() => decryptFile(bad, path.join(tmp, 'out'), generateKeyFile())).toThrow(
      /Invalid file format/,
    );
  });

  it('throws when file is too small', () => {
    const tiny = path.join(tmp, 'tiny.locked');
    fs.writeFileSync(tiny, Buffer.from([0x01, 0x02]));
    expect(() => decryptFile(tiny, path.join(tmp, 'out'), generateKeyFile())).toThrow(
      /Invalid file format/,
    );
  });

  it('returns the output path', () => {
    const src = path.join(tmp, 'f.txt');
    const enc = src + LOCKED_EXTENSION;
    const dec = path.join(tmp, 'out.txt');
    fs.writeFileSync(src, 'abc');
    const kf = generateKeyFile();
    encryptFile(src, enc, kf);
    const result = decryptFile(enc, dec, kf);
    expect(result).toBe(dec);
  });
});

// ── readEncryptedFileMetadata ──────────────────────────────────────────────────
describe('readEncryptedFileMetadata', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-meta-'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads back metadata written by encryptFile', () => {
    const src = path.join(tmp, 'doc.txt');
    const enc = src + LOCKED_EXTENSION;
    fs.writeFileSync(src, 'some content');
    const kf = generateKeyFile();
    encryptFile(src, enc, kf);

    const meta = readEncryptedFileMetadata(enc);
    expect(meta.keyId).toBe(kf.keyId);
    expect(meta.originalFilename).toBe('doc.txt');
    expect(meta.version).toBe(VERSION);
    expect(meta.iv).toHaveLength(24);    // 12 bytes → 24 hex
    expect(meta.authTag).toHaveLength(32); // 16 bytes → 32 hex
  });

  it('throws on non-USLK file', () => {
    const bad = path.join(tmp, 'bad.locked');
    fs.writeFileSync(bad, 'not encrypted');
    expect(() => readEncryptedFileMetadata(bad)).toThrow(/Invalid file format/);
  });

  it('throws on file smaller than header', () => {
    const tiny = path.join(tmp, 'tiny.locked');
    fs.writeFileSync(tiny, Buffer.alloc(3));
    expect(() => readEncryptedFileMetadata(tiny)).toThrow(/Invalid file format/);
  });
});
