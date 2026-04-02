// FlickPick — client-side scripts

document.addEventListener('DOMContentLoaded', () => {

  // ── Home / Swipe ────────────────────────────────────────────────────────────
  const passBtn = document.getElementById('passBtn');
  const saveBtn = document.getElementById('saveBtn');
  const card    = document.querySelector('.movie-card');

  if (passBtn && card) {
    passBtn.addEventListener('click', () => {
      card.classList.add('swipe-left');
      setTimeout(() => card.classList.remove('swipe-left'), 400);
    });
  }

  if (saveBtn && card) {
    saveBtn.addEventListener('click', () => {
      card.classList.add('swipe-right');
      setTimeout(() => card.classList.remove('swipe-right'), 400);

      fetch('/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          movie_id:   'placeholder-001',
          title:      card.querySelector('.card-title')?.textContent || 'Movie Title',
          poster_url: card.querySelector('.card-poster img')?.src    || null,
          genre:      null,
          year:       null,
          rating:     null,
        }),
      })
        .then(res => {
          if (res.status === 409) showCardToast(card, 'Already saved');
          else if (res.ok)        showCardToast(card, 'Saved!');
        })
        .catch(() => {});
    });
  }

  // ── Watchlist — client-side filter ─────────────────────────────────────────
  const searchInput = document.getElementById('watchlistSearch');
  const genreSelect = document.getElementById('genreFilter');
  const movieList   = document.getElementById('movieList');

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
      const q     = searchInput.value.toLowerCase();
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

});

// ── Modal ──────────────────────────────────────────────────────────────────────

function openModal(row) {
  document.getElementById('modalTitle').textContent  = row.dataset.title  || '';
  document.getElementById('modalRating').textContent = row.dataset.rating ? `★ ${row.dataset.rating}` : '';
  document.getElementById('modalMeta').textContent   =
    [row.dataset.genre, row.dataset.year].filter(Boolean).join(' • ');
  document.getElementById('modalTmdbLink').href =
    `https://www.themoviedb.org/movie/${row.dataset.movieId}`;
  document.getElementById('modalDeleteForm').action = `/watchlist/${row.dataset.id}`;

  const posterEl = document.getElementById('modalPoster');
  if (row.dataset.poster) {
    posterEl.innerHTML = `<img src="${row.dataset.poster}" alt="${row.dataset.title} poster" />`;
  } else {
    posterEl.textContent = '🎬';
  }

  document.getElementById('modalBackdrop').classList.add('modal-open');
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
  toast.className   = 'card-toast';
  toast.textContent = text;
  card.style.position = 'relative';
  card.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}
