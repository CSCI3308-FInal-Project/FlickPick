// FlickPick — client-side scripts

document.addEventListener('DOMContentLoaded', () => {
  const movies   = window.FLICKPICK_MOVIES || [];
  let index      = 0;

  const card = document.getElementById('movieCard');
  const noMore = document.getElementById('noMoreMsg');
  const poster = document.getElementById('cardPoster');
  const fallback = document.getElementById('cardFallback');
  const titleEl = document.getElementById('cardTitle');
  const metaEl = document.getElementById('cardMeta');
  const synopsis = document.getElementById('cardSynopsis');
  const passBtn = document.getElementById('passBtn');
  const saveBtn = document.getElementById('saveBtn');

  function showCard(i) {
    if (i >= movies.length) {
      card.style.display = 'none';
      noMore.style.display = 'block';
      return;
    }
    const m = movies[i];
    titleEl.textContent = m.title;
    const badgeHtml = (m.genres || '').split(', ').filter(Boolean).map(g => {
      const cls = g.replace(/[^a-zA-Z]/g, '');
      return `<span class="genre-badge genre-${cls}">${g}</span>`;
    }).join(' ');
    const metaParts = [m.year, m.rating ? `★ ${m.rating}` : null].filter(Boolean).join(' · ');
    metaEl.innerHTML = badgeHtml + (metaParts ? `<span class="meta-sep"> · </span>${metaParts}` : '');
    synopsis.textContent = m.synopsis;

    if (m.poster) {
      poster.src = m.poster;
      poster.style.display = '';
      fallback.style.display = 'none';
    } else {
      poster.style.display = 'none';
      fallback.style.display = '';
    }
  }

  function advance(direction) {
    card.classList.add(direction === 'pass' ? 'swipe-left' : 'swipe-right');
    setTimeout(() => {
      card.classList.remove('swipe-left', 'swipe-right');
      index++;
      showCard(index);
    }, 350);
  }

  if (passBtn) {
    passBtn.addEventListener('click', () => advance('pass'));
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const m = movies[index];
      if (!m) return;
      try {
        await fetch('/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            movie_id:  m.id,
            title:     m.title,
            poster_url: m.poster,
            genre:     m.genres,
            year:      m.year,
            rating:    m.rating,
            synopsis:  m.synopsis,
          }),
        });
      } catch (_) {
        // silently continue — card still advances
      }
      advance('save');
    });
  }

  // ── Watchlist — client-side filter ─────────────────────────────────────────
  const searchInput = document.getElementById('watchlistSearch');
  const genreSelect = document.getElementById('genreFilter');
  const movieList = document.getElementById('movieList');

  if (searchInput && genreSelect && movieList) {
    // Populate genre dropdown from rendered data attributes
    const genres = [...new Set(
      [...movieList.querySelectorAll('.movie-row')]
        .map(r => r.dataset.genre)
        .filter(Boolean)
    )].sort();
    genres.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      genreSelect.appendChild(opt);
    });

    function filterMovies() {
      const q = searchInput.value.toLowerCase();
      const genre = genreSelect.value;
      movieList.querySelectorAll('.movie-row').forEach(row => {
        const matchTitle = row.dataset.title.toLowerCase().includes(q);
        const matchGenre = !genre || row.dataset.genre === genre;
        row.style.display = matchTitle && matchGenre ? '' : 'none';
      });
    }

    searchInput.addEventListener('input', filterMovies);
    genreSelect.addEventListener('change', filterMovies);
  }

  showCard(0);
});

// ── Dropdown ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const dropdown = document.querySelector('.nav-dropdown');
  if (!dropdown) return;

  const toggle = dropdown.querySelector('.nav-link');
  toggle.addEventListener('click', e => {
    e.preventDefault();
    dropdown.classList.toggle('dropdown-open');
  });

  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('dropdown-open');
    }
  });
});

// ── Modal ──────────────────────────────────────────────────────────────────────

const detailsCache = {};

function openModal(row) {
  document.getElementById('modalTitle').textContent = row.dataset.title || '';
  document.getElementById('modalRating').textContent = row.dataset.rating ? `★ ${row.dataset.rating}` : '';
  document.getElementById('modalMeta').textContent =
    [row.dataset.genre, row.dataset.year].filter(Boolean).join(' • ');
  document.getElementById('modalTmdbLink').href =
    `https://www.themoviedb.org/movie/${row.dataset.movieId}`;

  const id = row.dataset.id;
  const isWatched = row.dataset.watched === 'true';

  document.getElementById('modalDeleteForm').action = `/watchlist/${id}`;
  document.getElementById('modalDeleteTab').value = isWatched ? 'watched' : 'watchlist';

  const watchForm = document.getElementById('modalWatchForm');
  const watchBtn  = document.getElementById('modalWatchBtn');
  if (isWatched) {
    watchForm.action = `/watchlist/${id}/unwatch`;
    watchBtn.textContent = '↩ Move to Watchlist';
  } else {
    watchForm.action = `/watchlist/${id}/watch`;
    watchBtn.textContent = '✓ Mark as Watched';
  }

  const posterEl = document.getElementById('modalPoster');
  if (row.dataset.poster) {
    posterEl.innerHTML = `<img src="${row.dataset.poster}" alt="${row.dataset.title} poster" />`;
  } else {
    posterEl.textContent = '🎬';
  }

  // Show loading state
  document.getElementById('modalLoading').style.display = '';
  document.getElementById('modalDetails').style.display = 'none';
  document.getElementById('modalError').style.display = 'none';

  document.getElementById('modalBackdrop').classList.add('modal-open');

  // Render synopsis immediately from DB data
  document.getElementById('modalSynopsis').textContent = row.dataset.synopsis || '';

  const tmdbId = row.dataset.movieId;

  if (detailsCache[tmdbId]) {
    renderDetails(detailsCache[tmdbId]);
    return;
  }

  fetch(`/api/movie/${tmdbId}`)
    .then(r => r.json())
    .then(data => {
      detailsCache[tmdbId] = data;
      renderDetails(data);
    })
    .catch(() => {
      document.getElementById('modalLoading').style.display = 'none';
      document.getElementById('modalError').style.display = '';
    });
}

function renderDetails(data) {
  const synopsisEl = document.getElementById('modalSynopsis');
  if (!synopsisEl.textContent && data.synopsis) {
    synopsisEl.textContent = data.synopsis;
  }
  document.getElementById('modalDirector').textContent =
    data.director ? `Director: ${data.director}` : '';
  document.getElementById('modalCast').textContent =
    data.cast && data.cast.length ? `Cast: ${data.cast.join(', ')}` : '';
  document.getElementById('modalLoading').style.display = 'none';
  document.getElementById('modalDetails').style.display = '';
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('modal-open');
}

function closeModalOnBackdrop(e) {
  if (e.target === document.getElementById('modalBackdrop')) closeModal();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function showCardToast(card, text) {
  const existing = card.querySelector('.card-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'card-toast';
  toast.textContent = text;
  card.style.position = 'relative';
  card.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

