export type InvoiceItem = {
  id: string;
  name: string;
  kind: 'service' | 'product' | 'gift_card' | 'voucher' | 'tip' | 'service_charge';
  quantity: number;
  unitPrice: number;
  discount: number;
  discountPercent?: number;
  discountRoundingAdjustment?: number;
  taxPercent?: number;
  taxRoundingAdjustment?: number;
  tax: number;
  mapped: boolean;
  redeemed?: boolean;
  redemptionNote?: string;
};

export type InvoicePayment = {
  id: string;
  method: 'bank' | 'cash' | 'gift_card' | 'voucher' | 'qris' | 'card' | 'other';
  amount: number;
  paidAt: string;
};
