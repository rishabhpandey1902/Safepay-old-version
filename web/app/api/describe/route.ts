import { z } from "zod";

import { agreementDraftSchema } from "@/lib/agreement-draft";

const requestSchema = z.object({ text: z.string().trim().min(1).max(2000) });

const openAiResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

const responseJsonSchema = {
  name: "agreement_draft",
  strict: true,
  schema: {
    type: "object",
    properties: {
      recipient: { type: "string" },
      amount: { type: "integer", minimum: 1 },
      milestones: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            amount: { type: "integer", minimum: 1 },
          },
          required: ["description", "amount"],
          additionalProperties: false,
        },
      },
    },
    required: ["recipient", "amount", "milestones"],
    additionalProperties: false,
  },
} as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid JSON request." }, { status: 400 });
  }

  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return Response.json({ error: "Describe the agreement in 1 to 2,000 characters." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "The description assistant is not configured on the server." }, { status: 503 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_schema", json_schema: responseJsonSchema },
        messages: [
          {
            role: "system",
            content:
              "Turn the user's plain-language payment agreement into a draft. Return rupee amounts as whole INR numbers (for example, 1 lakh = 100000 and 30k = 30000). Include each stated payment condition as a milestone with a concise description. Do not invent a recipient, amount, or milestone. The milestone amounts must sum exactly to the total amount. If details are ambiguous, make the most conservative literal interpretation; the user will review and edit the draft.",
          },
          { role: "user", content: parsedRequest.data.text },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return Response.json({ error: "The description could not be processed right now. Please try again." }, { status: 502 });
    }

    const rawResponse: unknown = await response.json();
    const parsedResponse = openAiResponseSchema.safeParse(rawResponse);
    const content = parsedResponse.success ? parsedResponse.data.choices[0]?.message.content : null;
    if (!content) {
      return Response.json({ error: "The assistant returned an empty draft. Please revise your description." }, { status: 502 });
    }

    let rawDraft: unknown;
    try {
      rawDraft = JSON.parse(content);
    } catch {
      return Response.json({ error: "The assistant returned an unreadable draft. Please try again." }, { status: 502 });
    }

    const parsedDraft = agreementDraftSchema.safeParse(rawDraft);
    if (!parsedDraft.success) {
      return Response.json(
        { error: "The milestones did not match the total. Clarify the amounts and try again." },
        { status: 422 },
      );
    }

    return Response.json({ draft: parsedDraft.data });
  } catch {
    return Response.json({ error: "The description service is temporarily unavailable." }, { status: 502 });
  }
}