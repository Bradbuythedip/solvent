/**
 * One error type for everything the operator can fix. Anything else is a bug and
 * prints a stack trace.
 */
export class CliError extends Error {
  readonly remedy: string | undefined;
  readonly exitCode: number;

  constructor(message: string, remedy?: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.remedy = remedy;
    this.exitCode = exitCode;
  }
}

export function isCliError(e: unknown): e is CliError {
  return e instanceof CliError;
}

/** viem errors are verbose; keep the first line, which is the useful one. */
export function briefly(e: unknown): string {
  if (e instanceof Error) {
    const first = e.message.split('\n')[0] ?? e.message;
    return first.trim();
  }
  return String(e);
}
