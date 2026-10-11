import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

import { createPrivyServerClient, verifyPrivyRequest } from "@/lib/privy-server";

export const runtime = "nodejs";

type EmbeddedAccount = {
  id: string | null;
  address: string;
  chain_type: string;
  type: string;
  wallet_client_type?: string;
};

async function loadWalletProtection(request: Request, address: string) {
  const privy = createPrivyServerClient();
  const claims = await verifyPrivyRequest(request, privy);
  if (!claims) return { error: NextResponse.json({ error: "A valid Privy access token is required." }, { status: 401 }) };

  const user = await privy.users()._get(claims.user_id);
  const account = user.linked_accounts.find((linkedAccount) =>
    linkedAccount.type === "wallet" &&
    linkedAccount.chain_type === "ethereum" &&
    (linkedAccount as EmbeddedAccount).wallet_client_type === "privy" &&
    linkedAccount.address.toLowerCase() === address.toLowerCase(),
  ) as EmbeddedAccount | undefined;
  if (!account) {
    return { error: NextResponse.json({ error: "The requested address is not this user's Privy embedded wallet." }, { status: 403 }) };
  }

  const wallet = account.id
    ? await privy.wallets().get(account.id)
    : await privy.wallets().getWalletByAddress({ address: getAddress(address) });
  const configuredPolicyId = process.env.PRIVY_CLIENT_POLICY_ID;
  if (!configuredPolicyId) {
    return {
      data: {
        configured: false,
        assigned: false,
        message: "Create the client policy in the Privy Dashboard and set PRIVY_CLIENT_POLICY_ID.",
      },
    };
  }

  const policy = await privy.policies().get(configuredPolicyId);
  const assigned = wallet.policy_ids.includes(configuredPolicyId);
  return {
    data: {
      configured: true,
      assigned,
      expectedPolicyId: configuredPolicyId,
      policy: {
        id: policy.id,
        name: policy.name,
        chainType: policy.chain_type,
        rules: policy.rules.map((rule) => ({
          name: rule.name,
          method: rule.method,
          action: rule.action,
          conditions: rule.conditions.map((condition) => ({
            field_source: condition.field_source,
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
          })),
        })),
      },
    },
  };
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  }
  try {
    const result = await loadWalletProtection(request, getAddress(address));
    if (result.error) return result.error;
    return NextResponse.json(result.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read Privy wallet policy data." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const rawBody: unknown = await request.json().catch(() => null);
  const parsedBody = z.object({
    address: z.string().refine(isAddress),
    authorizationSignature: z.string().min(1),
    requestExpiry: z.string().regex(/^\d+$/),
  }).safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid wallet policy authorization request." }, { status: 400 });
  }
  const body = parsedBody.data;

  const expiry = Number(body.requestExpiry);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + 2 * 60_000) {
    return NextResponse.json({ error: "The wallet policy authorization has expired or is outside the allowed window." }, { status: 400 });
  }
  const normalizedAddress = getAddress(body.address);

  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const policyId = process.env.PRIVY_CLIENT_POLICY_ID;
  if (!appId || !appSecret || !policyId) {
    return NextResponse.json(
      { error: "Set the server-side Privy app secret and client policy ID before enabling wallet protection." },
      { status: 503 },
    );
  }

  let walletId: string;
  try {
    const privy = createPrivyServerClient();
    const claims = await verifyPrivyRequest(request, privy);
    if (!claims) return NextResponse.json({ error: "A valid Privy access token is required." }, { status: 401 });

    const user = await privy.users()._get(claims.user_id);
    const embeddedAccount = user.linked_accounts.find((linkedAccount) =>
      linkedAccount.type === "wallet" &&
      linkedAccount.chain_type === "ethereum" &&
      (linkedAccount as EmbeddedAccount).wallet_client_type === "privy" &&
      linkedAccount.address.toLowerCase() === normalizedAddress.toLowerCase(),
    ) as EmbeddedAccount | undefined;
    if (!embeddedAccount) {
      return NextResponse.json({ error: "The requested address is not this user's Privy embedded wallet." }, { status: 403 });
    }
    walletId = embeddedAccount.id
      ? embeddedAccount.id
      : (await privy.wallets().getWalletByAddress({ address: normalizedAddress })).id;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to validate the Privy wallet." },
      { status: 503 },
    );
  }

  const url = `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "privy-app-id": appId,
      "privy-authorization-signature": body.authorizationSignature,
      "privy-request-expiry": body.requestExpiry,
    },
    body: JSON.stringify({ policy_ids: [policyId] }),
    cache: "no-store",
  });
  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = responseBody as { error?: string; message?: string } | null;
    return NextResponse.json(
      { error: apiError?.message ?? apiError?.error ?? `Privy rejected the wallet policy update (${response.status}).` },
      { status: 502 },
    );
  }

  const result = await loadWalletProtection(
    new Request(request.url, { headers: request.headers }),
    normalizedAddress,
  );
  if (result.error) return result.error;
  return NextResponse.json(result.data);
}
