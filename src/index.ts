#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { lockCommand } from './commands/lock';
import { unlockCommand } from './commands/unlock';
import { listUSBDrives } from './lib/usb';

// ── Welcome banner ────────────────────────────────────────────────────────────
console.log('');
console.log(chalk.bold.blue('  🔐 Hello! What files do you want to encrypt? 😊'));
console.log(chalk.gray('  ─────────────────────────────────────────────'));
console.log('');

const program = new Command();

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const { version } = require('../package.json');

program
  .name('usblocker')
  .description(
    chalk.blue('USB Locker — encrypt files with your USB drive as the key'),
  )
  .version(version);

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

// ── Interactive mode (double-click / no-args) ─────────────────────────────────
async function runInteractiveMode(): Promise<void> {
  const { action } = await inquirer.prompt<{ action: string }>([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '🔒  Lock a file', value: 'lock' },
        { name: '🔓  Unlock a file', value: 'unlock' },
        { name: '💾  List USB drives', value: 'list-drives' },
        { name: '❌  Exit', value: 'exit' },
      ],
    },
  ]);

  if (action === 'exit') return;

  if (action === 'list-drives') {
    const drives = listUSBDrives();
    if (drives.length === 0) {
      console.log(chalk.yellow('\n  No USB drives detected.\n'));
    } else {
      console.log(chalk.bold.blue('\n  Detected USB drives:\n'));
      drives.forEach((drive, i) => {
        console.log(
          `    ${i + 1}. ${chalk.cyan(drive.label)}  ${chalk.gray(drive.path)}`,
        );
      });
      console.log('');
    }
    return;
  }

  const { file } = await inquirer.prompt<{ file: string }>([
    {
      type: 'input',
      name: 'file',
      message:
        action === 'lock'
          ? 'Path to the file you want to lock:'
          : 'Path to the .locked file you want to unlock:',
      validate: (input: string) =>
        input.trim().length > 0 ? true : 'Please enter a file path',
    },
  ]);

  if (action === 'lock') {
    await lockCommand(file.trim(), {});
  } else {
    await unlockCommand(file.trim(), {});
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
const isInteractive = process.argv.length <= 2;

if (isInteractive) {
  // Launched with no arguments (e.g. double-clicked exe) — run interactive menu
  runInteractiveMode()
    .catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));
      }
    })
    .finally(() => {
      // Keep the CMD window open so the user can read the output before it closes
      inquirer
        .prompt([{ type: 'input', name: '_', message: chalk.gray('Press Enter to exit…') }])
        .catch(() => { /* window already closing */ });
    });
} else {
  program.parse(process.argv);
}
