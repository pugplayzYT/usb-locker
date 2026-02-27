import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  saveKeyToUSB,
  readKeyFromUSB,
  hasKeyFile,
  listUSBDrives,
} from '../src/lib/usb';
import { generateKeyFile, KEY_FILE_NAME } from '../src/lib/crypto';

// ── saveKeyToUSB + readKeyFromUSB ──────────────────────────────────────────────
describe('saveKeyToUSB + readKeyFromUSB', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-usb-'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('writes usblocker.key to the drive path', () => {
    saveKeyToUSB({ path: tmp, label: 'TestUSB' }, generateKeyFile());
    expect(fs.existsSync(path.join(tmp, KEY_FILE_NAME))).toBe(true);
  });

  it('writes valid JSON', () => {
    saveKeyToUSB({ path: tmp, label: 'TestUSB' }, generateKeyFile());
    const raw = fs.readFileSync(path.join(tmp, KEY_FILE_NAME), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('round-trips keyId and key correctly', () => {
    const drive = { path: tmp, label: 'TestUSB' };
    const kf = generateKeyFile();
    saveKeyToUSB(drive, kf);
    const back = readKeyFromUSB(drive);
    expect(back?.keyId).toBe(kf.keyId);
    expect(back?.key).toBe(kf.key);
    expect(back?.version).toBe(kf.version);
  });

  it('returns null when no key file exists', () => {
    expect(readKeyFromUSB({ path: tmp, label: 'Empty' })).toBeNull();
  });

  it('returns null when key file contains invalid JSON', () => {
    fs.writeFileSync(path.join(tmp, KEY_FILE_NAME), '{ broken json }}');
    expect(readKeyFromUSB({ path: tmp, label: 'Corrupt' })).toBeNull();
  });

  it('overwrites an existing key when save is called again', () => {
    const drive = { path: tmp, label: 'TestUSB' };
    const kf1 = generateKeyFile();
    const kf2 = generateKeyFile();
    saveKeyToUSB(drive, kf1);
    saveKeyToUSB(drive, kf2);
    const back = readKeyFromUSB(drive);
    expect(back?.keyId).toBe(kf2.keyId);
  });
});

// ── hasKeyFile ─────────────────────────────────────────────────────────────────
describe('hasKeyFile', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usblocker-usb-'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('returns false when no key file is present', () => {
    expect(hasKeyFile({ path: tmp, label: 'X' })).toBe(false);
  });

  it('returns true after saveKeyToUSB writes the file', () => {
    const drive = { path: tmp, label: 'X' };
    saveKeyToUSB(drive, generateKeyFile());
    expect(hasKeyFile(drive)).toBe(true);
  });

  it('returns false after key file is manually removed', () => {
    const drive = { path: tmp, label: 'X' };
    saveKeyToUSB(drive, generateKeyFile());
    fs.unlinkSync(path.join(tmp, KEY_FILE_NAME));
    expect(hasKeyFile(drive)).toBe(false);
  });
});

// ── listUSBDrives ──────────────────────────────────────────────────────────────
describe('listUSBDrives', () => {
  it('always returns an array and never throws', () => {
    // No mocking needed — the function catches all exec errors internally.
    // On CI (no USB drives) this returns []. On a developer machine it may
    // return actual removable drives. Either way: must be an array.
    expect(() => {
      const result = listUSBDrives();
      expect(Array.isArray(result)).toBe(true);
    }).not.toThrow();
  });

  it('each drive entry has path and label strings', () => {
    const drives = listUSBDrives();
    for (const d of drives) {
      expect(typeof d.path).toBe('string');
      expect(d.path.length).toBeGreaterThan(0);
      expect(typeof d.label).toBe('string');
    }
  });

  it('throws only for genuinely unsupported platforms', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'freebsd',
      configurable: true,
    });
    expect(() => listUSBDrives()).toThrow(/Unsupported platform/);
    Object.defineProperty(process, 'platform', {
      value: orig,
      configurable: true,
    });
  });
});
