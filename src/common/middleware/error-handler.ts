import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError, z } from 'zod';
import { AppError } from '../http/errors.js';
import { sendError } from '../http/response.js';
import { logger } from '../logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.originalUrl}`);
};

function isDuplicateKeyError(err: unknown): err is { code: number; keyValue?: unknown } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function isJsonSyntaxError(err: unknown): boolean {
  return err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed';
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Datos inválidos', z.flattenError(err));
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    sendError(res, 400, 'INVALID_ID', `Valor inválido para ${err.path}`);
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    sendError(res, 400, 'VALIDATION_ERROR', err.message);
    return;
  }
  if (isDuplicateKeyError(err)) {
    sendError(res, 409, 'DUPLICATE', 'Ya existe un registro con esos datos', err.keyValue);
    return;
  }
  if (isJsonSyntaxError(err)) {
    sendError(res, 400, 'INVALID_JSON', 'El cuerpo de la petición no es JSON válido');
    return;
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, 'Error no controlado');
  sendError(res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
};
