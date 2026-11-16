export type AccurateMode = 'simulation' | 'live';
export type AccurateTaxPolicy = 'gross-no-tax';
export type AccuratePayload = Record<string, string>;
export interface AccurateCredentials {
  version: 1;
  apiToken: string;
  signatureSecret: string;
  mode: AccurateMode;
  taxPolicy: AccurateTaxPolicy;
}
export interface AccurateProfile {
  id: string;
  name: string;
  host: string;
}
export interface AccurateMaster {
  id: string;
  code: string;
  name: string;
  unitName: string;
  itemType: string;
  suspended: boolean;
}
export type MasterKind = 'customer' | 'item' | 'branch';
export interface AccurateInvoiceResult {
  id: string;
  number: string;
  customerNo: string;
  branchId: string;
  total: number;
  approvalStatus: string;
  currencyCode: string;
  date: string;
}
