document.addEventListener('DOMContentLoaded', () => {
  const addFriendForm = document.getElementById('addFriendForm');

  if (!addFriendForm) return;

  addFriendForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = document.getElementById('friendUsername').value.trim();

    try {
      const response = await fetch('/friends/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to add friend');
      }

      alert('Friend added successfully');
      window.location.reload();
    } catch (error) {
      console.error('Add friend error:', error);
      alert(error.message);
    }
  });
});