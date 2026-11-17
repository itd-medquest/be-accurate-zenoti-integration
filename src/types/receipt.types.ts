import type { InvoicePayment } from './invoice.types.js';

export const receiptBanks = ['BCA', 'BNI'] as const;
export const receiptMethods = ['CREDIT_CARD', 'DEBIT_CARD', 'QRIS', 'BANK_TRANSFER'] as const;
export type ReceiptBank = (typeof receiptBanks)[number];
export type ReceiptMethod = (typeof receiptMethods)[number];
export const receiptRates: Record<ReceiptMethod, number> = {
  CREDIT_CARD: 200,
  DEBIT_CARD: 180,
  QRIS: 70,
  BANK_TRANSFER: 0,
};
export interface ReceiptAmounts {
  gross: number;
  rateBps: number;
  fee: number;
  net: number;
}
export interface ReceiptSourceGroup {
  key: string;
  fingerprint: string;
  method: InvoicePayment['method'];
  paidAt: string;
  gross: number;
  payments: InvoicePayment[];
  grouped: boolean;
}
export interface AccurateReceiptPayload {
  number: string;
  bankNo: string;
  customerNo: string;
  branchId: number;
  currencyCode: 'IDR';
  transDate: string;
  chequeAmount: number;
  paymentMethod: ReceiptMethod;
  description: string;
  detailInvoice: {
    invoiceNo: string;
    paymentAmount: number;
    detailDiscount?: { accountNo: string; amount: number; discountNotes: string }[];
  }[];
}

export interface ReceiptVerification {
  invoiceId: string;
  customerId: string;
  currencyId: string;
  bankId: string;
  feeAccountId: string | null;
  outstandingBefore: number;
  writeRejected: boolean;
}
