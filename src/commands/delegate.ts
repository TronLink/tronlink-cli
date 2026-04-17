import { Command } from 'commander';
import { getTronWeb, trxToSun, broadcastTx, validateAddress, waitForTxResult } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, signTransaction, stopSigner } from '../lib/signer.js';
import { outputResult, outputAction, createSpinner, confirmOnChain } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { getExplorerTxUrl, validateNetworkOption, type ResourceType } from '../lib/types.js';

export function registerDelegateCommand(program: Command): void {
  program
    .command('delegate')
    .description('Delegate energy or bandwidth to another address')
    .requiredOption('--toAddress <address>', 'Recipient address')
    .requiredOption('--amount <amount>', 'Amount of TRX to delegate')
    .requiredOption('--resource <type>', 'Resource type: energy or bandwidth')
    .option('--lock-period <days>', 'Lock period in days (0 = no lock)', '0')
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        validateNetworkOption(cmdOpts.network);
        validateAddress(cmdOpts.toAddress, 'recipient address');
        const resource = parseResource(cmdOpts.resource);
        const amountSun = trxToSun(cmdOpts.amount);
        const lockDays = Number(cmdOpts.lockPeriod);
        if (isNaN(lockDays) || lockDays < 0) {
          throw new Error(`Invalid lock period: "${cmdOpts.lockPeriod}". Must be a non-negative number`);
        }
        const lock = lockDays > 0;
        const lockPeriod = Math.round(lockDays * 28800); // 1 day = 28800 blocks (3s per block)

        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network, true);
        const tronWeb = getTronWeb(network, opts.apiKey);
        const broadcast = !opts.localBroadcast;

        outputAction({
          Action: 'Delegate Resource',
          Network: network,
          From: address,
          To: cmdOpts.toAddress,
          Amount: `${cmdOpts.amount} TRX`,
          Resource: resource,
          LockPeriod: lock ? `${lockDays} days (${lockPeriod} blocks)` : 'None',
          Broadcast: broadcast ? 'Signer' : 'Local',
        });

        const spinner = createSpinner('Building transaction...');
        const [tx, accountResource] = await Promise.all([
          tronWeb.transactionBuilder.delegateResource(
            amountSun,
            cmdOpts.toAddress,
            resource,
            address,
            lock,
            lockPeriod,
          ),
          tronWeb.trx.getAccountResources(address),
        ]);

        // Estimate how much resource this TRX amount will provide
        const totalWeight = resource === 'ENERGY'
          ? accountResource.TotalEnergyWeight
          : accountResource.TotalNetWeight;
        const totalLimit = resource === 'ENERGY'
          ? accountResource.TotalEnergyLimit
          : accountResource.TotalNetLimit;
        const estimatedResource = totalWeight > 0
          ? Math.floor((amountSun / 1_000_000) / totalWeight * totalLimit)
          : 0;

        (tx as any).__options = resource === 'ENERGY'
          ? { estimatedEnergy: estimatedResource }
          : { estimatedBandwidth: estimatedResource };

        spinner.succeed(`Transaction built (estimated ${resource.toLowerCase()}: ${estimatedResource.toLocaleString()})`);
        const result = await signTransaction(signer, tx, network, broadcast);

        const txId = broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
        await confirmOnChain(waitForTxResult(tronWeb, txId));
        outputResult(
          {
            Status: 'Success',
            TxID: txId,
            From: address,
            To: cmdOpts.toAddress,
            Amount: `${cmdOpts.amount} TRX`,
            Resource: resource,
            LockPeriod: lock ? `${lockDays} days (${lockPeriod} blocks)` : 'None',
            Explorer: getExplorerTxUrl(network, txId),
          },
          'Delegate Result',
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
