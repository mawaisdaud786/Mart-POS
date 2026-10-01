CREATE TABLE `admin_access_grants` (
	`id` binary(16) NOT NULL,
	`admin_id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`reason` text NOT NULL,
	`scope` varchar(10) NOT NULL DEFAULT 'read',
	`granted_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	CONSTRAINT `admin_access_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_access_grants_scope_ck` CHECK(`admin_access_grants`.`scope` in ('read','write'))
);
--> statement-breakpoint
CREATE TABLE `features` (
	`key` varchar(60) NOT NULL,
	`module` varchar(60) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	CONSTRAINT `features_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `plan_features` (
	`plan_id` binary(16) NOT NULL,
	`feature_key` varchar(60) NOT NULL,
	CONSTRAINT `plan_features_plan_id_feature_key_pk` PRIMARY KEY(`plan_id`,`feature_key`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` binary(16) NOT NULL,
	`code` varchar(40) NOT NULL,
	`name` varchar(80) NOT NULL,
	`description` text,
	`currency` varchar(3) NOT NULL DEFAULT 'PKR',
	`price_monthly` bigint NOT NULL DEFAULT 0,
	`price_yearly` bigint NOT NULL DEFAULT 0,
	`trial_days` int NOT NULL DEFAULT 14,
	`limits` json NOT NULL,
	`is_public` boolean NOT NULL DEFAULT true,
	`sort` int NOT NULL DEFAULT 0,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `platform_admins` (
	`id` binary(16) NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(190) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`totp_secret_enc` varbinary(255),
	`role` varchar(20) NOT NULL DEFAULT 'support',
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `platform_admins_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_admins_email_uq` UNIQUE(`email`),
	CONSTRAINT `platform_admins_role_ck` CHECK(`platform_admins`.`role` in ('super','support','billing')),
	CONSTRAINT `platform_admins_status_ck` CHECK(`platform_admins`.`status` in ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE `platform_audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`admin_id` binary(16),
	`tenant_id` binary(16),
	`action` varchar(80) NOT NULL,
	`target_type` varchar(60),
	`target_id` varchar(64),
	`before` json,
	`after` json,
	`ip` varbinary(16),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `platform_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`key` varchar(100) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_by` binary(16),
	CONSTRAINT `platform_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` binary(16) NOT NULL,
	`subscription_id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`event` varchar(30) NOT NULL,
	`from_status` varchar(20),
	`to_status` varchar(20),
	`data` json,
	`actor_admin_id` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `subscription_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`plan_id` binary(16) NOT NULL,
	`status` varchar(20) NOT NULL,
	`billing_cycle` varchar(10) NOT NULL DEFAULT 'monthly',
	`trial_ends_at` datetime(3),
	`current_period_start` datetime(3),
	`current_period_end` datetime(3),
	`grace_ends_at` datetime(3),
	`cancel_at_period_end` boolean NOT NULL DEFAULT false,
	`price_override` bigint,
	`overrides` json,
	`is_current` boolean NOT NULL DEFAULT true,
	`current_key` tinyint GENERATED ALWAYS AS ((if(`is_current`, 1, null))) STORED,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_current_uq` UNIQUE(`tenant_id`,`current_key`),
	CONSTRAINT `subscriptions_status_ck` CHECK(`subscriptions`.`status` in ('trialing','active','past_due','expired','suspended','cancelled')),
	CONSTRAINT `subscriptions_cycle_ck` CHECK(`subscriptions`.`billing_cycle` in ('monthly','yearly','custom'))
);
--> statement-breakpoint
CREATE TABLE `tenant_sync_counters` (
	`tenant_id` binary(16) NOT NULL,
	`last_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `tenant_sync_counters_tenant_id` PRIMARY KEY(`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` binary(16) NOT NULL,
	`slug` varchar(60) NOT NULL,
	`name` varchar(150) NOT NULL,
	`legal_name` varchar(200),
	`business_type` varchar(40) NOT NULL DEFAULT 'karyana',
	`country` varchar(2) NOT NULL DEFAULT 'PK',
	`currency` varchar(3) NOT NULL DEFAULT 'PKR',
	`timezone` varchar(50) NOT NULL DEFAULT 'Asia/Karachi',
	`default_locale` varchar(10) NOT NULL DEFAULT 'en',
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`suspended_reason` text,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`archived_at` datetime(3),
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `tenants_status_ck` CHECK(`tenants`.`status` in ('active','suspended','archived'))
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` binary(16),
	`storage_key` varchar(255) NOT NULL,
	`mime` varchar(100) NOT NULL,
	`size_bytes` int NOT NULL,
	`original_name` varchar(255),
	`uploaded_by` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`code` varchar(10) NOT NULL,
	`name` varchar(120) NOT NULL,
	`address` varchar(255),
	`phone` varchar(20),
	`is_default` boolean NOT NULL DEFAULT false,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`active_key` tinyint GENERATED ALWAYS AS ((if(`deleted_at` is null, 1, null))) STORED,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `branches_code_uq` UNIQUE(`tenant_id`,`code`,`active_key`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`branch_id` binary(16) NOT NULL,
	`code` varchar(3) NOT NULL,
	`name` varchar(80) NOT NULL,
	`platform` varchar(40),
	`user_agent` varchar(255),
	`registered_by` binary(16),
	`registered_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`last_seen_at` datetime(3),
	`last_push_at` datetime(3),
	`last_pulled_seq` bigint NOT NULL DEFAULT 0,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`revoked_at` datetime(3),
	`revoked_by` binary(16),
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `devices_code_uq` UNIQUE(`tenant_id`,`code`),
	CONSTRAINT `devices_status_ck` CHECK(`devices`.`status` in ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`identifier` varchar(190) NOT NULL,
	`ip` varchar(45),
	`success` boolean NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `membership_branches` (
	`tenant_id` binary(16) NOT NULL,
	`membership_id` binary(16) NOT NULL,
	`branch_id` binary(16) NOT NULL,
	CONSTRAINT `membership_branches_membership_id_branch_id_pk` PRIMARY KEY(`membership_id`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`key` varchar(60) NOT NULL,
	`module` varchar(40) NOT NULL,
	`description` varchar(255),
	`is_sensitive` boolean NOT NULL DEFAULT false,
	CONSTRAINT `permissions_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`device_id` binary(16),
	`family_id` binary(16) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`issued_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`expires_at` datetime(3) NOT NULL,
	`rotated_at` datetime(3),
	`revoked_at` datetime(3),
	`revoke_reason` varchar(40),
	`ip` varchar(45),
	`user_agent` varchar(255),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`tenant_id` binary(16) NOT NULL,
	`role_id` binary(16) NOT NULL,
	`permission_key` varchar(60) NOT NULL,
	CONSTRAINT `role_permissions_role_id_permission_key_pk` PRIMARY KEY(`role_id`,`permission_key`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`name` varchar(80) NOT NULL,
	`description` varchar(255),
	`is_system` boolean NOT NULL DEFAULT false,
	`system_key` varchar(40),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `roles_system_key_uq` UNIQUE(`tenant_id`,`system_key`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`tenant_id` binary(16) NOT NULL,
	`scope_branch_id` binary(16) NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`server_seq` bigint NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_by` binary(16),
	CONSTRAINT `settings_tenant_id_scope_branch_id_key_pk` PRIMARY KEY(`tenant_id`,`scope_branch_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `tenant_memberships` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`user_id` binary(16) NOT NULL,
	`role_id` binary(16) NOT NULL,
	`display_name` varchar(120),
	`pin_hash` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`all_branches` boolean NOT NULL DEFAULT true,
	`joined_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `tenant_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_memberships_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `tenant_memberships_user_uq` UNIQUE(`tenant_id`,`user_id`),
	CONSTRAINT `tenant_memberships_status_ck` CHECK(`tenant_memberships`.`status` in ('invited','active','disabled'))
);
--> statement-breakpoint
CREATE TABLE `tenant_profiles` (
	`tenant_id` binary(16) NOT NULL,
	`shop_name` varchar(150) NOT NULL,
	`shop_name_ur` varchar(150),
	`logo_key` varchar(255),
	`primary_color` varchar(9),
	`phone` varchar(20),
	`whatsapp` varchar(20),
	`email` varchar(190),
	`address` varchar(255),
	`address_ur` varchar(255),
	`ntn` varchar(20),
	`strn` varchar(20),
	`receipt_header` text,
	`receipt_footer` text,
	`receipt_width_mm` int NOT NULL DEFAULT 80,
	`version` int NOT NULL DEFAULT 1,
	`server_seq` bigint NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `tenant_profiles_tenant_id` PRIMARY KEY(`tenant_id`),
	CONSTRAINT `tenant_profiles_width_ck` CHECK(`tenant_profiles`.`receipt_width_mm` in (58, 80))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` binary(16) NOT NULL,
	`name` varchar(120) NOT NULL,
	`phone` varchar(20),
	`email` varchar(190),
	`password_hash` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`preferred_locale` varchar(10),
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_uq` UNIQUE(`phone`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`),
	CONSTRAINT `users_login_ck` CHECK(`users`.`phone` is not null or `users`.`email` is not null),
	CONSTRAINT `users_status_ck` CHECK(`users`.`status` in ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`name` varchar(120) NOT NULL,
	`name_ur` varchar(120),
	`manufacturer` varchar(120),
	CONSTRAINT `brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `brands_tenant_id_uq` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`parent_id` binary(16),
	`name` varchar(120) NOT NULL,
	`name_ur` varchar(120),
	`sort` int NOT NULL DEFAULT 0,
	`color` varchar(9),
	`icon` varchar(40),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_tenant_id_uq` UNIQUE(`tenant_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`product_unit_id` binary(16),
	`field` varchar(20) NOT NULL,
	`old_value` bigint,
	`new_value` bigint,
	`changed_by` binary(16),
	`changed_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`source_type` varchar(40),
	`source_id` binary(16),
	CONSTRAINT `price_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `price_history_field_ck` CHECK(`price_history`.`field` in ('sale','wholesale','min_sale','cost'))
);
--> statement-breakpoint
CREATE TABLE `product_barcodes` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`product_id` binary(16) NOT NULL,
	`product_unit_id` binary(16),
	`barcode` varchar(64) NOT NULL,
	`active_key` tinyint GENERATED ALWAYS AS ((if(`deleted_at` is null, 1, null))) STORED,
	CONSTRAINT `product_barcodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_barcodes_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `product_barcodes_barcode_uq` UNIQUE(`tenant_id`,`barcode`,`active_key`)
);
--> statement-breakpoint
CREATE TABLE `product_units` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`product_id` binary(16) NOT NULL,
	`unit_id` binary(16) NOT NULL,
	`factor_to_base` decimal(14,6) NOT NULL,
	`sale_price` bigint,
	`wholesale_price` bigint,
	`is_default_sale` boolean NOT NULL DEFAULT false,
	`is_default_purchase` boolean NOT NULL DEFAULT false,
	`active_key` tinyint GENERATED ALWAYS AS ((if(`deleted_at` is null, 1, null))) STORED,
	CONSTRAINT `product_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_units_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `product_units_unit_uq` UNIQUE(`tenant_id`,`product_id`,`unit_id`,`active_key`),
	CONSTRAINT `product_units_factor_ck` CHECK(`product_units`.`factor_to_base` > 0)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_by` binary(16),
	`updated_by` binary(16),
	`origin_device_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`deleted_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`sku` varchar(60) NOT NULL,
	`name` varchar(200) NOT NULL,
	`name_ur` varchar(200),
	`description` text,
	`category_id` binary(16),
	`brand_id` binary(16),
	`default_supplier_id` binary(16),
	`base_unit_id` binary(16) NOT NULL,
	`is_weighed` boolean NOT NULL DEFAULT false,
	`sale_price` bigint NOT NULL DEFAULT 0,
	`wholesale_price` bigint,
	`min_sale_price` bigint,
	`tax_rate_id` binary(16),
	`track_stock` boolean NOT NULL DEFAULT true,
	`track_batches` boolean NOT NULL DEFAULT false,
	`track_expiry` boolean NOT NULL DEFAULT false,
	`min_stock` decimal(14,3),
	`safety_stock` decimal(14,3),
	`lead_time_days` int,
	`review_period_days` int,
	`max_stock` decimal(14,3),
	`is_favorite` boolean NOT NULL DEFAULT false,
	`pos_sort` int NOT NULL DEFAULT 0,
	`image_key` varchar(255),
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`field_versions` json,
	`active_key` tinyint GENERATED ALWAYS AS ((if(`deleted_at` is null, 1, null))) STORED,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `products_sku_uq` UNIQUE(`tenant_id`,`sku`,`active_key`),
	CONSTRAINT `products_status_ck` CHECK(`products`.`status` in ('active','inactive')),
	CONSTRAINT `products_price_ck` CHECK(`products`.`sale_price` >= 0)
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16),
	`code` varchar(20) NOT NULL,
	`name` varchar(60) NOT NULL,
	`name_ur` varchar(60),
	`kind` varchar(10) NOT NULL,
	`base_code` varchar(20),
	`factor_to_base` decimal(12,6),
	`server_seq` bigint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `units_id` PRIMARY KEY(`id`),
	CONSTRAINT `units_code_uq` UNIQUE(`tenant_id`,`code`),
	CONSTRAINT `units_kind_ck` CHECK(`units`.`kind` in ('count','weight','volume','length'))
);
--> statement-breakpoint
CREATE TABLE `inventory_balances` (
	`tenant_id` binary(16) NOT NULL,
	`branch_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`qty_on_hand` decimal(14,3) NOT NULL DEFAULT 0,
	`qty_reserved` decimal(14,3) NOT NULL DEFAULT 0,
	`avg_cost` decimal(18,4) NOT NULL DEFAULT '0',
	`stock_value` bigint NOT NULL DEFAULT 0,
	`last_movement_at` datetime(3),
	`last_sale_at` datetime(3),
	`last_receipt_at` datetime(3),
	`server_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `inventory_balances_tenant_id_branch_id_product_id_pk` PRIMARY KEY(`tenant_id`,`branch_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`branch_id` binary(16) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`source_type` varchar(40) NOT NULL,
	`source_id` binary(16) NOT NULL,
	`source_line_id` binary(16),
	`product_id` binary(16) NOT NULL,
	`batch_id` binary(16),
	`movement_type` varchar(20) NOT NULL,
	`qty_base` decimal(14,3) NOT NULL,
	`unit_cost` decimal(18,4) NOT NULL,
	`total_cost` bigint NOT NULL,
	`balance_after` decimal(14,3),
	`reason_code` varchar(40),
	`memo` varchar(255),
	`created_by` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`server_seq` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `inventory_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_movements_type_ck` CHECK(movement_type in ('opening','purchase','sale','sale_return','purchase_return','adjustment_in','adjustment_out','damage','expiry','transfer_in','transfer_out','count_correction'))
);
--> statement-breakpoint
CREATE TABLE `stock_adjustment_items` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`adjustment_id` binary(16) NOT NULL,
	`line_no` int NOT NULL,
	`product_id` binary(16) NOT NULL,
	`batch_id` binary(16),
	`product_unit_id` binary(16),
	`qty` decimal(14,3) NOT NULL,
	`qty_base` decimal(14,3) NOT NULL,
	`unit_cost` bigint,
	`memo` varchar(255),
	CONSTRAINT `stock_adjustment_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_adjustment_items_line_uq` UNIQUE(`tenant_id`,`adjustment_id`,`line_no`)
);
--> statement-breakpoint
CREATE TABLE `stock_adjustments` (
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
	`reason` varchar(20) NOT NULL,
	`memo` text,
	`status` varchar(20) NOT NULL DEFAULT 'completed',
	`approved_by` binary(16),
	CONSTRAINT `stock_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_adjustments_tenant_id_uq` UNIQUE(`tenant_id`,`id`),
	CONSTRAINT `stock_adjustments_reason_ck` CHECK(`stock_adjustments`.`reason` in ('damage','expiry','theft','correction','opening','other')),
	CONSTRAINT `stock_adjustments_status_ck` CHECK(`stock_adjustments`.`status` in ('completed','voided'))
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`user_id` binary(16),
	`admin_id` binary(16),
	`device_id` binary(16),
	`ip` varchar(45),
	`user_agent` varchar(255),
	`action` varchar(80) NOT NULL,
	`entity_type` varchar(40),
	`entity_id` varchar(120),
	`before` json,
	`after` json,
	`reason` text,
	`occurred_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `import_job_rows` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`job_id` binary(16) NOT NULL,
	`row_no` int NOT NULL,
	`data` json NOT NULL,
	`errors` json,
	`status` varchar(20) NOT NULL,
	CONSTRAINT `import_job_rows_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_job_rows_status_ck` CHECK(`import_job_rows`.`status` in ('valid','error','imported','skipped'))
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`file_key` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'uploaded',
	`total_rows` int NOT NULL DEFAULT 0,
	`valid_rows` int NOT NULL DEFAULT 0,
	`error_rows` int NOT NULL DEFAULT 0,
	`options` json,
	`created_by` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`finished_at` datetime(3),
	CONSTRAINT `import_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_jobs_kind_ck` CHECK(`import_jobs`.`kind` in ('products','opening_stock','customers','suppliers','prices')),
	CONSTRAINT `import_jobs_status_ck` CHECK(`import_jobs`.`status` in ('uploaded','validating','validated','importing','done','failed'))
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`tenant_id` binary(16),
	`queue` varchar(40) NOT NULL DEFAULT 'default',
	`name` varchar(80) NOT NULL,
	`payload` json,
	`status` varchar(20) NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`run_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`locked_at` datetime(3),
	`locked_by` varchar(80),
	`last_error` text,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`finished_at` datetime(3),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_status_ck` CHECK(`jobs`.`status` in ('queued','running','done','failed'))
);
--> statement-breakpoint
CREATE TABLE `sync_changes` (
	`tenant_id` binary(16) NOT NULL,
	`server_seq` bigint NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(120) NOT NULL,
	`branch_id` binary(16),
	`op` varchar(10) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`changed_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `sync_changes_tenant_id_server_seq_pk` PRIMARY KEY(`tenant_id`,`server_seq`),
	CONSTRAINT `sync_changes_op_ck` CHECK(`sync_changes`.`op` in ('upsert','delete'))
);
--> statement-breakpoint
CREATE TABLE `sync_conflicts` (
	`id` binary(16) NOT NULL,
	`tenant_id` binary(16) NOT NULL,
	`mutation_id` binary(16) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(120) NOT NULL,
	`base_version` int NOT NULL,
	`server_version` int NOT NULL,
	`client_changes` json NOT NULL,
	`server_state` json NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`resolved_by` binary(16),
	`resolved_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `sync_conflicts_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_conflicts_status_ck` CHECK(`sync_conflicts`.`status` in ('open','resolved_client','resolved_server'))
);
--> statement-breakpoint
CREATE TABLE `sync_mutations` (
	`tenant_id` binary(16) NOT NULL,
	`mutation_id` binary(16) NOT NULL,
	`device_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(120),
	`op` varchar(20) NOT NULL,
	`status` varchar(20) NOT NULL,
	`result` json,
	`client_created_at` datetime(3),
	`received_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `sync_mutations_tenant_id_mutation_id_pk` PRIMARY KEY(`tenant_id`,`mutation_id`),
	CONSTRAINT `sync_mutations_status_ck` CHECK(`sync_mutations`.`status` in ('applied','rejected','conflict'))
);
--> statement-breakpoint
ALTER TABLE `admin_access_grants` ADD CONSTRAINT `admin_access_grants_admin_id_platform_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `platform_admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_access_grants` ADD CONSTRAINT `admin_access_grants_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_features` ADD CONSTRAINT `plan_features_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_features` ADD CONSTRAINT `plan_features_feature_key_features_key_fk` FOREIGN KEY (`feature_key`) REFERENCES `features`(`key`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscription_events` ADD CONSTRAINT `subscription_events_subscription_id_subscriptions_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_sync_counters` ADD CONSTRAINT `tenant_sync_counters_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `fk_branches_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `fk_devices_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `membership_branches` ADD CONSTRAINT `fk_membership_branches_membership` FOREIGN KEY (`tenant_id`,`membership_id`) REFERENCES `tenant_memberships`(`tenant_id`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `membership_branches` ADD CONSTRAINT `fk_membership_branches_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_key_permissions_key_fk` FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`tenant_id`,`role_id`) REFERENCES `roles`(`tenant_id`,`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `fk_roles_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `fk_memberships_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `fk_memberships_role` FOREIGN KEY (`tenant_id`,`role_id`) REFERENCES `roles`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_profiles` ADD CONSTRAINT `tenant_profiles_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brands` ADD CONSTRAINT `fk_brands_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `fk_categories_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `fk_categories_parent` FOREIGN KEY (`tenant_id`,`parent_id`) REFERENCES `categories`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `price_history` ADD CONSTRAINT `fk_price_history_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_barcodes` ADD CONSTRAINT `fk_product_barcodes_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_barcodes` ADD CONSTRAINT `fk_product_barcodes_unit` FOREIGN KEY (`tenant_id`,`product_unit_id`) REFERENCES `product_units`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_units` ADD CONSTRAINT `fk_product_units_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_units` ADD CONSTRAINT `fk_product_units_unit` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `fk_products_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `fk_products_category` FOREIGN KEY (`tenant_id`,`category_id`) REFERENCES `categories`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `fk_products_brand` FOREIGN KEY (`tenant_id`,`brand_id`) REFERENCES `brands`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `fk_products_base_unit` FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD CONSTRAINT `fk_inventory_balances_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD CONSTRAINT `fk_inventory_balances_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_movements` ADD CONSTRAINT `fk_inventory_movements_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `fk_stock_adjustment_items_adjustment` FOREIGN KEY (`tenant_id`,`adjustment_id`) REFERENCES `stock_adjustments`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `fk_stock_adjustment_items_product` FOREIGN KEY (`tenant_id`,`product_id`) REFERENCES `products`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustment_items` ADD CONSTRAINT `fk_stock_adjustment_items_unit` FOREIGN KEY (`tenant_id`,`product_unit_id`) REFERENCES `product_units`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `fk_stock_adjustments_branch` FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `platform_audit_logs_tenant_idx` ON `platform_audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `subscription_events_tenant_idx` ON `subscription_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `attachments_entity_idx` ON `attachments` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `branches_seq_idx` ON `branches` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `login_attempts_identifier_idx` ON `login_attempts` (`identifier`,`created_at`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `role_permissions_tenant_idx` ON `role_permissions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `roles_seq_idx` ON `roles` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `tenant_memberships_user_idx` ON `tenant_memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `tenant_memberships_seq_idx` ON `tenant_memberships` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `brands_seq_idx` ON `brands` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `categories_seq_idx` ON `categories` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `price_history_product_idx` ON `price_history` (`tenant_id`,`product_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `product_barcodes_seq_idx` ON `product_barcodes` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `product_units_seq_idx` ON `product_units` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`tenant_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `products_seq_idx` ON `products` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `inventory_balances_seq_idx` ON `inventory_balances` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `inventory_movements_product_idx` ON `inventory_movements` (`tenant_id`,`branch_id`,`product_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `inventory_movements_source_idx` ON `inventory_movements` (`tenant_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `inventory_movements_seq_idx` ON `inventory_movements` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_seq_idx` ON `stock_adjustments` (`tenant_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `stock_adjustments_date_idx` ON `stock_adjustments` (`tenant_id`,`branch_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_idx` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `import_job_rows_job_idx` ON `import_job_rows` (`tenant_id`,`job_id`,`row_no`);--> statement-breakpoint
CREATE INDEX `import_jobs_tenant_idx` ON `import_jobs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`queue`,`run_at`);--> statement-breakpoint
CREATE INDEX `sync_conflicts_open_idx` ON `sync_conflicts` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `sync_mutations_device_idx` ON `sync_mutations` (`tenant_id`,`device_id`,`received_at`);