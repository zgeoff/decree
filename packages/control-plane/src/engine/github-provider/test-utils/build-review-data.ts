export interface ReviewOverrides {
  id?: number;
  userLogin?: string;
  submitted_at?: string;
}

interface ReviewData {
  id: number;
  user: { login: string } | null;
  submitted_at: string;
}

const DEFAULT_REVIEW_ID = 100;

export function buildReviewData(overrides?: ReviewOverrides): ReviewData {
  return {
    id: overrides?.id ?? DEFAULT_REVIEW_ID,
    user:
      overrides?.userLogin !== undefined ? { login: overrides.userLogin } : { login: 'someone' },
    submitted_at: overrides?.submitted_at ?? '2026-01-01T00:00:00Z',
  };
}
