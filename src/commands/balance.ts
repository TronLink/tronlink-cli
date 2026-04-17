import { Command } from 'commander';
import { getTronWeb, sunToTrx, validateAddress, validateTokenId, fetchTrc20Decimals, fetchTrc10Decimals, ContractNotFoundError, TokenNotFoundError } from '../lib/tronweb.js';
import { initSigner, getWalletAddress, stopSigner } from '../lib/signer.js';
import { outputResult, createSpinner } from '../lib/output.js';
import { handleError } from '../lib/error.js';
import { validateNetworkOption, type TronNetwork } from '../lib/types.js';

interface TokenConfig {
  symbol: string;
  contract: string;
  decimals: number;
}

const TOKENS_BY_NETWORK: Record<TronNetwork, TokenConfig[]> = {
  mainnet: [
    { symbol: 'USDT', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
    { symbol: 'USDD', contract: 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz', decimals: 18 },
    { symbol: 'USDC', contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6 },

    { symbol: 'SUN', contract: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S', decimals: 18 },
    { symbol: 'JST', contract: 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9', decimals: 18 },
    { symbol: 'BTT', contract: 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4', decimals: 18 },
    { symbol: 'WIN', contract: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7', decimals: 6 },
    { symbol: 'WTRX', contract: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', decimals: 6 },
  ],
  nile: [
    { symbol: 'USDT', contract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', decimals: 6 },
  ],
  shasta: [],
};

function validateDecimals(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 77) {
    throw new Error(`Invalid decimals: "${value}". Must be a non-negative integer (0-77)`);
  }
  return n;
}

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Query address token balances')
    .option('--address <address>', 'Address to query (connects wallet if omitted)')
    .option('--token <contract>', 'Query a specific TRC20 token by contract address')
    .option('--tokenId <id>', 'Query a specific TRC10 token by token ID')
    .option('--decimals <n>', 'Token decimals (auto-detected if omitted)')
    .option('--network <name>', 'Network: mainnet, nile, shasta (default: mainnet when address provided)')
    .action(async (cmdOpts, cmd) => {
      const opts = cmd.optsWithGlobals();
      try {
        // Pre-connect format checks — fail fast before wallet popup
        if (cmdOpts.token && cmdOpts.tokenId) {
          throw new Error('Cannot use --token and --tokenId together. Use --token for TRC20, --tokenId for TRC10');
        }
        if (cmdOpts.tokenId) validateTokenId(cmdOpts.tokenId);
        if (cmdOpts.token) validateAddress(cmdOpts.token, 'token contract address');
        if (cmdOpts.decimals !== undefined) validateDecimals(cmdOpts.decimals);

        let targetAddress: string;
        let network: TronNetwork;

        if (cmdOpts.address) {
          // Address provided — query directly, no wallet connection
          validateAddress(cmdOpts.address, 'query address');
          validateNetworkOption(cmdOpts.network);
          targetAddress = cmdOpts.address;
          network = (cmdOpts.network?.toLowerCase() as TronNetwork) || 'mainnet';
        } else {
          // No address — connect wallet to get address and network
          const signer = await initSigner(opts.port);
          const wallet = await getWalletAddress(signer, cmdOpts.network, true);
          targetAddress = wallet.address;
          network = wallet.network;
        }

        const tronWeb = getTronWeb(network, opts.apiKey);

        // TRC10 single token query
        if (cmdOpts.tokenId) {
          validateTokenId(cmdOpts.tokenId);
          let decimals: number;
          if (cmdOpts.decimals !== undefined) {
            decimals = validateDecimals(cmdOpts.decimals);
          } else {
            const spinner = createSpinner('Fetching TRC10 token info...');
            try {
              const info = await fetchTrc10Decimals(tronWeb, cmdOpts.tokenId, network);
              decimals = info.decimals;
              spinner.succeed(`Token: ${info.name || cmdOpts.tokenId}, decimals: ${decimals}`);
            } catch (err) {
              spinner.fail('Failed to fetch token info');
              if (err instanceof TokenNotFoundError) throw err;
              throw new Error(`Cannot auto-detect decimals for TRC10 token "${cmdOpts.tokenId}". Use --decimals to specify manually`);
            }
          }

          const account = await tronWeb.trx.getAccount(targetAddress);
          const assetV2 = account.assetV2 || [];
          const asset = assetV2.find((a: { key: string; value: number }) => a.key === cmdOpts.tokenId);
          const rawAmount = asset ? BigInt(asset.value) : BigInt(0);
          const balance = formatBalance(rawAmount, decimals);

          outputResult(
            { Address: targetAddress, Network: network, TokenID: cmdOpts.tokenId, Balance: balance },
            'TRC10 Token Balance',
            opts.json,
          );
          await stopSigner();
          return;
        }

        // TRC20 single token query
        if (cmdOpts.token) {
          validateAddress(cmdOpts.token, 'token contract address');
          let decimals: number;
          if (cmdOpts.decimals !== undefined) {
            decimals = validateDecimals(cmdOpts.decimals);
          } else {
            const spinner = createSpinner('Fetching token decimals...');
            try {
              decimals = await fetchTrc20Decimals(tronWeb, cmdOpts.token, targetAddress, network);
              spinner.succeed(`Token decimals: ${decimals}`);
            } catch (err) {
              spinner.fail('Failed to fetch token decimals');
              if (err instanceof ContractNotFoundError) throw err;
              throw new Error(`Cannot auto-detect decimals for contract "${cmdOpts.token}" on ${network}. Use --decimals to specify manually`);
            }
          }

          const balance = await queryTrc20Balance(tronWeb, cmdOpts.token, targetAddress, decimals);
          outputResult(
            { Address: targetAddress, Network: network, Contract: cmdOpts.token, Balance: balance },
            'Token Balance',
            opts.json,
          );
          await stopSigner();
          return;
        }

        // Full balance query mode
        const balanceSun = await tronWeb.trx.getBalance(targetAddress);
        const trxBalance = sunToTrx(balanceSun);

        const balances: Record<string, string> = {
          Address: targetAddress,
          Network: network,
          TRX: trxBalance,
        };

        // Query TRC20 balances with rate limiting to avoid TronGrid throttling
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const tokens = TOKENS_BY_NETWORK[network];
        for (const token of tokens) {
          await delay(150);
          try {
            const balance = await queryTrc20Balance(tronWeb, token.contract, targetAddress, token.decimals);
            balances[token.symbol] = balance;
          } catch {
            balances[token.symbol] = 'query failed';
          }
        }

        outputResult(balances, 'Account Balances', opts.json);
        await stopSigner();
      } catch (err) {
        await stopSigner();
        handleError(err);
      }
    });
}

function formatBalance(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryTrc20Balance(tronWeb: any, contract: string, address: string, decimals: number): Promise<string> {
  const { constant_result } = await tronWeb.transactionBuilder.triggerConstantContract(
    contract,
    'balanceOf(address)',
    {},
    [{ type: 'address', value: address }],
    address,
  );
  const hex = constant_result?.[0];
  if (hex) {
    return formatBalance(BigInt('0x' + hex), decimals);
  }
  return '0';
}
