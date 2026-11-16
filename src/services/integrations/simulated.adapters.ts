import { randomUUID } from 'node:crypto';
import * as simulatedDraftsRepository from '../../repositories/simulated-drafts.repository.js';

import { sampleInvoices } from '../../db/fixtures/invoices.js';
import type { simulatedDrafts, Branch, Invoice } from '../../db/schema/index.js';
export class AmbiguousWrite extends Error {}
export interface AccurateAdapter {
  find(
    reference: string,
    databaseId: string,
  ): Promise<typeof simulatedDrafts.$inferSelect | undefined>;
  saveDraft(invoice: Invoice, branch: Branch): Promise<typeof simulatedDrafts.$inferSelect>;
}
export class SimulatedAccurate implements AccurateAdapter {
  async find(reference: string, databaseId: string) {
    return simulatedDraftsRepository.findByReference(reference, databaseId);
  }
  async saveDraft(invoice: Invoice, branch: Branch) {
    const existing = await this.find(invoice.sourceId, branch.accurateDatabaseId);
    const [draft] = await simulatedDraftsRepository.upsert(
      {
        id: randomUUID(),
        reference: invoice.sourceId,
        databaseId: branch.accurateDatabaseId,
        branchId: branch.accurateBranchId,
        number: `DRAFT-${invoice.number}`,
        total: invoice.total,
        version: invoice.version,
        paymentIds: invoice.payments.map((p) => p.id),
      },
      {
        total: invoice.total,
        version: invoice.version,
        paymentIds: invoice.payments.map((p) => p.id),
      },
    );
    if (invoice.exception === 'TIMEOUT' && !existing)
      throw new AmbiguousWrite(
        'Respons Accurate timeout. Draft mungkin telah tersimpan; jalankan pemeriksaan dan retry untuk mencari referensi terlebih dahulu.',
      );
    return draft;
  }
}
export class SimulatedZenoti {
  async fetch(branchId: string) {
    return sampleInvoices(branchId);
  }
}
export const accurate = new SimulatedAccurate();
export const zenoti = new SimulatedZenoti();
