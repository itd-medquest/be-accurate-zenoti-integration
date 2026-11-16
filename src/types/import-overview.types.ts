export type ImportCounts = {
  sent: number;
  draft: number;
  failed: number;
  redeem: number;
  processing: number;
};

export type ImportHistoryEntry = {
  id: string;
  status: string;
  branchId: string;
  version: number;
  createdAt: string;
  invoiceCount: number;
  references: string[];
  counts: ImportCounts & { simulation: number; local: number };
};

export type ImportOverview = {
  items: ImportHistoryEntry[];
  total: number;
  summary: ImportCounts;
};
