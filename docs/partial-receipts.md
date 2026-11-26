# Multiple payments and partial bank settlements

An invoice can have several independent source payments. Each source payment is reviewed against its own bank/method mapping and can be received in several stages. The ordinary single-payment flow still defaults to the full source amount with the existing fee calculation.

## Finance workflow

1. Open the invoice in Sales Receipts. If there are several source payments, select the payment to review. Source amounts and identities remain immutable.
2. Select the bank/method mapping as before. For a partial settlement, enable **Catat nominal aktual / penerimaan sebagian**.
3. Choose whether the amount is **NET** (the bank statement amount, already after fees) or **GROSS** (the amount before fees). Enter whole rupiah; the frontend formats currency, while the API receives an integer.
4. Save the draft, review the computed gross allocation, fee and net bank receipt, then confirm delivery. A draft alone does not change Accurate.
5. After a stage is verified, the remaining allocation stays receivable in Accurate. Use **Catat penerimaan berikutnya** when more money reaches the bank, or open another source payment on the same invoice.

Successful stages are immutable. A later receipt is a new record, not an edit or resend of a successful receipt. The invoice-level status is **Diterima sebagian** while some allocations are verified and some source amount remains. Processing or reconciliation errors take priority so uncertain deliveries remain visible. **Berhasil** requires all source payments to be fully allocated through verified stages.

## Amounts and fees

Accurate continues to receive gross `detailInvoice.paymentAmount`, the fee as an expense discount allocation, and net `chequeAmount`. Net input is converted back to gross using the configured method rate; its fee is not deducted a second time.

For example, at 2%, a net bank receipt of IDR 490,000 allocates IDR 500,000 against receivables and IDR 10,000 to the configured fee expense. The rest of a IDR 1,000,000 source payment remains receivable.

Fee rounding is cumulative for each source payment, method and rate: the fee for a stage is the ceiling of the cumulative gross fee minus fees already verified in that bucket. This preserves the full-payment fee across partial stages. Different source payments are not combined for fee rounding. NET inversion prefers the entire remaining gross when its net exactly matches the input, avoiding a one-rupiah remainder caused by inverse rounding. Inputs that exceed the remaining source payment, produce a non-positive net, or cannot match the configured fee are rejected. Source amounts, invoice totals, outstanding invoice identity and account currency validations remain in force.

## Configurable bank rates

Settings stores an optional default rate on each company/database/bank/method mapping. Existing null values keep the established defaults: credit card 2%, debit 1.8%, QRIS 0.7%, and bank transfer 0%. Mapping updates are versioned and audited, including old/new rates. The API accepts integer `rateBps` from 0 through 9999, representing 0–99.99%.

Finance can set `rateOverrideBps` on an unattempted draft receipt, or send null to return to its mapping default. Omitting the field retains an existing override when the mapping is unchanged; selecting another mapping resets it. Overrides affect that receipt stage only and never update Settings. A later partial stage starts with the then-current mapping default. The rate used for a successful stage remains immutable.

Both preview and server calculation use the selected rate, including NET inversion and cumulative fee rounding. Prior gross/fees are grouped by source payment, method, and rate so changing the rate does not apply historical fees from another rate. Detail responses add `feeBasisByRate` for exact previews; the existing `feeBasis` field is retained for compatibility. The queue and read-only reconciliation use frozen rate/amount snapshots; live and simulation use identical calculations.

## Numbering and delivery safety

The first receipt uses the document receipt number. Further stages reserve `-A`, `-B`, ..., `-Z`, `-AA` suffixes in creation order under an invoice transaction lock. The ordinal is shared across payments on that invoice, so separate payment groups do not reuse the same number. Numbers exceeding Accurate's existing 255-character limit are rejected.

If the document receipt is missing, Finance can supply an audited base number. It is shared by subsequent stages. A manually entered base can still be corrected for a single unattempted draft; once multiple stages share it, it cannot be changed. Source document numbers cannot be overridden.

Preparing the same source concurrently returns its existing active draft. A continuation is only created after the preceding stages of that source are verified. Repeated preparation after completion returns the latest successful stage. Amounts and source versions are checked again under the invoice lock. Another queued, sending or uncertain attempted receipt on the invoice prevents a new delivery until reconciliation completes. Live Accurate outstanding is checked before delivery.

Timeouts retain the original frozen payload and number. Read-only reconciliation must establish the outcome; creating a continuation or retrying an uncertain write does not issue another POST. Existing legacy queued payloads retain their frozen number and description.

## Simulation workflow

Successfully simulated sales invoices also appear in Sales Receipts. Finance can review each source payment, select virtual bank/expense accounts, and complete full or partial receipt stages using the same amount and fee calculations. These stages are explicitly labeled as simulations; they require no Accurate credentials and never call Accurate APIs. An active company in simulation mode can review and complete these local receipts even when its Accurate connection switch is disabled. This does not enable that connection or change live delivery requirements.

Virtual account mappings, receipt numbers, and settled amounts use a separate company-specific simulation namespace. Simulation history cannot settle an actual invoice or consume its receipt numbering. Switching the connection to live mode holds pending simulation work for review instead of sending it to Accurate. Existing simulation history remains readable. This extension uses existing tables and JSON metadata and requires no additional migration beyond the partial-receipt migration below.

## Database and deployment

Apply `npm run db:migrate` **before** starting the updated API or worker. Migration `mysql/0002_amusing_hex.sql` adds five columns to `accurate_receipts`: `payment_source_key`, `receipt_sequence`, `base_number`, `amount_mode`, and `input_amount`. It does not delete records, change historical column definitions, alter existing unique constraints, or migrate source invoice/payment values.

Legacy receipts default to ordinal zero and FULL mode; a missing `payment_source_key` uses the existing `source_key`. Existing uniqueness and idempotency constraints remain active. `PARTIAL` is a derived invoice overview status, not a replacement for individual delivery statuses. API draft fields `amountMode` and `inputAmount`, overview settlement data, and detail payment/history data are additive.

Migration `mysql/0003_configurable_receipt_rates.sql` additionally adds nullable `receipt_account_mappings.rate_bps` and `accurate_receipts.rate_override_bps`. It preserves existing column definitions, stored rate snapshots, sources, and amounts. Apply it before deploying the configurable-rate API/worker; existing null mappings use their former defaults. Deploy the matching frontend to expose default and receipt-specific rate controls.

Deploy frontend and backend together. Existing parsed payments remain unchanged; newly uploaded PDFs also recognize wrapped bank-transfer labels next to separate card payments.

## Verification

Backend coverage uses isolated `imp_test_*` MySQL schemas and mocked Accurate requests. It covers full-payment regressions, multiple mappings, net/gross conversion, cumulative rounding, source caps, immutable successful stages, invoice-wide numbering, concurrent preparation, retries and uncertain-write reconciliation. Browser tests cover desktop/mobile review, currency-only display formatting, partial status filters, continuation, mapping selection and final settlement. Tests do not send financial records to a real Accurate database.
