import { Command } from 'commander';
import { getTronWeb, broadcastTx, waitForTxResult } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, signTransaction, stopSigner } from '../lib/signer.js';
import { outputResult, outputAction, createSpinner, confirmOnChain } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import chalk from 'chalk';
import { getExplorerTxUrl, validateNetworkOption } from '../lib/types.js';

export function registerRewardCommand(program: Command): void {
  program
    .command('reward')
    .description('Claim voting rewards')
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network, true);
        const tronWeb = getTronWeb(network, opts.apiKey);
        const broadcast = !opts.localBroadcast;

        const rewardInfo = await tronWeb.trx.getReward(address);
        const rewardAmount = Number(rewardInfo) / 1_000_000;

        if (rewardAmount <= 0) {
          if (opts.json) {
            console.log(JSON.stringify({ Status: 'No Rewards', Address: address, Network: network, Reward: '0 TRX' }));
          } else {
            console.log(chalk.red('No unclaimed voting rewards available'));
          }
          await stopSigner();
          return;
        }

        outputAction({
          Action: 'Claim Voting Rewards',
          Network: network,
          Address: address,
          'Unclaimed Reward': `${rewardAmount} TRX`,
          Broadcast: broadcast ? 'Signer' : 'Local',
        });

        const spinner = createSpinner('Building transaction...');
        const tx = await tronWeb.transactionBuilder.withdrawBlockRewards(address);
        spinner.succeed('Transaction built');
        const result = await signTransaction(signer, tx, network, broadcast);

        const txId = broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
        await confirmOnChain(waitForTxResult(tronWeb, txId));
        outputResult(
          {
            Status: 'Success',
            TxID: txId,
            Address: address,
            Reward: `${rewardAmount} TRX`,
            Explorer: getExplorerTxUrl(network, txId),
          },
          'Reward Claim Result',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}
