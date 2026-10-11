import {
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type PublicClient,
} from "viem";

import { monadTestnet } from "./monad";

export const erc20MetadataAbi = [
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

export type TokenMetadata = {
  address: Address;
  symbol: string;
  decimals: number;
};

export function getConfiguredTokenAddress(): Address {
  const configuredAddress = process.env.NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS?.trim();
  if (!configuredAddress || !isAddress(configuredAddress)) {
    throw new Error(
      "Set NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS to a valid ERC-20 address.",
    );
  }
  const address = getAddress(configuredAddress);
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new Error("NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS must not be the zero address.");
  }
  return address;
}

export async function readTokenMetadata(
  publicClient: PublicClient,
): Promise<TokenMetadata> {
  const address = getConfiguredTokenAddress();
  const chainId = await publicClient.getChainId();
  if (chainId !== monadTestnet.id) {
    throw new Error(
      `Token configuration requires Monad testnet (${monadTestnet.id}); RPC returned chain ID ${chainId}.`,
    );
  }

  const bytecode = await publicClient.getBytecode({ address });
  if (!bytecode || bytecode === "0x") {
    throw new Error(`No contract code exists at configured token address ${address}.`);
  }

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({
      address,
      abi: erc20MetadataAbi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address,
      abi: erc20MetadataAbi,
      functionName: "decimals",
    }),
  ]);

  if (!symbol.trim()) {
    throw new Error(`Token at ${address} returned an empty symbol.`);
  }

  return { address, symbol, decimals: Number(decimals) };
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`Token decimals must be an integer between 0 and 255; got ${decimals}.`);
  }
  const trimmedValue = value.trim();
  const match = /^-?\d+(?:\.(\d*))?$/.exec(trimmedValue);
  if (!match) {
    throw new Error(`Invalid token amount: ${value}`);
  }
  if ((match[1]?.length ?? 0) > decimals) {
    throw new Error(`Token amount has more than ${decimals} fractional digits.`);
  }
  return parseUnits(trimmedValue, decimals);
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

export function formatTokenDisplay(
  value: bigint,
  metadata: Pick<TokenMetadata, "symbol" | "decimals">,
): string {
  const amount = formatTokenAmount(value, metadata.decimals);
  const [integerPart, fractionalPart] = amount.split(".");
  const groupedInteger = integerPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${metadata.symbol} ${fractionalPart ? `${groupedInteger}.${fractionalPart}` : groupedInteger}`;
}
