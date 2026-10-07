CREATE TABLE `customer_ledger_entries` (
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
	`customer_id` binary(16) NOT NULL,
	`sale_id` binary(16),
	`amount` bigint NOT NULL,
	`type` varchar(20) NOT NULL,
	`account_id` varchar(64),
	`note` varchar(500),
	CONSTRAINT `customer_ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_ledger_sale_uq` UNIQUE(`tenant_id`,`sale_id`),
	CONSTRAINT `customer_ledger_type_ck` CHECK(`customer_ledger_entries`.`type` in ('sale','payment','adjustment'))
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`name` varchar(160) NOT NULL,
	`phone` varchar(32),
	`address` text,
	`credit_limit` bigint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`created_by` binary(16),
	`updated_at` datetime(3) NOT NULL,
	`updated_by` binary(16),
	`deleted_at` datetime(3),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `customers_credit_limit_ck` CHECK(`customers`.`credit_limit` >= 0)
);
--> statement-breakpoint
ALTER TABLE `customer_ledger_entries` ADD CONSTRAINT `fk_customer_ledger_customer` FOREIGN KEY (`tenant_id`,`customer_id`) REFERENCES `customers`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_ledger_entries` ADD CONSTRAINT `fk_customer_ledger_sale` FOREIGN KEY (`tenant_id`,`sale_id`) REFERENCES `sales`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `customer_ledger_customer_idx` ON `customer_ledger_entries` (`tenant_id`,`customer_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`tenant_id`,`phone`);