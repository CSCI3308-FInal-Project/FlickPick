const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pgp = require('pg-promise')();
const path = require('path');
const fs = require('fs');

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
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  helpers: {
    eq: (a, b) => a === b,
    or: (a, b) => a || b,
  },
}));
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

const TMDB_CATEGORIES = ['popular', 'top_rated', 'upcoming', 'now_playing'];

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

app.get('/', requireAuth, async (req, res) => {
  const { genre, minRating } = req.query;
  const activeFilters = { genre: genre || '', minRating: minRating || '' };

  try {
    let combined = [];

    if (genre || minRating) {
      // Use TMDb discover endpoint when filters are active
      const params = new URLSearchParams({
        api_key: process.env.TMDB_API_KEY,
        language: 'en-US',
        sort_by: 'popularity.desc',
        page: Math.floor(Math.random() * 5) + 1,
      });
      if (genre)     params.set('with_genres', genre);
      if (minRating) params.set('vote_average.gte', minRating);

      const r = await fetch(`https://api.themoviedb.org/3/discover/movie?${params}`);
      const d = await r.json();
      combined = d.results || [];
    } else {
      // No filters — pick 2 random categories on random pages
      const cats = shuffleArray([...TMDB_CATEGORIES]).slice(0, 2);
      const page1 = Math.floor(Math.random() * 5) + 1;
      const page2 = Math.floor(Math.random() * 5) + 1;

      const [r1, r2] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/movie/${cats[0]}?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=${page1}`),
        fetch(`https://api.themoviedb.org/3/movie/${cats[1]}?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=${page2}`),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

      const seen = new Set();
      combined = [...(d1.results || []), ...(d2.results || [])].filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    }

    const movies = shuffleArray(combined).map(m => ({
      id: String(m.id),
      title: m.title,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      year: m.release_date ? m.release_date.slice(0, 4) : 'N/A',
      rating: m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
      genres: (m.genre_ids || []).slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean).join(', '),
      synopsis: m.overview || '',
    }));

    res.render('pages/home', { user: req.session.user, movies: JSON.stringify(movies), activeFilters });
  } catch (err) {
    console.error('TMDb fetch error:', err);
    res.render('pages/home', { user: req.session.user, movies: '[]', activeFilters });
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
  const activeTab = req.query.tab === 'watched' ? 'watched' : 'watchlist';
  try {
    const all = await db.any(
      'SELECT * FROM watchlist WHERE user_id = $1 ORDER BY added_at DESC',
      [req.session.user.id]
    );
    const watchlist = all.filter(m => !m.watched);
    const watched   = all.filter(m => m.watched);
    res.render('pages/watchlist', {
      user: req.session.user,
      watchlist,
      watched,
      watchlistCount: watchlist.length,
      watchedCount:   watched.length,
      tabWatchlist:   activeTab === 'watchlist',
      tabWatched:     activeTab === 'watched',
    });
  } catch (err) {
    console.error(err);
    res.render('pages/watchlist', {
      user: req.session.user,
      watchlist: [], watched: [],
      watchlistCount: 0, watchedCount: 0,
      tabWatchlist: true, tabWatched: false,
    });
  }
});

app.post('/watchlist', requireAuth, async (req, res) => {
  const { movie_id, title, poster_url, genre, year, rating, synopsis } = req.body;
  try {
    await db.none(
      `INSERT INTO watchlist(user_id, movie_id, title, poster_url, genre, year, rating, synopsis)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.session.user.id, movie_id, title, poster_url || null,
       genre || null, year || null, rating || null, synopsis || null]
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
  const tab = req.body._tab === 'watched' ? 'watched' : 'watchlist';
  try {
    await db.none(
      'DELETE FROM watchlist WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
  } catch (err) {
    console.error(err);
  }
  res.redirect(`/watchlist?tab=${tab}`);
});

app.post('/watchlist/:id/watch', requireAuth, async (req, res) => {
  try {
    await db.none(
      'UPDATE watchlist SET watched = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
  } catch (err) {
    console.error(err);
  }
  res.redirect('/watchlist?tab=watchlist');
});

app.post('/watchlist/:id/unwatch', requireAuth, async (req, res) => {
  try {
    await db.none(
      'UPDATE watchlist SET watched = false WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
  } catch (err) {
    console.error(err);
  }
  res.redirect('/watchlist?tab=watched');
});

// ─── Movie detail proxy ───────────────────────────────────────────────────────

app.get('/api/movie/:tmdbId', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${req.params.tmdbId}?append_to_response=credits&api_key=${process.env.TMDB_API_KEY}`
    );
    if (!response.ok) throw new Error(`TMDB responded ${response.status}`);
    const data = await response.json();
    const director = (data.credits?.crew || []).find(p => p.job === 'Director')?.name || null;
    const cast = (data.credits?.cast || []).slice(0, 5).map(p => p.name);
    res.json({ director, cast });
  } catch (err) {
    console.error('TMDB detail fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch movie details' });
  }
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

async function initDb() {
  const createSql = fs.readFileSync(path.join(__dirname, 'init_data/create.sql'), 'utf8');
  const insertSql = fs.readFileSync(path.join(__dirname, 'init_data/insert.sql'), 'utf8');
  await db.none(createSql);
  await db.none(insertSql);
  console.log('Database initialized');
}

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`FlickPick running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });

module.exports = app;
