import { expect, test } from 'vitest';
import type { DerivePipelineStatusInput } from './derive-pipeline-status.ts';
import { derivePipelineStatus } from './derive-pipeline-status.ts';

function buildSuccessInput(): DerivePipelineStatusInput {
  return {
    combinedStatus: { state: 'success', total_count: 1 },
    checkRuns: {
      total_count: 1,
      check_runs: [
        {
          name: 'ci',
          status: 'completed',
          conclusion: 'success',
          details_url: 'https://ci.example.com/1',
        },
      ],
    },
  };
}

test('it returns success when all check runs succeed and combined status is success', () => {
  const input = buildSuccessInput();
  const result = derivePipelineStatus(input);
  expect(result).toStrictEqual({ status: 'success', url: null, reason: null });
});

test('it returns failure when any check run has a failure conclusion', () => {
  const input = buildSuccessInput();
  input.checkRuns.check_runs = [
    {
      name: 'build',
      status: 'completed',
      conclusion: 'failure',
      details_url: 'https://ci.example.com/fail',
    },
  ];
  const result = derivePipelineStatus(input);
  expect(result).toStrictEqual({
    status: 'failure',
    url: 'https://ci.example.com/fail',
    reason: 'build',
  });
});

test('it returns failure when any check run has a cancelled conclusion', () => {
  const input = buildSuccessInput();
  input.checkRuns.check_runs = [
    {
      name: 'lint',
      status: 'completed',
      conclusion: 'cancelled',
      details_url: 'https://ci.example.com/cancel',
    },
  ];
  const result = derivePipelineStatus(input);
  expect(result).toStrictEqual({
    status: 'failure',
    url: 'https://ci.example.com/cancel',
    reason: 'lint',
  });
});

test('it returns failure when any check run has a timed_out conclusion', () => {
  const input = buildSuccessInput();
  input.checkRuns.check_runs = [
    {
      name: 'test',
      status: 'completed',
      conclusion: 'timed_out',
      details_url: 'https://ci.example.com/timeout',
    },
  ];
  const result = derivePipelineStatus(input);
  expect(result).toStrictEqual({
    status: 'failure',
    url: 'https://ci.example.com/timeout',
    reason: 'test',
  });
});

test('it returns pending when a check run is in progress', () => {
  const input = buildSuccessInput();
  input.checkRuns.check_runs = [
    { name: 'ci', status: 'in_progress', conclusion: null, details_url: null },
  ];
  const result = derivePipelineStatus(input);
  expect(result).toStrictEqual({ status: 'pending', url: null, reason: null });
});

test('it returns pending when both endpoints report zero total count', () => {
  const result = derivePipelineStatus({
    combinedStatus: { state: 'pending', total_count: 0 },
    checkRuns: { total_count: 0, check_runs: [] },
  });
  expect(result).toStrictEqual({ status: 'pending', url: null, reason: null });
});

test('it populates url and reason from the first failing check run on failure', () => {
  const result = derivePipelineStatus({
    combinedStatus: { state: 'success', total_count: 1 },
    checkRuns: {
      total_count: 3,
      check_runs: [
        {
          name: 'lint',
          status: 'completed',
          conclusion: 'success',
          details_url: 'https://ci.example.com/lint',
        },
        {
          name: 'test',
          status: 'completed',
          conclusion: 'failure',
          details_url: 'https://ci.example.com/test',
        },
        {
          name: 'build',
          status: 'completed',
          conclusion: 'failure',
          details_url: 'https://ci.example.com/build',
        },
      ],
    },
  });
  expect(result).toStrictEqual({
    status: 'failure',
    url: 'https://ci.example.com/test',
    reason: 'test',
  });
});

test('it returns null url and reason when status is success', () => {
  const result = derivePipelineStatus(buildSuccessInput());
  expect(result.url).toBeNull();
  expect(result.reason).toBeNull();
});

test('it returns pending when combined status is failure but is treated as failure', () => {
  const result = derivePipelineStatus({
    combinedStatus: { state: 'failure', total_count: 1 },
    checkRuns: {
      total_count: 1,
      check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success', details_url: null }],
    },
  });
  expect(result.status).toBe('failure');
});

test('it returns pending when combined status reports pending with real statuses', () => {
  const result = derivePipelineStatus({
    combinedStatus: { state: 'pending', total_count: 2 },
    checkRuns: {
      total_count: 1,
      check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success', details_url: null }],
    },
  });
  expect(result).toStrictEqual({ status: 'pending', url: null, reason: null });
});

test('it returns failure with null url when failing check run has no details url', () => {
  const result = derivePipelineStatus({
    combinedStatus: { state: 'success', total_count: 1 },
    checkRuns: {
      total_count: 1,
      check_runs: [
        { name: 'deploy', status: 'completed', conclusion: 'failure', details_url: null },
      ],
    },
  });
  expect(result).toStrictEqual({
    status: 'failure',
    url: null,
    reason: 'deploy',
  });
});

test('it returns a PipelineResult domain type', () => {
  const result = derivePipelineStatus(buildSuccessInput());
  expect(result).toHaveProperty('status');
  expect(result).toHaveProperty('url');
  expect(result).toHaveProperty('reason');
});
