import { Command } from 'commander';
import { initSigner, getWalletAddress, stopSigner } from '../lib/signer.js';
import { outputResult } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { NETWORKS, validateNetworkOption, type TronNetwork } from '../lib/types.js';

export function registerNetworkCommand(program: Command): void {
  program
    .command('network')
    .description('View current network (or switch with --network)')
    .option('--network <name>', 'Switch to network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        const signer = await initSigner(opts.port);
        const net = cmdOpts.network as TronNetwork | undefined;
        const { address, network: actualNetwork } = await getWalletAddress(signer, net, true);
        const config = NETWORKS[actualNetwork];

        outputResult(
          {
            Network: actualNetwork,
            FullHost: config.fullHost,
            Explorer: config.explorerUrl,
            ConnectedAddress: address,
          },
          'Current Network',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}
