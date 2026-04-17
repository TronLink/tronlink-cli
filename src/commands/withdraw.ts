import { Command } from 'commander';
import { getTronWeb, broadcastTx, waitForTxResult } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, signTransaction, stopSigner } from '../lib/signer.js';
import { outputResult, outputAction, createSpinner, confirmOnChain } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { getExplorerTxUrl, validateNetworkOption } from '../lib/types.js';

export function registerWithdrawCommand(program: Command): void {
  program
    .command('withdraw')
    .description('Withdraw unfrozen TRX (after unlock period)')
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network, true);
        const tronWeb = getTronWeb(network, opts.apiKey);
        const broadcast = !opts.localBroadcast;

        const spinner = createSpinner('Checking withdrawable balance...');
        const account = await tronWeb.trx.getAccount(address);
        const now = Date.now();
        const withdrawable = (account.unfrozenV2 || [])
          .filter((u: { unfreeze_amount?: number; unfreeze_expire_time?: number }) =>
            u.unfreeze_amount && u.unfreeze_expire_time && u.unfreeze_expire_time <= now)
          .reduce((sum: number, u: { unfreeze_amount?: number }) => sum + (u.unfreeze_amount || 0), 0);
        if (withdrawable === 0) {
          spinner.fail('No withdrawable TRX');
          throw new Error('No unfrozen TRX available to withdraw. Either nothing is unfreezing or the unlock period has not expired yet');
        }
        const withdrawTrx = (withdrawable / 1_000_000).toString();
        spinner.succeed(`Withdrawable: ${withdrawTrx} TRX`);

        outputAction({
          Action: 'Withdraw Unfrozen TRX',
          Network: network,
          Address: address,
          Amount: `${withdrawTrx} TRX`,
          Broadcast: broadcast ? 'Signer' : 'Local',
        });

        spinner.start('Building transaction...');
        const tx = await tronWeb.transactionBuilder.withdrawExpireUnfreeze(address);
        spinner.succeed('Transaction built');
        const result = await signTransaction(signer, tx, network, broadcast);

        const txId = broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
        await confirmOnChain(waitForTxResult(tronWeb, txId));
        outputResult(
          { Status: 'Success', TxID: txId, Address: address, Explorer: getExplorerTxUrl(network, txId) },
          'Withdraw Result',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}
