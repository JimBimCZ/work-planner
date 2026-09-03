CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"subject_id" text,
	"subject" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_board_id_created_at_idx" ON "activity" USING btree ("board_id","created_at");