import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as users from '../services/users.service.js';
import { createUserSchema, updateUserSchema } from '../validations/users.validation.js';
import { idParamsSchema } from '../validations/params.validation.js';

export const list: RequestHandler = async (_req, res) => {
  res.json(await users.listUsers());
};
export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await users.createUser(validated(res, createUserSchema), req.actor.id));
};
export const update: RequestHandler = async (req, res) => {
  res.json(
    await users.updateUser(String(req.params.id), validated(res, updateUserSchema), req.actor.id),
  );
};
export const remove: RequestHandler = async (req, res) => {
  const { id } = validated(res, idParamsSchema, 'params');
  res.json(await users.deleteUser(id, req.actor.id));
};
