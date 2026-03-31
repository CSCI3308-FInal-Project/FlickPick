// FlickPick — client-side scripts

document.addEventListener('DOMContentLoaded', () => {
  const movies   = window.FLICKPICK_MOVIES || [];
  let index      = 0;

  const card     = document.getElementById('movieCard');
  const noMore   = document.getElementById('noMoreMsg');
  const poster   = document.getElementById('cardPoster');
  const fallback = document.getElementById('cardFallback');
  const titleEl  = document.getElementById('cardTitle');
  const metaEl   = document.getElementById('cardMeta');
  const synopsis = document.getElementById('cardSynopsis');
  const passBtn  = document.getElementById('passBtn');
  const saveBtn  = document.getElementById('saveBtn');

  function showCard(i) {
    if (i >= movies.length) {
      card.style.display  = 'none';
      noMore.style.display = 'block';
      return;
    }
    const m = movies[i];
    titleEl.textContent  = m.title;
    metaEl.textContent   = [m.genres, m.year, `★ ${m.rating}`].filter(Boolean).join(' · ');
    synopsis.textContent = m.synopsis;

    if (m.poster) {
      poster.src           = m.poster;
      poster.style.display = '';
      fallback.style.display = 'none';
    } else {
      poster.style.display   = 'none';
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
          body: JSON.stringify({ movie_id: m.id, title: m.title, poster_url: m.poster }),
        });
      } catch (_) {
        // silently continue — card still advances
      }
      advance('save');
    });
  }

  showCard(0);
});
