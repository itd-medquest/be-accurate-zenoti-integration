import * as repository from '../repositories/import-overview.repository.js';
import type { ImportOverviewQuery } from '../validations/import-overview.validation.js';

export function getImportOverview(query: ImportOverviewQuery) {
  return repository.overview(query);
}
