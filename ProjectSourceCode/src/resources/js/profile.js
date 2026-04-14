// Profile Page Scripts

// Buttons and editsx 

document.addEventListener('DOMContentLoaded', () => {
  const passBtn = document.getElementById('passBtn');
  const saveBtn = document.getElementById('saveBtn');
  const card = document.querySelector('.movie-card');

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

  const editProfileBtn = document.getElementById('editProfileBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  let editing = false;

  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => {
      const usernameEl = document.getElementById('username');
      const nameEl = document.getElementById('name');
      const ageEl = document.getElementById('age');
      const genderEl = document.getElementById('gender');
      const bioEl = document.getElementById('bio');
      const favoriteGenresEl = document.getElementById('favoriteGenres');

      if (!usernameEl || !nameEl || !ageEl || !genderEl || !bioEl || !favoriteGenresEl) {
        return;
      }

      if (!editing) {
        const usernameText = usernameEl.textContent.trim();
        const nameText = nameEl.textContent.trim();
        const ageText = ageEl.textContent.trim();
        const genderText = genderEl.textContent.trim();
        const bioText = bioEl.textContent.trim();
        const favoriteGenresText = favoriteGenresEl.textContent.trim();

        usernameEl.innerHTML = `<input type="text" id="usernameInput" value="${usernameText}">`;
        nameEl.innerHTML = `<input type="text" id="nameInput" value="${nameText}">`;
        ageEl.innerHTML = `<input type="number" id="ageInput" value="${ageText}">`;
        genderEl.innerHTML = `<input type="text" id="genderInput" value="${genderText}">`;
        bioEl.innerHTML = `<textarea id="bioInput">${bioText}</textarea>`;
        favoriteGenresEl.innerHTML = `<input type="text" id="favoriteGenresInput" value="${favoriteGenresText}">`;

        editProfileBtn.textContent = 'Save Profile';
        editing = true;
      } else {
        const usernameInput = document.getElementById('usernameInput');
        const nameInput = document.getElementById('nameInput');
        const ageInput = document.getElementById('ageInput');
        const genderInput = document.getElementById('genderInput');
        const bioInput = document.getElementById('bioInput');
        const favoriteGenresInput = document.getElementById('favoriteGenresInput');

        usernameEl.textContent = usernameInput.value.trim() || 'Masone';
        nameEl.textContent = nameInput.value.trim() || 'Not provided';
        ageEl.textContent = ageInput.value.trim() || 'Not provided';
        genderEl.textContent = genderInput.value.trim() || 'Not provided';
        bioEl.textContent = bioInput.value.trim() || 'No bio added.';
        favoriteGenresEl.textContent = favoriteGenresInput.value.trim() || 'None selected';

        editProfileBtn.textContent = 'Edit Profile';
        editing = false;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      window.location.href = '/login';
    });
  }
});

// Saving Profile to Database

fetch('/api/profile', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    id,
    user_id,
    name,
    age,
    gender,
    bio,
    favoriteGenres,
    favoriteMovies
  })
})
.then(response => response.json())
.then(data => {
  console.log('Profile saved:', data);
})
.catch(error => {
  console.error('Error saving profile:', error);
});