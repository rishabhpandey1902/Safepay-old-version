
# SafePay

SafePay is a milestone-escrow prototype. **Do not use it to hold or send funds.**
The contract and web application are implemented in source, but the configured
SafePayEscrow and token have no bytecode on Monad Testnet, so no escrow lifecycle
transaction has been verified there.

## Audited feature and integration status

Status audited on 2026-10-07. **REAL** means the integration was exercised against
its actual endpoint; for an on-chain SafePay feature, that requires a successful
Monad Testnet transaction. A local contract test or an ABI wired into the UI is not
evidence that the feature works on testnet. **PREVIEW** means a UI/sample-data
presentation without its underlying operation. **PLANNED** means the end-to-end
service/deployment is not yet operational here; source code may exist.

| Feature / integration | Status | Verified behavior and boundary |
| --- | --- | --- |
| Monad Testnet RPC | REAL | A read-only request to the configured RPC returned chain ID `10143`. This verifies RPC connectivity only, not any SafePay contract operation. |
| SafePay escrow lifecycle (create, fund, submit, approve, timeout release, dispute, cancel) | PLANNED | Solidity source and local Foundry tests exist. The configured escrow address has no code; no lifecycle transaction is testnet-verified. |
| Guarded Monad lifecycle test script | PLANNED | Script supports a read-only preflight and explicit `--send` opt-in, but the preflight stops because the configured contracts have no code. No test transactions have been sent. |
| Settlement token metadata and decimal-aware amounts | PLANNED | Token metadata/startup validation and decimal-aware parsing are implemented, with six-decimal unit tests. The configured token address has no code, so testnet metadata/startup validation cannot pass. |
| Role-aware wallets (Hire / Privy, Offer services / Dynamic) | PLANNED | The UI binds each browser session to one provider and routes escrow operations through the shared wallet hook. Client transactions require a Privy embedded wallet; provider login, network switching, signing, and deployed escrow calls have not been verified against working contracts. |
| Privy embedded-wallet client signing | PLANNED | Client signing is restricted in code to Privy embedded wallets and the selected Monad Testnet chain. The integration and escrow transactions still need dashboard configuration and testnet verification. |
| Privy client wallet policy | PLANNED | The create page reads the wallet's actual assigned Privy policy and can attach the configured policy after user authorization. No policy ID or server Privy credentials are configured here, so no active policy is claimed. |
| Authenticated timeout-release relayer | PLANNED | A Privy-authenticated server route independently checks chain, code, token, agreement, submitted status, and elapsed approval deadline before calling only `releaseMilestone` from a dedicated app-owned Privy wallet. It is disabled until server credentials and a relayer wallet are configured; no release has been sent. |
| Agreement, dashboard, dispute, and resolver screens | PREVIEW | UI is present and wired to the SafePay ABI. Reads/actions requiring the undeployed escrow are not usable against the current addresses. |
| Marketplace demo browsing and hire prefill | PREVIEW | Six listings are marked demo data; the hire path only pre-fills the agreement draft. It does not create or fund an agreement. |
| Provider listing create/edit and local listing storage | PLANNED | SQLite API routes, Zod validation, and wallet-signature checks are implemented. Storage is local SQLite; a deployed durable service and successful signed create/edit round-trip have not been verified. |
| FX display conversion (INR, USD, EUR, GBP, AED) | REAL | The server-side Open ER API endpoint was smoke-tested for all five currencies. Rates are approximate display values only; they neither price nor move settlement funds. |
| Plain-language agreement draft | PLANNED | A server route and draft UI are implemented, but a successful live LLM call with configured credentials has not been verified. Draft output cannot submit transactions. |
| “Pay from another network” / NEAR Intents | PREVIEW | Static sample quote UI only. NEAR Intents' [official quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction) says there is no testnet. No quote, deposit address, bridge, or transaction is implemented. |
| Chainlink CRE timeout release | PLANNED | Workflow and receiver source exist, but neither is deployed or active. CRE CLI/tenant access and a live automated release have not been verified. It automates the timeout only; it does not verify work completion. |

### Current testnet deployment check

The read-only check on 2026-10-07 returned Monad Testnet chain ID `10143`.
`eth_getCode` returned `0x` for both configured addresses in `web/.env.local`:
the escrow and token. The actual addresses are intentionally not reproduced here.
Therefore, SafePay transactions, wallet-to-contract integration, and the testnet
lifecycle are **not live**. The deployment script deploys a test-only mintable
`ERC20Mock` and `SafePayEscrow`; it does not deploy a production payment token.

Contract source: [`../contracts/src/SafePayEscrow.sol`](../contracts/src/SafePayEscrow.sol).
Web chain configuration and ABI: [`lib/monad.ts`](lib/monad.ts) and
[`lib/contracts.ts`](lib/contracts.ts).
Local validation on this audit: all 12 Foundry tests and all 7 web unit tests passed.
These tests do not exercise a deployed testnet contract.

## Contract source notes

The local `SafePayEscrow` source has no owner withdrawal function. It fixes supported
tokens at deployment, validates agreement terms and caller roles, rejects
fee-on-transfer behavior through balance-delta checks, and implements one-time
milestone allocation, dispute resolution, cancellation, and permissionless timeout
release. These are properties of the **source contract**; they are not live at the
currently configured testnet addresses.

The deployment script uses an unrestricted-mint mock token for testing. **Do not use
it for real funds.** Foundry tests are local tests, not an independent security
audit, production-readiness assessment, or evidence of a testnet deployment.

## Setup

### Web app

Requirements: Node.js supported by Next.js 16, Corepack, and pnpm 10.

```bash
cd web
corepack pnpm install
cp .env.example .env.local
```

Edit `.env.local`:

```dotenv
NEXT_PUBLIC_PRIVY_APP_ID=<your Privy app ID>
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=<your Dynamic environment ID>
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS=<deployed SafePayEscrow address>
NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS=<token address supported by that escrow>
NEXT_PUBLIC_SAFE_PAY_RESOLVER_ADDRESS=<resolver address, different from both participants>
PRIVY_APP_SECRET=<server-only Privy app secret>
PRIVY_CLIENT_POLICY_ID=<policy created in the Privy Dashboard>
PRIVY_TIMEOUT_RELAYER_WALLET_ID=<dedicated app-owned Ethereum wallet ID>
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
OPENAI_API_KEY=<server-only key, optional for Describe in words>
OPENAI_MODEL=gpt-4o-mini
```

The app reads `NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS` as its settlement-token
configuration. Its token provider checks Monad testnet chain ID `10143`, checks for
bytecode, and reads `symbol()` and `decimals()` before enabling token metadata. The
Admin / token diagnostics panel displays that check's result. In this workspace the
configured token address currently has no code, so that runtime check does not pass.
Amount helpers use the token's decimals when metadata can be read; unit tests cover a
six-decimal token.

Wallet roles are selected on the landing page: **Hire** uses Privy and **Offer
services** uses Dynamic. The selected role is kept in browser `sessionStorage` and
cannot be changed until logout. All app escrow reads and writes use
[`useSafePayWallet`](./lib/wallet/useSafePayWallet.ts), which supplies the selected
signing client and the shared Monad Testnet read client. Client wallets request
Monad Testnet automatically; Dynamic network switching resolves the configured
Monad testnet entry and verifies the actual chain ID is `10143` before exposing
transactions.

For Privy, configure email login and the Monad Testnet chain in the Privy project.
Set `PRIVY_APP_SECRET` only in the server environment. Create a Privy Ethereum
policy in the Dashboard and assign its ID to `PRIVY_CLIENT_POLICY_ID`. The policy
must default-deny unmatched `eth_sendTransaction` requests, restrict `chain_id` to
`10143`, and permit only the configured SafePay escrow and settlement-token
addresses. For the token, allow only `approve` to the configured escrow and cap
the decoded `approve.amount`; for the escrow, allow only the required SafePay
methods and cap decoded `createAgreement.totalAmount`. Set that cap to
`1000 * 10^decimals` in the token's smallest units after reading `decimals()` from
the configured settlement token. Do not guess decimals or reuse an example token
address. Also allow only `createAgreement`, `fundAgreement`, `approveMilestone`,
`raiseDispute`, and `cancelAgreement` on the escrow, with decoded function-name
conditions and a cap on `createAgreement.totalAmount`.

Important limit: `fundAgreement` accepts only an agreement ID; the amount is read
from escrow state and is not in transaction calldata. Privy's calldata policy
cannot cap that value directly. The policy can cap the agreement at creation and
the ERC-20 approval, but a pre-existing over-limit draft or allowance must be
checked separately. Do not describe the policy as a strict per-funding-call cap.
Privy's Dashboard policy rules are the enforcement boundary; the Wallet
protection panel displays the policy actually reported by Privy, not an
app-authored approximation.

The protection panel's **Enable policy** action signs the specific policy
attachment request with the authenticated user's Privy authorization key. Confirm
the displayed contract addresses and actual policy rules before enabling it. The
existing auto-created embedded wallet is not protected until Privy confirms that
the policy ID is assigned.

For timeout releases, create a separate app-owned Ethereum wallet in Privy, fund
it with Monad Testnet gas, and set `PRIVY_TIMEOUT_RELAYER_WALLET_ID`. Do not use a
client wallet as the relayer. The server route accepts only an authenticated
Privy request and a pair of agreement/milestone IDs; it reads on-chain state,
requires an active agreement and submitted milestone whose approval deadline has
elapsed, then calls `releaseMilestone`. It never accepts arbitrary transaction
data and cannot call client-side funding, approval, dispute, or refund methods.
This is a timeout trigger only, not verification that work is complete. The route
is not enabled or verified on Monad Testnet in the current deployment.

For Dynamic, set the environment ID above, add the app origin to Allowed Origins,
enable EVM email OTP and WaaS wallet creation, and configure Monad Testnet in the
project networks as a testnet named with “Monad” and chain ID `10143`. If Dynamic
does not return that network or reports another chain ID, SafePay blocks wallet
transactions and shows the setup error. This client-side role choice is app
session state, not server-side authorization.

The integration follows the vendors' current guides:
[Privy React setup](https://docs.privy.io/basics/react/setup),
[Privy EVM network configuration](https://docs.privy.io/basics/react/advanced/configuring-evm-networks),
[Dynamic Next.js App Router](https://www.dynamic.xyz/docs/javascript/reference/nextjs-app-router),
[Dynamic React quickstart](https://www.dynamic.xyz/docs/javascript/reference/react-quickstart),
[Dynamic wallet management](https://www.dynamic.xyz/docs/javascript/building-ui/connected-wallets-management),
and [Dynamic network switching](https://www.dynamic.xyz/docs/javascript/building-ui/network-switching).

Never prefix the OpenAI key with `NEXT_PUBLIC_`, commit `.env.local`, or put private keys in the web app. Without the server key, the description endpoint returns a configuration error. Without deployed contract and token addresses, on-chain views and transactions cannot work.

Start and check the web app:

```bash
corepack pnpm dev
corepack pnpm lint
corepack pnpm exec tsc --noEmit
```

Open [http://localhost:3000](http://localhost:3000).

### Monad testnet escrow lifecycle script

The lifecycle script is read-only by default. It cannot proceed in the audited
environment because the configured escrow and token addresses have no code. No
lifecycle transaction was sent. It requires an explicitly supplied
`DEPLOYER_PRIVATE_KEY` and a valid deployment; only pass `--send` after reviewing a
successful preflight and deliberately authorizing test transactions. The six-decimal
unit tests can be run with `pnpm test:unit`.

### Freelance services marketplace

`/services` lists and filters offers; `/services/new` contains a Dynamic-wallet
signing flow for providers to publish listings; `/services/[id]` contains the
corresponding Dynamic-wallet owner-edit flow. Listing APIs validate data with Zod and persist it to local SQLite
at `web/data/services.sqlite` by default. Set `SAFEPAY_SERVICES_DB_PATH` for another
writable path. Six demo listings are seeded once and marked as sample data. This is
a local/off-chain prototype, not a hosted marketplace or an on-chain service.

“Hire with SafePay” opens a prefilled agreement draft. Listing prices are denominated
in USD for display only; the flow does not convert them to the escrow token, create an
agreement, or fund it. The client must enter settlement-token milestone values,
review, and use the existing explicit create/fund flow.

On `/services` and `/create`, users can select INR, USD, EUR, GBP, or AED for price
display. Approximate display rates are fetched server-side from the free
Open ER API, cached in SQLite for five minutes, and timestamped. If refresh fails, the
last cached rate is labeled stale; if no cached rate is available, non-USD conversion
is unavailable and agreement review is blocked until a rate can be shown or USD is
selected. This is approximate price conversion for display, not a live exchange
feature. Conversion does not change form settlement amounts. No agreement amount is
currently written to Monad Testnet from the configured deployment.

The `/create` page also shows a static “Pay from another network” quote-style
preview. NEAR Intents' official [1Click API quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction)
states that NEAR Intents has no testnet. The preview is explicitly marked “Preview
only — not live”; it uses sample values and does not call NEAR Intents, request a
quote or deposit address, bridge funds, or submit transactions.

Run the read-only preflight first; it checks chain ID, deployed bytecode, token
support, starting escrow balances, and deployer MON balance without sending
transactions. It currently stops because the configured contract addresses have no
code:

```bash
cd web
read -rsp "Testnet deployer private key: " DEPLOYER_PRIVATE_KEY
printf '\n'
export DEPLOYER_PRIVATE_KEY
pnpm e2e
```

Only after a successful preflight, and after deliberately deciding to send test
transactions, opt in explicitly:

```bash
pnpm e2e -- --send
unset DEPLOYER_PRIVATE_KEY
```

The script reports mined transactions with explorer links and token-balance
snapshots. It stops if addresses lack deployed code, the token is unsupported, or
the escrow has an outstanding balance or liability. It does not deploy or modify
contracts.

### Local contract tests

```bash
cd contracts
forge test
```

### Monad testnet deployment

The deployment script requires Foundry, testnet gas, and environment variables `PRIVATE_KEY`, `RPC_URL`, and `RESOLVER_ADDRESS`. Keep the private key outside source control and the web app.

```bash
cd contracts
forge test
forge script script/Deploy.s.sol:DeploySafePay --rpc-url "$RPC_URL" --broadcast
```

The script checks for Monad Testnet chain ID `10143` and prints the mock token and
escrow addresses. After deployment, update the app's configured addresses. The mock
token's public `mint` function is for test use only; it is not a production payment
token.

## Remaining work

- Deploy a supported token and SafePayEscrow to Monad Testnet, configure their
  addresses, and run the guarded lifecycle script before describing escrow actions
  as testnet-working.
- Configure and exercise Privy against that deployment.
- Choose and deploy persistent marketplace storage before treating listings as
  hosted marketplace data; the current SQLite setup requires a writable persistent
  volume.
- Configure and verify the optional LLM provider.
- Deploy the CRE receiver and workflow, then verify tenant access and timeout
  execution. CRE automates only elapsed approval time; it does not verify work.
- NEAR Intents has no documented testnet; its current UI remains a static preview.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
