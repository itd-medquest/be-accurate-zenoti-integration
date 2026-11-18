/** Read-only export boundary for the retired PostgreSQL/PGlite database. */
export interface LegacyUserSource {
  query<T extends Record<string, unknown>>(statement: string): Promise<{ rows: T[] }>;
}

export async function readLoginUsers(source: LegacyUserSource) {
  const users = await source.query(`select id, name, email, email_verified as "emailVerified",
    image, role, active, created_at as "createdAt", updated_at as "updatedAt" from users order by id`);
  const accounts =
    await source.query(`select id, account_id as "accountId", provider_id as "providerId",
    user_id as "userId", password, created_at as "createdAt", updated_at as "updatedAt"
    from accounts where provider_id = 'credential' order by id`);
  return { users: users.rows, accounts: accounts.rows };
}
