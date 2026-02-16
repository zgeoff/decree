const CLOSING_KEYWORD_PATTERN =
  /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)(?=[\s.,;:!?)\]}]|$)/gi;

export function matchClosingKeywords(body: string): string | null {
  const match = CLOSING_KEYWORD_PATTERN.exec(body);
  CLOSING_KEYWORD_PATTERN.lastIndex = 0;

  if (!match?.[1]) {
    return null;
  }

  return match[1];
}
