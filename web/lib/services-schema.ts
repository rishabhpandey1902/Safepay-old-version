import { isAddress } from "viem";
import { z } from "zod";

export const serviceCategories = [
  "Design",
  "Development",
  "Writing",
  "Marketing",
  "Video",
  "Business",
] as const;

export const serviceListingSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(2_000),
  category: z.enum(serviceCategories),
  country: z.string().trim().min(2).max(80),
  startingPriceUsd: z
    .number()
    .finite()
    .positive()
    .max(1_000_000)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
      "Starting price must use at most two decimal places.",
    ),
  deliveryDays: z.number().int().min(1).max(365),
  providerWalletAddress: z
    .string()
    .refine(isAddress, "Enter a valid provider wallet address.")
    .transform((address) => address.toLowerCase()),
});

export const serviceListingEditSchema = serviceListingSchema.omit({
  providerWalletAddress: true,
});

export const listingChallengeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    address: z.string().refine(isAddress).transform((value) => value.toLowerCase()),
    listing: serviceListingSchema,
  }),
  z.object({
    action: z.literal("edit"),
    address: z.string().refine(isAddress).transform((value) => value.toLowerCase()),
    listingId: z.string().uuid(),
    listing: serviceListingEditSchema,
  }),
]);

export const listingMutationSchema = z.object({
  nonce: z.string().uuid(),
  address: z.string().refine(isAddress).transform((value) => value.toLowerCase()),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  action: z.enum(["create", "edit"]),
  listingId: z.string().uuid().optional(),
  listing: z.unknown(),
});

export type ServiceListingInput = z.infer<typeof serviceListingSchema>;
export type ServiceListingEditInput = z.infer<typeof serviceListingEditSchema>;
export type ServiceCategory = (typeof serviceCategories)[number];

export type ServiceListing = ServiceListingInput & {
  id: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
};
