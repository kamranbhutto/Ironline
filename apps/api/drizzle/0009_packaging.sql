CREATE TABLE "pack_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"l" numeric(14, 4) NOT NULL,
	"w" numeric(14, 4) NOT NULL,
	"h" numeric(14, 4) NOT NULL,
	"wall" numeric(14, 4) DEFAULT 0 NOT NULL,
	"tare" numeric(14, 4) DEFAULT 0 NOT NULL,
	"max_load" numeric(14, 4) DEFAULT 0 NOT NULL,
	"max_height" numeric(14, 4) DEFAULT 0 NOT NULL,
	"cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"returnable" boolean DEFAULT false NOT NULL,
	"trip_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"life_trips" integer DEFAULT 1 NOT NULL,
	"grade" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_assets_kind" CHECK (kind in ('carton', 'tote', 'crate', 'pallet', 'vehicle'))
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_l" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_w" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_h" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_weight" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_upright" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_nest_pitch" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_settings" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "pack_spec" jsonb;--> statement-breakpoint
ALTER TABLE "pack_assets" ADD CONSTRAINT "pack_assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_assets_org_code" ON "pack_assets" USING btree ("org_id","code");