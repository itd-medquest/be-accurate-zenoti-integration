import { createHash } from 'node:crypto';
import type { ImportCandidate } from '../types/import.types.js';
import type { AccurateDestination } from './accurate-payload.js';
import { chargeableItems } from './redemption.js';
export const mappingSourceKey = (source: string) =>
  createHash('sha256').update(source).digest('hex');
type SavedMapping = {
  kind: string;
  sourceKey: string;
  targetId: string;
  targetCode: string;
  targetName: string;
  unitName: string;
};
export function applySavedMappings(
  candidate: ImportCandidate,
  destination: AccurateDestination,
  mappings: SavedMapping[],
) {
  const customer = mappings.find(
    (mapping) =>
      mapping.kind === 'customer' && mapping.sourceKey === mappingSourceKey(candidate.customerId),
  );
  const selection: NonNullable<ImportCandidate['accurateSelection']> = {
    databaseId: destination.databaseId,
    targetBranchId: destination.targetBranchId,
    items: {},
  };
  if (customer)
    selection.customer = {
      id: customer.targetId,
      code: customer.targetCode,
      name: customer.targetName,
    };
  for (const item of chargeableItems(candidate.items)) {
    const mapping = mappings.find(
      (mapping) =>
        mapping.kind === 'item' &&
        mapping.sourceKey === mappingSourceKey(`${item.kind}:${item.name}`),
    );
    if (mapping)
      selection.items[item.id] = {
        id: mapping.targetId,
        code: mapping.targetCode,
        name: mapping.targetName,
        unitName: mapping.unitName,
      };
  }
  if (selection.customer || Object.keys(selection.items).length)
    candidate.accurateSelection = selection;
}
