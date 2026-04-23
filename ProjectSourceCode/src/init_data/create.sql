CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50)  UNIQUE NOT NULL,
  email      VARCHAR(100) UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlist (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id   VARCHAR(50) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  poster_url VARCHAR(500),
  genre      VARCHAR(100),
  year       INT,
  rating     NUMERIC(3,1),
  synopsis   TEXT,
  added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  watched    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS profile (
  id              SERIAL PRIMARY KEY,
  user_id         INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(50),
  age             INT,
  country         VARCHAR(100),
  bio             TEXT,
  favorite_movies TEXT,
  favorite_genres TEXT,
  photo_url       VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS friends (
  id SERIAL PRIMARY KEY,
  requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE TABLE IF NOT EXISTS swipe_history (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    VARCHAR(50) NOT NULL,
  title       VARCHAR(255),
  genre_ids   TEXT,
  actor_ids   TEXT,
  director_id VARCHAR(50),
  rating      NUMERIC(3,1),
  liked       BOOLEAN NOT NULL,
  swiped_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, movie_id)
);

-- Migrate existing swipe_history tables that predate actor/director tracking
ALTER TABLE swipe_history ADD COLUMN IF NOT EXISTS actor_ids   TEXT;
ALTER TABLE swipe_history ADD COLUMN IF NOT EXISTS director_id VARCHAR(50);

-- Migrate profile table: replace gender with country
ALTER TABLE profile ADD COLUMN IF NOT EXISTS country VARCHAR(100);
ALTER TABLE profile ALTER COLUMN country TYPE VARCHAR(100);
ALTER TABLE profile DROP COLUMN IF EXISTS gender;

CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    VARCHAR(50) NOT NULL,
  title       VARCHAR(255),
  rating      INT NOT NULL CHECK (rating >= 1 AND rating <= 10),
  review_text TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, movie_id)
);

-- WS3: Change friends default to pending (for fresh installs)
ALTER TABLE friends ALTER COLUMN status SET DEFAULT 'pending';

-- Track who actually sent the friend request (MIN/MAX normalization loses this info)
ALTER TABLE friends ADD COLUMN IF NOT EXISTS sender_id INT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  payload    JSONB,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_sessions (
  id             SERIAL PRIMARY KEY,
  owner_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  code           VARCHAR(8) UNIQUE NOT NULL,
  mode           VARCHAR(10) DEFAULT 'async',
  status         VARCHAR(20) DEFAULT 'active',
  seed_movie_id  VARCHAR(50),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id  INT REFERENCES group_sessions(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) DEFAULT 'invited',
  joined_at   TIMESTAMP,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_swipes (
  id          SERIAL PRIMARY KEY,
  session_id  INT REFERENCES group_sessions(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  movie_id    VARCHAR(50) NOT NULL,
  title       VARCHAR(255),
  poster_url  VARCHAR(500),
  liked       BOOLEAN NOT NULL,
  swiped_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, user_id, movie_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id      ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_members_session     ON session_members(session_id);
CREATE INDEX IF NOT EXISTS idx_session_swipes_session      ON session_swipes(session_id);
CREATE INDEX IF NOT EXISTS idx_session_swipes_session_user ON session_swipes(session_id, user_id);
