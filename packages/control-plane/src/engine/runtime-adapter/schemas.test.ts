import { expect, test } from 'vitest';
import { z } from 'zod';
import { ImplementorOutputSchema, PlannerOutputSchema, ReviewerOutputSchema } from './schemas.ts';

test('it validates a valid planner output with all fields', () => {
  const input = {
    role: 'planner',
    create: [
      {
        tempID: 'temp-1',
        title: 'Add feature X',
        body: 'Description of feature X',
        labels: ['task:implement', 'priority:high'],
        blockedBy: ['#42', 'temp-2'],
      },
    ],
    close: ['#10', '#20'],
    update: [
      {
        workItemID: '#30',
        body: 'Updated description',
        labels: ['status:ready'],
      },
    ],
  };

  const result = PlannerOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it validates a planner output with empty arrays', () => {
  const input = {
    role: 'planner',
    create: [],
    close: [],
    update: [],
  };

  const result = PlannerOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it validates a planner output with nullable update fields', () => {
  const input = {
    role: 'planner',
    create: [],
    close: [],
    update: [
      {
        workItemID: '#30',
        body: null,
        labels: null,
      },
    ],
  };

  const result = PlannerOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it rejects planner output with incorrect role', () => {
  const input = {
    role: 'implementor',
    create: [],
    close: [],
    update: [],
  };

  const result = PlannerOutputSchema.safeParse(input);
  expect(result.success).toBe(false);
});

test('it rejects planner output missing required fields', () => {
  const input = {
    role: 'planner',
    create: [],
  };

  const result = PlannerOutputSchema.safeParse(input);
  expect(result.success).toBe(false);
});

test('it validates implementor output with completed outcome', () => {
  const input = {
    role: 'implementor',
    outcome: 'completed',
    summary: 'Successfully implemented the feature',
  };

  const result = ImplementorOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it validates implementor output with blocked outcome', () => {
  const input = {
    role: 'implementor',
    outcome: 'blocked',
    summary: 'Blocked on missing spec clarification',
  };

  const result = ImplementorOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it validates implementor output with validation-failure outcome', () => {
  const input = {
    role: 'implementor',
    outcome: 'validation-failure',
    summary: 'Tests failed after implementation',
  };

  const result = ImplementorOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it rejects implementor output with invalid outcome', () => {
  const input = {
    role: 'implementor',
    outcome: 'in-progress',
    summary: 'Summary text',
  };

  const result = ImplementorOutputSchema.safeParse(input);
  expect(result.success).toBe(false);
});

test('it strips extra fields from implementor output', () => {
  const input = {
    role: 'implementor',
    outcome: 'completed',
    summary: 'Summary',
    patch: 'diff --git a/file.ts b/file.ts',
  };

  const result = ImplementorOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toStrictEqual({
      role: 'implementor',
      outcome: 'completed',
      summary: 'Summary',
    });
  }
});

test('it validates reviewer output with approve verdict', () => {
  const input = {
    role: 'reviewer',
    review: {
      verdict: 'approve',
      summary: 'Looks good to merge',
      comments: [],
    },
  };

  const result = ReviewerOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it validates reviewer output with needs-changes verdict and comments', () => {
  const input = {
    role: 'reviewer',
    review: {
      verdict: 'needs-changes',
      summary: 'Several issues need to be addressed',
      comments: [
        {
          path: 'src/foo.ts',
          line: 42,
          body: 'This logic is incorrect',
        },
        {
          path: 'src/bar.ts',
          line: null,
          body: 'General comment on file',
        },
      ],
    },
  };

  const result = ReviewerOutputSchema.safeParse(input);
  expect(result.success).toBe(true);
});

test('it rejects reviewer output with invalid verdict', () => {
  const input = {
    role: 'reviewer',
    review: {
      verdict: 'rejected',
      summary: 'Summary',
      comments: [],
    },
  };

  const result = ReviewerOutputSchema.safeParse(input);
  expect(result.success).toBe(false);
});

test('it converts planner schema to JSON schema', () => {
  const jsonSchema = z.toJSONSchema(PlannerOutputSchema);

  expect(jsonSchema).toMatchObject({
    type: 'object',
    properties: expect.objectContaining({
      role: expect.any(Object),
      create: expect.any(Object),
      close: expect.any(Object),
      update: expect.any(Object),
    }),
    required: expect.arrayContaining(['role', 'create', 'close', 'update']),
  });
});

test('it converts implementor schema to JSON schema', () => {
  const jsonSchema = z.toJSONSchema(ImplementorOutputSchema);

  expect(jsonSchema).toMatchObject({
    type: 'object',
    properties: expect.objectContaining({
      role: expect.any(Object),
      outcome: expect.any(Object),
      summary: expect.any(Object),
    }),
    required: expect.arrayContaining(['role', 'outcome', 'summary']),
  });
});

test('it converts reviewer schema to JSON schema', () => {
  const jsonSchema = z.toJSONSchema(ReviewerOutputSchema);

  expect(jsonSchema).toMatchObject({
    type: 'object',
    properties: expect.objectContaining({
      role: expect.any(Object),
      review: expect.any(Object),
    }),
    required: expect.arrayContaining(['role', 'review']),
  });
});
