import { beforeEach, expect, test, vi } from 'vitest';
import { retryWithBackoff } from './retry-with-backoff.ts';

interface ErrorWithStatus {
  status: number;
  response?: {
    headers?: Record<string, string>;
  };
}

function setupTest(): {
  fn: ReturnType<typeof vi.fn<() => Promise<string>>>;
} {
  vi.useFakeTimers();
  const fn = vi.fn<() => Promise<string>>();
  return { fn };
}

beforeEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

test('it returns the result without delay when the function succeeds on first call', async () => {
  const { fn } = setupTest();
  fn.mockResolvedValue('success');

  const result = await retryWithBackoff(fn);

  expect(result).toBe('success');
  expect(fn).toHaveBeenCalledTimes(1);
});

test('it uses Retry-After header value as delay for 429 responses', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = {
    status: 429,
    response: {
      headers: {
        'retry-after': '5',
      },
    },
  };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);

  await vi.advanceTimersByTimeAsync(4999);
  expect(fn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);
  expect(fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it retries up to 3 times with exponential backoff for 500 responses', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 500 };

  fn.mockRejectedValueOnce(error);
  fn.mockRejectedValueOnce(error);
  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);

  expect(fn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(3000);
  expect(fn).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(5000);
  expect(fn).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(9000);
  expect(fn).toHaveBeenCalledTimes(4);

  const result = await promise;
  expect(result).toBe('success');
});

test('it retries for 502 responses', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 502 };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);
  await vi.advanceTimersByTimeAsync(3000);

  const result = await promise;
  expect(result).toBe('success');
  expect(fn).toHaveBeenCalledTimes(2);
});

test('it retries for 503 responses', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 503 };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);
  await vi.advanceTimersByTimeAsync(3000);

  const result = await promise;
  expect(result).toBe('success');
  expect(fn).toHaveBeenCalledTimes(2);
});

test('it retries for 504 responses', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 504 };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);
  await vi.advanceTimersByTimeAsync(3000);

  const result = await promise;
  expect(result).toBe('success');
  expect(fn).toHaveBeenCalledTimes(2);
});

test('it propagates 404 errors immediately without retry', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 404 };
  fn.mockRejectedValue(error);

  await expect(retryWithBackoff(fn)).rejects.toStrictEqual(error);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('it propagates 400 errors immediately without retry', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 400 };
  fn.mockRejectedValue(error);

  await expect(retryWithBackoff(fn)).rejects.toStrictEqual(error);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('it propagates 403 errors immediately without retry', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 403 };
  fn.mockRejectedValue(error);

  await expect(retryWithBackoff(fn)).rejects.toStrictEqual(error);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('it propagates the error when all 3 retries are exhausted', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 500 };
  fn.mockRejectedValue(error);

  const promise = retryWithBackoff(fn).catch((err) => err);

  await vi.advanceTimersByTimeAsync(3000);
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(9000);

  const result = await promise;
  expect(result).toStrictEqual(error);
  expect(fn).toHaveBeenCalledTimes(4);
});

test('it applies exponential backoff with jitter', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 500 };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  const promise = retryWithBackoff(fn);

  expect(fn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(2500);
  expect(fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it caps delay at 30 seconds regardless of backoff calculation', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 500 };

  fn.mockRejectedValueOnce(error);
  fn.mockRejectedValueOnce(error);
  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  vi.spyOn(Math, 'random').mockReturnValue(0);

  const promise = retryWithBackoff(fn);

  await vi.advanceTimersByTimeAsync(2000);
  expect(fn).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(4000);
  expect(fn).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(8000);
  expect(fn).toHaveBeenCalledTimes(4);

  const result = await promise;
  expect(result).toBe('success');
});

test('it handles 429 responses without Retry-After header using exponential backoff', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = { status: 429 };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);

  await vi.advanceTimersByTimeAsync(3000);
  expect(fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it handles 429 responses with malformed Retry-After header using exponential backoff', async () => {
  const { fn } = setupTest();

  const error: ErrorWithStatus = {
    status: 429,
    response: {
      headers: {
        'retry-after': 'invalid',
      },
    },
  };

  fn.mockRejectedValueOnce(error);
  fn.mockResolvedValue('success');

  const promise = retryWithBackoff(fn);

  await vi.advanceTimersByTimeAsync(3000);
  expect(fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it propagates errors without status property immediately', async () => {
  const { fn } = setupTest();

  const error = new Error('Network error');
  fn.mockRejectedValue(error);

  await expect(retryWithBackoff(fn)).rejects.toStrictEqual(error);
  expect(fn).toHaveBeenCalledTimes(1);
});
