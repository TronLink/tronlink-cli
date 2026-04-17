import { Command } from 'commander';
import { TronSigner } from 'tronlink-signer';
import { startIPCServer, writeServeState, clearServeState, readServeState, acquireServeLock } from '../lib/ipc.js';

import { validateNetworkOption, type TronNetwork } from '../lib/types.js';
import { outputSuccess, outputResult, outputInfo } from '../lib/output.js';
import { handleError } from '../lib/error.js';

export function registerServeCommand(program: Command): void {
  const serve = program
    .command('serve')
    .description('Manage persistent signer (auto-started by other commands)');

  serve
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .option('--daemon', 'Run in background (used internally)')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);

        const existing = readServeState();
        if (existing) {
          try {
            process.kill(existing.pid, 0);
            if (cmdOpts.daemon) process.exit(0);
            console.error(`Serve is already running (PID: ${existing.pid}, port: ${existing.port}). Use "tronlink serve stop" to stop it first.`);
            process.exit(1);
          } catch {
            clearServeState();
          }
        }

        // Acquire exclusive lock to prevent concurrent starts
        const releaseLock = acquireServeLock();
        if (!releaseLock) {
          if (cmdOpts.daemon) process.exit(0);
          console.error('Another serve instance is starting. Please wait.');
          process.exit(1);
        }

        const port = opts.port || 3386;
        if (opts.port) {
          process.env.TRON_HTTP_PORT = String(port);
        }

        // Catch unhandled rejections from SDK's attachAbortSignal
        // (promise.finally() creates a floating rejected promise on abort)
        process.on('unhandledRejection', (err) => {
          if (err instanceof Error && err.message === 'CANCELLED_BY_CALLER') return;
          console.error('[serve] Unhandled rejection:', err);
        });

        const signer = new TronSigner();
        await signer.start();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actualPort: number = typeof (signer as any).getPort === 'function'
          ? (signer as any).getPort()
          : signer.getConfig().httpPort;

        // Browser UI now shows all pending requests as tabs, so no queue concept on the CLI side.
        const ipcServer = startIPCServer(async (method, params, signal) => {
          if (method === 'connectWallet') {
            return signer.connectWallet(
              params.network as TronNetwork | undefined,
              { signal },
            );
          }
          if (method === 'getConnectedWallet') {
            return signer.getConnectedWallet();
          }
          if (method === 'signTransaction') {
            // confirm: false — CLI does its own waitForTxResult polling, don't double-wait
            return signer.signTransaction(
              params.transaction as Record<string, unknown>,
              params.network as TronNetwork | undefined,
              params.broadcast as boolean | undefined,
              { signal, confirm: false },
            );
          }
          if (method === 'ping') {
            return { status: 'ok' };
          }
          throw new Error(`Unknown IPC method: ${method}`);
        });

        writeServeState(actualPort);

        const cleanup = () => {
          clearServeState();
          releaseLock();
          ipcServer.close();
          signer.stop().catch(() => {});
          process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        // Stop serve when browser is closed
        signer.onBrowserDisconnect = () => {
          console.error('[serve] Browser disconnected, shutting down...');
          cleanup();
        };

        // Log wallet-change events — pendings are already rejected by SDK
        signer.onWalletChanged = (reason) => {
          console.error(`[serve] Wallet changed (${reason}) — all pending requests cancelled.`);
        };

        if (cmdOpts.daemon) {
          setInterval(() => {}, 60_000);
        } else {
          outputInfo('Connecting wallet...');
          const network = cmdOpts.network as TronNetwork | undefined;
          const result = await signer.connectWallet(network);
          const walletNetwork = result.network as TronNetwork;

          outputSuccess(`Connected: ${result.address} (${walletNetwork})`);

          outputResult(
            { PID: process.pid, Port: actualPort, Address: result.address, Network: walletNetwork },
            'Serve Running',
            opts.json,
          );
          outputInfo('Signer is running. Other commands will reuse this session.');
          outputInfo('Press Ctrl+C to stop.\n');
          setInterval(() => {}, 60_000);
        }
      } catch (err) {
        clearServeState();
        handleError(err);
      }
    });

  serve
    .command('stop')
    .description('Stop the running serve process')
    .action(() => {
      const state = readServeState();
      if (!state) {
        console.error('No serve process is running.');
        process.exit(1);
      }
      try {
        process.kill(state.pid, 'SIGTERM');
        clearServeState();
        outputSuccess(`Serve process (PID: ${state.pid}) stopped.`);
      } catch {
        clearServeState();
        outputSuccess('Serve process was not running. State cleaned up.');
      }
    });
}
