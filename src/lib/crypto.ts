import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { KeyFile, EncryptedFileMetadata } from './types';

export const KEY_FILE_NAME = 'usblocker.key';
export const LOCKED_EXTENSION = '.locked';

// File format magic bytes: "USLK"
export const MAGIC = Buffer.from([0x55, 0x53, 0x4c, 0x4b]);
export const VERSION = 1;

/**
 * File format layout:
 *   [0-3]   MAGIC (4 bytes)  — "USLK"
 *   [4]     VERSION (1 byte)
 *   [5-8]   METADATA_LEN (4 bytes, uint32le)
 *   [9 ...]  METADATA (JSON, variable)
 *   [9+len...] CIPHERTEXT
 */

export function generateKeyFile(): KeyFile {
  return {
    version: '1.0.0',
    keyId: uuidv4(),
    key: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
}

export function encryptFile(
  inputPath: string,
  outputPath: string,
  keyFile: KeyFile,
): EncryptedFileMetadata {
  const key = Buffer.from(keyFile.key, 'hex');
  const iv = crypto.randomBytes(12); // 96-bit nonce for AES-256-GCM

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const inputData = fs.readFileSync(inputPath);
  const originalFilename = path.basename(inputPath);

  const encrypted = Buffer.concat([cipher.update(inputData), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes

  const metadata: EncryptedFileMetadata = {
    version: VERSION,
    keyId: keyFile.keyId,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    originalFilename,
    originalSize: inputData.length,
    lockedAt: new Date().toISOString(),
  };

  const metadataJson = Buffer.from(JSON.stringify(metadata), 'utf8');
  const metadataLength = Buffer.allocUnsafe(4);
  metadataLength.writeUInt32LE(metadataJson.length, 0);

  const output = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION]),
    metadataLength,
    metadataJson,
    encrypted,
  ]);

  fs.writeFileSync(outputPath, output);
  return metadata;
}

export function decryptFile(
  inputPath: string,
  outputPath: string,
  keyFile: KeyFile,
): string {
  const fileData = fs.readFileSync(inputPath);

  if (fileData.length < 9) {
    throw new Error('Invalid file format: file too small');
  }

  if (!fileData.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Invalid file format: not a USB Locker encrypted file');
  }

  const fileVersion = fileData[4];
  if (fileVersion !== VERSION) {
    throw new Error(`Unsupported file version: ${fileVersion}`);
  }

  const metadataLength = fileData.readUInt32LE(5);
  const metadataJson = fileData.subarray(9, 9 + metadataLength);
  const metadata: EncryptedFileMetadata = JSON.parse(
    metadataJson.toString('utf8'),
  );

  if (metadata.keyId !== keyFile.keyId) {
    throw new Error(
      `Key mismatch: file requires key "${metadata.keyId}" but USB has key "${keyFile.keyId}"`,
    );
  }

  const encryptedData = fileData.subarray(9 + metadataLength);
  const key = Buffer.from(keyFile.key, 'hex');
  const iv = Buffer.from(metadata.iv, 'hex');
  const authTag = Buffer.from(metadata.authTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
  } catch {
    throw new Error(
      'Decryption failed: file is corrupted or has been tampered with',
    );
  }

  fs.writeFileSync(outputPath, decrypted);
  return outputPath;
}

export function readEncryptedFileMetadata(
  filePath: string,
): EncryptedFileMetadata {
  const fileData = fs.readFileSync(filePath);

  if (fileData.length < 9) {
    throw new Error('Invalid file format: file too small');
  }

  if (!fileData.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Invalid file format: not a USB Locker encrypted file');
  }

  const metadataLength = fileData.readUInt32LE(5);
  const metadataJson = fileData.subarray(9, 9 + metadataLength);

  return JSON.parse(metadataJson.toString('utf8')) as EncryptedFileMetadata;
}
