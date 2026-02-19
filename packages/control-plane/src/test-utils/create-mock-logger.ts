import { vi } from 'vitest';
import type { Logger } from '../engine/create-logger.ts';

interface MockLogMessage {
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface MockLoggerResult {
  logger: Logger;
  messages: MockLogMessage[];
}

export function createMockLogger(): MockLoggerResult {
  const messages: MockLogMessage[] = [];

  const logger: Logger = {
    debug: vi.fn().mockImplementation((message: string, data?: Record<string, unknown>) => {
      messages.push(buildLogMessage('debug', message, data));
    }),
    info: vi.fn().mockImplementation((message: string, data?: Record<string, unknown>) => {
      messages.push(buildLogMessage('info', message, data));
    }),
    error: vi.fn().mockImplementation((message: string, data?: Record<string, unknown>) => {
      messages.push(buildLogMessage('error', message, data));
    }),
  };

  return { logger, messages };
}

function buildLogMessage(
  level: string,
  message: string,
  data?: Record<string, unknown>,
): MockLogMessage {
  if (data === undefined) {
    return { level, message };
  }
  return { level, message, data };
}
