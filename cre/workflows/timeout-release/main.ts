import {
  CronCapability,
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
  type CronPayload,
  type Runtime,
} from "@chainlink/cre-sdk";
import { EVM_PB } from "@chainlink/cre-sdk/pb";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Address,
} from "viem";
import { z } from "zod";

const configSchema = z.object({
  chainSelectorName: z.literal("monad-testnet"),
  escrowAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  receiverAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  gasLimit: z.string().regex(/^[1-9][0-9]*$/),
});

type Config = z.infer<typeof configSchema>;

const escrowAbi = parseAbi([
  "function agreementCount() view returns (uint256)",
  "function getAgreement(uint256 agreementId) view returns ((address client, address contractor, address token, address resolver, uint256 totalAmount, uint256 remainingBalance, uint256 approvalWindow, uint256 disputeWindow, uint256 clientCancellationFee, uint256 createdAt, uint256 fundedAt, uint8 status, uint256 milestoneCount) details)",
  "function getMilestone(uint256 agreementId, uint256 milestoneIndex) view returns ((uint256 amount, bytes32 descriptionHash, string descriptionURI, uint8 status, bytes32 evidenceHash, string evidenceURI, uint256 submittedAt, uint256 approvalDeadline, uint256 disputeDeadline, address disputeRaisedBy, bytes32 disputeReasonHash, string disputeReasonURI, uint256 contractorPayout, uint256 clientRefund))",
]);

const receiverAbi = parseAbi([
  "function onReport(bytes metadata, bytes report)",
]);

const reportParameters = parseAbiParameters(
  "uint256 chainSelector, uint256 scheduledExecutionTime, uint256 agreementId, uint256 milestoneIndex",
);

const AGREEMENT_ACTIVE = 1;
const MILESTONE_SUBMITTED = 1;

const onCronTrigger = (
  runtime: Runtime<Config>,
  payload: CronPayload,
): string => {
  const config = configSchema.parse(runtime.config);
  const scheduledExecutionTime = payload.scheduledExecutionTime?.seconds;
  if (scheduledExecutionTime === undefined) {
    throw new Error("Cron payload did not include scheduledExecutionTime.");
  }

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
  });
  if (!network) {
    throw new Error(`CRE does not recognize chain ${config.chainSelectorName}.`);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);
  const escrowAddress = config.escrowAddress as Address;
  const receiverAddress = config.receiverAddress as Address;
  const countCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: "0x0000000000000000000000000000000000000000",
        to: escrowAddress,
        data: encodeFunctionData({
          abi: escrowAbi,
          functionName: "agreementCount",
          args: [],
        }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  const agreementCount = decodeFunctionResult({
    abi: escrowAbi,
    functionName: "agreementCount",
    data: bytesToHex(countCall.data),
  });

  let submittedReports = 0;
  for (let agreementId = 1n; agreementId <= agreementCount; agreementId += 1n) {
    const agreementCall = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: "0x0000000000000000000000000000000000000000",
          to: escrowAddress,
          data: encodeFunctionData({
            abi: escrowAbi,
            functionName: "getAgreement",
            args: [agreementId],
          }),
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();
    const agreement = decodeFunctionResult({
      abi: escrowAbi,
      functionName: "getAgreement",
      data: bytesToHex(agreementCall.data),
    });

    if (agreement.status !== AGREEMENT_ACTIVE) continue;

    for (
      let milestoneIndex = 0n;
      milestoneIndex < agreement.milestoneCount;
      milestoneIndex += 1n
    ) {
      const milestoneCall = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: "0x0000000000000000000000000000000000000000",
            to: escrowAddress,
            data: encodeFunctionData({
              abi: escrowAbi,
              functionName: "getMilestone",
              args: [agreementId, milestoneIndex],
            }),
          }),
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();
      const milestone = decodeFunctionResult({
        abi: escrowAbi,
        functionName: "getMilestone",
        data: bytesToHex(milestoneCall.data),
      });

      if (
        milestone.status !== MILESTONE_SUBMITTED ||
        milestone.approvalDeadline > BigInt(scheduledExecutionTime)
      ) {
        continue;
      }

      const encodedPayload = encodeAbiParameters(reportParameters, [
        BigInt(network.chainSelector.selector),
        BigInt(scheduledExecutionTime),
        agreementId,
        milestoneIndex,
      ]);
      const signedReport = runtime
        .report({
          encodedPayload: hexToBase64(encodedPayload),
          encoderName: "evm",
          signingAlgo: "ecdsa",
          hashingAlgo: "keccak256",
        })
        .result();
      const result = evmClient
        .writeReport(runtime, {
          receiver: receiverAddress,
          report: signedReport,
          gasConfig: { gasLimit: config.gasLimit },
        })
        .result();
      const txHash = bytesToHex(result.txHash ?? new Uint8Array(32));
      runtime.log(
        `Timeout release report agreement=${agreementId} milestone=${milestoneIndex} tx=${txHash} txStatus=${result.txStatus} receiverStatus=${result.receiverContractExecutionStatus}`,
      );

      if (result.txStatus !== TxStatus.SUCCESS) {
        throw new Error(
          `CRE report transaction failed (${result.txStatus}): ${result.errorMessage}`,
        );
      }
      if (
        result.receiverContractExecutionStatus ===
        EVM_PB.ReceiverContractExecutionStatus.REVERTED
      ) {
        throw new Error(
          `Timeout receiver reverted for agreement ${agreementId}, milestone ${milestoneIndex}.`,
        );
      }
      submittedReports += 1;
    }
  }

  return `Scanned ${agreementCount} agreements; submitted ${submittedReports} timeout release report(s).`;
};

const initWorkflow = (config: Config) => {
  configSchema.parse(config);
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({ schedule: "0 */5 * * * *" }),
      onCronTrigger,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
