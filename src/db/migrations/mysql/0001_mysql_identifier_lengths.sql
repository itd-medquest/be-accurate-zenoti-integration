ALTER TABLE `accurate_deliveries` DROP FOREIGN KEY `accurate_deliveries_invoice_id_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` DROP FOREIGN KEY `accurate_deliveries_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_destinations` DROP FOREIGN KEY `accurate_destinations_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` DROP FOREIGN KEY `accurate_mappings_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `accounts` DROP FOREIGN KEY `accounts_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `sessions` DROP FOREIGN KEY `sessions_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `import_batches` DROP FOREIGN KEY `import_batches_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `import_batches` DROP FOREIGN KEY `import_batches_uploader_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `import_files` DROP FOREIGN KEY `import_files_batch_id_import_batches_id_fk`;
--> statement-breakpoint
ALTER TABLE `import_rows` DROP FOREIGN KEY `import_rows_batch_id_import_batches_id_fk`;
--> statement-breakpoint
ALTER TABLE `import_rows` DROP FOREIGN KEY `import_rows_file_id_import_files_id_fk`;
--> statement-breakpoint
ALTER TABLE `import_rows` DROP FOREIGN KEY `import_rows_invoice_id_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `invoices` DROP FOREIGN KEY `invoices_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `invoice_syncs` DROP FOREIGN KEY `invoice_syncs_invoice_id_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `jobs` DROP FOREIGN KEY `jobs_invoice_id_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `sync_attempts` DROP FOREIGN KEY `sync_attempts_invoice_id_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` DROP FOREIGN KEY `accurate_receipts_invoice_id_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` DROP FOREIGN KEY `accurate_receipts_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` DROP FOREIGN KEY `accurate_receipts_mapping_id_receipt_account_mappings_id_fk`;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` DROP FOREIGN KEY `receipt_account_mappings_branch_id_branches_id_fk`;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` MODIFY COLUMN `source_key` varchar(64) NOT NULL;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `bank` varchar(64) NOT NULL;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `method` varchar(64) NOT NULL;
--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `actor_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `audit_logs` MODIFY COLUMN `entity_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` MODIFY COLUMN `invoice_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` MODIFY COLUMN `target_branch_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` MODIFY COLUMN `target_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `accurate_destinations` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_destinations` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_destinations` MODIFY COLUMN `target_branch_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` MODIFY COLUMN `target_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounts` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounts` MODIFY COLUMN `account_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounts` MODIFY COLUMN `provider_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounts` MODIFY COLUMN `user_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `user_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `verifications` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `branches` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `branches` MODIFY COLUMN `center_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `branches` MODIFY COLUMN `accurate_database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `branches` MODIFY COLUMN `accurate_branch_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_batches` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_batches` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_batches` MODIFY COLUMN `uploader_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_files` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_files` MODIFY COLUMN `batch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_rows` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_rows` MODIFY COLUMN `batch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_rows` MODIFY COLUMN `file_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `import_rows` MODIFY COLUMN `invoice_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `import_rows` MODIFY COLUMN `duplicate_invoice_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `integration_configs` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `scheduler_configs` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` MODIFY COLUMN `source_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` MODIFY COLUMN `customer_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoice_syncs` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoice_syncs` MODIFY COLUMN `invoice_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoice_syncs` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoice_syncs` MODIFY COLUMN `target_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `jobs` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `jobs` MODIFY COLUMN `invoice_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `jobs` MODIFY COLUMN `actor_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `simulated_drafts` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `simulated_drafts` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `simulated_drafts` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `sync_attempts` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `sync_attempts` MODIFY COLUMN `invoice_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `sync_attempts` MODIFY COLUMN `actor_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `invoice_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `target_branch_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `source_key` varchar(64) NOT NULL;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `mapping_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `target_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `accurate_receipts` MODIFY COLUMN `actor_id` varchar(100);
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `branch_id` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `database_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `account_id` varchar(255) NOT NULL;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` MODIFY COLUMN `fee_account_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` ADD CONSTRAINT `accurate_deliveries_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` ADD CONSTRAINT `accurate_deliveries_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accurate_destinations` ADD CONSTRAINT `accurate_destinations_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accurate_mappings` ADD CONSTRAINT `accurate_mappings_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_uploader_id_users_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `import_files` ADD CONSTRAINT `import_files_batch_id_import_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_batch_id_import_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_file_id_import_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `import_files`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `invoice_syncs` ADD CONSTRAINT `invoice_syncs_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `sync_attempts` ADD CONSTRAINT `sync_attempts_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD CONSTRAINT `accurate_receipts_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD CONSTRAINT `accurate_receipts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD CONSTRAINT `accurate_receipts_mapping_id_receipt_account_mappings_id_fk` FOREIGN KEY (`mapping_id`) REFERENCES `receipt_account_mappings`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` ADD CONSTRAINT `receipt_account_mappings_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
