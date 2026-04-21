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
      const errBanner = document.getElementById('homeErrorBanner');
      if (window.FLICKPICK_FETCH_ERROR && errBanner) {
        errBanner.style.display = 'flex';
        if (noMore) noMore.style.display = 'none';
      } else {
        if (noMore) noMore.style.display = 'flex';
      }
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

  // Credits cache so repeat saves on the same movie don't re-fetch
  const creditsCache = {};

  async function fetchCredits(movieId) {
    if (creditsCache[movieId]) return creditsCache[movieId];
    try {
      const r = await fetch(`/api/movie/${movieId}`);
      const data = await r.json();
      creditsCache[movieId] = {
        actorIds:   data.actorIds   || [],
        directorId: data.directorId || null,
      };
    } catch (_) {
      creditsCache[movieId] = { actorIds: [], directorId: null };
    }
    return creditsCache[movieId];
  }

  function recordSwipe(m, liked, credits = {}) {
    fetch('/swipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        movie_id:    m.id,
        title:       m.title,
        genre_ids:   m.genreIds || '',
        actor_ids:   (credits.actorIds || []).join(','),
        director_id: credits.directorId || '',
        rating:      m.rating,
        liked,
      }),
    }).catch(() => {});  // fire-and-forget
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
    const { movie, direction, statDelta, undoIndex } = lastSwiped;
    hideUndo();
    if (direction === 'save' || direction === 'watch') {
      try {
        await fetch(`/watchlist/by-movie/${movie.id}`, { method: 'DELETE' });
      } catch (_) { /* silent */ }
    }
    if (statDelta) {
      const reversed = {};
      Object.keys(statDelta).forEach(k => reversed[k] = -statDelta[k]);
      updateStats(reversed);
    }
    index = undoIndex;
    card.classList.remove('swipe-left', 'swipe-right');
    showCard(index);
  }

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
      if (m) recordSwipe(m, false);  // no credits needed for passes
      updateStats({ discovered: 1 });
      advance('pass', { discovered: 1 });
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const m = movies[index];
      if (!m) return;
      // Fetch credits before recording so actor/director IDs are captured
      const credits = await fetchCredits(m.id);
      recordSwipe(m, true, credits);
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
        if (typeof openReviewModal === 'function') {
          openReviewModal({
            movieId: String(m.id),
            title:   m.title,
            year:    m.year,
            genre:   m.genres,
            poster:  m.poster,
          });
        }
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

  // ── Keyboard navigation (1.6) ───────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') {
      closeModal();
    } else if (e.key === 'ArrowLeft') {
      if (passBtn && index < movies.length) passBtn.click();
    } else if (e.key === 'ArrowRight') {
      if (saveBtn && index < movies.length) saveBtn.click();
    }
  });

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
      const n = checked.length;
      showPageToast(
        `${n} movie${n !== 1 ? 's' : ''} marked as watched. <a href="/watchlist?tab=watched" style="color:var(--accent);font-weight:600;text-decoration:none">Head to Watched list</a> to review them individually.`
      );
      setTimeout(() => window.location.reload(), 1200);
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

// ── Review Modal ───────────────────────────────────────────────────────────

(function () {
  const backdrop    = document.getElementById('reviewBackdrop');
  const starRow     = document.getElementById('reviewStarRow');
  const starCount   = document.getElementById('reviewStarCount');
  const textarea    = document.getElementById('reviewText');
  const submitBtn   = document.getElementById('reviewSubmitBtn');
  const skipBtn     = document.getElementById('reviewSkipBtn');
  const posterEl    = document.getElementById('reviewPoster');
  const titleEl     = document.getElementById('reviewModalTitle');
  const metaEl      = document.getElementById('reviewModalMeta');

  if (!backdrop) return;

  let _reviewMovie  = null; // { movieId, title, year, genre, poster }
  let _selectedStar = 0;
  let _reviewId     = null; // set when editing existing review

  const stars = starRow ? [...starRow.querySelectorAll('.star')] : [];

  function paintStars(val) {
    stars.forEach(s => {
      s.classList.toggle('filled', parseInt(s.dataset.val, 10) <= val);
    });
    if (starCount) starCount.textContent = val ? `${val} / 10` : '';
  }

  stars.forEach(s => {
    s.addEventListener('mouseenter', () => paintStars(parseInt(s.dataset.val, 10)));
    s.addEventListener('mouseleave', () => paintStars(_selectedStar));
    s.addEventListener('click', () => {
      _selectedStar = parseInt(s.dataset.val, 10);
      paintStars(_selectedStar);
    });
  });

  window.openReviewModal = function ({ movieId, title, year, genre, poster, prefillRating, prefillText, reviewId } = {}) {
    _reviewMovie  = { movieId, title, year, genre };
    _selectedStar = prefillRating || 0;
    _reviewId     = reviewId || null;

    if (titleEl) titleEl.textContent = title || '';
    if (metaEl)  metaEl.textContent  = [year, genre].filter(Boolean).join(' · ');

    if (posterEl) {
      if (poster) {
        posterEl.innerHTML = `<img src="${poster}" alt="${title} poster" />`;
      } else {
        posterEl.textContent = '🎬';
      }
    }

    paintStars(_selectedStar);
    if (textarea)  textarea.value = prefillText || '';
    if (submitBtn) submitBtn.textContent = reviewId ? 'Update Review' : 'Submit Review';

    backdrop.classList.add('review-open');
    if (textarea) textarea.focus();
  };

  window.closeReviewModal = function () {
    backdrop.classList.remove('review-open');
    _reviewMovie  = null;
    _selectedStar = 0;
    _reviewId     = null;
    paintStars(0);
    if (textarea)  textarea.value = '';
  };

  if (skipBtn) skipBtn.addEventListener('click', closeReviewModal);

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeReviewModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('review-open')) {
      closeReviewModal();
    }
  });

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!_selectedStar) {
        submitBtn.textContent = 'Please pick a rating first';
        setTimeout(() => {
          submitBtn.textContent = _reviewId ? 'Update Review' : 'Submit Review';
        }, 1500);
        return;
      }
      const body = {
        movie_id:    _reviewMovie.movieId,
        title:       _reviewMovie.title,
        rating:      _selectedStar,
        review_text: textarea ? textarea.value.trim() : '',
      };
      try {
        await fetch('/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (_) { /* silently continue */ }
      closeReviewModal();
    });
  }
})();

// ── Modal ──────────────────────────────────────────────────────────────────────

const detailsCache = {};
let _currentModalRow = null;

function openModal(row) {
  _currentModalRow = row;
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
    watchForm.onsubmit = null;
  } else {
    watchForm.action = `/watchlist/${id}/watch`;
    watchBtn.textContent = '✓ Mark as Watched';
    watchForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await fetch(`/watchlist/${id}/watch`, { method: 'POST' });
        closeModal();
        if (typeof openReviewModal === 'function') {
          openReviewModal({
            movieId: row.dataset.movieId,
            title:   row.dataset.title,
            year:    row.dataset.year,
            genre:   row.dataset.genre,
            poster:  row.dataset.poster,
          });
        }
        row.dataset.watched = 'true';
      } catch (_) { /* silently continue */ }
    };
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
  document.getElementById('modalFriends').innerHTML = renderFriendsSection(row.dataset.friends);
  loadAndRenderReviews(row.dataset.movieId, isWatched, document.getElementById('modalReviews'));

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

function retryDetails() {
  if (!_currentModalRow) return;
  const tmdbId = _currentModalRow.dataset.movieId;
  delete detailsCache[tmdbId];
  document.getElementById('modalLoading').style.display = '';
  document.getElementById('modalDetails').style.display = 'none';
  document.getElementById('modalError').style.display = 'none';
  fetch(`/api/movie/${tmdbId}`)
    .then(r => r.json())
    .then(data => { detailsCache[tmdbId] = data; renderDetails(data); })
    .catch(() => {
      document.getElementById('modalLoading').style.display = 'none';
      document.getElementById('modalError').style.display = '';
    });
}

function renderFriendsSection(friendsJson) {
  let friends = [];
  try { friends = JSON.parse(friendsJson || '[]'); } catch (e) { friends = []; }
  if (!friends.length) return '';

  const lines = friends.map(f => {
    const cls   = f.watched ? 'friend-status-watched' : 'friend-status-watchlist';
    const label = f.watched ? 'watched' : 'watchlist';
    const initial = (f.username || '?')[0].toUpperCase();
    const safeName = f.username.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div class="friend-line">
      <div class="friend-initial">${initial}</div>
      <span class="friend-name">${safeName}</span>
      <span class="friend-status-tag ${cls}">${label}</span>
    </div>`;
  }).join('');

  return `<div class="friends-section">
    <div class="friends-section-label">Friends</div>
    ${lines}
  </div>`;
}

function renderStars(rating) {
  return Array.from({ length: 10 }, (_, i) =>
    `<span class="rstar${i < rating ? '' : ' empty'}">★</span>`
  ).join('');
}

async function loadAndRenderReviews(movieId, isWatched, containerEl) {
  if (!containerEl) return;
  if (!isWatched) { containerEl.style.display = 'none'; return; }

  let yourReviewHtml = '';
  let friendsHtml    = '';

  try {
    const [myRes, friendRes] = await Promise.all([
      fetch(`/api/reviews?movie_id=${encodeURIComponent(movieId)}`).then(r => r.json()),
      fetch(`/api/movie/${encodeURIComponent(movieId)}/reviews`).then(r => r.json()),
    ]);

    const myReview = myRes.review;
    if (myReview) {
      const text = myReview.review_text
        ? `<p class="your-review-text">"${myReview.review_text}"</p>`
        : '';
      yourReviewHtml = `
        <div class="modal-reviews-label">Your Review</div>
        <div class="your-review-row">
          <div class="your-review-stars">${renderStars(myReview.rating)}</div>
          <span class="your-review-score">${myReview.rating} / 10</span>
          <button class="btn-edit-review"
            onclick="openReviewModal({movieId:'${movieId}',title:'${(myReview.title||'').replace(/'/g,"\\'")}',prefillRating:${myReview.rating},prefillText:'${(myReview.review_text||'').replace(/'/g,"\\'").replace(/\n/g,' ')}',reviewId:${myReview.id}})">
            Edit
          </button>
        </div>
        ${text}
      `;
    } else {
      yourReviewHtml = `
        <div class="modal-reviews-label">Your Review</div>
        <button class="btn-write-review"
          onclick="openReviewModal({movieId:'${movieId}'})">
          ✎ Write a Review
        </button>
      `;
    }

    const friends = friendRes.reviews || [];
    if (friends.length) {
      const rows = friends.map(f => {
        const initial = (f.username || '?')[0].toUpperCase();
        const safe    = (f.username || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
        const text    = f.review_text
          ? `<p class="friend-review-text">"${f.review_text}"</p>`
          : '';
        return `
          <div class="friend-review-row">
            <div class="friend-review-initial">${initial}</div>
            <div class="friend-review-body">
              <div class="friend-review-meta">
                <span class="friend-review-username">${safe}</span>
                <div class="your-review-stars">${renderStars(f.rating)}</div>
                <span class="your-review-score">${f.rating}/10</span>
              </div>
              ${text}
            </div>
          </div>`;
      }).join('');
      friendsHtml = `<div class="modal-reviews-label" style="margin-top:0.75rem">Friends' Reviews</div>${rows}`;
    }
  } catch (_) { /* silently skip reviews on error */ }

  containerEl.innerHTML = yourReviewHtml + friendsHtml;
  containerEl.style.display = yourReviewHtml || friendsHtml ? '' : 'none';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function showPageToast(html) {
  const existing = document.getElementById('pageToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'pageToast';
  toast.className = 'page-toast';
  toast.innerHTML = html;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

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
  const panelFriends  = document.getElementById('panelFriends');
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
    panelExtra.innerHTML = '<span class="spinner"></span>';
    panelFriends.innerHTML = renderFriendsSection(row.dataset.friends);
    loadAndRenderReviews(movieId, isWatched, document.getElementById('panelReviews'));

    // Action buttons
    if (isWatched) {
      panelActions.innerHTML = `
        <form method="POST" action="/watchlist/${id}/unwatch" style="display:contents">
          <button type="submit" class="btn-watch-modal">↩ Move to Watchlist</button>
        </form>
        <form method="POST" action="/watchlist/${id}" style="display:contents">
          <input type="hidden" name="_method" value="DELETE" />
          <input type="hidden" name="_tab" value="watched" />
          <button type="submit" class="btn-remove-modal"
            onclick="return confirm('Remove \'${title.replace(/'/g, "\\'")}\\' from your list?')">
            ✕ Remove
          </button>
        </form>
      `;
    } else {
      panelActions.innerHTML = `
        <button class="btn-watch-modal" id="panelWatchNowBtn">✓ Mark as Watched</button>
        <form method="POST" action="/watchlist/${id}" style="display:contents">
          <input type="hidden" name="_method" value="DELETE" />
          <input type="hidden" name="_tab" value="watchlist" />
          <button type="submit" class="btn-remove-modal"
            onclick="return confirm('Remove \'${title.replace(/'/g, "\\'")}\\' from your list?')">
            ✕ Remove
          </button>
        </form>
      `;
      const panelWatchNowBtn = document.getElementById('panelWatchNowBtn');
      if (panelWatchNowBtn) {
        panelWatchNowBtn.addEventListener('click', async () => {
          try {
            await fetch(`/watchlist/${id}/watch`, { method: 'POST' });
            if (typeof openReviewModal === 'function') {
              openReviewModal({ movieId, title, year, genre, poster });
            }
            row.classList.remove('row-selected');
            layout.classList.remove('panel-open');
            row.dataset.watched = 'true';
          } catch (_) { /* silently continue */ }
        });
      }
    }

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

