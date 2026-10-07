ALTER TABLE `products` ADD `threshold_price` bigint;--> statement-breakpoint
ALTER TABLE `sales` ADD `delivery_address` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `pricing_mode` varchar(20) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `payment_method` varchar(20) DEFAULT 'cash' NOT NULL;