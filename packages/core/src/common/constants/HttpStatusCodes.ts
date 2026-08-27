enum HttpStatusCodes {
  Success = 200,
  NoContent = 204,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  RequestTimeout = 408,
  InternalServerError = 500,
}

export function isSuccessCode(statusCode: number) {
  return statusCode >= HttpStatusCodes.Success && statusCode < HttpStatusCodes.BadRequest;
}

export default HttpStatusCodes;
