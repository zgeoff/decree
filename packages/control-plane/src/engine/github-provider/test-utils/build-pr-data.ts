export interface PROverrides {
  number?: number;
  title?: string;
  html_url?: string;
  head?: { sha: string; ref: string };
  user?: { login: string } | null;
  body?: string | null;
  draft?: boolean;
}

interface PRData {
  number: number;
  title: string;
  html_url: string;
  head: { sha: string; ref: string };
  user: { login: string } | null;
  body: string | null;
  draft: boolean;
}

export function buildPRData(overrides?: PROverrides): PRData {
  return {
    number: overrides?.number ?? 1,
    title: overrides?.title ?? 'Test PR',
    html_url: overrides?.html_url ?? 'https://github.com/owner/repo/pull/1',
    head: overrides?.head ?? { sha: 'abc123', ref: 'feature-branch' },
    user: overrides?.user === undefined ? { login: 'testuser' } : overrides.user,
    body: overrides?.body === undefined ? 'Closes #10' : overrides.body,
    draft: overrides?.draft ?? false,
  };
}
