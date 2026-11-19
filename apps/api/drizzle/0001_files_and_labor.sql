CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_entity_kind" CHECK (entity in ('item', 'job', 'quote', 'customer', 'sales_order'))
);
--> statement-breakpoint
CREATE TABLE "labor_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_operation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'run' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"quantity_good" numeric(14, 4) DEFAULT 0 NOT NULL,
	"quantity_scrap" numeric(14, 4) DEFAULT 0 NOT NULL,
	"scrap_reason" text,
	"rate" numeric(14, 4) DEFAULT 0 NOT NULL,
	"note" text,
	CONSTRAINT "labor_kind" CHECK (kind in ('setup', 'run', 'labor'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_job_operation_id_job_operations_id_fk" FOREIGN KEY ("job_operation_id") REFERENCES "public"."job_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_entity" ON "attachments" USING btree ("org_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "labor_op" ON "labor_entries" USING btree ("org_id","job_operation_id");--> statement-breakpoint
CREATE INDEX "labor_open" ON "labor_entries" USING btree ("org_id","user_id","ended_at");