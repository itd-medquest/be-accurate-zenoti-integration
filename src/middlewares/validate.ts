import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';

type Source = 'body' | 'query' | 'params';
type Schemas = Partial<Record<Source, z.ZodType>>;

export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    try {
      const result: Partial<Record<Source, unknown>> = {};
      for (const key of ['params', 'query', 'body'] as const) {
        const schema = schemas[key];
        if (schema) result[key] = schema.parse(req[key]);
      }
      res.locals.validated = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Types the snapshot produced by validate; controllers never parse request data again. */
export function validated<T extends z.ZodType>(
  res: Response,
  _schema: T,
  key: Source = 'body',
): z.output<T> {
  return res.locals.validated[key] as z.output<T>;
}
