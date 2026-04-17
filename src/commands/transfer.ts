import { Command } from 'commander';
import { getTronWeb, trxToSun, broadcastTx, parseAmount, validateAddress, validateTokenId, fetchTrc20Decimals, fetchTrc10Decimals, waitForTxResult, ContractNotFoundError, TokenNotFoundError } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, signTransaction, stopSigner } from '../lib/signer.js';
import { outputResult, outputAction, createSpinner, confirmOnChain } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { getExplorerTxUrl, validateNetworkOption, type TronNetwork } from '../lib/types.js';

type TransferType = 'trx' | 'trc10' | 'trc20' | 'trc721';

function parseTransferType(value: string): TransferType {
  const lower = value.toLowerCase();
  if (lower === 'trx' || lower === 'trc10' || lower === 'trc20' || lower === 'trc721') return lower;
  throw new Error(`Invalid transfer type: "${value}". Use trx, trc10, trc20, or trc721`);
}

function validateDecimals(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 77) {
    throw new Error(`Invalid decimals: "${value}". Must be a non-negative integer (0-77)`);
  }
  return n;
}

function validatePositiveNumber(amount: string, label: string): void {
  if (!/^\d+(\.\d+)?$/.test(amount) || /^0+(\.0*)?$/.test(amount)) {
    throw new Error(`Invalid ${label}: "${amount}". Must be a positive number`);
  }
}

function validateRequiredParams(type: TransferType, opts: Record<string, unknown>): void {
  const required: Record<TransferType, { params: string[]; labels: string[] }> = {
    trx: { params: ['toAddress', 'amount'], labels: ['--toAddress', '--amount'] },
    trc10: { params: ['toAddress', 'amount', 'tokenId'], labels: ['--toAddress', '--amount', '--tokenId'] },
    trc20: { params: ['toAddress', 'amount', 'contract'], labels: ['--toAddress', '--amount', '--contract'] },
    trc721: { params: ['toAddress', 'contract', 'tokenId'], labels: ['--toAddress', '--contract', '--tokenId'] },
  };

  const forbidden: Record<TransferType, { params: string[]; labels: string[] }> = {
    trx: { params: ['tokenId', 'contract', 'decimals', 'feeLimit'], labels: ['--tokenId', '--contract', '--decimals', '--fee-limit'] },
    trc10: { params: ['contract', 'feeLimit'], labels: ['--contract', '--fee-limit'] },
    trc20: { params: ['tokenId'], labels: ['--tokenId'] },
    trc721: { params: ['amount', 'decimals'], labels: ['--amount', '--decimals'] },
  };

  const req = required[type];
  for (let i = 0; i < req.params.length; i++) {
    if (opts[req.params[i]] === undefined || opts[req.params[i]] === null) {
      throw new Error(`${req.labels[i]} is required for ${type.toUpperCase()} transfer`);
    }
  }

  const forb = forbidden[type];
  for (let i = 0; i < forb.params.length; i++) {
    if (opts[forb.params[i]] !== undefined && opts[forb.params[i]] !== null) {
      throw new Error(`${forb.labels[i]} is not applicable for ${type.toUpperCase()} transfer`);
    }
  }
}

export function registerTransferCommand(program: Command): void {
  program
    .command('transfer')
    .description('Transfer TRX / TRC10 / TRC20 / TRC721 tokens')
    .requiredOption('--type <type>', 'Token type: trx, trc10, trc20, trc721')
    .option('--toAddress <address>', 'Recipient address')
    .option('--amount <amount>', 'Amount to transfer')
    .option('--contract <address>', 'Token contract address (TRC20/TRC721)')
    .option('--tokenId <id>', 'Token ID (TRC10 token ID or TRC721 NFT ID)')
    .option('--decimals <n>', 'Token decimals (auto-detected if omitted for TRC10/TRC20)')
    .option('--fee-limit <trx>', 'Fee limit in TRX for contract calls (TRC20/TRC721, default: 100)')
    .option('--network <name>', 'Network: mainnet, nile, shasta')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        const type = parseTransferType(cmdOpts.type);
        validateNetworkOption(cmdOpts.network);
        validateRequiredParams(type, cmdOpts);

        if (cmdOpts.toAddress) validateAddress(cmdOpts.toAddress, 'recipient address');
        if (cmdOpts.contract) validateAddress(cmdOpts.contract, 'contract address');
        if ((type === 'trc10' || type === 'trc721') && cmdOpts.tokenId) {
          validateTokenId(cmdOpts.tokenId);
        }
        if (type !== 'trc721') {
          validatePositiveNumber(cmdOpts.amount, 'amount');
        }

        // Pre-connect format checks — fail fast before wallet popup
        if (type === 'trx') {
          trxToSun(cmdOpts.amount); // validates 6-decimal precision
        }
        if ((type === 'trc10' || type === 'trc20') && cmdOpts.decimals !== undefined) {
          const d = validateDecimals(cmdOpts.decimals);
          parseAmount(cmdOpts.amount, d); // validates precision against user decimals
        }

        const feeLimitSun = cmdOpts.feeLimit ? trxToSun(cmdOpts.feeLimit, 'fee-limit') : 100_000_000;

        const signer = await initSigner(opts.port);
        const { address, network } = await getWalletAddress(signer, cmdOpts.network, true);
        const tronWeb = getTronWeb(network, opts.apiKey);
        const broadcast = !opts.localBroadcast;

        if (type === 'trx') {
          await transferTrx(tronWeb, signer, {
            address, network, broadcast, json: opts.json,
            to: cmdOpts.toAddress, amount: cmdOpts.amount,
          });
        } else if (type === 'trc10') {
          await transferTrc10(tronWeb, signer, {
            address, network, broadcast, json: opts.json,
            to: cmdOpts.toAddress, amount: cmdOpts.amount,
            tokenId: cmdOpts.tokenId, decimals: cmdOpts.decimals,
          });
        } else if (type === 'trc20') {
          await transferTrc20(tronWeb, signer, {
            address, network, broadcast, json: opts.json,
            to: cmdOpts.toAddress, amount: cmdOpts.amount,
            contract: cmdOpts.contract, decimals: cmdOpts.decimals,
            feeLimitSun,
          });
        } else {
          await transferTrc721(tronWeb, signer, {
            address, network, broadcast, json: opts.json,
            to: cmdOpts.toAddress, contract: cmdOpts.contract,
            tokenId: cmdOpts.tokenId,
            feeLimitSun,
          });
        }

        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function transferTrx(tronWeb: any, signer: any, ctx: {
  address: string; network: TronNetwork; broadcast: boolean; json: boolean;
  to: string; amount: string;
}) {
  validatePositiveNumber(ctx.amount, 'amount');
  const amountSun = trxToSun(ctx.amount);

  outputAction({
    Action: 'Transfer TRX',
    Network: ctx.network,
    From: ctx.address,
    To: ctx.to,
    Amount: `${ctx.amount} TRX`,
    Broadcast: ctx.broadcast ? 'Signer' : 'Local',
  });

  const spinner = createSpinner('Building transaction...');
  const tx = await tronWeb.transactionBuilder.sendTrx(ctx.to, amountSun, ctx.address);
  spinner.succeed('Transaction built');
  const result = await signTransaction(signer, tx, ctx.network, ctx.broadcast);

  const txId = ctx.broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
  await confirmOnChain(waitForTxResult(tronWeb, txId));
  outputResult(
    { Status: 'Success', TxID: txId, From: ctx.address, To: ctx.to, Amount: `${ctx.amount} TRX`, Explorer: getExplorerTxUrl(ctx.network, txId) },
    'Transfer Result',
    ctx.json,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function transferTrc10(tronWeb: any, signer: any, ctx: {
  address: string; network: TronNetwork; broadcast: boolean; json: boolean;
  to: string; amount: string; tokenId: string; decimals?: string;
}) {
  let decimals: number;
  if (ctx.decimals !== undefined) {
    decimals = validateDecimals(ctx.decimals);
  } else {
    const spinner = createSpinner('Fetching TRC10 token info...');
    try {
      const info = await fetchTrc10Decimals(tronWeb, ctx.tokenId, ctx.network);
      decimals = info.decimals;
      spinner.succeed(`Token decimals: ${decimals}`);
    } catch (err) {
      spinner.fail('Failed to fetch token info');
      if (err instanceof TokenNotFoundError) throw err;
      throw new Error(`Cannot auto-detect decimals for TRC10 token "${ctx.tokenId}". Use --decimals to specify manually`);
    }
  }

  const rawAmount = parseAmount(ctx.amount, decimals);
  const trc10Amount = Number(rawAmount);
  if (!Number.isSafeInteger(trc10Amount)) {
    throw new Error(`TRC10 amount too large: "${ctx.amount}"`);
  }

  outputAction({
    Action: 'Transfer TRC10',
    Network: ctx.network,
    From: ctx.address,
    To: ctx.to,
    Amount: ctx.amount,
    TokenID: ctx.tokenId,
    Decimals: String(decimals),
    Broadcast: ctx.broadcast ? 'Signer' : 'Local',
  });

  const spinner2 = createSpinner('Building transaction...');
  const tx = await tronWeb.transactionBuilder.sendToken(ctx.to, trc10Amount, ctx.tokenId, ctx.address);
  spinner2.succeed('Transaction built');
  const result = await signTransaction(signer, tx, ctx.network, ctx.broadcast);

  const txId = ctx.broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
  await confirmOnChain(waitForTxResult(tronWeb, txId));
  outputResult(
    { Status: 'Success', TxID: txId, From: ctx.address, To: ctx.to, Amount: ctx.amount, TokenID: ctx.tokenId, Explorer: getExplorerTxUrl(ctx.network, txId) },
    'TRC10 Transfer Result',
    ctx.json,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function transferTrc20(tronWeb: any, signer: any, ctx: {
  address: string; network: TronNetwork; broadcast: boolean; json: boolean;
  to: string; amount: string; contract: string; decimals?: string;
  feeLimitSun: number;
}) {
  let decimals: number;
  if (ctx.decimals !== undefined) {
    decimals = validateDecimals(ctx.decimals);
  } else {
    const spinner = createSpinner('Fetching TRC20 token decimals...');
    try {
      decimals = await fetchTrc20Decimals(tronWeb, ctx.contract, ctx.address, ctx.network);
      spinner.succeed(`Token decimals: ${decimals}`);
    } catch (err) {
      spinner.fail('Failed to fetch token decimals');
      if (err instanceof ContractNotFoundError) throw err;
      throw new Error(`Cannot auto-detect decimals for contract "${ctx.contract}" on ${ctx.network}. Use --decimals to specify manually`);
    }
  }

  const rawAmount = parseAmount(ctx.amount, decimals);

  outputAction({
    Action: 'Transfer TRC20',
    Network: ctx.network,
    From: ctx.address,
    To: ctx.to,
    Amount: ctx.amount,
    Contract: ctx.contract,
    Decimals: String(decimals),
    FeeLimit: `${ctx.feeLimitSun / 1_000_000} TRX`,
    Broadcast: ctx.broadcast ? 'Signer' : 'Local',
  });

  const spinner2 = createSpinner('Building transaction...');
  const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
    ctx.contract,
    'transfer(address,uint256)',
    { feeLimit: ctx.feeLimitSun },
    [
      { type: 'address', value: ctx.to },
      { type: 'uint256', value: rawAmount },
    ],
    ctx.address,
  );
  spinner2.succeed('Transaction built');
  const result = await signTransaction(signer, transaction, ctx.network, ctx.broadcast);

  const txId = ctx.broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
  await confirmOnChain(waitForTxResult(tronWeb, txId));
  outputResult(
    { Status: 'Success', TxID: txId, From: ctx.address, To: ctx.to, Amount: ctx.amount, Contract: ctx.contract, Explorer: getExplorerTxUrl(ctx.network, txId) },
    'TRC20 Transfer Result',
    ctx.json,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function transferTrc721(tronWeb: any, signer: any, ctx: {
  address: string; network: TronNetwork; broadcast: boolean; json: boolean;
  to: string; contract: string; tokenId: string;
  feeLimitSun: number;
}) {
  outputAction({
    Action: 'Transfer TRC721 NFT',
    Network: ctx.network,
    From: ctx.address,
    To: ctx.to,
    Contract: ctx.contract,
    TokenID: ctx.tokenId,
    FeeLimit: `${ctx.feeLimitSun / 1_000_000} TRX`,
    Broadcast: ctx.broadcast ? 'Signer' : 'Local',
  });

  const spinner = createSpinner('Building transaction...');
  const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
    ctx.contract,
    'transferFrom(address,address,uint256)',
    { feeLimit: ctx.feeLimitSun },
    [
      { type: 'address', value: ctx.address },
      { type: 'address', value: ctx.to },
      { type: 'uint256', value: ctx.tokenId },
    ],
    ctx.address,
  );
  spinner.succeed('Transaction built');
  const result = await signTransaction(signer, transaction, ctx.network, ctx.broadcast);

  const txId = ctx.broadcast ? result.txId! : await broadcastTx(tronWeb, result.signedTransaction);
  await confirmOnChain(waitForTxResult(tronWeb, txId));
  outputResult(
    { Status: 'Success', TxID: txId, From: ctx.address, To: ctx.to, Contract: ctx.contract, TokenID: ctx.tokenId, Explorer: getExplorerTxUrl(ctx.network, txId) },
    'TRC721 Transfer Result',
    ctx.json,
  );
}
