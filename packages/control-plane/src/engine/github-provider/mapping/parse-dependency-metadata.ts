const METADATA_PATTERN = /<!-- decree:blockedBy((?:\s+#\d+)*) -->/;
const ISSUE_REF_PATTERN = /#(\d+)/g;

export function parseDependencyMetadata(body: string): string[] {
  const match = METADATA_PATTERN.exec(body);
  if (!match?.[1]) {
    return [];
  }

  const refs = match[1];
  const result: string[] = [];
  let issueMatch = ISSUE_REF_PATTERN.exec(refs);

  while (issueMatch !== null) {
    const issueNumber = issueMatch[1];
    if (issueNumber !== undefined) {
      result.push(issueNumber);
    }
    issueMatch = ISSUE_REF_PATTERN.exec(refs);
  }

  return result;
}
