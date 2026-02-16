const METADATA_PATTERN = /<!-- decree:blockedBy((?:\s+#\d+)*) -->/;
const ISSUE_REF_PATTERN = /#(\d+)/g;
const METADATA_LINE_PATTERN = /\n?\n?<!-- decree:blockedBy(?:\s+#\d+)* -->\s*$/;

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

export function formatDependencyMetadata(body: string, blockedBy: string[]): string {
  if (blockedBy.length === 0) {
    return body;
  }

  const refs = blockedBy.map((id) => `#${id}`).join(' ');
  return `${body}\n\n<!-- decree:blockedBy ${refs} -->`;
}

export function stripDependencyMetadata(body: string): string {
  return body.replace(METADATA_LINE_PATTERN, '');
}
