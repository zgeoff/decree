import type { Policy } from '../command-executor/types.ts';

export const defaultPolicy: Policy = () => ({ allowed: true, reason: null });
