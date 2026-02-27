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
  VERSION,
} from '../src/lib/crypto';
import { saveKeyToUSB, readKeyFromUSB } from '../src/lib/usb';

describe('Integration — full lock/unlock workflow', () => {
  let workDir: string;
  let usbDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-int-work-'));
    usbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-int-usb-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(usbDir, { recursive: true, force: true });
  });

  it('lock → remove original → unlock restores exact content', () => {
    const secret = 'Top-secret document 🔐\nLine two.\n';
    const orig = path.join(workDir, 'secret.txt');
    const locked = orig + LOCKED_EXTENSION;
    const recovered = path.join(workDir, 'secret-recovered.txt');

    fs.writeFileSync(orig, secret, 'utf8');

    // --- Lock ---
    const kf = generateKeyFile();
    const usb = { path: usbDir, label: 'MyUSB' };
    saveKeyToUSB(usb, kf);
    encryptFile(orig, locked, kf);
    expect(fs.existsSync(locked)).toBe(true);
    expect(fs.readFileSync(locked).toString('utf8')).not.toBe(secret);

    // Simulate user deleting original
    fs.unlinkSync(orig);
    expect(fs.existsSync(orig)).toBe(false);

    // --- Unlock ---
    const keyBack = readKeyFromUSB(usb);
    expect(keyBack).not.toBeNull();
    decryptFile(locked, recovered, keyBack!);

    expect(fs.readFileSync(recovered, 'utf8')).toBe(secret);
  });

  it('rejects decryption with a different USB key', () => {
    const src = path.join(workDir, 'data.txt');
    const locked = src + LOCKED_EXTENSION;
    const out = path.join(workDir, 'out.txt');

    fs.writeFileSync(src, 'classified payload');

    const rightKey = generateKeyFile();
    const wrongKey = generateKeyFile();

    encryptFile(src, locked, rightKey);

    expect(() => decryptFile(locked, out, wrongKey)).toThrow(/Key mismatch/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('multiple files can share the same USB key', () => {
    const kf = generateKeyFile();
    const usb = { path: usbDir, label: 'SharedUSB' };
    saveKeyToUSB(usb, kf);

    const files = ['alpha.txt', 'beta.pdf', 'gamma.jpg'];

    for (const name of files) {
      const src = path.join(workDir, name);
      fs.writeFileSync(src, `Content of ${name}`);
      encryptFile(src, src + LOCKED_EXTENSION, kf);
    }

    const keyBack = readKeyFromUSB(usb)!;

    for (const name of files) {
      const locked = path.join(workDir, name + LOCKED_EXTENSION);
      const recovered = path.join(workDir, 'rec-' + name);
      decryptFile(locked, recovered, keyBack);
      expect(fs.readFileSync(recovered, 'utf8')).toBe(`Content of ${name}`);
    }
  });

  it('preserves binary integrity (all-byte-values round-trip)', () => {
    const bin = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) bin[i] = i;

    const src = path.join(workDir, 'allbytes.bin');
    const locked = src + LOCKED_EXTENSION;
    const recovered = path.join(workDir, 'allbytes-out.bin');

    fs.writeFileSync(src, bin);
    const kf = generateKeyFile();
    encryptFile(src, locked, kf);
    decryptFile(locked, recovered, kf);

    expect(fs.readFileSync(recovered).equals(bin)).toBe(true);
  });

  it('metadata embedded in the locked file is accurate', () => {
    const content = 'check metadata';
    const src = path.join(workDir, 'meta-test.txt');
    const locked = src + LOCKED_EXTENSION;

    fs.writeFileSync(src, content, 'utf8');
    const kf = generateKeyFile();
    const written = encryptFile(src, locked, kf);
    const read = readEncryptedFileMetadata(locked);

    expect(read.originalFilename).toBe('meta-test.txt');
    expect(read.originalSize).toBe(Buffer.from(content).length);
    expect(read.keyId).toBe(kf.keyId);
    expect(read.version).toBe(VERSION);
    expect(read.iv).toBe(written.iv);
    expect(read.authTag).toBe(written.authTag);
  });

  it('locked file is strictly larger than the original', () => {
    const src = path.join(workDir, 'small.txt');
    const locked = src + LOCKED_EXTENSION;
    fs.writeFileSync(src, 'hi');
    encryptFile(src, locked, generateKeyFile());
    expect(fs.statSync(locked).size).toBeGreaterThan(fs.statSync(src).size);
  });
});
