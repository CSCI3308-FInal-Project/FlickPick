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

app.get('/', requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/popular?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=1`
    );
    const data = await response.json();
    const movies = (data.results || []).map(m => ({
      id:       String(m.id),
      title:    m.title,
      poster:   m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      year:     m.release_date ? m.release_date.slice(0, 4) : 'N/A',
      rating:   m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
      genres:   (m.genre_ids || []).slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean).join(', '),
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
    console.error(err);
    res.render('pages/register', { message: 'Username or email already taken.' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
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
