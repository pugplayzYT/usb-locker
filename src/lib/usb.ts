import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { USBDrive, KeyFile } from './types';
import { KEY_FILE_NAME } from './crypto';

export function listUSBDrives(): USBDrive[] {
  const platform = os.platform();

  try {
    if (platform === 'win32') return getWindowsUSBDrives();
    if (platform === 'linux') return getLinuxUSBDrives();
    if (platform === 'darwin') return getMacUSBDrives();
    throw new Error(`Unsupported platform: ${platform}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unsupported platform')) {
      throw error;
    }
    return [];
  }
}

function getWindowsUSBDrives(): USBDrive[] {
  // PowerShell-based detection (works on Windows 10 & 11 — wmic is deprecated)
  try {
    const psCmd =
      'powershell -NoProfile -NonInteractive -Command ' +
      '"Get-WmiObject Win32_LogicalDisk | ' +
      'Where-Object {$_.DriveType -eq 2} | ' +
      'Select-Object DeviceID,VolumeName | ' +
      'ConvertTo-Json -Compress"';

    const output = execSync(psCmd, { encoding: 'utf8', timeout: 8000 });
    const trimmed = output.trim();
    if (!trimmed || trimmed === 'null') return [];

    // PowerShell returns an object when there's 1 drive, array when >1
    const raw: Array<{ DeviceID: string; VolumeName: string | null }> =
      Array.isArray(JSON.parse(trimmed))
        ? JSON.parse(trimmed)
        : [JSON.parse(trimmed)];

    return raw
      .filter((d) => d.DeviceID)
      .map((d) => ({
        path: d.DeviceID + '\\',
        label: d.VolumeName?.trim() || 'USB Drive',
        device: d.DeviceID,
      }));
  } catch {
    return [];
  }
}

function getLinuxUSBDrives(): USBDrive[] {
  try {
    const output = execSync('lsblk -o NAME,MOUNTPOINT,HOTPLUG,TYPE --json', {
      encoding: 'utf8',
      timeout: 5000,
    });

    const data = JSON.parse(output) as {
      blockdevices: Array<{
        name: string;
        mountpoint: string | null;
        hotplug: string | boolean;
        type: string;
        children?: Array<{
          name: string;
          mountpoint: string | null;
          hotplug: string | boolean;
          type: string;
        }>;
      }>;
    };

    const drives: USBDrive[] = [];

    // Arrow function expression is valid inside a block (unlike declarations)
    const processDevice = (device: (typeof data.blockdevices)[0]) => {
      if (device.hotplug === '1' || device.hotplug === true) {
        if (device.mountpoint && device.type === 'part') {
          drives.push({
            path: device.mountpoint,
            label: device.name,
            device: `/dev/${device.name}`,
          });
        }
      }
      if (device.children) {
        device.children.forEach(processDevice);
      }
    };

    data.blockdevices?.forEach(processDevice);
    return drives;
  } catch {
    return [];
  }
}

function getMacUSBDrives(): USBDrive[] {
  try {
    const volumesDir = '/Volumes';
    const entries = fs.readdirSync(volumesDir, { withFileTypes: true });
    const drives: USBDrive[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'Macintosh HD') continue;

      const mountPath = path.join(volumesDir, entry.name);
      try {
        const info = execSync(`diskutil info "${mountPath}" 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 3000,
        });
        if (
          info.includes('Removable Media:           Yes') ||
          info.includes('Ejectable:                 Yes')
        ) {
          drives.push({ path: mountPath, label: entry.name });
        }
      } catch {
        // Drive info unavailable — skip
      }
    }

    return drives;
  } catch {
    return [];
  }
}

export function saveKeyToUSB(drive: USBDrive, keyFile: KeyFile): string {
  const keyPath = path.join(drive.path, KEY_FILE_NAME);
  fs.writeFileSync(keyPath, JSON.stringify(keyFile, null, 2), 'utf8');
  return keyPath;
}

export function readKeyFromUSB(drive: USBDrive): KeyFile | null {
  const keyPath = path.join(drive.path, KEY_FILE_NAME);
  if (!fs.existsSync(keyPath)) return null;

  try {
    const content = fs.readFileSync(keyPath, 'utf8');
    return JSON.parse(content) as KeyFile;
  } catch {
    return null;
  }
}

export function hasKeyFile(drive: USBDrive): boolean {
  return fs.existsSync(path.join(drive.path, KEY_FILE_NAME));
}

export function findUSBWithKey(keyId: string): USBDrive | null {
  const drives = listUSBDrives();
  for (const drive of drives) {
    const keyFile = readKeyFromUSB(drive);
    if (keyFile?.keyId === keyId) return drive;
  }
  return null;
}
