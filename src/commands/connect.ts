import { Command } from 'commander';
import { initSigner, getWalletAddress, stopSigner } from '../lib/signer.js';
import { validateNetworkOption } from '../lib/types.js';
import { outputResult, outputSuccess } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import type { TronNetwork } from '../lib/types.js';

export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .description('Connect TronLink wallet')
    .option('--network <name>', 'Network: mainnet, nile, shasta (omit to use wallet current network)')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network as TronNetwork | undefined, true);
        outputSuccess('Wallet connected');
        outputResult(
          { Address: address, Network: network },
          'Connected Wallet',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}
