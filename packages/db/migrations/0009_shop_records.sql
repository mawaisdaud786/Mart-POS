CREATE TABLE `shop_records` (
	`tenant_id` binary(16) NOT NULL,
	`collection` varchar(24) NOT NULL,
	`id` varchar(64) NOT NULL,
	`k1` varchar(80),
	`k2` varchar(80),
	`k3` varchar(80),
	`k4` varchar(80),
	`data` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	CONSTRAINT `shop_records_tenant_id_collection_id_pk` PRIMARY KEY(`tenant_id`,`collection`,`id`)
);
--> statement-breakpoint
CREATE INDEX `shop_records_k1_idx` ON `shop_records` (`tenant_id`,`collection`,`k1`);--> statement-breakpoint
CREATE INDEX `shop_records_k2_idx` ON `shop_records` (`tenant_id`,`collection`,`k2`,`k1`);--> statement-breakpoint
CREATE INDEX `shop_records_k3_idx` ON `shop_records` (`tenant_id`,`collection`,`k3`,`k1`);--> statement-breakpoint
CREATE INDEX `shop_records_k4_idx` ON `shop_records` (`tenant_id`,`collection`,`k4`);