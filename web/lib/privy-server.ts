import "server-only";

import { PrivyClient } from "@privy-io/node";

const getAppId = () => process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function createPrivyServerClient() {
  const appId = getAppId();
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Set PRIVY_APP_SECRET and PRIVY_APP_ID (or NEXT_PUBLIC_PRIVY_APP_ID) on the server.");
  }
  return new PrivyClient({ appId, appSecret });
}

export async function verifyPrivyRequest(request: Request, privy: PrivyClient) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  try {
    const claims = await privy.utils().auth().verifyAccessToken(token);
    const appId = getAppId();
    if (!appId || claims.app_id !== appId || claims.issuer !== "privy.io") return null;
    return claims;
  } catch {
    return null;
  }
}
