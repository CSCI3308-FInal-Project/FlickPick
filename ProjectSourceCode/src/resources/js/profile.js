// Profile Page Scripts

// Buttons and editsx 

document.addEventListener('DOMContentLoaded', () => 
  {
  const editProfileBtn = document.getElementById('editProfileBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  let editing = false;

  if (editProfileBtn) 
    {
    editProfileBtn.addEventListener('click', async () => {
      const usernameEl = document.getElementById('username');
      const nameEl = document.getElementById('name');
      const ageEl = document.getElementById('age');
      const genderEl = document.getElementById('gender');
      const bioEl = document.getElementById('bio');
      const favoriteGenresEl = document.getElementById('favoriteGenres');
      const favoriteMoviesEl = document.getElementById('favoriteMovies');

      if (
        !usernameEl ||
        !nameEl ||
        !ageEl ||
        !genderEl ||
        !bioEl ||
        !favoriteGenresEl ||
        !favoriteMoviesEl
      ) 
      {
        return;
      }

      if (!editing) 
        {
        usernameEl.innerHTML = `<input type="text" id="usernameInput" value="${usernameEl.textContent.trim()}">`;
        nameEl.innerHTML = `<input type="text" id="nameInput" value="${nameEl.textContent.trim()}">`;
        ageEl.innerHTML = `<input type="number" id="ageInput" value="${ageEl.textContent.trim()}">`;
        genderEl.innerHTML = `<input type="text" id="genderInput" value="${genderEl.textContent.trim()}">`;
        bioEl.innerHTML = `<textarea id="bioInput">${bioEl.textContent.trim()}</textarea>`;
        favoriteGenresEl.innerHTML = `<input type="text" id="favoriteGenresInput" value="${favoriteGenresEl.textContent.trim()}">`;
        favoriteMoviesEl.innerHTML = `<input type="text" id="favoriteMoviesInput" value="${favoriteMoviesEl.textContent.trim()}">`;

        editProfileBtn.textContent = 'Save Profile';
        editing = true;
        return;
      }

      const profileData = 
      {
        username: document.getElementById('usernameInput').value.trim(),
        name: document.getElementById('nameInput').value.trim(),
        age: document.getElementById('ageInput').value.trim(),
        gender: document.getElementById('genderInput').value.trim(),
        bio: document.getElementById('bioInput').value.trim(),
        favoriteGenres: document.getElementById('favoriteGenresInput').value.trim(),
        favoriteMovies: document.getElementById('favoriteMoviesInput').value.trim()
      };

      try 
      {
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: 
          {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(profileData)
        });

        const data = await response.json();

        if (!response.ok) 
        {
        throw new Error(data.message || 'Failed to save profile');
        }

      usernameEl.textContent = profileData.username || 'No username';
      nameEl.textContent = profileData.name || 'Not provided';
      ageEl.textContent = profileData.age || 'Not provided';
      genderEl.textContent = profileData.gender || 'Not provided';
      bioEl.textContent = profileData.bio || 'No bio added.';
      favoriteGenresEl.textContent = profileData.favoriteGenres || 'None selected';
      favoriteMoviesEl.textContent = profileData.favoriteMovies || 'None selected';

      editProfileBtn.textContent = 'Edit Profile';
      editing = false;
      } 
      catch (error) 
      {
      console.error('Error saving profile:', error);
      alert('Could not save profile.');
      }
    });
  }

  if (logoutBtn) 
  {
    logoutBtn.addEventListener('click', () => {
    window.location.href = '/logout';
    });
  }
  const photoInput = document.getElementById('photoInput');
const profilePhoto = document.getElementById('profilePhoto');

if (photoInput) {
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const res = await fetch('/profile/photo', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
  const newImg = document.createElement('img');
  newImg.id = 'profilePhoto';
  newImg.src = data.photoUrl;
  newImg.alt = 'Profile Photo';
  newImg.className = 'profile-photo';
  profilePhoto.replaceWith(newImg);
} else {
        alert('Failed to upload photo');
      }
    } catch (err) {
      console.error('Upload error:', err);
    }
  });
}
});