import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { isJsonMode } from './error.js';

export function outputResult(
  data: Record<string, unknown>,
  title: string,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(chalk.bold.green(`\n${title}`));
  const table = new Table();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      table.push({ [chalk.cyan(key)]: String(value) });
    }
  }
  console.log(table.toString());
  console.log();
}

export function outputInfo(message: string): void {
  if (isJsonMode()) return;
  console.log(chalk.blue(message));
}

export function outputAction(details: Record<string, string>): void {
  if (isJsonMode()) return;
  console.log(chalk.bold.yellow('\nTransaction Preview'));
  const table = new Table();
  for (const [key, value] of Object.entries(details)) {
    table.push({ [chalk.cyan(key)]: value });
  }
  console.log(table.toString());
}

export function outputSuccess(message: string): void {
  if (isJsonMode()) return;
  console.log(chalk.green(message));
}

export function outputSignedTx(signedTransaction: unknown): void {
  console.log(chalk.bold.green('\nSigned Transaction'));
  console.log(JSON.stringify(signedTransaction, null, 2));
  console.log();
}

interface SpinnerLike {
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
  start: (text?: string) => void;
  stop: () => void;
}

export function createSpinner(text: string): SpinnerLike {
  if (isJsonMode()) {
    return { succeed: () => {}, fail: () => {}, start: () => {}, stop: () => {} };
  }
  return ora({ text, color: 'cyan' }).start();
}

export async function confirmOnChain(promise: Promise<void>): Promise<void> {
  const s = createSpinner('Waiting for on-chain confirmation...');
  try {
    await promise;
    s.succeed('Confirmed on-chain');
  } catch (err) {
    s.fail('On-chain execution failed');
    throw err;
  }
}
