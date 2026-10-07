CREATE TABLE `inventory_reservations` (
	`tenant_id` binary(16) NOT NULL,
	`reservation_id` binary(16) NOT NULL,
	`branch_id` binary(16) NOT NULL,
	`device_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`lines` json NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `inventory_reservations_tenant_id_reservation_id_pk` PRIMARY KEY(`tenant_id`,`reservation_id`)
);
--> statement-breakpoint
ALTER TABLE `inventory_reservations` ADD CONSTRAINT `fk_inventory_reservations_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inventory_reservations_expiry_idx` ON `inventory_reservations` (`tenant_id`,`branch_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `inventory_reservations_device_idx` ON `inventory_reservations` (`tenant_id`,`device_id`,`status`);