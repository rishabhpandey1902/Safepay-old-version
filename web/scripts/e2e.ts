import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEther,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { safePayEscrowAbi } from "../lib/contracts";

const RPC_URL = "https://testnet-rpc.monad.xyz";
const EXPECTED_CHAIN_ID = 10143;
const EXPLORER_URL = "https://testnet.monadexplorer.com";
const APPROVAL_WINDOW_SECONDS = BigInt(180);
const DISPUTE_WINDOW_SECONDS = BigInt(120);
const GAS_FUND_AMOUNT = parseEther("0.1");
const TEST_TOKEN_BUDGET = BigInt(1_000);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const chain = defineChain({
  id: EXPECTED_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Monad Explorer", url: EXPLORER_URL },
  },
  testnet: true,
});

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

const escrowErrorAbi = [
  { type: "error", name: "InvalidAddress", inputs: [] },
  { type: "error", name: "InvalidToken", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "UnsupportedToken", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidWindow", inputs: [] },
  { type: "error", name: "InvalidMilestoneCount", inputs: [] },
  {
    type: "error",
    name: "InvalidMilestoneDescription",
    inputs: [{ name: "milestoneIndex", type: "uint256" }],
  },
  {
    type: "error",
    name: "InvalidReferenceLength",
    inputs: [{ name: "length", type: "uint256" }],
  },
  {
    type: "error",
    name: "MilestoneTotalMismatch",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "actual", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "AgreementNotFound",
    inputs: [{ name: "agreementId", type: "uint256" }],
  },
  {
    type: "error",
    name: "MilestoneNotFound",
    inputs: [
      { name: "agreementId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
  },
  { type: "error", name: "Unauthorized", inputs: [{ name: "caller", type: "address" }] },
  {
    type: "error",
    name: "InvalidAgreementStatus",
    inputs: [{ name: "status", type: "uint8" }],
  },
  {
    type: "error",
    name: "InvalidMilestoneStatus",
    inputs: [{ name: "status", type: "uint8" }],
  },
  { type: "error", name: "EvidenceRequired", inputs: [] },
  { type: "error", name: "DisputeReasonRequired", inputs: [] },
  {
    type: "error",
    name: "ApprovalWindowNotElapsed",
    inputs: [{ name: "deadline", type: "uint256" }],
  },
  {
    type: "error",
    name: "DisputeWindowNotElapsed",
    inputs: [{ name: "deadline", type: "uint256" }],
  },
  {
    type: "error",
    name: "ApprovalWindowElapsed",
    inputs: [{ name: "deadline", type: "uint256" }],
  },
  {
    type: "error",
    name: "DisputeWindowElapsed",
    inputs: [{ name: "deadline", type: "uint256" }],
  },
  { type: "error", name: "InvalidResolutionAmount", inputs: [] },
  {
    type: "error",
    name: "OutstandingMilestone",
    inputs: [{ name: "milestoneIndex", type: "uint256" }],
  },
  {
    type: "error",
    name: "TransferAmountMismatch",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "received", type: "uint256" },
    ],
  },
] as const satisfies Abi;

const escrowAbi = [...safePayEscrowAbi, ...escrowErrorAbi] as const satisfies Abi;
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const rows: Array<{
  scenario: string;
  step: string;
  txHash: string;
  explorerLink: string;
  clientBefore: string;
  clientAfter: string;
  contractorBefore: string;
  contractorAfter: string;
  resolverBefore: string;
  resolverAfter: string;
  escrowBefore: string;
  escrowAfter: string;
  result: "PASS" | "FAIL";
}> = [];

type TestAccount = ReturnType<typeof privateKeyToAccount>;
type Snapshot = {
  client: bigint;
  contractor: bigint;
  resolver: bigint;
  escrow: bigint;
};
type SnapshotKey = keyof Snapshot;
type WalletRole = "client" | "contractor" | "resolver";

function isPrivateKey(value: string | undefined): value is Hex {
  return value !== undefined && /^0x[0-9a-fA-F]{64}$/.test(value);
}

let escrowAddress: Address;
let tokenAddress: Address;
let clientAccount: TestAccount;
let contractorAccount: TestAccount;
let resolverAccount: TestAccount;
let tokenDecimals: number;

function readAddressFromEnvFile(fileContents: string, name: string): Address {
  const line = fileContents.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  const value = line?.replace(/^(['"])(.*)\1$/, "$2");
  if (!value || !isAddress(value)) {
    throw new Error(`${name} is missing or is not a valid address in web/.env.local`);
  }

  const address = getAddress(value);
  if (address === ZERO_ADDRESS) {
    throw new Error(`${name} must not be the zero address`);
  }
  return address;
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secret = process.env.DEPLOYER_PRIVATE_KEY;
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function findRevertData(error: unknown, seen = new Set<object>()): Hex | undefined {
  if (typeof error === "string") {
    return /^0x[0-9a-fA-F]{8,}$/.test(error) ? (error as Hex) : undefined;
  }
  if (!error || typeof error !== "object" || seen.has(error)) return undefined;
  seen.add(error);

  const value = error as Record<string, unknown>;
  for (const key of ["data", "cause", "error", "details"]) {
    const result = findRevertData(value[key], seen);
    if (result) return result;
  }
  return undefined;
}

function isRevertError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /revert/i.test(message) || findRevertData(error) !== undefined;
}

function describeRevert(error: unknown): string {
  const data = findRevertData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: escrowErrorAbi, data });
      const args = decoded.args?.map(String).join(", ") ?? "";
      return `${decoded.errorName}(${args})`;
    } catch {
      // Fall through to the RPC client's readable error message.
    }
  }
  return formatError(error);
}

async function snapshotBalances(): Promise<Snapshot> {
  const [client, contractor, resolver] = await Promise.all([
    clientAccount,
    contractorAccount,
    resolverAccount,
  ].map(async (account) =>
    publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ));
  const escrowBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [escrowAddress],
  });
  return { client, contractor, resolver, escrow: escrowBalance };
}

function assertBalanceDeltas(
  before: Snapshot,
  after: Snapshot,
  deltas: Partial<Record<SnapshotKey, bigint>>,
  step: string,
): void {
  for (const key of Object.keys(before) as SnapshotKey[]) {
    const expected = before[key] + (deltas[key] ?? BigInt(0));
    if (after[key] !== expected) {
      throw new Error(
        `${step}: ${key} token balance mismatch; expected ${expected}, got ${after[key]}`,
      );
    }
  }
}

function recordRow(
  scenario: string,
  step: string,
  hash: Hash | undefined,
  before: Snapshot,
  after: Snapshot,
  result: "PASS" | "FAIL",
): void {
  rows.push({
    scenario,
    step,
    txHash: hash ?? "NOT SENT",
    explorerLink: hash ? `${EXPLORER_URL}/tx/${hash}` : "-",
    clientBefore: before.client.toString(),
    clientAfter: after.client.toString(),
    contractorBefore: before.contractor.toString(),
    contractorAfter: after.contractor.toString(),
    resolverBefore: before.resolver.toString(),
    resolverAfter: after.resolver.toString(),
    escrowBefore: before.escrow.toString(),
    escrowAfter: after.escrow.toString(),
    result,
  });
}

async function sendTransaction(
  account: TestAccount,
  to: Address,
  data?: Hex,
  value?: bigint,
): Promise<Hash> {
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });
  return walletClient.sendTransaction({
    account,
    to,
    ...(data ? { data } : {}),
    ...(value !== undefined ? { value } : {}),
  });
}

async function executeStep(
  scenario: string,
  step: string,
  account: TestAccount,
  to: Address,
  data: Hex | undefined,
  deltas: Partial<Record<SnapshotKey, bigint>> = {},
  value?: bigint,
): Promise<Hash> {
  const before = await snapshotBalances();
  let hash: Hash | undefined;
  let simulatedRevert: string | undefined;
  try {
    if (data) {
      try {
        await publicClient.call({ account: account.address, to, data, ...(value !== undefined ? { value } : {}) });
      } catch (error) {
        simulatedRevert = describeRevert(error);
      }
    }
    hash = await sendTransaction(account, to, data, value);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const after = await snapshotBalances();
    if (receipt.status !== "success") {
      throw new Error(
        `Transaction receipt status was ${receipt.status}${simulatedRevert ? `; simulated revert: ${simulatedRevert}` : ""}`,
      );
    }
    assertBalanceDeltas(before, after, deltas, step);
    recordRow(scenario, step, hash, before, after, "PASS");
    return hash;
  } catch (error) {
    const after = await snapshotBalances().catch(() => before);
    recordRow(scenario, step, hash, before, after, "FAIL");
    console.error(`${scenario} / ${step} failed: ${describeRevert(error)}`);
    throw error;
  }
}

async function expectRevertStep(
  scenario: string,
  step: string,
  account: TestAccount,
  to: Address,
  data: Hex,
): Promise<void> {
  const before = await snapshotBalances();
  let hash: Hash | undefined;
  try {
    let revertReason: string | undefined;
    try {
      await publicClient.call({ account: account.address, to, data });
    } catch (error) {
      if (!isRevertError(error)) {
        throw new Error(`Could not verify expected contract revert: ${formatError(error)}`);
      }
      revertReason = describeRevert(error);
    }
    if (!revertReason) {
      throw new Error("Preflight call did not revert; the negative check is not valid");
    }

    hash = await sendTransaction(account, to, data);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const after = await snapshotBalances();
    if (receipt.status !== "reverted") {
      throw new Error(`Expected a reverted receipt, received ${receipt.status}`);
    }
    assertBalanceDeltas(before, after, {}, step);
    console.log(`${scenario} / ${step} reverted as expected: ${revertReason}`);
    recordRow(scenario, `${step} (${revertReason})`, hash, before, after, "PASS");
  } catch (error) {
    const after = await snapshotBalances().catch(() => before);
    recordRow(scenario, step, hash, before, after, "FAIL");
    console.error(`${scenario} / ${step} failed: ${describeRevert(error)}`);
    throw error;
  }
}

function encodeTokenCall(
  functionName: "approve" | "mint" | "transfer",
  args: readonly [Address, bigint],
): Hex {
  return encodeFunctionData({ abi: tokenAbi, functionName, args });
}

async function createAgreement(
  scenario: string,
  amounts: bigint[],
  cancellationFee: bigint,
): Promise<{ agreementId: bigint; total: bigint }> {
  const total = amounts.reduce((sum, amount) => sum + amount, BigInt(0));
  const milestones = amounts.map((amount, index) => {
    const description = `${scenario} milestone ${index + 1}`;
    return {
      amount,
      descriptionHash: keccak256(stringToHex(description)),
      descriptionURI: `e2e://${scenario}/milestone-${index + 1}`,
    };
  });
  const countBefore = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "agreementCount",
  });
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "createAgreement",
    args: [
      contractorAccount.address,
      tokenAddress,
      resolverAccount.address,
      total,
      APPROVAL_WINDOW_SECONDS,
      DISPUTE_WINDOW_SECONDS,
      cancellationFee,
      milestones,
    ],
  });
  await executeStep(scenario, "create agreement", clientAccount, escrowAddress, data);
  const countAfter = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "agreementCount",
  });
  if (countAfter !== countBefore + BigInt(1)) {
    throw new Error(`${scenario}: agreement count did not increase by one`);
  }
  return { agreementId: countAfter, total };
}

async function fundAgreement(
  scenario: string,
  agreementId: bigint,
  total: bigint,
): Promise<void> {
  await executeStep(
    scenario,
    "approve escrow token allowance",
    clientAccount,
    tokenAddress,
    encodeTokenCall("approve", [escrowAddress, total]),
  );
  await executeStep(
    scenario,
    "fund agreement",
    clientAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "fundAgreement",
      args: [agreementId],
    }),
    { client: -total, escrow: total },
  );
}

async function submitMilestone(
  scenario: string,
  agreementId: bigint,
  index = BigInt(0),
): Promise<void> {
  await executeStep(
    scenario,
    `contractor submits milestone ${index + BigInt(1)}`,
    contractorAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "submitMilestone",
      args: [
        agreementId,
        index,
        keccak256(stringToHex(`${scenario} evidence ${index}`)),
        `e2e://${scenario}/evidence-${index}`,
      ],
    }),
  );
}

async function approveMilestone(
  scenario: string,
  agreementId: bigint,
  index: bigint,
  amount: bigint,
): Promise<void> {
  await executeStep(
    scenario,
    `client approves and releases milestone ${index + BigInt(1)}`,
    clientAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "approveMilestone",
      args: [agreementId, index],
    }),
    { contractor: amount, escrow: -amount },
  );
}

async function raiseDispute(scenario: string, agreementId: bigint): Promise<void> {
  await executeStep(
    scenario,
    "client raises dispute",
    clientAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "raiseDispute",
      args: [
        agreementId,
        BigInt(0),
        keccak256(stringToHex(`${scenario} dispute reason`)),
        `e2e://${scenario}/dispute`,
      ],
    }),
  );
}

async function resolveDispute(
  scenario: string,
  agreementId: bigint,
  resolution: 0 | 1 | 2,
  contractorAmount: bigint,
  milestoneAmount: bigint,
): Promise<void> {
  const contractorDelta =
    resolution === 0 ? milestoneAmount : resolution === 1 ? BigInt(0) : contractorAmount;
  const clientDelta =
    resolution === 0
      ? BigInt(0)
      : resolution === 1
        ? milestoneAmount
        : milestoneAmount - contractorAmount;
  await executeStep(
    scenario,
    `resolver resolves dispute (${["release", "refund", "split"][resolution]})`,
    resolverAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "resolveDispute",
      args: [agreementId, BigInt(0), resolution, contractorAmount],
    }),
    { client: clientDelta, contractor: contractorDelta, escrow: -milestoneAmount },
  );
}

async function waitForApprovalDeadline(agreementId: bigint): Promise<void> {
  const milestone = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getMilestone",
    args: [agreementId, BigInt(0)],
  });
  console.log(
    `Waiting until approval deadline ${milestone.approvalDeadline.toString()} for agreement ${agreementId}...`,
  );
  while (true) {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    if (block.timestamp >= milestone.approvalDeadline) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function releaseAfterTimeout(
  scenario: string,
  agreementId: bigint,
  amount: bigint,
): Promise<void> {
  await waitForApprovalDeadline(agreementId);
  await executeStep(
    scenario,
    "third wallet releases after approval deadline",
    resolverAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "releaseMilestone",
      args: [agreementId, BigInt(0)],
    }),
    { contractor: amount, escrow: -amount },
  );
}

async function cancelAgreement(
  scenario: string,
  agreementId: bigint,
  actor: WalletRole,
  remaining: bigint,
  contractorFee: bigint,
): Promise<void> {
  const clientRefund = remaining - contractorFee;
  await executeStep(
    scenario,
    `${actor} cancels agreement`,
    actor === "client" ? clientAccount : contractorAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "cancelAgreement",
      args: [agreementId],
    }),
    {
      client: clientRefund,
      contractor: contractorFee,
      escrow: -remaining,
    },
  );
}

async function assertFinishedAgreement(
  scenario: string,
  agreementId: bigint,
  expectedStatus: 2 | 3,
): Promise<void> {
  const agreement = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgreement",
    args: [agreementId],
  });
  if (
    agreement.remainingBalance !== BigInt(0) ||
    agreement.status !== expectedStatus
  ) {
    throw new Error(
      `${scenario}: agreement ${agreementId} has status ${agreement.status} and remaining balance ${agreement.remainingBalance}; expected status ${expectedStatus} and zero remaining balance`,
    );
  }
  const [escrowBalance, liability] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [escrowAddress],
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "totalLiability",
      args: [tokenAddress],
    }),
  ]);
  if (escrowBalance !== BigInt(0) || liability !== BigInt(0)) {
    throw new Error(
      `${scenario}: finished agreement left escrow balance ${escrowBalance} and liability ${liability}`,
    );
  }
}

async function readOnlyPreflight(): Promise<{
  deployer: TestAccount;
  deployerBalance: bigint;
}> {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  let envFile: string;
  try {
    envFile = readFileSync(envPath, "utf8");
  } catch {
    throw new Error(`Could not read ${envPath}`);
  }
  escrowAddress = readAddressFromEnvFile(
    envFile,
    "NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS",
  );
  tokenAddress = readAddressFromEnvFile(envFile, "NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS");

  const actualChainId = await publicClient.getChainId();
  console.log(`RPC chain ID: ${actualChainId}`);
  if (actualChainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Expected Monad testnet chain ID ${EXPECTED_CHAIN_ID}; got ${actualChainId}`);
  }

  const [escrowCode, tokenCode] = await Promise.all([
    publicClient.getBytecode({ address: escrowAddress }),
    publicClient.getBytecode({ address: tokenAddress }),
  ]);
  const escrowHasCode = Boolean(escrowCode && escrowCode !== "0x");
  const tokenHasCode = Boolean(tokenCode && tokenCode !== "0x");
  console.log(
    `Escrow ${escrowAddress}: ${escrowHasCode ? `code present (${(escrowCode!.length - 2) / 2} bytes)` : "NO CODE"}`,
  );
  console.log(
    `Token ${tokenAddress}: ${tokenHasCode ? `code present (${(tokenCode!.length - 2) / 2} bytes)` : "NO CODE"}`,
  );

  const key = process.env.DEPLOYER_PRIVATE_KEY;
  let deployer: TestAccount | undefined;
  let deployerBalance: bigint | undefined;
  if (isPrivateKey(key)) {
    deployer = privateKeyToAccount(key);
    deployerBalance = await publicClient.getBalance({ address: deployer.address });
    console.log(
      `Deployer ${deployer.address} MON balance: ${formatEther(deployerBalance)} MON`,
    );
  } else {
    console.log(
      `Deployer MON balance: NOT CHECKED (${key ? "DEPLOYER_PRIVATE_KEY has invalid format" : "DEPLOYER_PRIVATE_KEY is not set in the environment"})`,
    );
  }

  const failures: string[] = [];
  if (!escrowHasCode) failures.push("no contract code at ESCROW_ADDRESS");
  if (!tokenHasCode) failures.push("no contract code at TOKEN_ADDRESS");
  if (!deployer) failures.push("DEPLOYER_PRIVATE_KEY is unavailable or invalid");

  if (escrowHasCode && tokenHasCode) {
    const isSupported = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "supportedTokens",
      args: [tokenAddress],
    });
    console.log(`Escrow supports configured token: ${isSupported}`);
    if (!isSupported) failures.push("configured token is not supported by this escrow");

    const [balance, liability] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [escrowAddress],
      }),
      publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "totalLiability",
        args: [tokenAddress],
      }),
    ]);
    console.log(`Existing escrow token balance: ${balance}`);
    console.log(`Existing escrow token liability: ${liability}`);
    if (balance !== BigInt(0) || liability !== BigInt(0)) {
      failures.push("escrow has a nonzero starting token balance or liability");
    }
  }

  if (deployer && deployerBalance !== undefined) {
    const minimumBalance = GAS_FUND_AMOUNT * BigInt(3) + parseEther("0.02");
    console.log(`Required deployer balance for gas-funding wallets: ${formatEther(minimumBalance)} MON`);
    if (deployerBalance < minimumBalance) {
      failures.push("deployer MON balance is below the wallet-funding minimum");
    }
  }

  if (failures.length > 0) {
    throw new Error(`Read-only preflight failed: ${failures.join("; ")}`);
  }
  if (!deployer || deployerBalance === undefined) {
    throw new Error("Read-only preflight failed: deployer account is unavailable");
  }
  return { deployer, deployerBalance };
}

async function createFreshWallets(deployer: TestAccount): Promise<void> {
  clientAccount = privateKeyToAccount(generatePrivateKey());
  contractorAccount = privateKeyToAccount(generatePrivateKey());
  resolverAccount = privateKeyToAccount(generatePrivateKey());

  console.log(`Client: ${clientAccount.address}`);
  console.log(`Contractor: ${contractorAccount.address}`);
  console.log(`Resolver: ${resolverAccount.address}`);

  for (const [role, account] of [
    ["client", clientAccount],
    ["contractor", contractorAccount],
    ["resolver", resolverAccount],
  ] as const) {
    await executeStep(
      "setup",
      `funder sends ${formatEther(GAS_FUND_AMOUNT)} MON to ${role}`,
      deployer,
      account.address,
      undefined,
      {},
      GAS_FUND_AMOUNT,
    );
  }

  await executeStep(
    "setup",
    `mint ${TEST_TOKEN_BUDGET} mock tokens to client`,
    clientAccount,
    tokenAddress,
    encodeTokenCall("mint", [
      clientAccount.address,
      TEST_TOKEN_BUDGET * BigInt(10) ** BigInt(tokenDecimals),
    ]),
    { client: TEST_TOKEN_BUDGET * BigInt(10) ** BigInt(tokenDecimals) },
  );
}

async function runLifecycle(): Promise<void> {
  const oneToken = BigInt(10) ** BigInt(tokenDecimals);
  const cancellationFee = oneToken;

  const happyAmounts = [BigInt(2) * oneToken, BigInt(3) * oneToken, BigInt(5) * oneToken];
  const happy = await createAgreement("happy path", happyAmounts, BigInt(0));
  await fundAgreement("happy path", happy.agreementId, happy.total);
  for (let index = 0; index < happyAmounts.length; index += 1) {
    const milestoneIndex = BigInt(index);
    await submitMilestone("happy path", happy.agreementId, milestoneIndex);
    await approveMilestone(
      "happy path",
      happy.agreementId,
      milestoneIndex,
      happyAmounts[index]!,
    );
  }
  await assertFinishedAgreement("happy path", happy.agreementId, 3);

  const timeoutAmount = oneToken;
  const timeout = await createAgreement("timeout release", [timeoutAmount], BigInt(0));
  await fundAgreement("timeout release", timeout.agreementId, timeout.total);
  await submitMilestone("timeout release", timeout.agreementId);
  await releaseAfterTimeout("timeout release", timeout.agreementId, timeoutAmount);
  await assertFinishedAgreement("timeout release", timeout.agreementId, 3);

  const disputeCases = [
    { name: "dispute release", resolution: 0 as const, contractorAmount: BigInt(0) },
    { name: "dispute refund", resolution: 1 as const, contractorAmount: BigInt(0) },
    { name: "dispute split", resolution: 2 as const, contractorAmount: oneToken / BigInt(2) },
  ];
  for (const dispute of disputeCases) {
    const created = await createAgreement(dispute.name, [oneToken], BigInt(0));
    await fundAgreement(dispute.name, created.agreementId, created.total);
    await submitMilestone(dispute.name, created.agreementId);
    await raiseDispute(dispute.name, created.agreementId);
    await resolveDispute(
      dispute.name,
      created.agreementId,
      dispute.resolution,
      dispute.contractorAmount,
      oneToken,
    );
    await assertFinishedAgreement(dispute.name, created.agreementId, 3);
  }

  const cancellationCases = [
    { name: "client cancellation before work", actor: "client" as const, completed: false },
    { name: "contractor cancellation before work", actor: "contractor" as const, completed: false },
    { name: "client cancellation after milestone", actor: "client" as const, completed: true },
    { name: "contractor cancellation after milestone", actor: "contractor" as const, completed: true },
  ];
  for (const cancellation of cancellationCases) {
    const amounts = cancellation.completed
      ? [BigInt(2) * oneToken, BigInt(3) * oneToken]
      : [BigInt(4) * oneToken];
    const created = await createAgreement(
      cancellation.name,
      amounts,
      cancellationFee,
    );
    await fundAgreement(cancellation.name, created.agreementId, created.total);
    let remaining = created.total;
    if (cancellation.completed) {
      await submitMilestone(cancellation.name, created.agreementId, BigInt(0));
      await approveMilestone(
        cancellation.name,
        created.agreementId,
        BigInt(0),
        amounts[0]!,
      );
      remaining -= amounts[0]!;
    }
    const fee = cancellation.actor === "client"
      ? remaining < cancellationFee
        ? remaining
        : cancellationFee
      : BigInt(0);
    await cancelAgreement(
      cancellation.name,
      created.agreementId,
      cancellation.actor,
      remaining,
      fee,
    );
    await assertFinishedAgreement(cancellation.name, created.agreementId, 2);
  }

  const unauthorizedApprove = await createAgreement(
    "negative unauthorized approve",
    [oneToken],
    BigInt(0),
  );
  await fundAgreement(
    "negative unauthorized approve",
    unauthorizedApprove.agreementId,
    unauthorizedApprove.total,
  );
  await submitMilestone("negative unauthorized approve", unauthorizedApprove.agreementId);
  await expectRevertStep(
    "negative unauthorized approve",
    "contractor approval attempt",
    contractorAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "approveMilestone",
      args: [unauthorizedApprove.agreementId, BigInt(0)],
    }),
  );
  await approveMilestone(
    "negative unauthorized approve cleanup",
    unauthorizedApprove.agreementId,
    BigInt(0),
    oneToken,
  );
  await assertFinishedAgreement(
    "negative unauthorized approve",
    unauthorizedApprove.agreementId,
    3,
  );

  const unauthorizedResolve = await createAgreement(
    "negative unauthorized resolve",
    [oneToken],
    BigInt(0),
  );
  await fundAgreement(
    "negative unauthorized resolve",
    unauthorizedResolve.agreementId,
    unauthorizedResolve.total,
  );
  await submitMilestone("negative unauthorized resolve", unauthorizedResolve.agreementId);
  await raiseDispute("negative unauthorized resolve", unauthorizedResolve.agreementId);
  await expectRevertStep(
    "negative unauthorized resolve",
    "contractor resolution attempt",
    contractorAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "resolveDispute",
      args: [unauthorizedResolve.agreementId, BigInt(0), 0, BigInt(0)],
    }),
  );
  await resolveDispute(
    "negative unauthorized resolve cleanup",
    unauthorizedResolve.agreementId,
    0,
    BigInt(0),
    oneToken,
  );
  await assertFinishedAgreement(
    "negative unauthorized resolve",
    unauthorizedResolve.agreementId,
    3,
  );

  const doubleRelease = await createAgreement("negative double release", [oneToken], BigInt(0));
  await fundAgreement(
    "negative double release",
    doubleRelease.agreementId,
    doubleRelease.total,
  );
  await submitMilestone("negative double release", doubleRelease.agreementId);
  await releaseAfterTimeout(
    "negative double release",
    doubleRelease.agreementId,
    oneToken,
  );
  await expectRevertStep(
    "negative double release",
    "second release attempt",
    resolverAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "releaseMilestone",
      args: [doubleRelease.agreementId, BigInt(0)],
    }),
  );
  await assertFinishedAgreement("negative double release", doubleRelease.agreementId, 3);

  const lateApproval = await createAgreement("negative late approval", [oneToken], BigInt(0));
  await fundAgreement(
    "negative late approval",
    lateApproval.agreementId,
    lateApproval.total,
  );
  await submitMilestone("negative late approval", lateApproval.agreementId);
  await waitForApprovalDeadline(lateApproval.agreementId);
  await expectRevertStep(
    "negative late approval",
    "client approval after window",
    clientAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "approveMilestone",
      args: [lateApproval.agreementId, BigInt(0)],
    }),
  );
  await releaseAfterTimeout(
    "negative late approval cleanup",
    lateApproval.agreementId,
    oneToken,
  );
  await assertFinishedAgreement("negative late approval", lateApproval.agreementId, 3);

  const doubleFund = await createAgreement("negative funding twice", [oneToken], BigInt(0));
  await executeStep(
    "negative funding twice",
    "approve escrow token allowance",
    clientAccount,
    tokenAddress,
    encodeTokenCall("approve", [escrowAddress, doubleFund.total]),
  );
  await executeStep(
    "negative funding twice",
    "first funding",
    clientAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "fundAgreement",
      args: [doubleFund.agreementId],
    }),
    { client: -doubleFund.total, escrow: doubleFund.total },
  );
  await expectRevertStep(
    "negative funding twice",
    "second funding attempt",
    clientAccount,
    escrowAddress,
    encodeFunctionData({
      abi: escrowAbi,
      functionName: "fundAgreement",
      args: [doubleFund.agreementId],
    }),
  );
  await submitMilestone("negative funding twice cleanup", doubleFund.agreementId);
  await approveMilestone(
    "negative funding twice cleanup",
    doubleFund.agreementId,
    BigInt(0),
    oneToken,
  );
  await assertFinishedAgreement("negative funding twice", doubleFund.agreementId, 3);
}

async function main(): Promise<void> {
  const send = process.argv.includes("--send");
  const { deployer } = await readOnlyPreflight();
  if (!send) {
    console.log("Read-only preflight passed. No transactions were sent.");
    console.log("To execute the lifecycle test, rerun with: pnpm e2e -- --send");
    return;
  }

  tokenDecimals = Number(
    await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "decimals",
    }),
  );
  const initialEscrowBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [escrowAddress],
  });
  if (initialEscrowBalance !== BigInt(0)) {
    throw new Error("Escrow token balance is not zero; refusing to run");
  }

  await createFreshWallets(deployer);
  await runLifecycle();
  console.log("All SafePayEscrow lifecycle and negative checks passed.");
}

main()
  .catch((error: unknown) => {
    console.error(`E2E stopped: ${describeRevert(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (rows.length > 0) console.table(rows);
  });
