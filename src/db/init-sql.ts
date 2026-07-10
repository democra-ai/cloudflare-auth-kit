// AUTO-GENERATED from migrations/0000_init.sql by scripts/build-assets? no — by db:generate.
// Run at first boot if the schema is missing, so the Deploy button needs no manual migration.
export const INIT_SQL: string[] = [
  "CREATE TABLE `account` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`account_id` text NOT NULL,\n\t`provider_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`access_token` text,\n\t`refresh_token` text,\n\t`id_token` text,\n\t`access_token_expires_at` integer,\n\t`refresh_token_expires_at` integer,\n\t`scope` text,\n\t`password` text,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`updated_at` integer NOT NULL,\n\tFOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade\n);",
  "CREATE INDEX `account_userId_idx` ON `account` (`user_id`);",
  "CREATE TABLE `invitation` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`organization_id` text NOT NULL,\n\t`email` text NOT NULL,\n\t`role` text,\n\t`status` text DEFAULT 'pending' NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`inviter_id` text NOT NULL,\n\tFOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade\n);",
  "CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);",
  "CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);",
  "CREATE TABLE `member` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`organization_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`role` text DEFAULT 'member' NOT NULL,\n\t`created_at` integer NOT NULL,\n\tFOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade\n);",
  "CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);",
  "CREATE INDEX `member_userId_idx` ON `member` (`user_id`);",
  "CREATE TABLE `organization` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`logo` text,\n\t`created_at` integer NOT NULL,\n\t`metadata` text\n);",
  "CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);",
  "CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);",
  "CREATE TABLE `session` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`token` text NOT NULL,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`ip_address` text,\n\t`user_agent` text,\n\t`user_id` text NOT NULL,\n\t`impersonated_by` text,\n\t`active_organization_id` text,\n\tFOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade\n);",
  "CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);",
  "CREATE INDEX `session_userId_idx` ON `session` (`user_id`);",
  "CREATE TABLE `user` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`email` text NOT NULL,\n\t`email_verified` integer DEFAULT false NOT NULL,\n\t`image` text,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`username` text,\n\t`display_username` text,\n\t`role` text,\n\t`banned` integer DEFAULT false,\n\t`ban_reason` text,\n\t`ban_expires` integer\n);",
  "CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);",
  "CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);",
  "CREATE TABLE `verification` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`identifier` text NOT NULL,\n\t`value` text NOT NULL,\n\t`expires_at` integer NOT NULL,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL\n);",
  "CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);"
];

// Added in the passkey release (migrations/0001_passkey.sql). Kept separate so existing
// deployments (user table present, passkey table missing) can be healed at boot.
export const PASSKEY_SQL: string[] = [
  "CREATE TABLE `passkey` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text,\n\t`public_key` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`credential_id` text NOT NULL,\n\t`counter` integer NOT NULL,\n\t`device_type` text NOT NULL,\n\t`backed_up` integer NOT NULL,\n\t`transports` text,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`aaguid` text,\n\tFOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade\n);",
  "CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);",
  "CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);",
];
