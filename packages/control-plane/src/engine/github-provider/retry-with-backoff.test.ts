import { expect, test, vi } from 'vitest';
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

test('it returns the result without delay when the function succeeds on first call', async () => {
  const setup = setupTest();
  setup.fn.mockResolvedValue('success');

  const result = await retryWithBackoff(setup.fn);

  expect(result).toBe('success');
  expect(setup.fn).toHaveBeenCalledTimes(1);
});

test('it uses Retry-After header value as delay for 429 responses', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = {
    status: 429,
    response: {
      headers: {
        'retry-after': '5',
      },
    },
  };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);

  await vi.advanceTimersByTimeAsync(4999);
  expect(setup.fn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);
  expect(setup.fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it retries up to 3 times with exponential backoff for 500 responses', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 500 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);

  expect(setup.fn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(3000);
  expect(setup.fn).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(5000);
  expect(setup.fn).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(9000);
  expect(setup.fn).toHaveBeenCalledTimes(4);

  const result = await promise;
  expect(result).toBe('success');
});

test('it retries for 502 responses', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 502 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);
  await vi.advanceTimersByTimeAsync(3000);

  const result = await promise;
  expect(result).toBe('success');
  expect(setup.fn).toHaveBeenCalledTimes(2);
});

test('it retries for 503 responses', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 503 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);
  await vi.advanceTimersByTimeAsync(3000);

  const result = await promise;
  expect(result).toBe('success');
  expect(setup.fn).toHaveBeenCalledTimes(2);
});

test('it retries for 504 responses', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 504 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);
  await vi.advanceTimersByTimeAsync(3000);

  const result = await promise;
  expect(result).toBe('success');
  expect(setup.fn).toHaveBeenCalledTimes(2);
});

test('it propagates 404 errors immediately without retry', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 404 };
  setup.fn.mockRejectedValue(error);

  await expect(retryWithBackoff(setup.fn)).rejects.toStrictEqual(error);
  expect(setup.fn).toHaveBeenCalledTimes(1);
});

test('it propagates 400 errors immediately without retry', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 400 };
  setup.fn.mockRejectedValue(error);

  await expect(retryWithBackoff(setup.fn)).rejects.toStrictEqual(error);
  expect(setup.fn).toHaveBeenCalledTimes(1);
});

test('it propagates 403 errors immediately without retry', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 403 };
  setup.fn.mockRejectedValue(error);

  await expect(retryWithBackoff(setup.fn)).rejects.toStrictEqual(error);
  expect(setup.fn).toHaveBeenCalledTimes(1);
});

test('it propagates the error when all 3 retries are exhausted', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 500 };
  setup.fn.mockRejectedValue(error);

  const promise = retryWithBackoff(setup.fn).catch((err) => err);

  await vi.advanceTimersByTimeAsync(3000);
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(9000);

  const result = await promise;
  expect(result).toStrictEqual(error);
  expect(setup.fn).toHaveBeenCalledTimes(4);
});

test('it applies exponential backoff with jitter', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 500 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  vi.spyOn(Math, 'random').mockReturnValue(0.5);

  const promise = retryWithBackoff(setup.fn);

  expect(setup.fn).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(2500);
  expect(setup.fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it caps delay at 30 seconds regardless of backoff calculation', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 500 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  vi.spyOn(Math, 'random').mockReturnValue(0);

  const promise = retryWithBackoff(setup.fn);

  await vi.advanceTimersByTimeAsync(2000);
  expect(setup.fn).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(4000);
  expect(setup.fn).toHaveBeenCalledTimes(3);

  await vi.advanceTimersByTimeAsync(8000);
  expect(setup.fn).toHaveBeenCalledTimes(4);

  const result = await promise;
  expect(result).toBe('success');
});

test('it handles 429 responses without Retry-After header using exponential backoff', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = { status: 429 };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);

  await vi.advanceTimersByTimeAsync(3000);
  expect(setup.fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it handles 429 responses with malformed Retry-After header using exponential backoff', async () => {
  const setup = setupTest();

  const error: ErrorWithStatus = {
    status: 429,
    response: {
      headers: {
        'retry-after': 'invalid',
      },
    },
  };

  setup.fn.mockRejectedValueOnce(error);
  setup.fn.mockResolvedValue('success');

  const promise = retryWithBackoff(setup.fn);

  await vi.advanceTimersByTimeAsync(3000);
  expect(setup.fn).toHaveBeenCalledTimes(2);

  const result = await promise;
  expect(result).toBe('success');
});

test('it propagates errors without status property immediately', async () => {
  const setup = setupTest();

  const error = new Error('Network error');
  setup.fn.mockRejectedValue(error);

  await expect(retryWithBackoff(setup.fn)).rejects.toStrictEqual(error);
  expect(setup.fn).toHaveBeenCalledTimes(1);
});
