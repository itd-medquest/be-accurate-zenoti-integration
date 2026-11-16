export type Actor = { id: string; name: string; email: string; role: string; active: boolean };

declare global {
  namespace Express {
    interface Request {
      actor: Actor;
    }
  }
}
