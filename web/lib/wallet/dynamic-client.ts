"use client";

import { createDynamicClient, initializeClient } from "@dynamic-labs-sdk/client";
import { addEvmExtension } from "@dynamic-labs-sdk/evm";

const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

export const dynamicClient = environmentId
  ? createDynamicClient({
      autoInitialize: false,
      environmentId,
      metadata: {
        name: "SafePay",
        universalLink: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      },
    })
  : null;

if (dynamicClient) {
  addEvmExtension();
  if (typeof window !== "undefined") void initializeClient();
}
