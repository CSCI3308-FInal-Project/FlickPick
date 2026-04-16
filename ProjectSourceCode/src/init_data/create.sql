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
  gender          VARCHAR(50),
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
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id   VARCHAR(50) NOT NULL,
  title      VARCHAR(255),
  genre_ids  TEXT,
  rating     NUMERIC(3,1),
  liked      BOOLEAN NOT NULL,
  swiped_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, movie_id)
);