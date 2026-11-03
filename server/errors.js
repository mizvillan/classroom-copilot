export class AppError extends Error {
  constructor(code, message, status = 500, detail = "") {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function toErrorResponse(error) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message,
        ...(error.detail ? { detail: error.detail } : {}),
      },
    };
  }
  console.error("[classroom-copilot]", error);
  return {
    status: 500,
    body: {
      error: "internal_error",
      message: "Something went wrong on the server.",
      ...(error?.message ? { detail: String(error.message) } : {}),
    },
  };
}
