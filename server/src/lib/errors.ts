/** API error carrying an HTTP status + machine-readable code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string): ApiError => new ApiError(400, "BAD_REQUEST", message);
export const notFound = (message: string): ApiError => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string): ApiError => new ApiError(409, "CONFLICT", message);
export const unsupportedMedia = (message: string): ApiError =>
  new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", message);
