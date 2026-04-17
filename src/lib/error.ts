import chalk from 'chalk';

export class CliError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CliError';
  }
}

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function handleError(err: unknown): never {
  const message = classifyError(err);
  if (jsonMode) {
    process.stderr.write(JSON.stringify({ status: 'error', error: message }) + '\n');
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
  process.exit(1);
}

// Match specific phrases so unrelated messages containing "reject" etc. don't get misclassified.
const USER_CANCEL_PATTERNS = [
  /\buser[\s_](rejected|denied|cancell?ed)\b/i,
  /\brejected\s+by\s+user\b/i,
  /\bcancell?ed\s+by\s+user\b/i,
  /^USER_(REJECTED|DENIED|CANCELL?ED)$/i,
  /^CANCELLED_BY_CALLER$/,
];

function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (USER_CANCEL_PATTERNS.some(p => p.test(msg))) {
    return 'Transaction cancelled by user in TronLink';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'TronLink approval timed out. Please try again';
  }
  if (lower.includes('insufficient') || lower.includes('balance is not sufficient')) {
    return `Insufficient balance: ${msg}`;
  }
  if (lower.includes('invalid address') || lower.includes('invalid base58')) {
    return `Invalid TRON address provided`;
  }
  if (lower.includes('ipc connection closed') || lower.includes('ipc connection lost')) {
    return 'Signer disconnected (browser closed?). Keep the TronLink signer page open in your browser and retry.';
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('etimedout') || lower.includes('network error') || lower.includes('failed to fetch')) {
    return `Network connection failed. Check your internet connection`;
  }
  if (lower.includes('broadcast failed')) {
    return `Transaction broadcast failed: ${msg}`;
  }

  return msg;
}
