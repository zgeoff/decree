import { z } from 'zod';
import type {
  AgentReview,
  AgentReviewComment,
  PlannedWorkItem,
  PlannedWorkItemUpdate,
  PlannerResult,
  ReviewerResult,
} from '../state-store/domain-type-stubs.ts';

// Implementor schema output — patch is added by the adapter, not validated here
interface ImplementorSchemaOutput {
  role: 'implementor';
  outcome: 'completed' | 'blocked' | 'validation-failure';
  summary: string;
}

// --- Planner ---

const PlannedWorkItemSchema: z.ZodType<PlannedWorkItem> = z.object({
  tempID: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  blockedBy: z.array(z.string()),
});

const PlannedWorkItemUpdateSchema: z.ZodType<PlannedWorkItemUpdate> = z.object({
  workItemID: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()).nullable(),
});

export const PlannerOutputSchema: z.ZodType<PlannerResult> = z.object({
  role: z.literal('planner'),
  create: z.array(PlannedWorkItemSchema),
  close: z.array(z.string()),
  update: z.array(PlannedWorkItemUpdateSchema),
});

// --- Implementor (no patch field — adapter extracts it) ---

export const ImplementorOutputSchema: z.ZodType<ImplementorSchemaOutput> = z.object({
  role: z.literal('implementor'),
  outcome: z.enum(['completed', 'blocked', 'validation-failure']),
  summary: z.string(),
});

// --- Reviewer ---

const AgentReviewCommentSchema: z.ZodType<AgentReviewComment> = z.object({
  path: z.string(),
  line: z.number().nullable(),
  body: z.string(),
});

const AgentReviewSchema: z.ZodType<AgentReview> = z.object({
  verdict: z.enum(['approve', 'needs-changes']),
  summary: z.string(),
  comments: z.array(AgentReviewCommentSchema),
});

export const ReviewerOutputSchema: z.ZodType<ReviewerResult> = z.object({
  role: z.literal('reviewer'),
  review: AgentReviewSchema,
});
