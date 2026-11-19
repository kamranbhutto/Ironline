CREATE TABLE "inspection_characteristics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" text DEFAULT 'length' NOT NULL,
	"attachment_id" uuid,
	"page" integer DEFAULT 1 NOT NULL,
	"x" numeric(7, 6),
	"y" numeric(7, 6),
	"nominal" numeric(14, 6),
	"tol_plus" numeric(14, 6),
	"tol_minus" numeric(14, 6),
	"unit" text DEFAULT 'mm' NOT NULL,
	"datums" text,
	"requirement" text,
	"operation_seq" integer,
	"sampling" text DEFAULT 'first' NOT NULL,
	"every_n" integer,
	"gauge" text,
	"critical" boolean DEFAULT false NOT NULL,
	CONSTRAINT "insp_char_sampling" CHECK (sampling in ('first', 'every_n', 'all'))
);
--> statement-breakpoint
CREATE TABLE "inspection_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"characteristic_id" uuid NOT NULL,
	"piece" integer NOT NULL,
	"value" numeric(14, 6),
	"passed" boolean,
	"gauge" text,
	"user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_characteristics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"attachment_id" uuid,
	"page" integer DEFAULT 1 NOT NULL,
	"x" numeric(7, 6),
	"y" numeric(7, 6),
	"nominal" numeric(14, 6),
	"tol_plus" numeric(14, 6),
	"tol_minus" numeric(14, 6),
	"unit" text DEFAULT 'mm' NOT NULL,
	"datums" text,
	"requirement" text,
	"operation_seq" integer,
	"sampling" text DEFAULT 'first' NOT NULL,
	"every_n" integer,
	"gauge" text,
	"critical" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_characteristics" ADD CONSTRAINT "inspection_characteristics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_characteristics" ADD CONSTRAINT "inspection_characteristics_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_characteristics" ADD CONSTRAINT "inspection_characteristics_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_characteristic_id_job_characteristics_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."job_characteristics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_characteristics" ADD CONSTRAINT "job_characteristics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_characteristics" ADD CONSTRAINT "job_characteristics_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_characteristics" ADD CONSTRAINT "job_characteristics_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insp_char_item_number" ON "inspection_characteristics" USING btree ("item_id","number");--> statement-breakpoint
CREATE INDEX "insp_char_item" ON "inspection_characteristics" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insp_result_piece" ON "inspection_results" USING btree ("characteristic_id","piece");--> statement-breakpoint
CREATE INDEX "insp_result_job" ON "inspection_results" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_char_job_number" ON "job_characteristics" USING btree ("job_id","number");