import type { Response } from 'express';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

interface SendOptions {
  status?: number;
  message?: string;
  meta?: Record<string, unknown>;
}

/** Envía una respuesta exitosa con el status HTTP real (a diferencia de JJ, que siempre mandaba 200). */
export function sendOk<T>(res: Response, data: T, options: SendOptions = {}): void {
  const { status = 200, message, meta } = options;
  const body: ApiSuccess<T> = { ok: true, data };
  if (message) body.message = message;
  if (meta) body.meta = meta;
  res.status(status).json(body);
}

export function sendCreated<T>(res: Response, data: T, message?: string): void {
  sendOk(res, data, { status: 201, ...(message && { message }) });
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiFailure = { ok: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}
