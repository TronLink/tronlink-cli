import { TronWeb } from 'tronweb';
import { NETWORKS, type TronNetwork } from './types.js';

let tronWebInstance: InstanceType<typeof TronWeb> | null = null;
let currentNetwork: TronNetwork | null = null;
let currentApiKey: string | undefined = undefined;

export function getTronWeb(network: TronNetwork, apiKey?: string): InstanceType<typeof TronWeb> {
  const key = apiKey || process.env.TRON_API_KEY;
  if (tronWebInstance && currentNetwork === network && currentApiKey === key) {
    return tronWebInstance;
  }
  const config = NETWORKS[network];
  tronWebInstance = new TronWeb({
    fullHost: config.fullHost,
    headers: key ? { 'TRON-PRO-API-KEY': key } : undefined,
  });
  currentNetwork = network;
  currentApiKey = key;
  return tronWebInstance;
}

export function sunToTrx(sun: number): string {
  return (sun / 1_000_000).toString();
}

/**
 * Validate TRON address using TronWeb.isAddress() for full checksum verification.
 */
export function validateAddress(address: string, label = 'address'): void {
  if (!TronWeb.isAddress(address)) {
    throw new Error(`Invalid TRON ${label}: "${address}"`);
  }
}

export function validateTokenId(value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid tokenId: "${value}". Must be a non-negative integer`);
  }
}

/**
 * Convert TRX string to sun using string-based math to avoid floating point loss.
 * TRX has 6 decimal places (1 TRX = 1,000,000 sun).
 */
export function trxToSun(trx: string, label = 'TRX amount'): number {
  // Validate input format
  if (!/^\d+(\.\d+)?$/.test(trx)) {
    throw new Error(`Invalid ${label}: "${trx}". Must be a non-negative number`);
  }
  const raw = parseAmount(trx, 6);
  const val = Number(raw);
  if (val <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  if (!Number.isSafeInteger(val)) {
    throw new Error(`${label} too large: "${trx}"`);
  }
  return val;
}

/**
 * Broadcast a signed transaction and verify the result.
 * Throws if the broadcast was rejected by the network.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function broadcastTx(tronWeb: InstanceType<typeof TronWeb>, signedTx: any): Promise<string> {
  const result = await tronWeb.trx.sendRawTransaction(signedTx);
  // TronWeb returns { result: true, txid } on success
  // or { result: false, code: '...', message: '...' } on failure
  if (result.result === false || result.code) {
    const reason = result.message
      ? Buffer.from(result.message, 'hex').toString('utf-8')
      : result.code || 'Unknown error';
    throw new Error(`Transaction broadcast failed: ${reason}`);
  }
  const txId = result.txid || result.transaction?.txID;
  if (!txId) {
    throw new Error('Transaction broadcast succeeded but no transaction ID was returned');
  }
  return txId;
}

/**
 * Poll getTransactionInfo until the tx is confirmed on-chain, then inspect the result.
 * Throws on OUT_OF_ENERGY / REVERT / FAILED / timeout so callers can report real failure.
 */
export async function waitForTxResult(
  tronWeb: InstanceType<typeof TronWeb>,
  txId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  const toStr = (hex?: string): string => hex ? Buffer.from(hex, 'hex').toString('utf-8') : '';
  while (Date.now() - start < timeoutMs) {
    // Use unconfirmed endpoint (fullnode /wallet/gettransactioninfobyid).
    // Returns receipt as soon as the tx is packed into a block (~3s),
    // instead of waiting for 19 SR confirmations on the solidity node.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = await tronWeb.trx.getUnconfirmedTransactionInfo(txId) as any;
    if (info && (info.id || info.blockNumber)) {
      // Contract calls: receipt.result must be SUCCESS (OUT_OF_ENERGY/REVERT/... = failure)
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') {
        const msg = toStr(info.resMessage);
        throw new Error(`On-chain execution failed: ${info.receipt.result}${msg ? ` — ${msg}` : ''} (txId: ${txId})`);
      }
      // Native tx: top-level result === 'FAILED' on failure, absent on success
      if (info.result === 'FAILED') {
        const msg = toStr(info.resMessage) || 'unknown';
        throw new Error(`Transaction failed on-chain: ${msg} (txId: ${txId})`);
      }
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Transaction not confirmed within ${timeoutMs / 1000}s: ${txId}`);
}

/**
 * Parse a decimal string amount to raw integer string, avoiding floating point precision loss.
 * e.g. parseAmount("1.234567", 6) => "1234567"
 */
/**
 * Fetch TRC20 token decimals by calling the contract's decimals() method.
 * First verifies the contract exists on the current network.
 * Uses triggerConstantContract with explicit callerAddress to avoid
 * dependency on tronWeb.defaultAddress.
 */
export async function fetchTrc20Decimals(
  tronWeb: InstanceType<typeof TronWeb>,
  contractAddress: string,
  callerAddress: string,
  network: TronNetwork,
): Promise<number> {
  // Verify contract exists on this network (proxy contracts may lack bytecode, so check contract_address)
  const contractInfo = await tronWeb.trx.getContract(contractAddress);
  if (!contractInfo || (!contractInfo.bytecode && !contractInfo.contract_address)) {
    throw new ContractNotFoundError(contractAddress, network);
  }

  const { constant_result } = await tronWeb.transactionBuilder.triggerConstantContract(
    contractAddress,
    'decimals()',
    {},
    [],
    callerAddress,
  );
  const hex = constant_result?.[0];
  if (!hex) {
    throw new Error('Empty result from decimals() call');
  }
  const decimals = parseInt(hex, 16);
  if (isNaN(decimals) || decimals < 0) {
    throw new Error('Invalid decimals value');
  }
  return decimals;
}

export class ContractNotFoundError extends Error {
  constructor(address: string, network: TronNetwork) {
    super(`Contract "${address}" not found on ${network}. Check the contract address and --network option`);
  }
}

/**
 * Fetch TRC10 token decimals (precision) from chain.
 */
export async function fetchTrc10Decimals(tronWeb: InstanceType<typeof TronWeb>, tokenId: string, network: TronNetwork): Promise<{ decimals: number; name?: string }> {
  const tokenInfo = await tronWeb.trx.getTokenByID(tokenId);
  if (!tokenInfo || tokenInfo.precision === undefined) {
    throw new TokenNotFoundError(tokenId, network);
  }
  return { decimals: tokenInfo.precision, name: tokenInfo.name };
}

export class TokenNotFoundError extends Error {
  constructor(tokenId: string, network: TronNetwork) {
    super(`TRC10 token "${tokenId}" not found on ${network}. Check the token ID and --network option`);
  }
}

export function parseAmount(amount: string, decimals: number): string {
  // Validate: must be a non-negative number with at most one decimal point
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid amount: "${amount}". Must be a non-negative number (e.g. 1.5, 100)`);
  }

  const parts = amount.split('.');
  const whole = parts[0];
  let frac = parts[1] || '';

  if (frac.length > decimals) {
    throw new Error(`Amount "${amount}" exceeds ${decimals} decimal places`);
  } else {
    frac = frac.padEnd(decimals, '0');
  }

  const raw = (whole + frac).replace(/^0+/, '') || '0';
  return raw;
}
