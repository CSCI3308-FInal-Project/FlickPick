(function () {
  const bellBtn = document.getElementById('notifBellBtn');
  const menu = document.getElementById('notifMenu');
  const badge = document.getElementById('notifBadge');
  const list = document.getElementById('notifList');
  const markAllBtn = document.getElementById('notifMarkAll');

  if (!bellBtn) return; // not logged in

  function humanTime(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function notifMessage(n) {
    const p = n.payload || {};
    switch (n.type) {
      case 'friend_request':
        return `<strong>${p.from_username}</strong> sent you a friend request`;
      case 'session_invite':
        return `<strong>${p.from_username}</strong> invited you to "${p.session_name}"`;
      case 'group_match':
        return `Match in "${p.session_name}": <strong>${p.movie_title}</strong>`;
      case 'session_ended':
        return `Session "<strong>${p.session_name}</strong>" has ended`;
      default:
        return 'New notification';
    }
  }

  function notifLink(n) {
    const p = n.payload || {};
    switch (n.type) {
      case 'friend_request': return '/friends';
      case 'session_invite': return `/group-sessions?join=${p.session_code}`;
      case 'group_match':    return `/group-sessions/${p.session_id}`;
      case 'session_ended':  return `/group-sessions/${p.session_id}`;
      default: return '#';
    }
  }

  function renderNotifications(notifications) {
    if (!notifications.length) {
      list.innerHTML = '<li class="notif-empty">You\'re all caught up</li>';
      return;
    }
    list.innerHTML = notifications.map(n => `
      <li class="notif-item ${n.read ? '' : 'notif-unread'}" data-id="${n.id}">
        <a href="${notifLink(n)}" class="notif-link" onclick="markRead(${n.id})">
          <span class="notif-msg">${notifMessage(n)}</span>
          <span class="notif-time">${humanTime(n.created_at)}</span>
        </a>
      </li>
    `).join('');
  }

  function updateBadge(count) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  function fetchNotifications() {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(data => {
        updateBadge(data.unreadCount);
        renderNotifications(data.notifications || []);
      })
      .catch(() => {});
  }

  window.markRead = function (id) {
    fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
  };

  markAllBtn.addEventListener('click', () => {
    fetch('/api/notifications/read-all', { method: 'POST' })
      .then(() => fetchNotifications())
      .catch(() => {});
  });

  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
    if (menu.classList.contains('open')) fetchNotifications();
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('notifDropdown').contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.classList.remove('open');
  });

  // Initial fetch + poll every 15s
  fetchNotifications();
  setInterval(fetchNotifications, 15000);
})();
