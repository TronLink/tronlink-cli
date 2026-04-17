import { Command } from 'commander';
import { getTronWeb, broadcastTx, validateAddress, waitForTxResult } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, signTransaction, stopSigner } from '../lib/signer.js';
import { outputResult, outputAction, createSpinner, confirmOnChain } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { getExplorerTxUrl, validateNetworkOption } from '../lib/types.js';

export function registerVoteCommand(program: Command): void {
  program
    .command('vote')
    .description('Vote for super representatives')
    .requiredOption('--votes <votes...>', 'Votes in format address:count (e.g. --votes TXxx:5 TYyy:3)')
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        const voteMap = parseVotes(cmdOpts.votes);
        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network, true);
        const tronWeb = getTronWeb(network, opts.apiKey);
        const broadcast = !opts.localBroadcast;

        const voteDisplay = Object.entries(voteMap)
          .map(([addr, count]) => `${addr}: ${count}`)
          .join('\n');

        outputAction({
          Action: 'Vote for Super Representatives',
          Network: network,
          Voter: address,
          Votes: voteDisplay,
          Broadcast: broadcast ? 'Signer' : 'Local',
        });

        const spinner = createSpinner('Building transaction...');
        const tx = await tronWeb.transactionBuilder.vote(voteMap, address);
        spinner.succeed('Transaction built');
        const result = await signTransaction(signer, tx, network, broadcast);

        const txId = broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
        await confirmOnChain(waitForTxResult(tronWeb, txId));
        outputResult(
          {
            Status: 'Success',
            TxID: txId,
            Voter: address,
            'Total Votes': Object.values(voteMap).reduce((a, b) => a + b, 0),
            Explorer: getExplorerTxUrl(network, txId),
          },
          'Vote Result',
          opts.json,
        );
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}

function parseVotes(votes: string[]): Record<string, number> {
  const voteMap: Record<string, number> = {};
  for (const v of votes) {
    const parts = v.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid vote format: "${v}". Use address:count (e.g. TXxx:5)`);
    }
    const [addr, countStr] = parts;
    const count = Number(countStr);
    if (!addr || isNaN(count) || count <= 0 || !Number.isInteger(count)) {
      throw new Error(`Invalid vote: "${v}". Count must be a positive integer`);
    }
    validateAddress(addr, 'SR address');
    if (voteMap[addr]) {
      throw new Error(`Duplicate vote for address: ${addr}`);
    }
    voteMap[addr] = count;
  }
  return voteMap;
}
