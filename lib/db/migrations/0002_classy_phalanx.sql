CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"column_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp with time zone,
	"rank" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_column_id_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."columns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_column_id_rank_idx" ON "cards" USING btree ("column_id","rank");--> statement-breakpoint
CREATE INDEX "cards_board_id_idx" ON "cards" USING btree ("board_id");