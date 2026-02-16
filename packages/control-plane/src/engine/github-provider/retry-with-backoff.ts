const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MS_PER_SECOND = 1000;
const STATUS_RATE_LIMITED = 429;
const STATUS_INTERNAL_SERVER_ERROR = 500;
const STATUS_BAD_GATEWAY = 502;
const STATUS_SERVICE_UNAVAILABLE = 503;
const STATUS_GATEWAY_TIMEOUT = 504;

const RETRYABLE_STATUS_CODES: Set<number> = new Set([
  STATUS_RATE_LIMITED,
  STATUS_INTERNAL_SERVER_ERROR,
  STATUS_BAD_GATEWAY,
  STATUS_SERVICE_UNAVAILABLE,
  STATUS_GATEWAY_TIMEOUT,
]);

interface ErrorWithStatus {
  status?: number;
  response?: {
    headers?: Record<string, string | undefined>;
  };
}

export async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retry loop requires sequential awaits
      return await fn();
    } catch (error) {
      const errorWithStatus = error as ErrorWithStatus;
      const status = errorWithStatus.status;

      if (status === undefined || !RETRYABLE_STATUS_CODES.has(status)) {
        throw error;
      }

      if (attempt >= MAX_RETRIES) {
        throw error;
      }

      const delayMS = computeDelay(errorWithStatus, attempt);
      await sleep(delayMS);
      attempt += 1;
    }
  }
}

function computeDelay(error: ErrorWithStatus, attempt: number): number {
  if (error.status === STATUS_RATE_LIMITED) {
    const retryAfter = error.response?.headers?.['retry-after'];
    if (retryAfter !== undefined) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds)) {
        return seconds * MS_PER_SECOND;
      }
    }
  }

  const exponentialDelay = BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * BASE_DELAY_MS;
  const totalDelay = exponentialDelay + jitter;

  return Math.min(totalDelay, MAX_DELAY_MS);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
