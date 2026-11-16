import { findById } from '../repositories/user.repository.js';
import { HttpError } from '../utils/http-error.js';

export async function authenticatedActor(userId: string | undefined) {
  if (!userId) throw new HttpError(401, 'Silakan masuk terlebih dahulu.');
  const actor = await findById(userId);
  if (!actor?.active) throw new HttpError(403, 'Akun dinonaktifkan. Hubungi administrator.');
  return actor;
}
