ALTER TABLE `sales` ADD `ghar_order_id` binary(16);--> statement-breakpoint
ALTER TABLE `sales` ADD `delivery_fee` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ghar_orders` ADD `sale_id` binary(16);--> statement-breakpoint
ALTER TABLE `ghar_orders` ADD CONSTRAINT `ghar_orders_sale_uq` UNIQUE(`tenant_id`,`sale_id`);--> statement-breakpoint
ALTER TABLE `ghar_orders` ADD CONSTRAINT `fk_ghar_orders_sale` FOREIGN KEY (`tenant_id`,`sale_id`) REFERENCES `sales`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;