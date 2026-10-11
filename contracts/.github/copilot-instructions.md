# SafePay Copilot Instructions

SafePay is a consumer programmable escrow app for the Monad hackathon's Consumer Products & Payments track. Build for safe, understandable payments; do not imply functionality or integrations that are not implemented and verified.

## Security and integrity

- Never fabricate blockchain transactions, transaction hashes, contract addresses, deployment status, chain data, or sponsor integrations. Show only values returned by a real configured provider or clearly labeled test/demo data.
- Never expose, commit, log, or hardcode private keys, seed phrases, or other secrets. Read secrets from environment variables; keep `.env` files out of version control and document required variable names in `.env.example` without values.
- Escrowed funds must not be withdrawable through an admin or owner function. Do not add hidden owner backdoors, privileged bypasses, or alternate paths that can move locked escrow funds.
- Use OpenZeppelin `ReentrancyGuard` on external fund-moving flows and `SafeERC20` for ERC-20 transfers.
- Follow checks-effects-interactions for external calls. Prefer custom errors over revert strings.
- Add NatSpec to public and external Solidity interfaces. Emit an event for every successful state change, including creation, funding, milestone updates/releases, dispute actions, and resolution.
- Validate that milestone amounts are valid and their total matches the escrow amount. Ensure each milestone can be released at most once. Disputed funds stay locked until an explicitly authorized resolution; ordinary release and withdrawal paths must not bypass the dispute.
- AI may suggest or draft payment rules for a user's review, but must never authorize, sign, submit, or execute a transaction or move funds.

## Product and frontend

- Present amounts in rupees and explain actions in plain language. Avoid crypto jargon in user-facing UI; explain necessary payment status in familiar terms.
- Use TypeScript strict mode and small, reusable components. Preserve strict typing instead of using `any` or suppressing type errors to bypass them.
- Clearly label all mocked, simulated, placeholder, or demo-only data and functionality wherever users encounter it. Never present a mock as a live transaction, real escrow, verified address, or working integration.

## Project-specific checks

- The current `Counter` contract is Foundry starter scaffold, not an escrow implementation. Do not describe it or its behavior as SafePay escrow functionality.
- Before adding or changing contract flows, add or update Foundry tests for authorization, amount and milestone validation, one-time release, disputed-fund locking, and reentrancy-sensitive transfers as applicable.
- Keep sponsor and Monad integration claims limited to integrations present in the code and verified against the relevant network or official documentation.