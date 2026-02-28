#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { lockCommand } from './commands/lock';
import { unlockCommand } from './commands/unlock';
import { listUSBDrives } from './lib/usb';

// ── Welcome banner ────────────────────────────────────────────────────────────
console.log('');
console.log(chalk.bold.blue('  🔐 Hello! What files do you want to encrypt? 😊'));
console.log(chalk.gray('  ─────────────────────────────────────────────'));
console.log('');

const program = new Command();

program
  .name('usblocker')
  .description(
    chalk.blue('USB Locker — encrypt files with your USB drive as the key'),
  )
  .version('1.0.0');

// ── lock ──────────────────────────────────────────────────────────────────────
program
  .command('lock <file>')
  .description('Encrypt a file; the decryption key is saved on your USB drive')
  .option('-k, --keep-original', 'Keep the original unencrypted file', false)
  .option('-o, --output <path>', 'Custom output path for the encrypted file')
  .option('-d, --drive <path>', 'USB drive path (skips interactive selection)')
  .action(async (file: string, options) => {
    try {
      await lockCommand(file, {
        keepOriginal: options.keepOriginal as boolean,
        outputPath: options.output as string | undefined,
        drive: options.drive as string | undefined,
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));
      }
      process.exit(1);
    }
  });

// ── unlock ────────────────────────────────────────────────────────────────────
program
  .command('unlock <file>')
  .description(
    'Decrypt a .locked file using the key from the correct USB drive',
  )
  .option('-o, --output <path>', 'Custom output path for the decrypted file')
  .option('-d, --drive <path>', 'USB drive path (skips auto-detection)')
  .action(async (file: string, options) => {
    try {
      await unlockCommand(file, {
        outputPath: options.output as string | undefined,
        drive: options.drive as string | undefined,
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));
      }
      process.exit(1);
    }
  });

// ── list-drives ───────────────────────────────────────────────────────────────
program
  .command('list-drives')
  .description('List all currently detected USB drives')
  .action(() => {
    const drives = listUSBDrives();
    if (drives.length === 0) {
      console.log(chalk.yellow('\n  No USB drives detected.\n'));
      return;
    }
    console.log(chalk.bold.blue('\n  Detected USB drives:\n'));
    drives.forEach((drive, i) => {
      console.log(
        `    ${i + 1}. ${chalk.cyan(drive.label)}  ${chalk.gray(drive.path)}`,
      );
    });
    console.log('');
  });

program.parse(process.argv);
