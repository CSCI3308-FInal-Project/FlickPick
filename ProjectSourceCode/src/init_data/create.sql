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
  added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  favorite_genres TEXT
);