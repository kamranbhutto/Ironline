ALTER TABLE "job_operations" ALTER COLUMN "run_hours_per_unit" SET DATA TYPE numeric(14, 8);--> statement-breakpoint
ALTER TABLE "quote_line_operations" ALTER COLUMN "run_hours_per_unit" SET DATA TYPE numeric(14, 8);--> statement-breakpoint
ALTER TABLE "routing_operations" ALTER COLUMN "run_hours_per_unit" SET DATA TYPE numeric(14, 8);