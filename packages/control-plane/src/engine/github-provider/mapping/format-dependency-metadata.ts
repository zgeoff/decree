export function formatDependencyMetadata(body: string, blockedBy: string[]): string {
  if (blockedBy.length === 0) {
    return body;
  }

  const refs = blockedBy.map((id) => `#${id}`).join(' ');
  return `${body}\n\n<!-- decree:blockedBy ${refs} -->`;
}
