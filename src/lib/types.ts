export interface KeyFile {
  version: string;
  keyId: string;
  key: string; // hex-encoded 32-byte AES-256 key
  createdAt: string;
}

export interface EncryptedFileMetadata {
  version: number;
  keyId: string;
  iv: string; // hex-encoded 12-byte GCM nonce
  authTag: string; // hex-encoded 16-byte GCM auth tag
  originalFilename: string;
  originalSize: number;
  lockedAt: string;
}

export interface USBDrive {
  path: string;
  label: string;
  device?: string;
}

export interface LockOptions {
  keepOriginal?: boolean;
  outputPath?: string;
  drive?: string;
}

export interface UnlockOptions {
  outputPath?: string;
  drive?: string;
}
