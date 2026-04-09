// FlickPick — client-side scripts

document.addEventListener('DOMContentLoaded', () => {
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
    });
  }
});

