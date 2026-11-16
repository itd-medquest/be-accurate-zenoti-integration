import type { Invoice } from '../schema/index.js';
const names = [
  'Nadia Putri',
  'Andi Pratama',
  'Citra Wijaya',
  'Budi Santoso',
  'Dewi Lestari',
  'Rizky Aditya',
  'Maya Kusuma',
  'Fajar Hidayat',
];
export function sampleInvoices(branchId = 'branch-jakarta'): Invoice[] {
  return Array.from({ length: 36 }, (_, i) => {
    const date = new Date();
    date.setUTCHours(3, (i * 7) % 60, 0, 0);
    date.setUTCDate(date.getUTCDate() - Math.floor(i / 3));
    const closed = i % 3 !== 0;
    const amount = 350000 + (i % 8) * 125000;
    const tax = Math.round(amount * 0.11);
    const total = amount + tax;
    const paid = closed ? total : i % 2 === 0 ? Math.floor(total / 2) : 0;
    const id = `invoice-${i + 1}`;
    const exception =
      i === 5 ? 'MAPPING' : i === 8 ? 'TIMEOUT' : i === 11 ? 'REFUND' : i === 17 ? 'VOID' : null;
    const kind =
      i === 14
        ? 'gift_card'
        : i === 20
          ? 'voucher'
          : i === 23
            ? 'tip'
            : i === 26
              ? 'service_charge'
              : 'service';
    return {
      id,
      sourceId: `zenoti-${i + 1}`,
      number: `ZNT-${date.getFullYear()}-${String(10480 + i).padStart(5, '0')}`,
      branchId,
      customer: names[i % names.length],
      customerId: `guest-${i % names.length}`,
      date,
      dueDate: closed ? null : new Date(date.getTime() + 14 * 86400000),
      businessStatus: exception === 'VOID' ? 'VOIDED' : closed ? 'CLOSED' : 'OPEN',
      paymentStatus: paid === total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID',
      syncStatus: 'PENDING',
      total,
      outstanding: total - paid,
      tax,
      discount: 0,
      items: [
        {
          id: `item-${i}`,
          name:
            kind === 'gift_card'
              ? 'Gift card wellness'
              : kind === 'voucher'
                ? 'Voucher treatment'
                : kind === 'tip'
                  ? 'Tip terapis'
                  : kind === 'service_charge'
                    ? 'Service charge'
                    : [
                        'Signature facial',
                        'Body treatment',
                        'Wellness consultation',
                        'Hair & scalp therapy',
                      ][i % 4],
          kind,
          quantity: 1,
          unitPrice: amount,
          discount: 0,
          tax,
          mapped: exception !== 'MAPPING',
        },
      ],
      payments: paid
        ? [
            {
              id: `payment-${i}`,
              method: i % 7 === 0 ? 'gift_card' : i % 5 === 0 ? 'voucher' : i % 2 ? 'bank' : 'cash',
              amount: paid,
              paidAt: date.toISOString(),
            },
          ]
        : [],
      sourceHash: null,
      exception,
      error: null,
      version: 1,
      createdAt: date,
      updatedAt: date,
    };
  });
}
