# USB Locker 🔐

> **Your USB drive IS the key.**
> Encrypt any file with AES-256-GCM. The decryption key lives only on your USB drive — no USB, no access.

---

## How it works

```
┌──────────────┐    lock     ┌──────────────┐    ┌─────────────────────┐
│  plain file  │ ──────────► │ .locked file │    │  USB drive          │
└──────────────┘             └──────────────┘    │  usblocker.key      │
                                                 │  (AES-256 key +     │
                                                 │   UUID key ID)      │
                                                 └─────────────────────┘

Unlock only possible when the exact USB (with matching key ID) is present.
```

1. **Lock** — a fresh 256-bit AES-GCM key is generated and written to your USB as `usblocker.key`. The file is encrypted in-place and saved as `<filename>.locked`.
2. **Unlock** — USB Locker scans plugged-in USB drives, finds the one whose `keyId` matches the encrypted file's header, and decrypts it. Wrong USB → decryption refused.

### Cryptographic details

| Property | Value |
|---|---|
| Algorithm | AES-256-GCM |
| Key size | 256 bit (32 bytes) |
| Nonce / IV | 96 bit (12 bytes), random per encryption |
| Auth tag | 128 bit (16 bytes) |
| Key storage | JSON on USB (`usblocker.key`) |

The `.locked` file format:

```
Offset   Size    Field
0        4       Magic bytes  "USLK"
4        1       Format version (0x01)
5        4       Metadata JSON length (uint32 LE)
9        N       Metadata JSON  { keyId, iv, authTag, originalFilename, … }
9+N      rest    AES-256-GCM ciphertext
```

---

## Installation

### From npm (run without installing)
```bash
npx usb-locker lock secret.pdf
```

### Global install
```bash
npm install -g usb-locker
usblocker lock secret.pdf
```

### Build a standalone executable
Requires [Node.js 18+](https://nodejs.org).

```bash
git clone https://github.com/YOUR_USER/usb-locker.git
cd usb-locker
npm install
npm run bundle        # produces bin/usblocker-win.exe, bin/usblocker-linux, bin/usblocker-macos
```

---

## Usage

### Lock a file
```bash
usblocker lock <file> [options]
```

```
Options:
  -k, --keep-original    Keep the original unencrypted file (default: asks)
  -o, --output <path>    Custom output path for the encrypted file
  -d, --drive <path>     USB drive path, e.g. E:\ or /media/usb (skips prompt)
```

**Example:**
```bash
usblocker lock ~/Documents/passwords.kdbx
# → selects USB interactively, writes ~/Documents/passwords.kdbx.locked
# → saves key to E:\usblocker.key
```

### Unlock a file
```bash
usblocker unlock <file.locked> [options]
```

```
Options:
  -o, --output <path>    Custom output path for the decrypted file
  -d, --drive <path>     USB drive path (skips auto-detection)
```

**Example:**
```bash
usblocker unlock ~/Documents/passwords.kdbx.locked
# → scans USB drives, finds matching key, decrypts
```

### List USB drives
```bash
usblocker list-drives
```

---

## Platform support

| OS | USB detection method |
|---|---|
| Windows | `wmic logicaldisk where drivetype=2` |
| Linux | `lsblk --json` |
| macOS | `diskutil info` + `/Volumes` scan |

---

## Development

```bash
npm install          # install deps + set up git hooks
npm run dev          # run CLI via tsx (no build needed)
npm test             # run full test suite
npm run test:watch   # watch mode
npm run lint         # ESLint
npm run build        # compile TypeScript → dist/
```

### Git hooks (enforced automatically)

| Hook | Runs |
|---|---|
| `pre-commit` | `npm run lint` — ESLint must pass |
| `pre-push` | `npm test` — all tests must pass |

These are installed by [Husky](https://typicode.github.io/husky/) when you run `npm install`. You cannot push broken code.

---

## Project structure

```
usb-locker/
├── src/
│   ├── index.ts              CLI entry point (Commander)
│   ├── commands/
│   │   ├── lock.ts           lock command logic
│   │   └── unlock.ts         unlock command logic
│   └── lib/
│       ├── crypto.ts         AES-256-GCM encrypt/decrypt + file format
│       ├── usb.ts            USB drive detection + key read/write
│       └── types.ts          shared TypeScript interfaces
├── tests/
│   ├── crypto.test.ts        unit tests for crypto layer
│   ├── usb.test.ts           unit tests for USB layer (mocked exec)
│   └── integration.test.ts   end-to-end lock → unlock workflows
├── .husky/
│   ├── pre-commit            runs ESLint
│   └── pre-push              runs full test suite
└── ...config files
```

---

## Security notes

- **Never commit `usblocker.key`** — it is listed in `.gitignore` by default.
- The key file is plain JSON on the USB. Physical access to the USB = access to the key.
- AES-256-GCM provides both confidentiality and authenticity (tamper detection).
- Each encryption uses a fresh random 96-bit nonce, so encrypting the same file twice produces different ciphertext.

---

## License

MIT
