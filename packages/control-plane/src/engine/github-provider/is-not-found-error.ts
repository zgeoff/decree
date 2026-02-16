const STATUS_NOT_FOUND = 404;

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === STATUS_NOT_FOUND
  );
}
