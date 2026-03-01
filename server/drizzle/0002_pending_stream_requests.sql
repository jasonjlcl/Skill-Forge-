CREATE TABLE IF NOT EXISTS "pending_stream_requests" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid,
  "message" text NOT NULL,
  "module" text,
  "top_k" integer,
  "time_seconds" integer,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pending_stream_requests_user_expires_idx"
  ON "pending_stream_requests" ("user_id", "expires_at");

CREATE INDEX IF NOT EXISTS "pending_stream_requests_expires_idx"
  ON "pending_stream_requests" ("expires_at");
