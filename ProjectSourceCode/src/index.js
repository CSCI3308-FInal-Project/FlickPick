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
    const genreCounts    = {};
    const actorCounts    = {};
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
    const topGenres  = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    const topActors    = Object.entries(actorCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const topDirectors = Object.entries(directorCounts).sort((a, b) => b[1] - a[1]).slice(0, 1);
    const topPeople    = [...topActors, ...topDirectors]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    // ── Fetch movies ──────────────────────────────────────────────────────────
    let combined = [];

    if (genre || minRating) {
      // Explicit filters override everything
      const extra = {};
      if (genre)     extra['with_genres']      = genre;
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
      const genreTarget  = Math.round(20 * 0.3);
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
        ...addBatch(shuffleArray(genreBatch),  genreTarget),
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
      id:       String(m.id),
      title:    m.title,
      poster:   m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      year:     m.release_date ? m.release_date.slice(0, 4) : 'N/A',
      rating:   m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
      genres:   (m.genre_ids || []).slice(0, 2).map(id => GENRE_MAP[id]).filter(Boolean).join(', '),
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

    const activeArray = activeTab === 'watched' ? watched : watchlist;
    const totalPages = Math.max(1, Math.ceil(activeArray.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const paged = activeArray.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    res.render('pages/watchlist', {
      user: req.session.user,
      watchlist: activeTab === 'watchlist' ? paged : watchlist,
      watched: activeTab === 'watched' ? paged : watched,
      watchlistCount: watchlist.length,
      watchedCount: watched.length,
      tabWatchlist: activeTab === 'watchlist',
      tabWatched: activeTab === 'watched',
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
      tabWatched: activeTab === 'watched',
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
    const directorPerson = (data.credits?.crew || []).find(p => p.job === 'Director') || null;
    const castPersons    = (data.credits?.cast || []).slice(0, 5);
    res.json({
      director:   directorPerson?.name  || null,
      directorId: directorPerson?.id    ? String(directorPerson.id) : null,
      cast:       castPersons.map(p => p.name),
      actorIds:   castPersons.map(p => String(p.id)),
      synopsis:   data.overview || null,
    });
  } catch (err) {
    console.error('TMDB detail fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch movie details' });
  }
});



// Friends page
app.get('/friends', requireAuth, async (req, res) => {
  try {
    const friends = await db.any(
      `
      SELECT
        u.username,
        p.name,
        p.bio,
        p.favorite_movies,
        p.favorite_genres
      FROM friends f
      JOIN users u
        ON u.id = CASE
          WHEN f.requester_id = $1 THEN f.addressee_id
          ELSE f.requester_id
        END
      LEFT JOIN profile p ON p.user_id = u.id
      WHERE (f.requester_id = $1 OR f.addressee_id = $1)
        AND f.status = 'accepted'
      ORDER BY u.username
      `,
      [req.session.user.id]
    );

    res.render('pages/friends', {
      user: req.session.user,
      friends
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
    const largerId = Math.max(req.session.user.id, targetUser.id);

    await db.none(
      `
      INSERT INTO friends (requester_id, addressee_id, status)
      VALUES ($1, $2, 'accepted')
      ON CONFLICT (requester_id, addressee_id) DO NOTHING
      `,
      [smallerId, largerId]
    );

    res.json({ success: true, message: 'Friend added successfully' });
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).json({ success: false, message: 'Could not add friend' });
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
    gender,
    bio,
    favoriteGenres,
    favoriteMovies
  } = req.body;

  try {
    await db.none(
      `
      UPDATE users
      SET username = $1
      WHERE id = $2
      `,
      [username, req.session.user.id]
    );

    await db.none(
      `
      INSERT INTO profile (user_id, name, age, gender, bio, favorite_genres, favorite_movies)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        age = EXCLUDED.age,
        gender = EXCLUDED.gender,
        bio = EXCLUDED.bio,
        favorite_genres = EXCLUDED.favorite_genres,
        favorite_movies = EXCLUDED.favorite_movies
      `,
      [
        req.session.user.id,
        name || null,
        age ? parseInt(age, 10) : null,
        gender || null,
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
        'INSERT INTO profile(user_id, name, age, gender, bio, favorite_genres, favorite_movies) VALUES($1, $2, $3, $4, $5, $6, $7)',
        [req.session.user.id, '', null, '', '', '', '']
      );

      profile = await db.one(
        'SELECT * FROM profile WHERE user_id = $1',
        [req.session.user.id]
      );
    }

    res.render('pages/profile', {
      user: req.session.user,
      profile,
      activePage: 'profile',
    });
  } catch (err) {
    console.error('Profile load error:', err);
    res.status(500).send('Could not load profile');
  }
});