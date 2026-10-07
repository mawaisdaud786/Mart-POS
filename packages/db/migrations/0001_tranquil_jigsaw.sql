CREATE TABLE `sale_items` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`sale_id` binary(16) NOT NULL,
	`line_no` int NOT NULL,
	`product_id` binary(16) NOT NULL,
	`name` varchar(200) NOT NULL,
	`unit` varchar(60) NOT NULL,
	`qty` decimal(14,3) NOT NULL,
	`price` bigint NOT NULL,
	`discount` bigint NOT NULL DEFAULT 0,
	`cost` bigint NOT NULL,
	`returned_qty` decimal(14,3) NOT NULL DEFAULT 0,
	CONSTRAINT `sale_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `sale_items_line_uq` UNIQUE(`tenant_id`,`sale_id`,`line_no`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
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
	`customer_id` binary(16),
	`subtotal` bigint NOT NULL,
	`discount` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL,
	`paid` bigint NOT NULL,
	`change_amount` bigint NOT NULL DEFAULT 0,
	`credit` bigint NOT NULL DEFAULT 0,
	`payments` json NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'completed',
	`returned_total` bigint NOT NULL DEFAULT 0,
	`note` text,
	CONSTRAINT `sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `sales_no_uq` UNIQUE(`tenant_id`,`no`),
	CONSTRAINT `sales_status_ck` CHECK(`sales`.`status` in ('completed','void')),
	CONSTRAINT `sales_totals_ck` CHECK(`sales`.`subtotal` >= 0 and `sales`.`discount` >= 0 and `sales`.`total` >= 0 and `sales`.`paid` >= 0 and `sales`.`credit` >= 0)
);
--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `fk_sale_items_sale` FOREIGN KEY (`tenant_id`,`sale_id`) REFERENCES `sales`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sale_items` ADD CONSTRAINT `fk_sale_items_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sale_items_product_idx` ON `sale_items` (`tenant_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `sales_date_idx` ON `sales` (`tenant_id`,`branch_id`,`occurred_at`);