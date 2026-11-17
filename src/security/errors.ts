// Erreurs normalisées du backend. Toute réponse d'erreur suit la forme :
//   { "error": { "code": "...", "message": "...", "request_id": "..." } }
// Les codes sont stables et documentés dans OPENAPI.yaml / BACKEND_CONTRACT.md.

export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_DEVICE_ID"
  | "TERMINAL_NOT_FOUND"
  | "MISSING_DEVICE_ID"
  | "MISSING_IDEMPOTENCY_KEY"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INSUFFICIENT_CREDITS"
  | "INVALID_PRODUCT"
  | "PAYMENT_PROVIDER_NOT_CONFIGURED"
  | "PAYMENTS_DISABLED"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_STATE_INVALID"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "REQUEST_TOO_LARGE"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "SIMULATION_DISABLED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_DEVICE_ID: 400,
  TERMINAL_NOT_FOUND: 404,
  MISSING_DEVICE_ID: 400,
  MISSING_IDEMPOTENCY_KEY: 400,
  INVALID_IDEMPOTENCY_KEY: 400,
  INSUFFICIENT_CREDITS: 402,
  INVALID_PRODUCT: 400,
  PAYMENT_PROVIDER_NOT_CONFIGURED: 503,
  PAYMENTS_DISABLED: 503,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_STATE_INVALID: 409,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  REQUEST_TOO_LARGE: 413,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  SIMULATION_DISABLED: 404,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function jsonError(err: ApiError, requestId: string): Response {
  const body = {
    error: {
      code: err.code,
      message: err.message,
      request_id: requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
  return Response.json(body, {
    status: err.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
