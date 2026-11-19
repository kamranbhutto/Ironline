CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"dimensions" text,
	"heat_number" text,
	"supplier" text,
	"quantity" numeric(14, 4) DEFAULT 0 NOT NULL,
	"unit_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"remnant" boolean DEFAULT false NOT NULL,
	"parent_lot_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "stock_lots_not_negative" CHECK (quantity >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid,
	"lot_id" uuid,
	"kind" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"value" numeric(14, 4) DEFAULT 0 NOT NULL,
	"job_id" uuid,
	"job_material_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"note" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_tx_kind" CHECK (kind in ('receive', 'consume', 'return', 'remnant', 'adjust', 'count', 'move_out', 'move_in'))
);
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_entity_kind";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reorder_point" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reorder_quantity" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "job_materials" ADD COLUMN "issued_cost" numeric(14, 4) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_job_material_id_job_materials_id_fk" FOREIGN KEY ("job_material_id") REFERENCES "public"."job_materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_locations_org_code" ON "stock_locations" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "stock_lots_item" ON "stock_lots" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_org_number" ON "stock_lots" USING btree ("org_id","lot_number");--> statement-breakpoint
CREATE INDEX "stock_tx_item" ON "stock_transactions" USING btree ("org_id","item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_tx_lot" ON "stock_transactions" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_tx_job_material" ON "stock_transactions" USING btree ("job_material_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_entity_kind" CHECK (entity in ('item', 'job', 'quote', 'customer', 'sales_order', 'stock_lot'));--> statement-breakpoint
UPDATE "job_materials" SET "issued_cost" = round(("quantity_issued" * "unit_cost")::numeric, 4);
