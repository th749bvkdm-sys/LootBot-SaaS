export interface RecentSystemError {
  occurredAt: string;
  method: string;
  path: string;
  errorType: string;
}

const MAX_RECENT_ERRORS = 50;
const recentErrors: RecentSystemError[] = [];

export function recordSystemError(error: RecentSystemError): void {
  recentErrors.unshift(error);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.pop();
}

export function getRecentSystemErrors(): RecentSystemError[] {
  return recentErrors.map((error) => ({ ...error }));
}
