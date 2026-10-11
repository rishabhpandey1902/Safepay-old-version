# SafePay CRE timeout release

This workflow scans the configured SafePayEscrow on Monad Testnet every five minutes. For each Active agreement, it inspects its milestones and reports only milestones that are still Submitted and whose approval deadline has passed at the scheduled execution time. CRE writes a signed report through Chainlink's `KeystoneForwarder`; it does not submit a wallet-signed transaction directly.

`TimeoutReleaseReceiver` is a separate report receiver/adapter. It validates the configured forwarder, target chain selector, and report age, then re-reads the agreement and milestone on Monad before invoking the escrow's permissionless `releaseMilestone`. SafePayEscrow itself remains unchanged and enforces the actual deadline/status and fixed contractor payout. Disputed or otherwise ineligible milestones are not released.

This automates only the approval timeout. It does **not** evaluate evidence, verify delivered work, or claim that work is complete.

## Prerequisites

1. A Chainlink CRE account/tenant and CRE CLI v1.30.0 or newer, plus TypeScript SDK v1.19.0 or newer. Login and verify tenant access with `cre workflow supported-chains`; Monad support can be tenant-scoped.
2. A logged-in CRE account/tenant with deployment access (Chainlink approval may be required). This workflow selects the private registry, so workflow registration itself does not need a linked wallet or Ethereum Mainnet gas. Fund the separate receiver-contract deployer with testnet MON. Never put private keys in this directory.
3. A deployed SafePayEscrow on Monad Testnet (chain ID 10143), with the correct escrow address and verified code.
4. A deployed `TimeoutReleaseReceiver`, configured at construction with the Monad Testnet forwarder returned by `cre workflow supported-chains`, the escrow address, and Monad Testnet's CRE chain selector (`2183018362218727504`). Do not use a simulation mock forwarder for a deployed workflow.
5. The receiver address and escrow address in a local `config.staging.json` copied from `config.staging.example.json`. The zero-address examples are placeholders, not usable deployments.
6. The workflow's EVM RPC configured in `project.yaml` (Monad Testnet public RPC by default).

No change to SafePayEscrow is needed: `releaseMilestone(uint256,uint256)` is permissionless and checks the deadline plus Submitted/Active state itself. The receiver adapter is required because CRE EVM writes are delivered to an `IReceiver` by the forwarder.

## Local setup and verification

From this directory:

```sh
cp config.staging.example.json config.staging.json
# Edit config.staging.json with the deployed escrow and receiver addresses.
npm install
npm run typecheck
cre version
cre login
cre workflow supported-chains
cre workflow simulate . --non-interactive --trigger-index 0 --target staging-settings
```

Simulation is local and is not a deployed CRE execution. Onchain writes are dry-run by default; do not add `--broadcast` unless you deliberately intend to send a real transaction. Follow the current CLI deployment guidance only after inspecting the receiver deployment and simulation results. A deployed workflow may require Chainlink approval and tenant-enabled Monad.

## Operational notes

- The workflow scans agreement IDs from 1 through `agreementCount`, then reads each milestone for active agreements. The escrow limits each agreement to 50 milestones, but total scan cost grows with total agreements. For a large production deployment, add an event-indexed candidate store or a carefully designed bounded cursor before scaling this full scan.
- A run that observes an expired milestone submits one report per milestone. The receiver re-checks eligibility at execution time to handle disputes, approvals, or releases that race with the scheduled report.
- A release can still fail for ordinary on-chain reasons (for example, the settlement token rejects the transfer); CRE reports its transaction and receiver-execution status. The workflow does not silently treat a failed write as success.
