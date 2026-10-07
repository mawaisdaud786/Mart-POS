CREATE TABLE `ghar_orders` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`server_seq` bigint NOT NULL DEFAULT 0,
	`branch_id` binary(16) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`received_at` datetime(3),
	`no` varchar(40) NOT NULL,
	`customer_id` binary(16) NOT NULL,
	`customer_name` varchar(160) NOT NULL,
	`phone` varchar(32),
	`address` varchar(1000) NOT NULL,
	`items` json NOT NULL,
	`subtotal` bigint NOT NULL,
	`delivery_fee` bigint NOT NULL,
	`total` bigint NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'invoice_draft',
	`note` varchar(1000),
	CONSTRAINT `ghar_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `ghar_orders_status_ck` CHECK(`ghar_orders`.`status` in ('invoice_draft','invoice_sent','confirmed','packing','out_for_delivery','delivered','cancelled'))
);
--> statement-breakpoint
ALTER TABLE `ghar_orders` ADD CONSTRAINT `fk_ghar_orders_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ghar_orders` ADD CONSTRAINT `fk_ghar_orders_customer` FOREIGN KEY (`tenant_id`,`customer_id`) REFERENCES `customers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ghar_orders_date_idx` ON `ghar_orders` (`tenant_id`,`branch_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ghar_orders_customer_idx` ON `ghar_orders` (`tenant_id`,`customer_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ghar_orders_status_idx` ON `ghar_orders` (`tenant_id`,`status`);