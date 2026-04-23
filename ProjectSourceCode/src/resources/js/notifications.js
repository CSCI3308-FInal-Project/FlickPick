document.addEventListener('DOMContentLoaded', () => {
  const notifBadge = document.getElementById('notifBadge');
  const notifList = document.getElementById('notifList');
  const markAllReadBtn = document.getElementById('markAllReadBtn');

  // The dropdown toggling logic is handled globally by script.js 
  // (.nav-dropdown selector) which includes clicking outside.

  // Fetch notifications
  const fetchNotifications = async () => {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) return;

      const data = await response.json();
      
      // Update badge
      if (data.unreadCount > 0) {
        notifBadge.textContent = data.unreadCount;
        notifBadge.style.display = 'flex';
      } else {
        notifBadge.style.display = 'none';
      }

      // Update list
      if (!data.notifications || data.notifications.length === 0) {
        notifList.innerHTML = '<div class="notif-empty">You\'re all caught up</div>';
        return;
      }

      notifList.innerHTML = data.notifications.map(notif => {
        let message = '';
        let href = '#';
        let icon = '';

        if (notif.type === 'friend_request') {
          message = `<b>${notif.payload.from_username}</b> sent you a friend request.`;
          href = '/friends';
          icon = '👥';
        } else if (notif.type === 'session_invite') {
          message = `<b>${notif.payload.from_username}</b> invited you to join session "<b>${notif.payload.session_name}</b>".`;
          href = `/group-sessions?join=${notif.payload.session_code}`;
          icon = '🍿';
        } else if (notif.type === 'group_match') {
          message = `New match in "<b>${notif.payload.session_name}</b>": <b>${notif.payload.movie_title}</b>!`;
          href = `/group-sessions/${notif.payload.session_id}`;
          icon = '🔥';
        } else if (notif.type === 'session_ended') {
          message = `Session "<b>${notif.payload.session_name}</b>" has ended.`;
          href = `/group-sessions/${notif.payload.session_id}`;
          icon = '🏁';
        }

        return `
          <div class="notif-wrapper" style="position: relative;">
            <a href="${href}" class="notif-item ${notif.read ? '' : 'unread'}" data-id="${notif.id}">
              <div class="notif-icon">${icon}</div>
              <div class="notif-content">
                <div class="notif-message">${message}</div>
                <div class="notif-time">${new Date(notif.created_at).toLocaleString()}</div>
              </div>
            </a>
            <button class="notif-delete-btn" data-id="${notif.id}" title="Delete notification">✕</button>
          </div>
        `;
      }).join('');

      // Add read handlers
      document.querySelectorAll('.notif-item.unread').forEach(item => {
        item.addEventListener('click', async (e) => {
          // Send read request, don't prevent navigation
          const id = item.dataset.id;
          try {
            await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
          } catch(err) {
            console.error(err);
          }
        });
      });

      // Add delete handlers
      document.querySelectorAll('.notif-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.dataset.id;
          try {
            await fetch(`/api/notifications/${id}/delete`, { method: 'POST' });
            btn.closest('.notif-wrapper').remove();
            fetchNotifications(); // Update count
          } catch(err) {
            console.error('Error deleting notification:', err);
          }
        });
      });

    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Initial fetch
  fetchNotifications();

  // Poll exactly every 15 seconds
  setInterval(fetchNotifications, 15000);

  // Mark all read
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await fetch('/api/notifications/read-all', { method: 'POST' });
        fetchNotifications();
      } catch (error) {
        console.error('Error marking all as read:', error);
      }
    });
  }
});
