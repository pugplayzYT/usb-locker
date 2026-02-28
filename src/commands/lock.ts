import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import {
  listUSBDrives,
  saveKeyToUSB,
  hasKeyFile,
  readKeyFromUSB,
} from '../lib/usb';
import {
  generateKeyFile,
  encryptFile,
  LOCKED_EXTENSION,
} from '../lib/crypto';
import type { LockOptions, USBDrive, KeyFile } from '../lib/types';

export async function lockCommand(
  filePath: string,
  options: LockOptions,
): Promise<void> {
  // ── Validate input file ────────────────────────────────────────────────────
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${filePath}`);
  }

  if (filePath.endsWith(LOCKED_EXTENSION)) {
    const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
      {
        type: 'confirm',
        name: 'proceed',
        message: chalk.yellow(
          'This file already has a .locked extension. Proceed anyway?',
        ),
        default: false,
      },
    ]);
    if (!proceed) return; // user cancelled — caller returns to menu
  }

  console.log(chalk.bold.blue('\n  USB Locker — Lock File'));
  console.log(chalk.gray('  ' + '─'.repeat(38)));

  // ── Select USB drive ───────────────────────────────────────────────────────
  let selectedDrive: USBDrive;

  if (options.drive) {
    selectedDrive = { path: options.drive, label: 'Specified Drive' };
  } else {
    const spinner = ora('Scanning for USB drives…').start();
    const drives = listUSBDrives();
    spinner.stop();

    if (drives.length === 0) {
      throw new Error('No USB drives detected — insert a USB drive and try again.');
    }

    const { drive } = await inquirer.prompt<{ drive: USBDrive }>([
      {
        type: 'list',
        name: 'drive',
        message: 'Select the USB drive to store the key on:',
        choices: drives.map((d) => ({
          name: `${d.label}  ${chalk.gray(d.path)}`,
          value: d,
        })),
      },
    ]);

    selectedDrive = drive;
  }

  // ── Resolve key ────────────────────────────────────────────────────────────
  let keyFile: KeyFile;

  if (hasKeyFile(selectedDrive)) {
    const existingKey = readKeyFromUSB(selectedDrive);
    const { keyChoice } = await inquirer.prompt<{ keyChoice: string }>([
      {
        type: 'list',
        name: 'keyChoice',
        message: chalk.yellow(
          'This USB already has a key. What would you like to do?',
        ),
        choices: [
          {
            name: 'Use existing key  (recommended — unlock multiple files with one USB)',
            value: 'existing',
          },
          {
            name: 'Generate a new key  (replaces the old key on this USB)',
            value: 'new',
          },
        ],
      },
    ]);

    keyFile =
      keyChoice === 'existing' && existingKey
        ? existingKey
        : generateKeyFile();
  } else {
    keyFile = generateKeyFile();
  }

  // ── Output path ────────────────────────────────────────────────────────────
  const outputPath =
    options.outputPath ??
    path.join(
      path.dirname(path.resolve(filePath)),
      path.basename(filePath) + LOCKED_EXTENSION,
    );

  // ── Encrypt ────────────────────────────────────────────────────────────────
  const encryptSpinner = ora(
    `Encrypting ${chalk.cyan(path.basename(filePath))}…`,
  ).start();

  try {
    saveKeyToUSB(selectedDrive, keyFile);
    const metadata = encryptFile(filePath, outputPath, keyFile);
    encryptSpinner.succeed(chalk.green('File encrypted successfully!'));

    console.log('');
    console.log(`  Original  : ${chalk.cyan(path.resolve(filePath))}`);
    console.log(`  Encrypted : ${chalk.cyan(outputPath)}`);
    console.log(`  Key ID    : ${chalk.gray(metadata.keyId)}`);
    console.log(`  Key on    : ${chalk.cyan(selectedDrive.path)}`);
  } catch (error) {
    encryptSpinner.fail(chalk.red('Encryption failed.'));
    throw error;
  }

  // ── Optionally delete original ─────────────────────────────────────────────
  if (!options.keepOriginal) {
    const { deleteOriginal } = await inquirer.prompt<{
      deleteOriginal: boolean;
    }>([
      {
        type: 'confirm',
        name: 'deleteOriginal',
        message: chalk.yellow('Delete the original unencrypted file?'),
        default: true,
      },
    ]);

    if (deleteOriginal) {
      fs.unlinkSync(filePath);
      console.log(chalk.gray('\n  Original file removed.'));
    }
  }

  console.log(chalk.bold.green('\n  ✓ Done. Keep your USB safe — it IS the key.\n'));
}
