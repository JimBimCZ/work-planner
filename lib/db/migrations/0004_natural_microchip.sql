CREATE TABLE "board_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "board_role" NOT NULL,
	"invited_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_invites_board_id_email_key" UNIQUE("board_id","email"),
	CONSTRAINT "board_invites_role_not_owner" CHECK ("board_invites"."role" <> 'owner')
);
--> statement-breakpoint
ALTER TABLE "board_invites" ADD CONSTRAINT "board_invites_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_invites" ADD CONSTRAINT "board_invites_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_invites_email_idx" ON "board_invites" USING btree ("email");