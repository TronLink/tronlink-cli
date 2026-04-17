import { Command } from 'commander';
import { getTronWeb, sunToTrx, validateAddress } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, stopSigner } from '../lib/signer.js';
import { outputResult } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { validateNetworkOption, type TronNetwork } from '../lib/types.js';

export function registerResourceCommand(program: Command): void {
  program
    .command('resource')
    .description('Query energy and bandwidth usage')
    .option('--address <address>', 'Address to query (connects wallet if omitted)')
    .option('--network <name>', 'Network: mainnet, nile, shasta (default: mainnet when address provided)')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        let targetAddress: string;
        let network: TronNetwork;

        if (cmdOpts.address) {
          validateAddress(cmdOpts.address, 'query address');
          validateNetworkOption(cmdOpts.network);
          targetAddress = cmdOpts.address;
          network = (cmdOpts.network?.toLowerCase() as TronNetwork) || 'mainnet';
        } else {
          const signer = await initSigner(opts.port);
          const wallet = await getWalletAddress(signer, cmdOpts.network, true);
          targetAddress = wallet.address;
          network = wallet.network;
        }

        const tronWeb = getTronWeb(network, opts.apiKey);
        const resources = await tronWeb.trx.getAccountResources(targetAddress);
        const account = await tronWeb.trx.getAccount(targetAddress);

        const energyLimit = resources.EnergyLimit || 0;
        const energyUsed = resources.EnergyUsed || 0;
        const bandwidthLimit = (resources.NetLimit || 0) + (resources.freeNetLimit || 0);
        const bandwidthUsed = (resources.NetUsed || 0) + (resources.freeNetUsed || 0);

        const frozenV2 = account.frozenV2 || [];
        let stakedForEnergy = 0;
        let stakedForBandwidth = 0;
        for (const f of frozenV2) {
          if (f.type === 'ENERGY') stakedForEnergy = f.amount || 0;
          else if (f.type === 'BANDWIDTH' || !f.type) stakedForBandwidth = f.amount || 0;
        }

        outputResult(
          {
            Address: targetAddress,
            Network: network,
            'Energy Available': `${energyLimit - energyUsed} / ${energyLimit}`,
            'Energy Used': energyUsed,
            'Staked for Energy': `${sunToTrx(stakedForEnergy)} TRX`,
            'Bandwidth Available': `${bandwidthLimit - bandwidthUsed} / ${bandwidthLimit}`,
            'Bandwidth Used': bandwidthUsed,
            'Staked for Bandwidth': `${sunToTrx(stakedForBandwidth)} TRX`,
          },
          'Account Resources',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}
