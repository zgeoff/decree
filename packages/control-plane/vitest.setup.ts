import { fs, vol } from 'memfs';
import { afterEach, vi } from 'vitest';

vi.mock('node:fs/promises', () => fs.promises);

afterEach(() => {
  vol.reset();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
