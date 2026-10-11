import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  isHash,
  type Address,
} from "viem";

import { safePayEscrowAbi } from "@/lib/contracts";
import { monadTestnet } from "@/lib/monad";
import { createPrivyServerClient, verifyPrivyRequest } from "@/lib/privy-server";

export const runtime = "nodejs";

const requestSchema = z.object({
  agreementId: z.number().int().positive(),
  milestoneIndex: z.number().int().nonnegative(),
});

const rpcUrl =
  process.env.MONAD_RPC_URL ??
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ??
  "https://testnet-rpc.monad.xyz";
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });

export async function POST(request: Request) {
  const privyAppId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const relayerWalletId = process.env.PRIVY_TIMEOUT_RELAYER_WALLET_ID;
  const escrowAddress = process.env.NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS;
  const tokenAddress = process.env.NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS;
  if (!privyAppId || !process.env.PRIVY_APP_SECRET || !relayerWalletId) {
    return NextResponse.json(
      { error: "Configure the Privy server app credentials and a dedicated timeout relayer wallet before enabling timeout releases." },
      { status: 503 },
    );
  }
  if (!escrowAddress || !isAddress(escrowAddress) || !tokenAddress || !isAddress(tokenAddress)) {
    return NextResponse.json({ error: "Configure valid SafePay escrow and settlement token addresses." }, { status: 503 });
  }

  const privy = createPrivyServerClient();
  const claims = await verifyPrivyRequest(request, privy);
  if (!claims) return NextResponse.json({ error: "A valid Privy access token is required." }, { status: 401 });

  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid timeout release request.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if (await publicClient.getChainId() !== 10143) {
      return NextResponse.json({ error: "The configured RPC is not connected to Monad Testnet (chain ID 10143)." }, { status: 503 });
    }
    const [escrowCode, tokenCode, relayer] = await Promise.all([
      publicClient.getBytecode({ address: escrowAddress }),
      publicClient.getBytecode({ address: tokenAddress }),
      privy.wallets().get(relayerWalletId),
    ]);
    if (!escrowCode || escrowCode === "0x" || !tokenCode || tokenCode === "0x") {
      return NextResponse.json({ error: "The configured escrow or settlement token has no deployed code." }, { status: 503 });
    }
    if (relayer.chain_type !== "ethereum" || relayer.owner_id !== null) {
      return NextResponse.json(
        { error: "The timeout relayer must be a Privy-managed Ethereum wallet without a user owner." },
        { status: 503 },
      );
    }

    const address = escrowAddress as Address;
    const token = tokenAddress as Address;
    const [supported, agreement, milestone, block] = await Promise.all([
      publicClient.readContract({
        address,
        abi: safePayEscrowAbi,
        functionName: "supportedTokens",
        args: [token],
      }),
      publicClient.readContract({
        address,
        abi: safePayEscrowAbi,
        functionName: "getAgreement",
        args: [BigInt(parsed.data.agreementId)],
      }),
      publicClient.readContract({
        address,
        abi: safePayEscrowAbi,
        functionName: "getMilestone",
        args: [BigInt(parsed.data.agreementId), BigInt(parsed.data.milestoneIndex)],
      }),
      publicClient.getBlock(),
    ]);
    if (!supported) {
      return NextResponse.json({ error: "The configured settlement token is not supported by this escrow." }, { status: 409 });
    }
    if (agreement.token.toLowerCase() !== token.toLowerCase()) {
      return NextResponse.json({ error: "The agreement uses a different settlement token." }, { status: 409 });
    }
    if (Number(agreement.status) !== 1 || Number(milestone.status) !== 1) {
      return NextResponse.json({ error: "Only active agreements with submitted, unreleased milestones can use timeout release." }, { status: 409 });
    }
    if (milestone.approvalDeadline > block.timestamp) {
      return NextResponse.json(
        { error: "The milestone approval window has not elapsed.", approvalDeadline: milestone.approvalDeadline.toString() },
        { status: 409 },
      );
    }

    const data = encodeFunctionData({
      abi: safePayEscrowAbi,
      functionName: "releaseMilestone",
      args: [BigInt(parsed.data.agreementId), BigInt(parsed.data.milestoneIndex)],
    });
    const sent = await privy.wallets().ethereum().sendTransaction(relayerWalletId, {
      caip2: "eip155:10143",
      params: {
        transaction: {
          to: address,
          value: "0x0",
          data,
          chain_id: 10143,
        },
      },
    });
    if (!isHash(sent.hash)) throw new Error("Privy returned an invalid transaction hash.");
    const receipt = await publicClient.waitForTransactionReceipt({ hash: sent.hash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Privy submitted the timeout release, but the transaction reverted.", transactionHash: sent.hash }, { status: 502 });
    }
    return NextResponse.json({ transactionHash: sent.hash, status: receipt.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to execute the permissionless timeout release." },
      { status: 502 },
    );
  }
}
