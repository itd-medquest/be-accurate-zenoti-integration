CREATE TABLE "accurate_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"database_id" text NOT NULL,
	"target_branch_id" text NOT NULL,
	"source_key" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"source_payments" jsonb NOT NULL,
	"source_method" text NOT NULL,
	"gross_amount" integer NOT NULL,
	"number" text NOT NULL,
	"mapping_id" text,
	"mapping_version" integer,
	"bank" text,
	"method" text,
	"bank_account_no" text,
	"bank_account_name" text,
	"fee_account_no" text,
	"fee_account_name" text,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"fee_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"payment_date" text DEFAULT '' NOT NULL,
	"payment_reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"payload" jsonb,
	"target_id" text,
	"target_number" text,
	"error" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_account_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"database_id" text NOT NULL,
	"bank" text NOT NULL,
	"method" text NOT NULL,
	"account_id" text NOT NULL,
	"account_no" text NOT NULL,
	"account_name" text NOT NULL,
	"fee_account_id" text,
	"fee_account_no" text,
	"fee_account_name" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accurate_receipts" ADD CONSTRAINT "accurate_receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accurate_receipts" ADD CONSTRAINT "accurate_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accurate_receipts" ADD CONSTRAINT "accurate_receipts_mapping_id_receipt_account_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."receipt_account_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_account_mappings" ADD CONSTRAINT "receipt_account_mappings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_source_unique" ON "accurate_receipts" USING btree ("invoice_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_number_unique" ON "accurate_receipts" USING btree ("database_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_target_unique" ON "accurate_receipts" USING btree ("database_id","target_id");--> statement-breakpoint
CREATE INDEX "receipt_queue_idx" ON "accurate_receipts" USING btree ("status","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_account_mapping_unique" ON "receipt_account_mappings" USING btree ("branch_id","database_id","bank","method");