-- GATHER schema. Runs automatically on server start (safe to run repeatedly).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  timezone    TEXT NOT NULL DEFAULT 'America/Chicago',
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Busy time only (start/end). Availability belongs to a user, shared with their groups.
CREATE TABLE IF NOT EXISTS availability (
  id        SERIAL PRIMARY KEY,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_utc TIMESTAMPTZ NOT NULL,
  end_utc   TIMESTAMPTZ NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('google', 'manual')),
  CHECK (end_utc > start_utc)
);
CREATE INDEX IF NOT EXISTS availability_user_idx ON availability (user_id, start_utc);

CREATE TABLE IF NOT EXISTS ideas (
  id           SERIAL PRIMARY KEY,
  group_id     INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT NOT NULL CHECK (category IN ('restaurants', 'outdoor', 'entertainment', 'at_home', 'travel', 'events', 'other')),
  location     TEXT,
  budget_cents INT CHECK (budget_cents >= 0),
  status       TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'under_consideration', 'planned', 'completed', 'archived')),
  added_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idea_interests (
  idea_id INT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (idea_id, user_id)
);

CREATE TABLE IF NOT EXISTS polls (
  id               SERIAL PRIMARY KEY,
  group_id         INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  question         TEXT NOT NULL,
  deadline         TIMESTAMPTZ NOT NULL,
  closed           BOOLEAN NOT NULL DEFAULT false,
  winner_option_id INT,
  event_start_utc  TIMESTAMPTZ,
  event_end_utc    TIMESTAMPTZ,
  created_by       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id      SERIAL PRIMARY KEY,
  poll_id INT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label   TEXT NOT NULL,
  idea_id INT REFERENCES ideas(id) ON DELETE SET NULL
);

-- One vote per member per poll, enforced by the database itself.
CREATE TABLE IF NOT EXISTS votes (
  poll_id   INT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id         SERIAL PRIMARY KEY,
  group_id   INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  start_utc  TIMESTAMPTZ NOT NULL,
  end_utc    TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'cancelled')),
  idea_id    INT REFERENCES ideas(id) ON DELETE SET NULL,
  poll_id    INT REFERENCES polls(id) ON DELETE SET NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_utc > start_utc)
);

CREATE TABLE IF NOT EXISTS event_responses (
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (response IN ('yes', 'no', 'maybe')),
  PRIMARY KEY (event_id, user_id)
);

-- Money is always integer cents.
CREATE TABLE IF NOT EXISTS expenses (
  id           SERIAL PRIMARY KEY,
  group_id     INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  paid_by      INT NOT NULL REFERENCES users(id),
  event_id     INT REFERENCES events(id) ON DELETE SET NULL,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_splits (
  expense_id  INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id),
  share_cents INT NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id           SERIAL PRIMARY KEY,
  group_id     INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user    INT NOT NULL REFERENCES users(id),
  to_user      INT NOT NULL REFERENCES users(id),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  recorded_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_user <> to_user)
);
