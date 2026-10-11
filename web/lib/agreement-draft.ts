import { z } from "zod";

const safeRupees = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const agreementDraftSchema = z
  .object({
    recipient: z.string().trim().min(1).max(100),
    amount: safeRupees,
    milestones: z
      .array(
        z.object({
          description: z.string().trim().min(3).max(180),
          amount: safeRupees,
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((draft, context) => {
    const milestoneTotal = draft.milestones.reduce((sum, milestone) => sum + milestone.amount, 0);
    if (!Number.isSafeInteger(milestoneTotal) || milestoneTotal !== draft.amount) {
      context.addIssue({
        code: "custom",
        path: ["milestones"],
        message: "Milestone amounts must add up to the total amount.",
      });
    }
  });

export type AgreementDraft = z.infer<typeof agreementDraftSchema>;