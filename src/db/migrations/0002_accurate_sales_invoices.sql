CREATE TABLE "accurate_deliveries" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"database_id" text NOT NULL,
	"target_branch_id" text NOT NULL,
	"source_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"expected_total" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempted_at" timestamp with time zone,
	"target_id" text,
	"target_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accurate_destinations" (
	"branch_id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
	"database_name" text NOT NULL,
	"target_branch_id" text NOT NULL,
	"target_branch_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accurate_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"database_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"target_id" text NOT NULL,
	"target_code" text NOT NULL,
	"target_name" text NOT NULL,
	"unit_name" text DEFAULT '' NOT NULL,
	"item_type" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accurate_deliveries" ADD CONSTRAINT "accurate_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accurate_deliveries" ADD CONSTRAINT "accurate_deliveries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accurate_destinations" ADD CONSTRAINT "accurate_destinations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accurate_mappings" ADD CONSTRAINT "accurate_mappings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accurate_delivery_number_unique" ON "accurate_deliveries" USING btree ("database_id","target_branch_id","target_number");--> statement-breakpoint
CREATE UNIQUE INDEX "accurate_mapping_source_unique" ON "accurate_mappings" USING btree ("branch_id","database_id","kind","source_key");