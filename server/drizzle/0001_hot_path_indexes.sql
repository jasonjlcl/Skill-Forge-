CREATE INDEX IF NOT EXISTS "sessions_user_last_active_idx"
  ON "sessions" ("user_id", "last_active_at");

CREATE INDEX IF NOT EXISTS "messages_session_created_at_idx"
  ON "messages" ("session_id", "created_at");

CREATE INDEX IF NOT EXISTS "quiz_attempts_user_started_at_idx"
  ON "quiz_attempts" ("user_id", "started_at");

CREATE INDEX IF NOT EXISTS "quiz_questions_attempt_position_idx"
  ON "quiz_questions" ("attempt_id", "position");

CREATE INDEX IF NOT EXISTS "quiz_answers_attempt_answered_at_idx"
  ON "quiz_answers" ("attempt_id", "answered_at");
