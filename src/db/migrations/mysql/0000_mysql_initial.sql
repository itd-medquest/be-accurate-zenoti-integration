CREATE TABLE `audit_logs` (
	`id` varchar(64) NOT NULL,
	`actor_id` varchar(64),
	`action` varchar(255) NOT NULL,
	`entity_id` varchar(64),
	`details` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `accurate_deliveries` (
	`invoice_id` varchar(64) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`target_branch_id` varchar(64) NOT NULL,
	`source_version` int NOT NULL,
	`requested_number` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`expected_total` int NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'PENDING',
	`attempted_at` datetime(3),
	`target_id` varchar(64),
	`target_number` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accurate_deliveries_invoice_id` PRIMARY KEY(`invoice_id`),
	CONSTRAINT `accurate_delivery_number_unique` UNIQUE(`database_id`,`target_branch_id`,`target_number`),
	CONSTRAINT `accurate_delivery_requested_unique` UNIQUE(`database_id`,`requested_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `accurate_destinations` (
	`branch_id` varchar(64) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`database_name` varchar(255) NOT NULL,
	`target_branch_id` varchar(64) NOT NULL,
	`target_branch_name` varchar(255) NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accurate_destinations_branch_id` PRIMARY KEY(`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `accurate_mappings` (
	`id` varchar(64) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`kind` varchar(64) NOT NULL,
	`source_key` varchar(512) NOT NULL,
	`target_id` varchar(64) NOT NULL,
	`target_code` varchar(255) NOT NULL,
	`target_name` varchar(255) NOT NULL,
	`unit_name` varchar(255) NOT NULL DEFAULT '',
	`item_type` varchar(255) NOT NULL DEFAULT '',
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accurate_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `accurate_mapping_source_unique` UNIQUE(`branch_id`,`database_id`,`kind`,`source_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` varchar(64) NOT NULL,
	`account_id` varchar(64) NOT NULL,
	`provider_id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` datetime(3),
	`refresh_token_expires_at` datetime(3),
	`scope` text,
	`password` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`ip_address` varchar(255),
	`user_agent` text,
	`user_id` varchar(64) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_unique` UNIQUE(`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(64) NOT NULL,
	`name` text NOT NULL,
	`email` varchar(320) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`role` varchar(255) NOT NULL DEFAULT 'viewer',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` varchar(64) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `verifications_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` varchar(64) NOT NULL,
	`name` text NOT NULL,
	`center_id` varchar(64) NOT NULL,
	`accurate_database_id` varchar(64) NOT NULL,
	`accurate_branch_id` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_center_id_unique` UNIQUE(`center_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` varchar(64) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`uploader_id` varchar(64) NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'PREVIEW',
	`version` int NOT NULL DEFAULT 1,
	`submitted_by` varchar(255),
	`submitted_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `import_batches_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `import_files` (
	`id` varchar(64) NOT NULL,
	`batch_id` varchar(64) NOT NULL,
	`name` text NOT NULL,
	`stored_name` varchar(255) NOT NULL,
	`hash` varchar(255) NOT NULL,
	`size` int NOT NULL,
	`format` varchar(255) NOT NULL,
	`error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `import_files_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` varchar(64) NOT NULL,
	`batch_id` varchar(64) NOT NULL,
	`file_id` varchar(64) NOT NULL,
	`position` int NOT NULL,
	`candidate` json NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'REVIEW',
	`invoice_id` varchar(64),
	`duplicate_invoice_id` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `import_rows_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `integration_configs` (
	`id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`encrypted_secret` text,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `integration_configs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `scheduler_configs` (
	`id` varchar(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`interval_minutes` int NOT NULL DEFAULT 60,
	`next_run_at` datetime(3),
	`last_run_at` datetime(3),
	CONSTRAINT `scheduler_configs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` varchar(64) NOT NULL,
	`source_id` varchar(64) NOT NULL,
	`number` varchar(255) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`customer` text NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`date` datetime(3) NOT NULL,
	`due_date` datetime(3),
	`business_status` varchar(255) NOT NULL,
	`payment_status` varchar(255) NOT NULL,
	`sync_status` varchar(255) NOT NULL DEFAULT 'PENDING',
	`total` int NOT NULL,
	`outstanding` int NOT NULL,
	`discount` int NOT NULL DEFAULT 0,
	`tax` int NOT NULL DEFAULT 0,
	`items` json NOT NULL,
	`payments` json NOT NULL,
	`exception` varchar(255),
	`error` text,
	`version` int NOT NULL DEFAULT 1,
	`source_hash` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_source_branch_unique` UNIQUE(`source_id`,`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `invoice_syncs` (
	`id` varchar(64) NOT NULL,
	`invoice_id` varchar(64) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`target_id` varchar(64) NOT NULL,
	`target_number` varchar(255) NOT NULL,
	`target_status` varchar(255) NOT NULL DEFAULT 'DRAFT',
	`version` int NOT NULL,
	`payment_ids` json NOT NULL,
	`synced_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoice_syncs_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_destination_unique` UNIQUE(`invoice_id`,`database_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(64) NOT NULL,
	`invoice_id` varchar(64) NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'QUEUED',
	`actor_id` varchar(64),
	`attempts` int NOT NULL DEFAULT 0,
	`available_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`locked_at` datetime(3),
	`error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`finished_at` datetime(3),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `simulated_drafts` (
	`id` varchar(64) NOT NULL,
	`reference` varchar(255) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`number` varchar(255) NOT NULL,
	`total` int NOT NULL,
	`version` int NOT NULL,
	`payment_ids` json NOT NULL,
	CONSTRAINT `simulated_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `draft_reference_database_unique` UNIQUE(`reference`,`database_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `sync_attempts` (
	`id` varchar(64) NOT NULL,
	`invoice_id` varchar(64) NOT NULL,
	`actor_id` varchar(64),
	`status` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`response` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sync_attempts_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `accurate_receipts` (
	`id` varchar(64) NOT NULL,
	`invoice_id` varchar(64) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`target_branch_id` varchar(64) NOT NULL,
	`source_key` varchar(512) NOT NULL,
	`source_fingerprint` varchar(255) NOT NULL,
	`source_payments` json NOT NULL,
	`source_method` varchar(255) NOT NULL,
	`gross_amount` int NOT NULL,
	`number` varchar(255) NOT NULL,
	`mapping_id` varchar(64),
	`mapping_version` int,
	`bank` varchar(255),
	`method` varchar(255),
	`bank_account_no` varchar(255),
	`bank_account_name` varchar(255),
	`fee_account_no` varchar(255),
	`fee_account_name` varchar(255),
	`rate_bps` int NOT NULL DEFAULT 0,
	`fee_amount` int NOT NULL DEFAULT 0,
	`net_amount` int NOT NULL DEFAULT 0,
	`payment_date` varchar(255) NOT NULL DEFAULT '',
	`payment_reference` varchar(255) NOT NULL DEFAULT '',
	`notes` varchar(4000) NOT NULL DEFAULT '',
	`version` int NOT NULL DEFAULT 1,
	`status` varchar(255) NOT NULL DEFAULT 'DRAFT',
	`reviewed_at` datetime(3),
	`queued_at` datetime(3),
	`attempted_at` datetime(3),
	`completed_at` datetime(3),
	`payload` json,
	`verification` json,
	`target_id` varchar(64),
	`target_number` varchar(255),
	`error` text,
	`actor_id` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `accurate_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipt_source_unique` UNIQUE(`invoice_id`,`source_key`),
	CONSTRAINT `receipt_number_unique` UNIQUE(`database_id`,`number`),
	CONSTRAINT `receipt_target_unique` UNIQUE(`database_id`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `receipt_account_mappings` (
	`id` varchar(64) NOT NULL,
	`branch_id` varchar(64) NOT NULL,
	`database_id` varchar(64) NOT NULL,
	`bank` varchar(255) NOT NULL,
	`method` varchar(255) NOT NULL,
	`account_id` varchar(64) NOT NULL,
	`account_no` varchar(255) NOT NULL,
	`account_name` varchar(255) NOT NULL,
	`fee_account_id` varchar(64),
	`fee_account_no` varchar(255),
	`fee_account_name` varchar(255),
	`version` int NOT NULL DEFAULT 1,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `receipt_account_mappings_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipt_account_mapping_unique` UNIQUE(`branch_id`,`database_id`,`bank`,`method`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `application_locks` (
	`name` varchar(64) NOT NULL,
	CONSTRAINT `application_locks_name` PRIMARY KEY(`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
ALTER TABLE `accurate_deliveries` ADD CONSTRAINT `accurate_deliveries_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accurate_deliveries` ADD CONSTRAINT `accurate_deliveries_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accurate_destinations` ADD CONSTRAINT `accurate_destinations_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accurate_mappings` ADD CONSTRAINT `accurate_mappings_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_uploader_id_users_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_files` ADD CONSTRAINT `import_files_batch_id_import_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_batch_id_import_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_file_id_import_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `import_files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_syncs` ADD CONSTRAINT `invoice_syncs_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sync_attempts` ADD CONSTRAINT `sync_attempts_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD CONSTRAINT `accurate_receipts_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD CONSTRAINT `accurate_receipts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD CONSTRAINT `accurate_receipts_mapping_id_receipt_account_mappings_id_fk` FOREIGN KEY (`mapping_id`) REFERENCES `receipt_account_mappings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipt_account_mappings` ADD CONSTRAINT `receipt_account_mappings_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `import_rows_batch_idx` ON `import_rows` (`batch_id`);--> statement-breakpoint
CREATE INDEX `invoice_date_status_idx` ON `invoices` (`date`,`sync_status`);--> statement-breakpoint
CREATE INDEX `receipt_queue_idx` ON `accurate_receipts` (`status`,`queued_at`);
--> statement-breakpoint
INSERT INTO `application_locks` (`name`) VALUES ('users');
