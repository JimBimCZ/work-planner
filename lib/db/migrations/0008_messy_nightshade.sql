CREATE TABLE "activity_reads" (
	"board_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_reads_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "activity_reads" ADD CONSTRAINT "activity_reads_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reads" ADD CONSTRAINT "activity_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;