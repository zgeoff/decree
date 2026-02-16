const METADATA_LINE_PATTERN = /\n?\n?<!-- decree:blockedBy(?:\s+#\d+)* -->\s*$/;

export function stripDependencyMetadata(body: string): string {
  return body.replace(METADATA_LINE_PATTERN, '');
}
