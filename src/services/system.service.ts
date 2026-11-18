import { config } from '../config/env.js';
import { listRecent as recentAudit } from '../repositories/audit-logs.repository.js';
import { listRecent as recentJobs } from '../repositories/jobs.repository.js';
import { checkDatabase } from '../repositories/system.repository.js';

export async function health() {
  await checkDatabase();
  return {
    status: 'ok',
    mode: config.INTEGRATION_MODE,
    queue: 'mysql',
    timezone: 'Asia/Jakarta',
  };
}
export const listAudit = () => recentAudit();
export const listJobs = () => recentJobs();
