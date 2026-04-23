const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pgp = require('pg-promise')();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'resources/uploads');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `user_${req.session?.user?.id || 'unknown'}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const app = express();

// Database connection
const db = pgp({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
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
    times: n => Array.from({ length: n }, (_, i) => i + 1),
    lte: (a, b) => a <= b,
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

// ── TMDb page cache ───────────────────────────────────────────────────────────
const tmdbCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function fetchTmdbPage(category, page) {
  const key = `${category}-${page}`;
  const hit = tmdbCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
  const r = await fetch(
    `https://api.themoviedb.org/3/movie/${category}?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=${page}`
  );
  if (!r.ok) throw new Error(`TMDb ${category}/${page} responded ${r.status}`);
  const data = await r.json();
  tmdbCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

// ── Test-only cleanup route (disabled in production) ─────────────────────────
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  app.delete('/test/friends-cleanup', async (req, res) => {
    const { requester, addressee } = req.body;
    try {
      const u1 = await db.oneOrNone('SELECT id FROM users WHERE username = $1', [requester]);
      const u2 = await db.oneOrNone('SELECT id FROM users WHERE username = $1', [addressee]);
      if (u1 && u2) {
        const smallerId = Math.min(u1.id, u2.id);
        const largerId  = Math.max(u1.id, u2.id);
        await db.none(
          'DELETE FROM friends WHERE requester_id = $1 AND addressee_id = $2',
          [smallerId, largerId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.json({ success: false });
    }
  });
}

// Helper: fetch a TMDb discover page with given params
async function tmdbDiscover(extraParams) {
  const params = new URLSearchParams({
    api_key: process.env.TMDB_API_KEY,
    language: 'en-US',
    sort_by: 'popularity.desc',
    page: Math.floor(Math.random() * 5) + 1,
    ...extraParams,
  });
  const r = await fetch(`https://api.themoviedb.org/3/discover/movie?${params}`);
  const d = await r.json();
  return d.results || [];
}

// Helper: fetch a TMDb category page
async function tmdbCategory(category, page) {
  const r = await fetch(
    `https://api.themoviedb.org/3/movie/${category}?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=${page}`
  );
  const d = await r.json();
  return d.results || [];
}

app.get('/', requireAuth, async (req, res) => {
  const { genre, minRating } = req.query;
  const activeFilters = { genre: genre || '', minRating: minRating || '' };

  try {
    // ── Swipe history: already-seen IDs + preference tallies ─────────────────
    const swipeRows = await db.any(
      'SELECT movie_id, genre_ids, actor_ids, director_id, liked FROM swipe_history WHERE user_id = $1',
      [req.session.user.id]
    );

    const seenIds = new Set(swipeRows.map(r => String(r.movie_id)));

    // Also exclude movies already in watchlist (in case they predate swipe tracking)
    const watchlistRows = await db.any(
      'SELECT movie_id FROM watchlist WHERE user_id = $1',
      [req.session.user.id]
    );
    watchlistRows.forEach(r => seenIds.add(String(r.movie_id)));

    // Tally genres, actors, and directors from liked swipes
    const genreCounts = {};
    const actorCounts = {};
    const directorCounts = {};

    for (const row of swipeRows) {
      if (!row.liked) continue;
      if (row.genre_ids) {
        row.genre_ids.split(',').forEach(id => {
          const g = id.trim();
          if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
      }
      if (row.actor_ids) {
        row.actor_ids.split(',').forEach(id => {
          const a = id.trim();
          if (a) actorCounts[a] = (actorCounts[a] || 0) + 1;
        });
      }
      if (row.director_id) {
        directorCounts[row.director_id] = (directorCounts[row.director_id] || 0) + 1;
      }
    }

    const likedCount = swipeRows.filter(r => r.liked).length;
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    const topActors = Object.entries(actorCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const topDirectors = Object.entries(directorCounts).sort((a, b) => b[1] - a[1]).slice(0, 1);
    const topPeople = [...topActors, ...topDirectors]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    // ── Fetch movies ──────────────────────────────────────────────────────────
    let combined = [];

    if (genre || minRating) {
      // Explicit filters override everything
      const extra = {};
      if (genre) extra['with_genres'] = genre;
      if (minRating) extra['vote_average.gte'] = minRating;
      combined = await tmdbDiscover(extra);

    } else if (likedCount >= 5 && (topGenres.length > 0 || topPeople.length > 0)) {
      // Recommendation mode: 30% genre-based, 30% person-based, 40% random
      const fetches = [
        topGenres.length ? tmdbDiscover({ with_genres: topGenres.join(',') }) : Promise.resolve([]),
        topPeople.length ? tmdbDiscover({ with_people: topPeople.join(',') }) : Promise.resolve([]),
        (async () => {
          const cats = shuffleArray([...TMDB_CATEGORIES]).slice(0, 2);
          const [a, b] = await Promise.all([
            tmdbCategory(cats[0], Math.floor(Math.random() * 5) + 1),
            tmdbCategory(cats[1], Math.floor(Math.random() * 5) + 1),
          ]);
          return [...a, ...b];
        })(),
      ];

      const [genreBatch, peopleBatch, randomBatch] = await Promise.all(fetches);
      const genreTarget = Math.round(20 * 0.3);
      const peopleTarget = Math.round(20 * 0.3);
      const randomTarget = 20 - genreTarget - peopleTarget;
      const seen = new Set();
      const addBatch = (batch, limit) => {
        const added = [];
        for (const m of batch) {
          if (added.length >= limit) break;
          if (!seen.has(m.id)) { seen.add(m.id); added.push(m); }
        }
        return added;
      };
      combined = shuffleArray([
        ...addBatch(shuffleArray(genreBatch), genreTarget),
        ...addBatch(shuffleArray(peopleBatch), peopleTarget),
        ...addBatch(shuffleArray(randomBatch), randomTarget),
      ]);

    } else {
      // Not enough history — random shuffle across three categories, wider page range
      const cats = shuffleArray([...TMDB_CATEGORIES]).slice(0, 3);
      const [a, b, c] = await Promise.all([
        tmdbCategory(cats[0], Math.floor(Math.random() * 15) + 1),
        tmdbCategory(cats[1], Math.floor(Math.random() * 15) + 1),
        tmdbCategory(cats[2], Math.floor(Math.random() * 15) + 1),
      ]);
      const seen = new Set();
      combined = [...a, ...b, ...c].filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    }

    const movies = shuffleArray(combined.filter(m => !seenIds.has(String(m.id)))).map(m => ({
      id: String(m.id),
      title: m.title,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      year: m.release_date ? m.release_date.slice(0, 4) : 'N/A',
      rating: m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
      genres: (m.genre_ids || []).slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean).join(', '),
      genreIds: (m.genre_ids || []).join(','),
      synopsis: m.overview || '',
    }));

    const userId = req.session.user.id;
    const [savedResult, watchedResult, discoveredResult] = await Promise.all([
      db.one('SELECT COUNT(*) FROM watchlist WHERE user_id = $1 AND watched = false', [userId]),
      db.one('SELECT COUNT(*) FROM watchlist WHERE user_id = $1 AND watched = true', [userId]),
      db.one('SELECT COUNT(*) FROM swipe_history WHERE user_id = $1', [userId]),
    ]);
    res.render('pages/home', {
      user: req.session.user,
      movies: JSON.stringify(movies),
      activeFilters,
      activePage: 'home',
      savedCount: parseInt(savedResult.count, 10),
      watchedCount: parseInt(watchedResult.count, 10),
      discoveredCount: parseInt(discoveredResult.count, 10),
    });
  } catch (err) {
    console.error('Home route error:', err);
    res.render('pages/home', {
      user: req.session.user,
      movies: '[]',
      activeFilters,
      activePage: 'home',
      savedCount: 0,
      watchedCount: 0,
      discoveredCount: 0,
      fetchError: true,
    });
  }
});

// Record a swipe (called for both pass and save)
app.post('/swipe', requireAuth, async (req, res) => {
  const { movie_id, title, genre_ids, actor_ids, director_id, rating, liked } = req.body;
  try {
    await db.none(
      `INSERT INTO swipe_history(user_id, movie_id, title, genre_ids, actor_ids, director_id, rating, liked)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, movie_id) DO NOTHING`,
      [req.session.user.id, String(movie_id), title,
      genre_ids || '', actor_ids || '', director_id || null,
      rating || null, liked === true || liked === 'true']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Swipe record error:', err);
    res.status(500).json({ success: false });
  }
});


app.get('/login', (req, res) => {
  res.render('pages/login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.oneOrNone('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render('pages/login', { message: 'Invalid username/email or password.' });
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
  if (!username || !email || !password) {
    return res.status(400).render('pages/register', { message: 'All fields are required.' });
  }
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
  const PAGE_SIZE = 20;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const all = await db.any(
      'SELECT * FROM watchlist WHERE user_id = $1 ORDER BY added_at DESC',
      [req.session.user.id]
    );
    const watchlist = all.filter(m => !m.watched);
    const watched = all.filter(m => m.watched);

    // Batch-fetch which friends also have these movies
    const movieIds = all.map(r => r.movie_id);
    const friendActivityMap = {};
    if (movieIds.length > 0) {
      const friendRows = await db.any(
        `SELECT w.movie_id, u.username, w.watched
         FROM friends f
         JOIN users u
           ON u.id = CASE
             WHEN f.requester_id = $1 THEN f.addressee_id
             ELSE f.requester_id
           END
         JOIN watchlist w ON w.user_id = u.id
         WHERE (f.requester_id = $1 OR f.addressee_id = $1)
           AND f.status = 'accepted'
           AND w.movie_id = ANY($2)`,
        [req.session.user.id, movieIds]
      );
      for (const row of friendRows) {
        if (!friendActivityMap[row.movie_id]) friendActivityMap[row.movie_id] = [];
        friendActivityMap[row.movie_id].push({ username: row.username, watched: row.watched });
      }
    }

    // Attach serialized friend data to each row
    const attachFriends = rows => rows.map(r => ({
      ...r,
      friendsJson: JSON.stringify(friendActivityMap[r.movie_id] || [])
    }));

    const watchlistWithFriends = attachFriends(watchlist);
    const watchedWithFriends   = attachFriends(watched);

    const activeArray = activeTab === 'watched' ? watchedWithFriends : watchlistWithFriends;
    const totalPages = Math.max(1, Math.ceil(activeArray.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const paged = activeArray.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    res.render('pages/watchlist', {
      user: req.session.user,
      watchlist: activeTab === 'watchlist' ? paged : watchlistWithFriends,
      watched:   activeTab === 'watched'   ? paged : watchedWithFriends,
      watchlistCount: watchlist.length,
      watchedCount:   watched.length,
      tabWatchlist: activeTab === 'watchlist',
      tabWatched:   activeTab === 'watched',
      currentPage: safePage,
      totalPages,
      showPagination: totalPages > 1,
      hasPrev: safePage > 1,
      hasNext: safePage < totalPages,
      prevPage: safePage - 1,
      nextPage: safePage + 1,
      activePage: 'watchlist',
    });
  } catch (err) {
    console.error(err);
    res.render('pages/watchlist', {
      user: req.session.user,
      watchlist: [], watched: [],
      watchlistCount: 0, watchedCount: 0,
      tabWatchlist: activeTab === 'watchlist',
      tabWatched:   activeTab === 'watched',
      currentPage: 1, totalPages: 1,
      showPagination: false,
      hasPrev: false, hasNext: false,
      prevPage: 1, nextPage: 1,
      activePage: 'watchlist',
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

app.post('/watchlist/watch-direct', requireAuth, async (req, res) => {
  const { movie_id, title, poster_url, genre, year, rating, synopsis } = req.body;
  try {
    await db.none(
      `INSERT INTO watchlist(user_id, movie_id, title, poster_url, genre, year, rating, synopsis, watched)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (user_id, movie_id) DO UPDATE SET watched = true`,
      [req.session.user.id, movie_id, title, poster_url || null,
      genre || null, year || null, rating || null, synopsis || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Watch-direct error:', err);
    res.status(500).json({ success: false });
  }
});


app.delete('/watchlist/by-movie/:movie_id', requireAuth, async (req, res) => {
  try {
    await db.none(
      'DELETE FROM watchlist WHERE user_id = $1 AND movie_id = $2',
      [req.session.user.id, req.params.movie_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Watchlist by-movie delete error:', err);
    res.status(500).json({ success: false, error: 'Failed to remove from watchlist' });
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
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
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

// ─── Reviews ──────────────────────────────────────────────────────────────────

app.post('/reviews', requireAuth, async (req, res) => {
  const { movie_id, title, rating, review_text } = req.body;
  if (!movie_id || !rating) {
    return res.status(400).json({ error: 'movie_id and rating are required' });
  }
  const r = parseInt(rating, 10);
  if (isNaN(r) || r < 1 || r > 10) {
    return res.status(400).json({ error: 'rating must be 1–10' });
  }
  try {
    const row = await db.one(
      `INSERT INTO reviews (user_id, movie_id, title, rating, review_text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, movie_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             review_text = EXCLUDED.review_text,
             updated_at = NOW()
       RETURNING id`,
      [req.session.user.id, movie_id, title || null, r, review_text || null]
    );
    res.status(201).json({ success: true, id: row.id });
  } catch (err) {
    console.error('Review upsert error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.delete('/reviews/:id', requireAuth, async (req, res) => {
  try {
    await db.none(
      'DELETE FROM reviews WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Review delete error:', err);
    res.status(500).json({ success: false });
  }
});

// ─── Movie detail proxy ───────────────────────────────────────────────────────

app.get('/api/movie/:tmdbId', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${req.params.tmdbId}?append_to_response=credits&api_key=${process.env.TMDB_API_KEY}`
    );
    if (!response.ok) throw new Error(`TMDB responded ${response.status}`);
    const data = await response.json();
    const directorPerson = (data.credits?.crew || []).find(p => p.job === 'Director') || null;
    const castPersons = (data.credits?.cast || []).slice(0, 5);
    res.json({
      director: directorPerson?.name || null,
      directorId: directorPerson?.id ? String(directorPerson.id) : null,
      cast: castPersons.map(p => p.name),
      actorIds: castPersons.map(p => String(p.id)),
      synopsis: data.overview || null,
    });
  } catch (err) {
    console.error('TMDB detail fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch movie details' });
  }
});

app.get('/api/reviews', requireAuth, async (req, res) => {
  const { movie_id } = req.query;
  if (!movie_id) return res.json({ review: null });
  try {
    const row = await db.oneOrNone(
      'SELECT * FROM reviews WHERE user_id = $1 AND movie_id = $2',
      [req.session.user.id, movie_id]
    );
    res.json({ review: row || null });
  } catch (err) {
    console.error('Get review error:', err);
    res.status(500).json({ review: null });
  }
});

app.get('/api/movie/:tmdbId/reviews', requireAuth, async (req, res) => {
  const { tmdbId } = req.params;
  const userId = req.session.user.id;
  try {
    const rows = await db.any(
      `SELECT r.id, r.rating, r.review_text, r.created_at, u.username
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.movie_id = $1
         AND r.user_id != $2
         AND (
           EXISTS (
             SELECT 1 FROM friends
             WHERE requester_id = $2 AND addressee_id = r.user_id AND status = 'accepted'
           ) OR EXISTS (
             SELECT 1 FROM friends
             WHERE requester_id = r.user_id AND addressee_id = $2 AND status = 'accepted'
           )
         )
       ORDER BY r.created_at DESC`,
      [tmdbId, userId]
    );
    res.json({ reviews: rows });
  } catch (err) {
    console.error('Friend reviews error:', err);
    res.status(500).json({ reviews: [] });
  }
});

// ─── Notifications ────────────────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const rows = await db.any(
      `SELECT id, type, payload, read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.session.user.id]
    );
    const unreadCount = rows.filter(r => !r.read).length;
    res.json({ unreadCount, notifications: rows });
  } catch (err) {
    console.error('Notifications fetch error:', err);
    res.status(500).json({ unreadCount: 0, notifications: [] });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await db.none(
      'UPDATE notifications SET read = true WHERE user_id = $1',
      [req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ success: false });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await db.none(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ success: false });
  }
});

// Friends page
app.get('/friends', requireAuth, async (req, res) => {
  try {
    const friends = await db.any(
      `SELECT f.id, u.username, p.name, p.bio, p.favorite_movies, p.favorite_genres
       FROM friends f
       JOIN users u ON u.id = CASE
         WHEN f.requester_id = $1 THEN f.addressee_id
         ELSE f.requester_id
       END
       LEFT JOIN profile p ON p.user_id = u.id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
       ORDER BY u.username`,
      [req.session.user.id]
    );

    const pendingRequests = await db.any(
      `SELECT f.id, u.username
       FROM friends f
       JOIN users u ON u.id = f.sender_id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.sender_id != $1
         AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.session.user.id]
    );

    res.render('pages/friends', {
      user: req.session.user,
      friends,
      pendingRequests,
      pendingCount: pendingRequests.length,
    });
  } catch (err) {
    console.error('Friends load error:', err);
    res.status(500).send('Could not load friends');
  }
});

// Add friend
app.post('/friends/add', requireAuth, async (req, res) => {
  const { username } = req.body;
  try {
    const targetUser = await db.oneOrNone(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (targetUser.id === req.session.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot add yourself' });
    }

    const smallerId = Math.min(req.session.user.id, targetUser.id);
    const largerId  = Math.max(req.session.user.id, targetUser.id);

    const existing = await db.oneOrNone(
      'SELECT id, status FROM friends WHERE requester_id = $1 AND addressee_id = $2',
      [smallerId, largerId]
    );
    if (existing) {
      return res.status(409).json({ success: false, message: 'Friend request already sent or already friends' });
    }

    await db.none(
      `INSERT INTO friends (requester_id, addressee_id, status, sender_id)
       VALUES ($1, $2, 'pending', $3)`,
      [smallerId, largerId, req.session.user.id]
    );

    await db.none(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1, 'friend_request', $2)`,
      [targetUser.id, JSON.stringify({ from_user_id: req.session.user.id, from_username: req.session.user.username })]
    );

    res.json({ success: true, message: 'Friend request sent' });
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).json({ success: false, message: 'Could not send friend request' });
  }
});

app.get('/friends/requests', requireAuth, async (req, res) => {
  try {
    const rows = await db.any(
      `SELECT f.id, u.username, f.sender_id AS from_user_id
       FROM friends f
       JOIN users u ON u.id = f.sender_id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.sender_id != $1
         AND f.status = 'pending'`,
      [req.session.user.id]
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error('Friend requests fetch error:', err);
    res.status(500).json({ requests: [] });
  }
});

app.post('/friends/accept/:id', requireAuth, async (req, res) => {
  try {
    const friendRow = await db.oneOrNone(
      `SELECT * FROM friends WHERE id = $1
       AND (requester_id = $2 OR addressee_id = $2)
       AND sender_id != $2
       AND status = 'pending'`,
      [req.params.id, req.session.user.id]
    );
    if (!friendRow) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    await db.none(
      'UPDATE friends SET status = $1 WHERE id = $2',
      ['accepted', req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Accept friend error:', err);
    res.status(500).json({ success: false });
  }
});

app.post('/friends/decline/:id', requireAuth, async (req, res) => {
  try {
    await db.none(
      `DELETE FROM friends WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2) AND status = 'pending'`,
      [req.params.id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Decline friend error:', err);
    res.status(500).json({ success: false });
  }
});

app.delete('/friends/:id', requireAuth, async (req, res) => {
  try {
    await db.none(
      `DELETE FROM friends WHERE id = $1
       AND (requester_id = $2 OR addressee_id = $2)
       AND status = 'accepted'`,
      [req.params.id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Unfriend error:', err);
    res.status(500).json({ success: false });
  }
});

// View friends profile
app.get('/users/:username', requireAuth, async (req, res) => {
  const { username } = req.params;

  try {
    const viewedUser = await db.oneOrNone(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );

    if (!viewedUser) {
      return res.status(404).send('User not found');
    }

    const profile = await db.oneOrNone(
      'SELECT * FROM profile WHERE user_id = $1',
      [viewedUser.id]
    );

    res.render('pages/userprofile', {
      user: req.session.user,
      viewedUser,
      profile: profile || {}
    });
  } catch (err) {
    console.error('User profile load error:', err);
    res.status(500).send('Could not load user profile');
  }
});


app.put('/api/profile', requireAuth, async (req, res) => {
  const {
    username,
    name,
    age,
    country,
    bio,
    favoriteGenres,
    favoriteMovies
  } = req.body;

  try {
    await db.none(
      `UPDATE users SET username = $1 WHERE id = $2`,
      [username, req.session.user.id]
    );

    await db.none(
      `
      INSERT INTO profile (user_id, name, age, country, bio, favorite_genres, favorite_movies)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        country = EXCLUDED.country,
        bio = EXCLUDED.bio,
        favorite_genres = EXCLUDED.favorite_genres,
        favorite_movies = EXCLUDED.favorite_movies
      `,
      [
        req.session.user.id,
        name || null,
        age ? parseInt(age, 10) : null,
        country ? country.toUpperCase().slice(0, 2) : null,
        bio || null,
        favoriteGenres || null,
        favoriteMovies || null
      ]
    );

    req.session.user.username = username;

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile save error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.post('/profile/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const photoUrl = `/uploads/${req.file.filename}`;
  try {
    await db.none(
      'UPDATE profile SET photo_url = $1 WHERE user_id = $2',
      [photoUrl, req.session.user.id]
    );
    res.json({ success: true, photoUrl });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to save photo' });
  }
});

// ─── Group Sessions ───────────────────────────────────────────────────────────

app.get('/group-sessions', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const sessions = await db.any(
      `SELECT gs.*,
        (SELECT COUNT(*) FROM session_members sm WHERE sm.session_id = gs.id AND sm.status = 'joined') AS member_count,
        (SELECT COUNT(*) FROM (
          SELECT movie_id FROM session_swipes WHERE session_id = gs.id AND liked = true
          GROUP BY movie_id
          HAVING COUNT(DISTINCT user_id) = (SELECT COUNT(*) FROM session_members WHERE session_id = gs.id AND status = 'joined')
        ) m) AS match_count
       FROM group_sessions gs
       JOIN session_members sm ON sm.session_id = gs.id
       WHERE sm.user_id = $1
       ORDER BY gs.created_at DESC`,
      [userId]
    );
    const friends = await db.any(
      `SELECT u.id, u.username FROM friends f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
       ORDER BY u.username`,
      [userId]
    );
    const topPicks = await db.any(
      `SELECT w.movie_id, w.title, w.poster_url, COUNT(DISTINCT w.user_id) AS watchlist_count
       FROM friends f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       JOIN watchlist w ON w.user_id = u.id
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
       GROUP BY w.movie_id, w.title, w.poster_url
       ORDER BY watchlist_count DESC LIMIT 20`,
      [userId]
    );
    res.render('pages/group-sessions', {
      user: req.session.user, activePage: 'group-sessions',
      sessions: sessions.map(s => ({ ...s, member_count: parseInt(s.member_count)||0, match_count: parseInt(s.match_count)||0 })),
      friends, topPicks,
    });
  } catch (err) {
    console.error('Group sessions load error:', err);
    res.render('pages/group-sessions', { user: req.session.user, activePage: 'group-sessions', sessions: [], friends: [], topPicks: [], error: 'Could not load sessions.' });
  }
});

app.post('/group-sessions/create', requireAuth, async (req, res) => {
  const { name, mode, inviteUserIds, seedMovieId } = req.body;
  const userId = req.session.user.id;
  if (!name) return res.status(400).json({ message: 'Session name is required.' });
  try {
    let code, exists = true;
    while (exists) {
      code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const row = await db.oneOrNone('SELECT id FROM group_sessions WHERE code = $1', [code]);
      exists = !!row;
    }
    const session = await db.one(
      `INSERT INTO group_sessions (owner_id, name, code, mode, seed_movie_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [userId, name, code, mode || 'async', seedMovieId || null]
    );
    await db.none(
      `INSERT INTO session_members (session_id, user_id, status, joined_at) VALUES ($1,$2,'joined',NOW())`,
      [session.id, userId]
    );
    const invites = Array.isArray(inviteUserIds) ? inviteUserIds : (inviteUserIds ? [inviteUserIds] : []);
    for (const invitedId of invites) {
      await db.none(
        `INSERT INTO session_members (session_id, user_id, status) VALUES ($1,$2,'invited') ON CONFLICT DO NOTHING`,
        [session.id, invitedId]
      );
    }
    res.json({ sessionId: session.id, code });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ message: 'Could not create session.' });
  }
});

app.post('/group-sessions/join', requireAuth, async (req, res) => {
  const { code } = req.body;
  const userId = req.session.user.id;
  try {
    const session = await db.oneOrNone('SELECT * FROM group_sessions WHERE code = $1', [code]);
    if (!session) return res.status(404).json({ message: 'Session not found.' });
    if (session.status === 'ended') return res.status(400).json({ message: 'This session has already ended.' });
    await db.none(
      `INSERT INTO session_members (session_id, user_id, status, joined_at) VALUES ($1,$2,'joined',NOW())
       ON CONFLICT (session_id, user_id) DO UPDATE SET status='joined', joined_at=NOW()`,
      [session.id, userId]
    );
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Join session error:', err);
    res.status(500).json({ message: 'Could not join session.' });
  }
});

app.get('/group-sessions/:id', requireAuth, async (req, res) => {
  const sessionId = req.params.id;
  const userId = req.session.user.id;
  try {
    const session = await db.oneOrNone('SELECT * FROM group_sessions WHERE id = $1', [sessionId]);
    if (!session) return res.status(404).send('Session not found');
    const members = await db.any(
      `SELECT sm.user_id, sm.status, u.username,
         (SELECT COUNT(*) FROM session_swipes ss WHERE ss.session_id=$1 AND ss.user_id=sm.user_id) AS swipe_count
       FROM session_members sm JOIN users u ON u.id=sm.user_id WHERE sm.session_id=$1`,
      [sessionId]
    );
    const matches = await db.any(
      `SELECT movie_id, title, poster_url FROM session_swipes
       WHERE session_id=$1 AND liked=true
       GROUP BY movie_id, title, poster_url
       HAVING COUNT(DISTINCT user_id)=(SELECT COUNT(*) FROM session_members WHERE session_id=$1 AND status='joined')`,
      [sessionId]
    );
    const mySwipeRow = await db.oneOrNone(
      'SELECT COUNT(*) FROM session_swipes WHERE session_id=$1 AND user_id=$2',
      [sessionId, userId]
    );
    const mySwipeCount = parseInt(mySwipeRow?.count || 0);
    const swipedIds = await db.any('SELECT movie_id FROM session_swipes WHERE session_id=$1 AND user_id=$2', [sessionId, userId]);
    const swipedSet = new Set(swipedIds.map(r => String(r.movie_id)));
    let pool = [];
    try {
      if (session.seed_movie_id && !swipedSet.has(String(session.seed_movie_id))) {
        const seedRes = await fetch(`https://api.themoviedb.org/3/movie/${session.seed_movie_id}?api_key=${process.env.TMDB_API_KEY}`);
        const seedData = await seedRes.json();
        if (seedData.id) pool.push({ id:String(seedData.id), title:seedData.title, poster:seedData.poster_path?`https://image.tmdb.org/t/p/w500${seedData.poster_path}`:null, year:seedData.release_date?.slice(0,4)||'N/A', rating:seedData.vote_average?.toFixed(1)||'N/A', genres:(seedData.genre_ids||[]).slice(0,2).map(id=>GENRE_MAP[id]).filter(Boolean).join(', '), synopsis:seedData.overview||'' });
      }
      const page = Math.floor(Math.random()*5)+1;
      const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/popular?api_key=${process.env.TMDB_API_KEY}&language=en-US&page=${page}`);
      const tmdbData = await tmdbRes.json();
      const extra = (tmdbData.results||[]).filter(m=>!swipedSet.has(String(m.id))).map(m=>({ id:String(m.id), title:m.title, poster:m.poster_path?`https://image.tmdb.org/t/p/w500${m.poster_path}`:null, year:m.release_date?.slice(0,4)||'N/A', rating:m.vote_average?.toFixed(1)||'N/A', genres:(m.genre_ids||[]).slice(0,2).map(id=>GENRE_MAP[id]).filter(Boolean).join(', '), synopsis:m.overview||'' }));
      pool = [...pool, ...extra].slice(0, 20);
    } catch(_) {}
    const isOwner = session.owner_id === userId;
    const totalMovies = pool.length;
    const progressPct = totalMovies > 0 ? Math.round((mySwipeCount/totalMovies)*100) : 0;
    res.render('pages/group-session-detail', {
      user:req.session.user, session, activePage:'group-sessions',
      members: members.map(m=>({...m, swipeCount:parseInt(m.swipe_count||0)})),
      matches, mySwipeCount, totalMovies, progressPct,
      matchCount: matches.length, isOwner,
      moviesJson: JSON.stringify(pool),
    });
  } catch (err) {
    console.error('Session detail error:', err);
    res.status(500).send('Could not load session');
  }
});

app.post('/group-sessions/:id/swipe', requireAuth, async (req, res) => {
  const { movieId, title, posterUrl, liked } = req.body;
  const sessionId = req.params.id;
  const userId = req.session.user.id;
  try {
    await db.none(
      `INSERT INTO session_swipes (session_id, user_id, movie_id, title, poster_url, liked)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id, user_id, movie_id) DO UPDATE SET liked=EXCLUDED.liked`,
      [sessionId, userId, movieId, title, posterUrl||null, liked]
    );
    const match = await db.oneOrNone(
      `SELECT movie_id, title, poster_url FROM session_swipes
       WHERE session_id=$1 AND liked=true
         AND movie_id IN (
           SELECT movie_id FROM session_swipes WHERE session_id=$1 AND liked=true
           GROUP BY movie_id
           HAVING COUNT(DISTINCT user_id)=(SELECT COUNT(*) FROM session_members WHERE session_id=$1 AND status='joined')
         )
       LIMIT 1`,
      [sessionId]
    );
    res.json({ matched:!!match, matchedMovie:match||null });
  } catch (err) {
    console.error('Session swipe error:', err);
    res.status(500).json({ matched:false });
  }
});

app.post('/group-sessions/:id/end', requireAuth, async (req, res) => {
  try {
    await db.none(
      `UPDATE group_sessions SET status='ended', ended_at=NOW() WHERE id=$1 AND owner_id=$2`,
      [req.params.id, req.session.user.id]
    );
    res.json({ success:true });
  } catch (err) {
    console.error('End session error:', err);
    res.status(500).json({ success:false });
  }
});

// ── Notifications (Phase 3B) ──────────────────────────────────────────────────

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notifications = await db.any(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY read ASC, created_at DESC 
       LIMIT 20`,
      [req.session.user.id]
    );
    const unreadCountRow = await db.one(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false`,
      [req.session.user.id]
    );
    res.json({
      unreadCount: parseInt(unreadCountRow.count),
      notifications: notifications
    });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await db.none(
      `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await db.none(
      `UPDATE notifications SET read = true WHERE user_id = $1`,
      [req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/group-sessions/:id/state', requireAuth, async (req, res) => {
  const sessionId = req.params.id;
  try {
    const session = await db.oneOrNone('SELECT * FROM group_sessions WHERE id=$1', [sessionId]);
    const members = await db.any(
      `SELECT sm.user_id, sm.status, u.username,
         (SELECT COUNT(*) FROM session_swipes ss WHERE ss.session_id=$1 AND ss.user_id=sm.user_id) AS swipe_count
       FROM session_members sm JOIN users u ON u.id=sm.user_id WHERE sm.session_id=$1`,
      [sessionId]
    );
    const matches = await db.any(
      `SELECT movie_id, title, poster_url FROM session_swipes
       WHERE session_id=$1 AND liked=true
       GROUP BY movie_id, title, poster_url
       HAVING COUNT(DISTINCT user_id)=(SELECT COUNT(*) FROM session_members WHERE session_id=$1 AND status='joined')`,
      [sessionId]
    );
    res.json({ session, members:members.map(m=>({...m,swipeCount:parseInt(m.swipe_count||0)})), matches });
  } catch (err) {
    console.error('State poll error:', err);
    res.status(500).json({ session:null, members:[], matches:[] });
  }
});
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

// Profile

app.get('/profile', requireAuth, async (req, res) => {
  try {
    let profile = await db.oneOrNone(
      'SELECT * FROM profile WHERE user_id = $1',
      [req.session.user.id]
    );

    if (!profile) {
      await db.none(
        'INSERT INTO profile(user_id, name, age, country, bio, favorite_genres, favorite_movies) VALUES($1, $2, $3, $4, $5, $6, $7)',
        [req.session.user.id, '', null, null, '', '', '']
      );
      profile = await db.one('SELECT * FROM profile WHERE user_id = $1', [req.session.user.id]);
    }

    // Swipe stats
    const swipeRows = await db.any(
      'SELECT genre_ids, liked FROM swipe_history WHERE user_id = $1',
      [req.session.user.id]
    );
    const totalSwipes = swipeRows.length;
    const rightSwipes = swipeRows.filter(r => r.liked).length;
    const leftSwipes = totalSwipes - rightSwipes;

    // Top 3 genres from liked swipes
    const genreCounts = {};
    for (const row of swipeRows) {
      if (!row.liked || !row.genre_ids) continue;
      row.genre_ids.split(',').forEach(id => {
        const g = id.trim();
        if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    }
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => GENRE_MAP[id])
      .filter(Boolean);

    // Watchlist counts
    const [savedResult, watchedResult] = await Promise.all([
      db.one('SELECT COUNT(*) FROM watchlist WHERE user_id = $1 AND watched = false', [req.session.user.id]),
      db.one('SELECT COUNT(*) FROM watchlist WHERE user_id = $1 AND watched = true', [req.session.user.id]),
    ]);

    // Recent reviews
    const recentReviews = await db.any(
      `SELECT r.*, w.poster_url
       FROM reviews r
       LEFT JOIN watchlist w ON w.movie_id = r.movie_id AND w.user_id = r.user_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT 5`,
      [req.session.user.id]
    );

    res.render('pages/profile', {
      user: req.session.user,
      profile,
      activePage: 'profile',
      totalSwipes,
      rightSwipes,
      leftSwipes,
      topGenres,
      savedCount: parseInt(savedResult.count, 10),
      watchedCount: parseInt(watchedResult.count, 10),
      recentReviews,
    });
  } catch (err) {
    console.error('Profile load error:', err);
    res.status(500).send('Could not load profile');
  }
});