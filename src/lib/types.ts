export type TronNetwork = 'mainnet' | 'nile' | 'shasta';

export type ResourceType = 'ENERGY' | 'BANDWIDTH';

export interface NetworkConfig {
  name: TronNetwork;
  fullHost: string;
  explorerUrl: string;
}

export interface TransactionResult {
  status: 'success' | 'signed';
  txId?: string;
  from: string;
  explorerUrl?: string;
  signedTransaction?: Record<string, unknown>;
}

export interface CommandContext {
  address: string;
  network: TronNetwork;
  broadcast: boolean;
  json: boolean;
}

export const NETWORKS: Record<TronNetwork, NetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    fullHost: 'https://api.trongrid.io',
    explorerUrl: 'https://tronscan.org',
  },
  nile: {
    name: 'nile',
    fullHost: 'https://nile.trongrid.io',
    explorerUrl: 'https://nile.tronscan.org',
  },
  shasta: {
    name: 'shasta',
    fullHost: 'https://api.shasta.trongrid.io',
    explorerUrl: 'https://shasta.tronscan.org',
  },
};

export function validateNetworkOption(network?: string): TronNetwork | undefined {
  if (!network) return undefined;
  const lower = network.toLowerCase();
  if (lower === 'mainnet' || lower === 'nile' || lower === 'shasta') return lower;
  throw new Error(`Invalid network: "${network}". Use mainnet, nile, or shasta`);
}

export function getExplorerTxUrl(network: TronNetwork, txId: string): string {
  return `${NETWORKS[network].explorerUrl}/#/transaction/${txId}`;
}
