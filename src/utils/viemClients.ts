import { createPublicClient, http, PublicClient, Chain } from 'viem';
import { 
  mainnet, 
  optimism, 
  gnosis, 
  polygon, 
  fantom, 
  base, 
  arbitrum 
} from 'viem/chains';
import { defineChain } from 'viem';

// Define custom chains
const sonic = defineChain({
  id: 146,
  name: 'Sonic',
  nativeCurrency: {
    decimals: 18,
    name: 'Sonic',
    symbol: 'S',
  },
  rpcUrls: {
    default: { http: ['https://rpc.sonic.game'] },
  },
  blockExplorers: {
    default: { name: 'Sonic Explorer', url: 'https://sonicscan.org' },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

const katana = defineChain({
  id: 747474,
  name: 'Katana',
  nativeCurrency: {
    decimals: 18,
    name: 'Katana',
    symbol: 'KTN',
  },
  rpcUrls: {
    default: { http: ['https://rpc.katana.network'] },
  },
  blockExplorers: {
    default: { name: 'Katana Explorer', url: 'https://katana.network' },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});

// Chain mappings
const chains: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  100: gnosis,
  137: polygon,
  146: sonic,
  250: fantom,
  42161: arbitrum,
  747474: katana,
  8453: base,
};

// Client cache
const clients = new Map<number, PublicClient>();

/**
 * Get or create a public client for the specified chain
 * Clients are configured with multicall batching for optimal performance
 */
export function getPublicClient(chainId: number): PublicClient {
  if (!clients.has(chainId)) {
    const rpcUrl = process.env[`RPC_URI_FOR_${chainId}`];
    
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }

    const chain = chains[chainId];
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const client = createPublicClient({
      chain,
      transport: http(rpcUrl),
      batch: {
        multicall: {
          batchSize: 1024 * 1024, // 1MB batches
          wait: 0, // Send immediately
        },
      },
    });

    clients.set(chainId, client);
  }

  return clients.get(chainId)!;
}

/**
 * Clear all cached clients
 * Useful for testing or reinitializing with new RPC URLs
 */
export function clearClients(): void {
  clients.clear();
}

/**
 * Helper to batch multiple contract reads using multicall
 * This is a convenience wrapper around publicClient.multicall
 */
export async function batchReadContracts<T = any>(
  chainId: number,
  contracts: Array<{
    address: `0x${string}`;
    abi: any;
    functionName: string;
    args?: any[];
  }>
): Promise<Array<{ status: 'success' | 'failure'; result?: T; error?: Error }>> {
  const client = getPublicClient(chainId);
  
  // Use multicall with allowFailure to handle tokens that might not have certain methods
  const results = await client.multicall({
    contracts: contracts.map(c => ({
      ...c,
      args: c.args || [],
    })),
    allowFailure: true,
  });

  return results as Array<{ status: 'success' | 'failure'; result?: T; error?: Error }>;
}