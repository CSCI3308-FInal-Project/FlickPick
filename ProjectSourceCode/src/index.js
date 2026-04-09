const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pgp = require('pg-promise')();
const path = require('path');

const app = express();

// Database connection
const db = pgp({
  host: process.env.DB_HOST || 'db',
  port: process.env.DB_PORT || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

// Handlebars setup
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: 'main' }));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'resources')));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

// Method override — allows HTML forms to send DELETE via _method body field
app.use((req, res, next) => {
  if (req.body && req.body._method === 'DELETE') {
    req.method = 'DELETE';
    delete req.body._method;
  }
  next();
});

// Auth guard
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

// ─── Routes ──────────────────────────────────────────────────────────────────

const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  53: 'Thriller', 10752: 'War', 37: 'Western',
};

app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

app.get('/', requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/popular?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=1`
    );
    const data = await response.json();
    const movies = (data.results || []).map(m => ({
      id: String(m.id),
      title: m.title,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      year: m.release_date ? m.release_date.slice(0, 4) : 'N/A',
      rating: m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
      genres: (m.genre_ids || []).slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean).join(', '),
      synopsis: m.overview || '',
    }));
    res.render('pages/home', { user: req.session.user, movies: JSON.stringify(movies) });
  } catch (err) {
    console.error('TMDb fetch error:', err);
    res.render('pages/home', { user: req.session.user, movies: '[]' });
  }
});

app.post('/watchlist', requireAuth, async (req, res) => {
  const { movie_id, title, poster_url } = req.body;
  try {
    await db.none(
      `INSERT INTO watchlist(user_id, movie_id, title, poster_url)
       VALUES($1, $2, $3, $4)
       ON CONFLICT (user_id, movie_id) DO NOTHING`,
      [req.session.user.id, movie_id, title, poster_url || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Watchlist insert error:', err);
    res.status(500).json({ success: false });
  }
});

app.get('/login', (req, res) => {
  res.render('pages/login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1', [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render('pages/login', { message: 'Invalid username or password.' });
    }
    req.session.user = { id: user.id, username: user.username };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('pages/login', { message: 'Something went wrong. Please try again.' });
  }
});

app.get('/register', (req, res) => {
  res.render('pages/register');
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.none(
      'INSERT INTO users(username, email, password) VALUES($1, $2, $3)',
      [username, email, hashed]
    );
    res.redirect('/login');
  } catch (err) {
    let message = "Something went wrong. Please try again.";
    if (err.code === '23505') {
      if (err.detail.includes('username')) {
        message = "Username already taken";
      } else if (err.detail.includes('email')) {
        message = "There is already an account associated with this email";
      }
    }
    res.status(400).render('pages/register', { message: message });
  }
});

app.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password');
});

app.post('/forgot-password', async (req, res) => {
  const { username_or_email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render('pages/forgot-password', { message: 'Passwords do not match.' });
  }

  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1 OR email = $1', [username_or_email]);
    if (!user) {
      return res.render('pages/forgot-password', { message: 'User not found with that username or email.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.none('UPDATE users SET password = $1 WHERE id = $2', [hashed, user.id]);

    res.render('pages/login', { message: 'Password reset successfully. Please log in with your new password.' });
  } catch (err) {
    console.error(err);
    res.render('pages/forgot-password', { message: 'Something went wrong. Please try again.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ─── Watchlist ────────────────────────────────────────────────────────────────

app.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const movies = await db.any(
      'SELECT * FROM watchlist WHERE user_id = $1 ORDER BY added_at DESC',
      [req.session.user.id]
    );
    res.render('pages/watchlist', { user: req.session.user, movies, count: movies.length });
  } catch (err) {
    console.error(err);
    res.render('pages/watchlist', { user: req.session.user, movies: [], count: 0 });
  }
});

app.post('/watchlist', requireAuth, async (req, res) => {
  const { movie_id, title, poster_url, genre, year, rating } = req.body;
  try {
    await db.none(
      `INSERT INTO watchlist(user_id, movie_id, title, poster_url, genre, year, rating)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [req.session.user.id, movie_id, title, poster_url || null,
      genre || null, year || null, rating || null]
    );
    res.status(201).json({ message: 'Added to watchlist' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already in watchlist' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.delete('/watchlist/:id', requireAuth, async (req, res) => {
  try {
    await db.none(
      'DELETE FROM watchlist WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
  } catch (err) {
    console.error(err);
  }
  res.redirect('/watchlist');
});

// ─── Wireframes ───────────────────────────────────────────────────────────────

app.get('/wireframes', (_, res) => res.render('pages/wireframes'));
app.get('/wireframes/login', (_, res) => res.render('pages/wireframe-login'));
app.get('/wireframes/register', (_, res) => res.render('pages/wireframe-register'));
app.get('/wireframes/home', (_, res) => res.render('pages/wireframe-home'));
app.get('/wireframes/watchlist', (_, res) => res.render('pages/wireframe-watchlist'));
app.get('/wireframes/group-session', (_, res) => res.render('pages/wireframe-group-session'));
app.get('/wireframes/profile', (_, res) => res.render('pages/wireframe-profile'));

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FlickPick running on port ${PORT}`));

module.exports = app;
