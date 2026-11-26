# Package Benefit extraction and review exceptions

Native Zenoti PDFs with a structured Benefit / Type / Price / Discount / number-of-benefits table use that table as their item detail. A single billed parent may have any name, including Trial or Custom Package. The parent remains source provenance and is not added to the child item totals. Legacy tables without these structural headers retain their existing interpretation. Usage tables containing Used and Balance remain redemption references.

Discounts are interpreted per row: an explicit percent sign denotes a percentage; otherwise a valid rupiah amount denotes a nominal discount for the row. Price is the total price of the row in this structured layout. Unit price is Price divided by the number of benefits. Item kinds follow the existing service mapping behavior. Unreadable rows, ambiguous columns, missing quantities, invalid prices, excessive discounts, or multiple billed parents remain held for review rather than partially replacing the parent.

The complete table must fit existing quantity, precision, and monetary limits. Percentage rounding may reconcile only the existing bounded differences of at most Rp2 per adjustable line. Nominal source discounts are exact and locked; an all-nominal table with a source mismatch is held. Source subtotal, tax, total, payment identities, and the original PDF remain unchanged.

## Discount requests

Add-item and package-review requests accept exactly one of discountPercent or discountAmount. Correct-item requests accept either one or neither when preserving an unchanged allocation. Both together are rejected. discountAmount is a non-negative whole-rupiah discount for the extended row, bounded by quantity times unitPrice. Rates keep the existing maximum six-decimal precision.

Derived percentages are display values for nominal discounts and are not persisted as exact source rates. The frontend retains the exact rupiah discount while switching its display between percent and amount. An untouched item correction preserves existing rounding allocations.

## Review with a reason

The existing reviewed endpoint accepts an optional exceptionReason of 10-1000 trimmed characters. The backend only acknowledges a fixed allowlist of recoverable package extraction messages, after item and tax sums exactly match the immutable source, package parents have been replaced by attributed child lines, the invoice status is Open or Closed, and live-mode mapping checks pass.

Finance and Super Admin use their existing operator permissions. The client cannot supply an actor, approval fingerprint, arbitrary waived errors, or a reason directly to the submit endpoint. A reason never bypasses identity, source integrity, duplicate/conflict, financial, destination, authorization, or idempotency checks.

The acknowledgement is stored as optional metadata in the existing candidate JSON. It records the authenticated actor, timestamp, reason, extraction errors, and a canonical SHA-256 fingerprint of the reviewed draft. Changes to item details, status, or Accurate mapping clear the acknowledgement; other changes invalidate its fingerprint. Source extraction exceptions remain in the source candidate and are suppressed only for a current acknowledgement. Review and submission each write a dedicated audit event.

The preview response adds exceptionReview metadata for the UI. Approved notes remain visible when reopening the review, and the batch submit action identifies submissions containing a note. Accurate transaction payloads keep their existing financial contract; internal review reasons are retained in intgrte and its audit history.

## Existing drafts

The reparse endpoint accepts resetReview=true only for draft PDFs with recoverable package extraction errors. This operation requires explicit frontend confirmation because it replaces manual corrections, mappings, status, and review with a fresh parse of the same original PDF. The file hash and optimistic batch version are checked, submitted invoices cannot be replaced, and old rows are retained with DELETED status. Audit events identify the previous rows and review metadata. Previously valid drafts cannot use this flag to bypass the existing reparse restriction.

No new database columns, migration files, or environment variables are required. The changes use existing JSON candidate storage and audit records.

## Validation

Regression tests cover native mixed and nominal Benefit rows, Trial parents, multi-page tables, incomplete and invalid rows, exact nominal calculations, bounded rounding, frontend/backend calculation parity, API authorization, stale versions, review invalidation, audited submission, and confirmed re-reading. Existing percentage, OCR, redemption, mapping, delivery, receipt, and idempotency tests remain applicable. Database tests use disposable imp_test_* schemas through TEST_DATABASE_URL; browser scenarios mock their API.
