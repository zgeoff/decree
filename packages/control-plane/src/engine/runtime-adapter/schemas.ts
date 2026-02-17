import { z } from 'zod';

// --- Planner ---

const PlannedWorkItemSchema: z.ZodType = z.object({
  tempID: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  blockedBy: z.array(z.string()),
});

const PlannedWorkItemUpdateSchema: z.ZodType = z.object({
  workItemID: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()).nullable(),
});

export const PlannerOutputSchema: z.ZodType = z.object({
  role: z.literal('planner'),
  create: z.array(PlannedWorkItemSchema),
  close: z.array(z.string()),
  update: z.array(PlannedWorkItemUpdateSchema),
});

// --- Implementor (no patch field — adapter extracts it) ---

export const ImplementorOutputSchema: z.ZodType = z.object({
  role: z.literal('implementor'),
  outcome: z.enum(['completed', 'blocked', 'validation-failure']),
  summary: z.string(),
});

// --- Reviewer ---

const AgentReviewCommentSchema: z.ZodType = z.object({
  path: z.string(),
  line: z.number().nullable(),
  body: z.string(),
});

const AgentReviewSchema: z.ZodType = z.object({
  verdict: z.enum(['approve', 'needs-changes']),
  summary: z.string(),
  comments: z.array(AgentReviewCommentSchema),
});

export const ReviewerOutputSchema: z.ZodType = z.object({
  role: z.literal('reviewer'),
  review: AgentReviewSchema,
});
