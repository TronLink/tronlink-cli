import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { TronSigner } from 'tronlink-signer';
import type { TronNetwork } from './types.js';

import { outputInfo, createSpinner } from './output.js';
import { tryConnectIPC, type IPCClient } from './ipc.js';

let signerInstance: TronSigner | null = null;
let ipcClient: IPCClient | null = null;
let signerAbort: AbortController | null = null;

const DEFAULT_TIMEOUT = 300_000; // 5 minutes



/**
 * Initialize signer. Tries to reuse a running serve daemon via IPC.
 * If no daemon is running, auto-starts one in the background.
 * Falls back to in-process signer if daemon start fails.
 */
export async function initSigner(port?: number): Promise<TronSigner> {
  // 1. Try existing serve daemon
  const existing = await tryConnectIPC();
  if (existing) {
    ipcClient = existing;
    outputInfo('Connected to signer');
    return {} as TronSigner;
  }

  // 2. Try to auto-start daemon
  const client = await spawnDaemon(port);
  if (client) {
    ipcClient = client;
    outputInfo('Signer started in background');
    return {} as TronSigner;
  }

  // 3. Fall back to in-process signer
  if (port) {
    process.env.TRON_HTTP_PORT = String(port);
  }
  if (!signerInstance) {
    signerInstance = new TronSigner();
  }
  await signerInstance.start();

  // Only stop signer on process exit/SIGTERM, NOT on SIGINT
  // SIGINT (Ctrl+C) should only abort the current operation via createSignerAbort()
  const signer = signerInstance;
  const cleanup = () => {
    signer.stop().catch(() => {});
  };
  process.once('SIGTERM', cleanup);
  process.once('exit', cleanup);

  return signerInstance;
}

/**
 * Spawn serve daemon in background and wait for IPC to be ready.
 */
async function spawnDaemon(port?: number): Promise<IPCClient | null> {
  try {
    const args = [process.argv[1], 'serve', '--daemon'];
    if (port) args.push('--port', String(port));

    const logDir = join(homedir(), '.tronlink-cli');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const logPath = join(logDir, 'daemon.log');
    const logFd = openSync(logPath, 'a');
    const child = spawn(process.argv[0], args, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    });
    child.unref();
    closeSync(logFd);

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      const client = await tryConnectIPC();
      if (client) return client;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create an AbortController for the current signer operation.
 * Ctrl+C in non-IPC mode aborts the current operation instead of killing the process.
 */
function createSignerAbort(): AbortController {
  // Clean up previous
  if (signerAbort) signerAbort.abort();
  signerAbort = new AbortController();

  const onSigint = () => {
    signerAbort?.abort();
    // Remove listener so next Ctrl+C kills the process
    process.removeListener('SIGINT', onSigint);
  };
  process.on('SIGINT', onSigint);

  // Clean up SIGINT listener when signal is used or GC'd
  signerAbort.signal.addEventListener('abort', () => {
    process.removeListener('SIGINT', onSigint);
  }, { once: true });

  return signerAbort;
}

export async function getWalletAddress(
  signer: TronSigner,
  network?: TronNetwork,
  forceConnect = false,
): Promise<{ address: string; network: TronNetwork }> {
  let address: string;
  let walletNetwork: TronNetwork;

  if (ipcClient) {
    // Try cached wallet — skips creating a Connect pending in the browser tab bar.
    // When cached network differs from requested, fall through to connectWallet so the
    // SDK/browser can prompt TronLink to switch; don't short-circuit here.
    const cached = await ipcClient.call('getConnectedWallet', {}) as { address: string; network: string } | null;
    if (cached && (!network || network === cached.network)) {
      address = cached.address;
      walletNetwork = cached.network as TronNetwork;
      outputInfo(`Wallet: ${address} (${walletNetwork})`);
    } else {
      outputInfo('Connecting wallet (check browser tab to approve)...');
      let result: { address: string; network: string };
      try {
        result = await withTimeout(
          ipcClient.call('connectWallet', { network }) as Promise<{ address: string; network: string }>,
          getTimeout(),
          'Wallet connection timed out. Please try again',
        );
      } catch (err) {
        const reason = walletChangedReason(err);
        if (reason) throw walletChangedError(reason);
        throw err;
      }
      address = result.address;
      walletNetwork = result.network as TronNetwork;
      outputInfo(`Wallet connected: ${address} (${walletNetwork})`);
    }
  } else {
    outputInfo('Connecting wallet...');
    const controller = createSignerAbort();
    const result = await withTimeout(
      signer.connectWallet(network, { signal: controller.signal }),
      getTimeout(),
      'Wallet connection timed out. Please try again',
    );
    address = result.address;
    walletNetwork = result.network as TronNetwork;
    outputInfo(`Connected: ${address} (${walletNetwork})`);
  }

  if (network && network !== walletNetwork) {
    throw new Error(
      `Network switch failed: requested "${network}" but wallet is on "${walletNetwork}". Please switch TronLink to "${network}" manually and retry.`,
    );
  }

  return { address, network: walletNetwork };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signTransaction(
  signer: TronSigner,
  transaction: unknown,
  network?: TronNetwork,
  broadcast = true,
): Promise<{ signedTransaction?: any; txId?: string }> {
  if (ipcClient) {
    const approvalSpinner = createSpinner('Awaiting TronLink approval (check browser tab)...');
    try {
      const result = await withTimeout(
        ipcClient.call('signTransaction', {
          transaction: transaction as Record<string, unknown>,
          network,
          broadcast,
        }) as Promise<{ signedTransaction?: any; txId?: string }>,
        getTimeout(),
        'Transaction signing timed out. Please run the command again',
      );
      if (broadcast && !result.txId) {
        approvalSpinner.fail('Approval failed');
        throw new Error('Signer reported broadcast but returned no transaction ID — the transaction may have been rejected by the network');
      }
      approvalSpinner.succeed(broadcast ? `Broadcasted (TxID: ${result.txId})` : 'Signed');
      return result;
    } catch (err) {
      const reason = walletChangedReason(err);
      if (reason) {
        approvalSpinner.fail('Cancelled: wallet changed in TronLink');
        throw walletChangedError(reason);
      }
      approvalSpinner.fail('Approval failed');
      throw err;
    }
  }

  const approvalSpinner = createSpinner('Awaiting TronLink approval (check browser tab)...');
  const controller = createSignerAbort();
  try {
    const result = await withTimeout(
      signer.signTransaction(
        transaction as Record<string, unknown>,
        network,
        broadcast,
        { signal: controller.signal },
      ),
      getTimeout(),
      'Transaction signing timed out. Please run the command again',
    );
    if (broadcast && !result.txId) {
      approvalSpinner.fail('Approval failed');
      throw new Error('Signer reported broadcast but returned no transaction ID — the transaction may have been rejected by the network');
    }
    approvalSpinner.succeed(broadcast ? `Broadcasted (TxID: ${result.txId})` : 'Signed');
    return result;
  } catch (err) {
    const reason = walletChangedReason(err);
    if (reason) {
      approvalSpinner.fail('Cancelled: wallet changed in TronLink');
      throw walletChangedError(reason);
    }
    approvalSpinner.fail('Approval failed');
    throw err;
  }
}

export async function stopSigner(): Promise<void> {
  if (ipcClient) {
    ipcClient.disconnect();
    ipcClient = null;
    return;
  }
  if (signerInstance) {
    await signerInstance.stop();
    signerInstance = null;
  }
}

function getTimeout(): number {
  const env = process.env.TRONLINK_TIMEOUT;
  if (env) {
    const val = Number(env);
    if (!isNaN(val) && val > 0) return val;
  }
  return DEFAULT_TIMEOUT;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

function walletChangedReason(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const m = err.message.match(/^WALLET_CHANGED(?::\s*(.+))?/);
  return m ? (m[1] || 'changed') : null;
}

function walletChangedError(reason: string): Error {
  const text = reason === 'account' ? 'Wallet account switched in TronLink'
    : reason === 'network' ? 'Wallet network switched in TronLink'
    : reason === 'disconnect' ? 'Wallet disconnected in TronLink'
    : `Wallet changed in TronLink (${reason})`;
  return new Error(`${text}. Please re-run the command.`);
}
