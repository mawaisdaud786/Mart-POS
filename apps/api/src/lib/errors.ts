/** Application error rendered as RFC 9457 problem+json with a stable `code`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (code = 'PERMISSION_DENIED', message = 'You do not have permission to do this') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const badRequest = (code: string, message: string) => new AppError(400, code, message);
