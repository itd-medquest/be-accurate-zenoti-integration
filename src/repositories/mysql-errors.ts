/** Do not use INSERT IGNORE: it can silently truncate values or ignore invalid data. */
export function isDuplicateEntry(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && error.code === 'ER_DUP_ENTRY') return true;
  return 'cause' in error && error.cause !== error && isDuplicateEntry(error.cause);
}
