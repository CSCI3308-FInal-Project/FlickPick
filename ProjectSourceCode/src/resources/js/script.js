// FlickPick — client-side scripts

document.addEventListener('DOMContentLoaded', () => {
  const movies  = window.FLICKPICK_MOVIES || [];
  let index     = 0;
  let lastSwiped = null;
  let undoTimer  = null;

  const card          = document.getElementById('movieCard');
  const noMore        = document.getElementById('noMoreMsg');
  const poster        = document.getElementById('cardPoster');
  const fallback      = document.getElementById('cardFallback');
  const fallbackTitle = document.getElementById('cardFallbackTitle');
  const titleEl       = document.getElementById('cardTitle');
  const metaEl        = document.getElementById('cardMeta');
  const badgesEl      = document.getElementById('cardBadges');
  const synopsis      = document.getElementById('cardSynopsis');
  const passBtn       = document.getElementById('passBtn');
  const saveBtn       = document.getElementById('saveBtn');
  const watchedBtn    = document.getElementById('watchedBtn');

  // Stats counters — updated instantly client-side
  const stats = Object.assign({ saved: 0, watched: 0, discovered: 0 }, window.FLICKPICK_STATS || {});
  const statSavedEl     = document.getElementById('statSaved');
  const statWatchedEl   = document.getElementById('statWatched');
  const statDiscoveredEl = document.getElementById('statDiscovered');

  function updateStats(delta) {
    if (delta.saved     !== undefined) { stats.saved     += delta.saved;     if (statSavedEl)      statSavedEl.textContent     = stats.saved; }
    if (delta.watched   !== undefined) { stats.watched   += delta.watched;   if (statWatchedEl)    statWatchedEl.textContent   = stats.watched; }
    if (delta.discovered !== undefined) { stats.discovered += delta.discovered; if (statDiscoveredEl) statDiscoveredEl.textContent = stats.discovered; }
  }

  function showCard(i) {
    if (!card) return;
    if (i >= movies.length) {
      card.style.display = 'none';
      if (noMore) noMore.style.display = 'flex';
      return;
    }
    card.style.display = '';
    if (noMore) noMore.style.display = 'none';
    const m = movies[i];

    // Title + meta in poster overlay
    titleEl.textContent = m.title;
    const metaParts = [m.year, m.rating ? `★ ${m.rating}` : null].filter(Boolean).join(' · ');
    metaEl.textContent = metaParts;

    // Genre badges in top-right of poster
    if (badgesEl) {
      badgesEl.innerHTML = (m.genres || '').split(', ').filter(Boolean).map(g => {
        const cls = g.replace(/[^a-zA-Z]/g, '');
        return `<span class="genre-badge genre-${cls}">${g}</span>`;
      }).join('');
    }

    // Synopsis below poster
    synopsis.textContent = m.synopsis;

    // Poster image or styled fallback
    if (m.poster) {
      poster.src = m.poster;
      poster.style.display = '';
      fallback.style.display = 'none';
    } else {
      poster.style.display = 'none';
      fallback.style.display = 'flex';
      if (fallbackTitle) fallbackTitle.textContent = m.title;
    }
  }

  function recordSwipe(movie, isRight) {
    fetch('/swipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        movie_id:  movie.id,
        title:     movie.title,
        genre_ids: movie.genreIds || '',
        rating:    parseFloat(movie.rating) || null,
        liked:     isRight,
      }),
    });
    // fire-and-forget
  }

  function showUndo() {
    clearTimeout(undoTimer);
    const bar = document.getElementById('undoBar');
    if (!bar) return;
    bar.style.animation = 'none';
    void bar.offsetHeight;
    bar.style.animation = '';
    bar.style.display = 'flex';
    undoTimer = setTimeout(hideUndo, 5000);
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    const bar = document.getElementById('undoBar');
    if (bar) bar.style.display = 'none';
    lastSwiped = null;
  }

  async function onUndo() {
    if (!lastSwiped) return;
    const { movie, direction, statDelta, undoIndex } = lastSwiped; // capture all before hideUndo nulls lastSwiped
    hideUndo();
    if (direction === 'save' || direction === 'watch') {
      try {
        await fetch(`/watchlist/by-movie/${movie.id}`, { method: 'DELETE' });
      } catch (_) { /* silent */ }
    }
    // Reverse stats for any direction
    if (statDelta) {
      const reversed = {};
      Object.keys(statDelta).forEach(k => reversed[k] = -statDelta[k]);
      updateStats(reversed);
    }
    index = undoIndex;
    card.classList.remove('swipe-left', 'swipe-right');
    showCard(index);
  }

  // Wire up the static undo button
  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) undoBtn.addEventListener('click', onUndo);

  function advance(direction, statDelta) {
    lastSwiped = { movie: movies[index], direction, undoIndex: index, statDelta };
    showUndo();
    card.classList.add(direction === 'pass' ? 'swipe-left' : 'swipe-right');
    setTimeout(() => {
      card.classList.remove('swipe-left', 'swipe-right');
      index++;
      showCard(index);
    }, 350);
  }

  if (passBtn) {
    passBtn.addEventListener('click', () => {
      const m = movies[index];
      if (m) recordSwipe(m, false);
      updateStats({ discovered: 1 });
      advance('pass', { discovered: 1 });
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const m = movies[index];
      if (!m) return;
      recordSwipe(m, true);
      try {
        await fetch('/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            movie_id:   m.id,
            title:      m.title,
            poster_url: m.poster,
            genre:      m.genres,
            year:       m.year,
            rating:     m.rating,
            synopsis:   m.synopsis,
          }),
        });
      } catch (_) { /* silently continue */ }
      updateStats({ saved: 1, discovered: 1 });
      advance('save', { saved: 1, discovered: 1 });
    });
  }

  if (watchedBtn) {
    watchedBtn.addEventListener('click', async () => {
      const m = movies[index];
      if (!m) return;
      recordSwipe(m, true);
      try {
        await fetch('/watchlist/watch-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            movie_id:   m.id,
            title:      m.title,
            poster_url: m.poster,
            genre:      m.genres,
            year:       m.year,
            rating:     m.rating,
            synopsis:   m.synopsis,
          }),
        });
      } catch (_) { /* silently continue */ }
      updateStats({ watched: 1, discovered: 1 });
      advance('watch', { watched: 1, discovered: 1 });
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

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      const originalOrder = [...movieList.querySelectorAll('.movie-row')];
      sortSelect.addEventListener('change', () => {
        if (sortSelect.value === 'default') {
          originalOrder.forEach(r => movieList.appendChild(r));
          return;
        }
        const rows = [...movieList.querySelectorAll('.movie-row')];
        rows.sort((a, b) => {
          if (sortSelect.value === 'rating') {
            return (parseFloat(b.dataset.rating) || 0) - (parseFloat(a.dataset.rating) || 0);
          }
          if (sortSelect.value === 'alpha') {
            return a.dataset.title.localeCompare(b.dataset.title);
          }
          return 0;
        });
        rows.forEach(r => movieList.appendChild(r));
      });
    }
  }

  showCard(0);

  // ── Bulk actions ────────────────────────────────────────────────────────────
  const bulkBar      = document.getElementById('bulkBar');
  const selectAllCb  = document.getElementById('selectAll');
  const bulkWatchBtn = document.getElementById('bulkWatchBtn');
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

  function updateBulkBar() {
    if (!movieList || !bulkBar) return;
    const checked = movieList.querySelectorAll('.row-check:checked');
    bulkBar.style.display = checked.length > 0 ? '' : 'none';
    if (selectAllCb) {
      const all = movieList.querySelectorAll('.row-check');
      selectAllCb.checked = all.length > 0 && checked.length === all.length;
      selectAllCb.indeterminate = checked.length > 0 && checked.length < all.length;
    }
  }

  if (movieList) {
    movieList.addEventListener('change', e => {
      if (e.target.classList.contains('row-check')) updateBulkBar();
    });
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      if (!movieList) return;
      movieList.querySelectorAll('.row-check').forEach(cb => {
        cb.checked = selectAllCb.checked;
      });
      updateBulkBar();
    });
  }

  if (bulkWatchBtn) {
    bulkWatchBtn.addEventListener('click', async () => {
      if (!movieList) return;
      const checked = [...movieList.querySelectorAll('.row-check:checked')];
      if (!checked.length) return;
      if (!confirm(`Mark ${checked.length} movie${checked.length !== 1 ? 's' : ''} as watched?`)) return;
      for (const cb of checked) {
        await fetch(`/watchlist/${cb.dataset.id}/watch`, { method: 'POST' });
      }
      window.location.reload();
    });
  }

  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
      if (!movieList) return;
      const checked = [...movieList.querySelectorAll('.row-check:checked')];
      if (!checked.length) return;
      if (!confirm(`Delete ${checked.length} selected movie${checked.length !== 1 ? 's' : ''}?`)) return;
      for (const cb of checked) {
        await fetch(`/watchlist/${cb.dataset.id}`, { method: 'DELETE' });
      }
      window.location.reload();
    });
  }

  // ── Single delete confirmation ───────────────────────────────────────────────
  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.closest('form').addEventListener('submit', e => {
      const row = btn.closest('.movie-row');
      const title = row ? row.dataset.title : 'this movie';
      if (!confirm(`Remove "${title}" from your list?`)) {
        e.preventDefault();
      }
    });
  });

  const modalDeleteForm = document.getElementById('modalDeleteForm');
  if (modalDeleteForm) {
    modalDeleteForm.addEventListener('submit', e => {
      const title = document.getElementById('modalTitle').textContent || 'this movie';
      if (!confirm(`Remove "${title}" from your list?`)) {
        e.preventDefault();
      }
    });
  }
});

// ── Dropdown ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const dropdown = document.querySelector('.nav-dropdown');
  if (!dropdown) return;

  const toggle = dropdown.querySelector('.profile-icon-btn') || dropdown.querySelector('.nav-link');
  if (!toggle) return;

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

// ── Watchlist detail panel (desktop ≥768px only) ───────────────────────────

(function () {
  const layout    = document.querySelector('.watchlist-layout');
  const panel     = document.getElementById('detailPanel');
  if (!layout || !panel) return;

  const panelPoster   = document.getElementById('panelPoster');
  const panelTitle    = document.getElementById('panelTitle');
  const panelMeta     = document.getElementById('panelMeta');
  const panelRating   = document.getElementById('panelRating');
  const panelBadges   = document.getElementById('panelBadges');
  const panelSynopsis = document.getElementById('panelSynopsis');
  const panelExtra    = document.getElementById('panelExtra');
  const panelActions  = document.getElementById('panelActions');

  const detailsCache = window._flickpickDetailsCache || (window._flickpickDetailsCache = {});

  function formatDate(raw) {
    if (!raw) return '';
    const d = new Date(raw);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function openPanel(row) {
    if (window.innerWidth < 768) return; // mobile: let Details button handle it

    const title    = row.dataset.title || '';
    const movieId  = row.dataset.movieId;
    const poster   = row.dataset.poster;
    const year     = row.dataset.year || '';
    const rating   = row.dataset.rating || '';
    const genre    = row.dataset.genre || '';
    const synopsis = row.dataset.synopsis || '';
    const id       = row.dataset.id;
    const isWatched = row.dataset.watched === 'true';
    const addedAt  = formatDate(row.dataset.addedAt);

    // Poster
    if (poster) {
      panelPoster.innerHTML = `<img src="${poster}" alt="${title} poster" />`;
    } else {
      panelPoster.innerHTML = `<div class="panel-poster-fallback"><span>✦</span><span>${title}</span></div>`;
    }

    // Title, meta, rating, genres
    panelTitle.textContent = title;
    panelMeta.textContent  = [year, addedAt ? `Added ${addedAt}` : ''].filter(Boolean).join(' · ');
    panelRating.textContent = rating ? `★ ${rating}` : '';
    panelBadges.innerHTML  = genre.split(', ').filter(Boolean).map(g => {
      const cls = g.replace(/[^a-zA-Z]/g, '');
      return `<span class="genre-badge genre-${cls}">${g}</span>`;
    }).join('');
    panelSynopsis.textContent = synopsis;

    // Extra (director/runtime) — clear and fetch async
    panelExtra.innerHTML = '<span class="panel-loading">Loading…</span>';

    // Action buttons
    panelActions.innerHTML = `
      <form method="POST" action="/watchlist/${id}/${isWatched ? 'unwatch' : 'watch'}" style="display:contents">
        <button type="submit" class="btn-watch-modal">
          ${isWatched ? '↩ Move to Watchlist' : '✓ Mark as Watched'}
        </button>
      </form>
      <form method="POST" action="/watchlist/${id}" style="display:contents">
        <input type="hidden" name="_method" value="DELETE" />
        <input type="hidden" name="_tab" value="${isWatched ? 'watched' : 'watchlist'}" />
        <button type="submit" class="btn-remove-modal"
          onclick="return confirm('Remove \'${title.replace(/'/g, "\\'")}\\' from your list?')">
          ✕ Remove
        </button>
      </form>
    `;

    // Highlight selected row
    document.querySelectorAll('.movie-row').forEach(r => r.classList.remove('row-selected'));
    row.classList.add('row-selected');

    // Show panel
    layout.classList.add('panel-open');

    // Async fetch director/runtime
    if (detailsCache[movieId]) {
      renderPanelExtra(detailsCache[movieId]);
      return;
    }
    fetch(`/api/movie/${movieId}`)
      .then(r => r.json())
      .then(data => {
        detailsCache[movieId] = data;
        renderPanelExtra(data);
      })
      .catch(() => { panelExtra.textContent = ''; });
  }

  function renderPanelExtra(data) {
    const parts = [];
    if (data.director) parts.push(`Director: ${data.director}`);
    if (data.runtime)  parts.push(`${data.runtime} min`);
    panelExtra.textContent = parts.join(' · ');
  }

  // Wire up row clicks — but not clicks on buttons/forms inside the row
  const movieList = document.getElementById('movieList');
  if (movieList) {
    movieList.addEventListener('click', e => {
      if (e.target.closest('button, a, input, form')) return;
      const row = e.target.closest('.movie-row');
      if (row) openPanel(row);
    });
  }
})();

