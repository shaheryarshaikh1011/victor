import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** Consistent error response body returned to the Web_Client. */
interface ErrorResponseBody {
  error: {
    code: number;
    message: string;
  };
}

/**
 * Global exception filter mapping every error to a consistent JSON shape.
 *
 * Known {@link HttpException}s keep their status and a safe client message
 * (e.g. validation, unauthorized, forbidden, too-many-requests). Any other
 * (unexpected) error is masked as a generic 500 so internal stack details
 * never reach the client, while the full error is logged server-side
 * (Requirement 9.3).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(this.buildBody(status, exception));
      return;
    }

    // Unexpected error: log full details server-side, return a masked response.
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    this.logger.error(
      `Unhandled error on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(status).json({
      error: { code: status, message: 'Internal server error' },
    } satisfies ErrorResponseBody);
  }

  /**
   * Builds the client-facing body for a known HttpException, extracting the
   * safe message from Nest's response payload without exposing stack traces.
   */
  private buildBody(
    status: number,
    exception: HttpException,
  ): ErrorResponseBody {
    const payload = exception.getResponse();
    let message: string;

    if (typeof payload === 'string') {
      message = payload;
    } else if (
      payload &&
      typeof payload === 'object' &&
      'message' in payload
    ) {
      const raw = (payload as { message: unknown }).message;
      message = Array.isArray(raw) ? raw.join('; ') : String(raw);
    } else {
      message = exception.message;
    }

    return { error: { code: status, message } };
  }
}
