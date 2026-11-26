ALTER TABLE `accurate_receipts` ADD `payment_source_key` varchar(64);--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD `receipt_sequence` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD `base_number` varchar(255);--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD `amount_mode` varchar(12) DEFAULT 'FULL' NOT NULL;--> statement-breakpoint
ALTER TABLE `accurate_receipts` ADD `input_amount` int;