import type { PipelineResult, PipelineStatus } from '../../state-store/domain-type-stubs.ts';

export interface CombinedStatusInput {
  state: string;
  total_count: number;
}

export interface CheckRunInput {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}

export interface CheckRunsInput {
  total_count: number;
  check_runs: CheckRunInput[];
}

export interface DerivePipelineStatusInput {
  combinedStatus: CombinedStatusInput;
  checkRuns: CheckRunsInput;
}

const FAILURE_CONCLUSIONS: Set<string> = new Set(['failure', 'cancelled', 'timed_out']);

export function derivePipelineStatus(input: DerivePipelineStatusInput): PipelineResult {
  const status = deriveStatus(input);

  if (status === 'failure') {
    const failingRun = findFirstFailingRun(input.checkRuns.check_runs);
    return {
      status,
      url: failingRun?.details_url ?? null,
      reason: failingRun?.name ?? null,
    };
  }

  return { status, url: null, reason: null };
}

function deriveStatus(input: DerivePipelineStatusInput): PipelineStatus {
  const combinedState = input.combinedStatus.state;
  const runs = input.checkRuns.check_runs;

  // failure: combined status failure, or any check run with a failure conclusion
  if (combinedState === 'failure') {
    return 'failure';
  }
  if (runs.some((run) => FAILURE_CONCLUSIONS.has(run.conclusion ?? ''))) {
    return 'failure';
  }

  // pending: any incomplete check run
  if (runs.some((run) => run.status !== 'completed')) {
    return 'pending';
  }

  // pending: combined status pending with real statuses
  if (input.combinedStatus.total_count > 0 && combinedState === 'pending') {
    return 'pending';
  }

  // pending: no CI configured at all
  if (input.combinedStatus.total_count === 0 && input.checkRuns.total_count === 0) {
    return 'pending';
  }

  // success: combined status success (or no statuses) and all check runs succeeded
  const combinedOk = combinedState === 'success' || input.combinedStatus.total_count === 0;
  const checksOk =
    input.checkRuns.total_count === 0 || runs.every((run) => run.conclusion === 'success');

  if (combinedOk && checksOk) {
    return 'success';
  }

  return 'pending';
}

function findFirstFailingRun(runs: CheckRunInput[]): CheckRunInput | undefined {
  return runs.find((run) => FAILURE_CONCLUSIONS.has(run.conclusion ?? ''));
}
