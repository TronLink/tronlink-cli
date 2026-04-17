import { Command } from 'commander';
import { getTronWeb, trxToSun, broadcastTx, waitForTxResult } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, signTransaction, stopSigner } from '../lib/signer.js';
import { outputResult, outputAction, createSpinner, confirmOnChain } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { getExplorerTxUrl, validateNetworkOption, type ResourceType } from '../lib/types.js';

export function registerUnstakeCommand(program: Command): void {
  program
    .command('unstake')
    .description('Unlock staked TRX (Stake 2.0)')
    .requiredOption('--amount <amount>', 'Amount of TRX to unstake')
    .requiredOption('--resource <type>', 'Resource type: energy or bandwidth')
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        const resource = parseResource(cmdOpts.resource);
        const amountSun = trxToSun(cmdOpts.amount);

        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network, true);
        const tronWeb = getTronWeb(network, opts.apiKey);
        const broadcast = !opts.localBroadcast;

        outputAction({
          Action: 'Unstake TRX',
          Network: network,
          Address: address,
          Amount: `${cmdOpts.amount} TRX`,
          Resource: resource,
          Broadcast: broadcast ? 'Signer' : 'Local',
        });

        const spinner = createSpinner('Building transaction...');
        const tx = await tronWeb.transactionBuilder.unfreezeBalanceV2(amountSun, resource, address);
        spinner.succeed('Transaction built');
        const result = await signTransaction(signer, tx, network, broadcast);

        const txId = broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
        await confirmOnChain(waitForTxResult(tronWeb, txId));
        outputResult(
          { Status: 'Success', TxID: txId, Address: address, Amount: `${cmdOpts.amount} TRX`, Resource: resource, Explorer: getExplorerTxUrl(network, txId) },
          'Unstake Result',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}

function parseResource(input: string): ResourceType {
  const upper = input.toUpperCase();
  if (upper === 'ENERGY') return 'ENERGY';
  if (upper === 'BANDWIDTH') return 'BANDWIDTH';
  throw new Error(`Invalid resource type: "${input}". Use "energy" or "bandwidth"`);
}
