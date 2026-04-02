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

app.get('/', requireAuth, (req, res) => {
  res.render('pages/home', { user: req.session.user });
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
