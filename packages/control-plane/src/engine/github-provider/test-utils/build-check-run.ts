export interface CheckRunOverrides {
  name?: string;
  status?: string;
  conclusion?: string | null;
  details_url?: string | null;
}

interface CheckRunData {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}

export function buildCheckRun(overrides?: CheckRunOverrides): CheckRunData {
  return {
    name: overrides?.name ?? 'ci',
    status: overrides?.status ?? 'completed',
    conclusion: overrides?.conclusion === undefined ? 'success' : overrides.conclusion,
    details_url: overrides?.details_url === undefined ? null : overrides.details_url,
  };
}
