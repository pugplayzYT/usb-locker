import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { listUSBDrives, readKeyFromUSB, findUSBWithKey } from '../lib/usb';
import {
  decryptFile,
  readEncryptedFileMetadata,
  LOCKED_EXTENSION,
} from '../lib/crypto';
import type { UnlockOptions } from '../lib/types';

export async function unlockCommand(
  filePath: string,
  options: UnlockOptions,
): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(chalk.bold.blue('\n  USB Locker — Unlock File'));
  console.log(chalk.gray('  ' + '─'.repeat(38)));

  // ── Read encrypted metadata ────────────────────────────────────────────────
  const metaSpinner = ora('Reading file metadata…').start();

  let metadata;
  try {
    metadata = readEncryptedFileMetadata(filePath);
    metaSpinner.succeed('Metadata read');
  } catch {
    metaSpinner.fail(chalk.red('Not a valid USB Locker file.'));
    throw new Error('Not a valid USB Locker file — was this encrypted with usblocker?');
  }

  console.log(`\n  Original name : ${chalk.cyan(metadata.originalFilename)}`);
  console.log(`  Locked at     : ${new Date(metadata.lockedAt).toLocaleString()}`);
  console.log(`  Key ID        : ${chalk.gray(metadata.keyId)}`);

  // ── Locate key ─────────────────────────────────────────────────────────────
  let keyFile;

  if (options.drive) {
    const drive = { path: options.drive, label: 'Specified Drive' };
    keyFile = readKeyFromUSB(drive);
    if (!keyFile) {
      throw new Error(`No USB Locker key found on drive: ${options.drive}`);
    }
  } else {
    const scanSpinner = ora('Scanning USB drives for matching key…').start();
    const matchingDrive = findUSBWithKey(metadata.keyId);
    scanSpinner.stop();

    if (matchingDrive) {
      keyFile = readKeyFromUSB(matchingDrive);
      if (!keyFile) {
        console.error(
          chalk.red(`\n  Failed to read key from matching drive: ${matchingDrive.path}`)
        );
        process.exit(1);
      }
      console.log(
        chalk.green(
          `\n  ✓ Matching key found on: ${matchingDrive.label} (${matchingDrive.path})`,
        ),
      );
    } else {
      // Fall back to manual selection
      const drives = listUSBDrives();

      if (drives.length === 0) {
        throw new Error('No USB drives found — insert the correct USB drive and retry.');
      }

      console.log(
        chalk.yellow(
          '\n  Could not auto-detect the matching key. Select the USB drive manually:',
        ),
      );

      const { drive } = await inquirer.prompt<{
        drive: { path: string; label: string };
      }>([
        {
          type: 'list',
          name: 'drive',
          message: 'Select the USB drive that holds the key:',
          choices: drives.map((d) => ({
            name: `${d.label}  ${chalk.gray(d.path)}`,
            value: d,
          })),
        },
      ]);

      keyFile = readKeyFromUSB(drive);
      if (!keyFile) {
        throw new Error('No USB Locker key found on the selected drive.');
      }
    }
  }

  // ── Determine output path ──────────────────────────────────────────────────
  let outputPath = options.outputPath;

  if (!outputPath) {
    const dir = path.dirname(path.resolve(filePath));
    const defaultName = metadata.originalFilename;
    const defaultPath = path.join(dir, defaultName);

    if (fs.existsSync(defaultPath)) {
      const { choice } = await inquirer.prompt<{ choice: string }>([
        {
          type: 'list',
          name: 'choice',
          message: chalk.yellow(
            `"${defaultName}" already exists in the same directory:`,
          ),
          choices: [
            { name: 'Overwrite it', value: 'overwrite' },
            { name: 'Choose a different name', value: 'rename' },
          ],
        },
      ]);

      if (choice === 'rename') {
        const { newPath } = await inquirer.prompt<{ newPath: string }>([
          {
            type: 'input',
            name: 'newPath',
            message: 'Output file path:',
            default:
              defaultPath.replace(LOCKED_EXTENSION, '') + '.decrypted',
          },
        ]);
        outputPath = newPath;
      } else {
        outputPath = defaultPath;
      }
    } else {
      outputPath = defaultPath;
    }
  }

  // ── Decrypt ────────────────────────────────────────────────────────────────
  const decryptSpinner = ora(
    `Decrypting ${chalk.cyan(path.basename(filePath))}…`,
  ).start();

  try {
    const finalPath = decryptFile(filePath, outputPath, keyFile);
    decryptSpinner.succeed(chalk.green('File decrypted successfully!'));

    console.log('');
    console.log(`  Decrypted : ${chalk.cyan(finalPath)}`);
    console.log(chalk.bold.green('\n  ✓ Done.\n'));
  } catch (error) {
    decryptSpinner.fail(chalk.red('Decryption failed.'));
    if (error instanceof Error) {
      if (error.message.includes('Key mismatch')) {
        throw new Error('Wrong USB drive — this is not the USB that was used to lock the file.');
      } else if (error.message.includes('corrupted')) {
        throw new Error('The file appears to be corrupted or tampered with.');
      }
    }
    throw error;
  }
}
