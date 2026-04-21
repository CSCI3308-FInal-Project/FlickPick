# WS3 — Social: Friend Requests + Notifications + Group Sessions

**Due:** April 24, 2026  
**Status:** Ready to implement  
**Depends on:** Existing `friends` table, `swipe_history` table, `watchlist` table  
**Assigned to:** TBD

---

## Overview

This workstream adds three layered features:

1. **3A — Friend Requests** — Upgrade the existing auto-accept friends system to a proper send/accept/decline workflow
2. **3B — Notifications** — In-app bell icon that drives all social alerts (friend requests, session invites, group matches)
3. **3C — Group Sessions** — A new top-level page where users create or join movie-swiping sessions with friends; async and live modes both supported

All three sub-features must ship together — notifications are required by group sessions, and group sessions are only useful with a real friends system.

---

## Current State (what already exists)

| Thing | Status |
|-------|--------|
| `friends` table | Exists — but `status DEFAULT 'accepted'` (auto-accepts all requests) |
| `POST /friends/add` | Exists — inserts with `status = 'accepted'` immediately, no request flow |
| `GET /friends` | Exists — shows accepted friends list |
| `swipe_history` table | Exists — used for Top Picks boost signal |
| `watchlist` table | Exists — used for Top Picks primary signal |
| `group_sessions` table | Does not exist |
| `session_members` table | Does not exist |
| `session_swipes` table | Does not exist |
| `notifications` table | Does not exist |

---

## 3A — Friend Requests

### DB Change

The `friends` table already exists. One column default needs to change:

```sql
-- Run this migration (or update create.sql for fresh installs):
ALTER TABLE friends ALTER COLUMN status SET DEFAULT 'pending';
```

No new table needed. The `status` column already supports arbitrary values — just start inserting `'pending'` instead of `'accepted'`.

### New Routes

```
GET  /friends/requests        — list incoming pending requests for logged-in user
POST /friends/accept/:id      — set status = 'accepted' for friends row with given id
POST /friends/decline/:id     — delete friends row with given id (decline)
DELETE /friends/:id           — remove an accepted friend (unfriend)
```

### Changes to Existing Routes

**`POST /friends/add`** — change insert to use `status = 'pending'` instead of `'accepted'`. Also create a `notifications` row for the recipient (type `'friend_request'`).

### UI Changes on `/friends` page (`friends.hbs`)

- Add a **"Pending Requests"** section at the top, above the current friends list
- Each pending request row shows: requester username, Accept button, Decline button
- Accept/Decline are `fetch()` calls to the new routes; row removes from DOM on response
- Red badge on the Friends nav link when `pendingCount > 0` (pass this from the GET `/friends` route)
- Friends list below pending section — no change to existing display

### Acceptance Criteria

- [ ] Sending a friend request inserts with `status = 'pending'`; recipient does NOT appear in sender's friends list yet
- [ ] Recipient sees the request in "Pending Requests" section
- [ ] Accept → `status = 'accepted'`; both users now see each other in friends list
- [ ] Decline → row deleted; no friend relationship
- [ ] Duplicate request returns a friendly error (UNIQUE constraint on `requester_id, addressee_id`)
- [ ] Cannot add yourself (existing CHECK constraint respected with user-facing message)
- [ ] Unfriend (DELETE) removes the row; user disappears from friends list
- [ ] `/friends` page works with 0 friends and 0 pending requests (empty states)

---

## 3B — Notifications

### New DB Table

Add to `create.sql`:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  -- type values: 'friend_request' | 'session_invite' | 'group_match' | 'session_ended'
  payload    JSONB,
  -- payload shape per type:
  --   friend_request:  { from_user_id, from_username }
  --   session_invite:  { session_id, session_name, session_code, from_username }
  --   group_match:     { session_id, session_name, movie_id, movie_title }
  --   session_ended:   { session_id, session_name }
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Routes

```
GET  /api/notifications              — returns unread + last 20 notifications for logged-in user
POST /api/notifications/:id/read     — mark one notification as read
POST /api/notifications/read-all     — mark all as read for logged-in user
```

`GET /api/notifications` response shape:
```json
{
  "unreadCount": 3,
  "notifications": [
    {
      "id": 12,
      "type": "session_invite",
      "payload": { "session_id": 4, "session_name": "Movie Night", "session_code": "AB12CD34", "from_username": "alex" },
      "read": false,
      "created_at": "2026-04-21T18:00:00Z"
    }
  ]
}
```

### UI (global — add to `main.hbs` or header partial)

- Bell icon (use an SVG or a `🔔` emoji-free Unicode char) in the nav bar, visible only when logged in
- Red badge `<span class="notif-badge">3</span>` overlaid on bell; hidden when count is 0
- Clicking bell opens a dropdown panel (similar to the existing nav dropdown pattern)
- Panel lists notifications: icon by type, human-readable message, relative timestamp ("2 min ago"), action link
- Clicking a `session_invite` notification → navigate to `/group-sessions?join=<session_code>`
- Clicking a `friend_request` notification → navigate to `/friends`
- Each notification marks itself read on click
- "Mark all read" button at top of panel
- Panel closes on outside click or `Esc`
- Poll `GET /api/notifications` every **15 seconds** via `setInterval` to update badge count

### Acceptance Criteria

- [ ] Bell icon visible in nav for all logged-in pages
- [ ] Badge shows unread count; hidden (not "0") when count is 0
- [ ] Polling updates badge without page reload
- [ ] All notification types render a readable message (no raw JSON visible)
- [ ] Click on session invite navigates to join flow
- [ ] Click on friend request navigates to `/friends`
- [ ] Mark-as-read works per notification and for all
- [ ] Panel closes on Esc and outside click
- [ ] No notifications = panel shows empty state ("You're all caught up")

---

## 3C — Group Sessions

### New DB Tables

Add to `create.sql`:

```sql
CREATE TABLE IF NOT EXISTS group_sessions (
  id             SERIAL PRIMARY KEY,
  owner_id       INT NOT NULL REFERENCES users(id),
  name           VARCHAR(100) NOT NULL,
  code           VARCHAR(8) UNIQUE NOT NULL,   -- random 8-char alphanumeric join code
  mode           VARCHAR(10) DEFAULT 'async',  -- 'async' | 'live'
  status         VARCHAR(20) DEFAULT 'active', -- 'active' | 'ended'
  seed_movie_id  VARCHAR(50),                  -- optional TMDb movie ID to include first
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id  INT REFERENCES group_sessions(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) DEFAULT 'invited',   -- 'invited' | 'joined' | 'declined'
  joined_at   TIMESTAMP,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS session_swipes (
  id          SERIAL PRIMARY KEY,
  session_id  INT REFERENCES group_sessions(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id) ON DELETE CASCADE,
  movie_id    VARCHAR(50) NOT NULL,
  title       VARCHAR(255),
  poster_url  VARCHAR(500),
  liked       BOOLEAN NOT NULL,
  swiped_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, user_id, movie_id)
);
```

### Routes

```
GET  /group-sessions                      — main page (renders group-sessions.hbs)
POST /group-sessions/create               — create session + invite friends + send notifications
POST /group-sessions/join                 — join by code (updates session_members.status = 'joined')
GET  /group-sessions/:id                  — session detail / swipe view
POST /group-sessions/:id/swipe            — record a swipe in session_swipes; check for new matches
POST /group-sessions/:id/end              — owner ends session; sends session_ended notifications
GET  /api/group-sessions/:id/state        — poll: returns member list, match list, swipe progress
GET  /api/group-sessions/top-picks        — ranked movies from friends' watchlists + swipe_history boost
```

#### Route details

**`POST /group-sessions/create`** body:
```json
{
  "name": "Movie Night",
  "mode": "async",
  "inviteUserIds": [2, 5, 9],
  "seedMovieId": "550"
}
```
- Generates random 8-char alphanumeric `code` (loop until unique, or use `nanoid`)
- Inserts into `group_sessions`
- Inserts `session_members` row for owner with `status = 'joined'`, `joined_at = NOW()`
- Inserts `session_members` rows for each invited user with `status = 'invited'`
- Inserts `notifications` row for each invited user (type `'session_invite'`)
- Responds with `{ sessionId, code }`; client redirects to `/group-sessions/:id`

**`POST /group-sessions/join`** body: `{ code: "AB12CD34" }`
- Looks up session by code; 404 if not found, 400 if `status = 'ended'`
- Upserts `session_members` row for current user with `status = 'joined'`, `joined_at = NOW()`
- Redirects to `/group-sessions/:id`

**`POST /group-sessions/:id/swipe`** body: `{ movieId, title, posterUrl, liked }`
- Inserts into `session_swipes` (upsert on conflict)
- After insert, runs match-check query (see below)
- If new match found, inserts `notifications` rows (type `'group_match'`) for all joined members
- Responds with `{ matched: true/false, matchedMovie: { ... } }` or `{ matched: false }`

**Match-check query:**
```sql
SELECT movie_id, title, poster_url
FROM session_swipes
WHERE session_id = $1
  AND liked = true
  AND movie_id IN (
    SELECT movie_id FROM session_swipes
    WHERE session_id = $1 AND liked = true
    GROUP BY movie_id
    HAVING COUNT(DISTINCT user_id) = (
      SELECT COUNT(*) FROM session_members
      WHERE session_id = $1 AND status = 'joined'
    )
  )
LIMIT 1;
```

**`GET /api/group-sessions/:id/state`** response:
```json
{
  "session": { "id": 4, "name": "Movie Night", "mode": "async", "status": "active", "code": "AB12CD34" },
  "members": [
    { "userId": 1, "username": "matt", "status": "joined", "swipeCount": 12 },
    { "userId": 2, "username": "alex", "status": "invited", "swipeCount": 0 }
  ],
  "matches": [
    { "movieId": "550", "title": "Fight Club", "posterUrl": "..." }
  ],
  "mySwipeCount": 12,
  "totalMovies": 20
}
```

**`GET /api/group-sessions/top-picks`** logic:
1. Get all friends of logged-in user
2. Count how many friends have each `movie_id` in their watchlist → `watchlist_count`
3. Count how many friends have `liked = true` for each `movie_id` in `swipe_history` → `swipe_boost`
4. Sort by `(watchlist_count * 2) + swipe_boost` descending
5. Return top 20, include `watchlist_count` and `swipe_boost` for display

### Movie Pool for Sessions

When a member enters the swipe view for a session (`GET /group-sessions/:id`), the server builds the movie pool:

1. If `seed_movie_id` is set, include that movie first
2. Fetch movies from TMDb Discover (same logic as home route — use existing genre bias if available)
3. Exclude any movie the user has already swiped in this session (`session_swipes`)
4. Return up to 20 movies per load; support `?page=N` for pagination

The pool is **not pre-stored in the DB** — it's generated fresh per member per load (same as the home deck). This keeps it simple and avoids a large DB table for movie metadata.

### `/group-sessions` Page Layout (`group-sessions.hbs`)

Three stacked sections:

#### Section 1 — Top Picks Among Friends
- Horizontal scrollable row of movie cards (poster + title + "N friends saved this")
- Only visible if user has ≥1 friend
- Each card has a "Start session" button that pre-fills the create form with that movie as seed
- Empty state: "Add friends to see what they're watching"
- Data source: `GET /api/group-sessions/top-picks`

#### Section 2 — My Sessions
- Grid of session cards: name, mode badge (Async / Live), member count, match count, status
- Active sessions: "Swipe" button → `/group-sessions/:id`
- Ended sessions: "View Results" button → `/group-sessions/:id` in read-only mode
- Empty state: "No sessions yet — create one below"

#### Section 3 — Create / Join
Two side-by-side panels (stack on mobile):

**Create panel:**
- Session name (text input, required)
- Mode toggle: Async / Live (radio or toggle switch)
- Invite friends: multi-select checkboxes from friend list
- Seed movie: optional text input (movie title search, or pre-filled from watchlist)
- Submit → `POST /group-sessions/create`

**Join panel:**
- Session code input (8 chars)
- Join button → `POST /group-sessions/join`

### Session Detail / Swipe View (`/group-sessions/:id`)

This is a modified version of the home swipe deck, scoped to the session's movie pool.

Layout:
- Header: session name, mode badge, member avatars, match count
- Swipe deck (same card component as home)
- Right sidebar (desktop) / bottom sheet (mobile): current matches panel
- Progress bar: "You've swiped X of Y movies"
- "Leave session" button (does not end session for others)
- If owner: "End Session" button → `POST /group-sessions/:id/end`

Polling:
- **Async mode:** Poll `GET /api/group-sessions/:id/state` every **30 seconds** to update matches panel and member progress
- **Live mode:** Poll every **3 seconds**; also show "Waiting for others..." overlay when not all members have swiped the current movie

Live mode "ready gate" (simplified implementation):
- Each movie in the pool is presented one at a time to all members
- A member's swipe is recorded but the next movie only reveals when all joined members have swiped the current one (enforced client-side via state poll)
- If a member is idle for >60s on a movie, they are considered to have passed (server can implement a timeout or just move on client-side)

### Starting a Session from Watchlist

On the watchlist page (both tabs):
- Add a "Start Group Session" button to each movie row and to the watchlist detail modal
- Clicking navigates to `/group-sessions?seed=<movieId>&seedTitle=<title>`
- On page load, if `?seed` query param is present: auto-scroll to Section 3 (Create panel) and pre-fill the seed movie field
- Friends who also have that movie in their watchlist should be pre-checked in the invite list

### Invite Flow (end-to-end)

1. Owner submits create form
2. Server inserts session + `session_members` (status `'invited'`) + notifications
3. Invited friend's bell badge increments on next 15s poll
4. Friend opens notification panel → clicks invite → navigates to `/group-sessions?join=<code>`
5. Page auto-triggers join (if `?join` param present, show a "Join [session name]?" confirm UI)
6. After joining, member is taken to the swipe view

Alternatively: owner copies the 8-char code and shares it manually. Anyone with the code can join.

---

## Acceptance Criteria (full checklist)

### 3A — Friend Requests
- [ ] Send request → `status = 'pending'`; new friend NOT visible in friends list yet
- [ ] Recipient sees request in "Pending Requests" section
- [ ] Accept → accepted; both users see each other in friends list
- [ ] Decline → row deleted
- [ ] Duplicate request → user-facing error (not a 500)
- [ ] Unfriend works via DELETE route
- [ ] `/friends` handles 0 friends and 0 pending (empty states, no crash)

### 3B — Notifications
- [ ] Bell in nav, logged-in only
- [ ] Badge shows unread count; hidden when 0
- [ ] 15s poll updates badge
- [ ] All 4 notification types render human-readable messages
- [ ] Session invite click → join flow
- [ ] Friend request click → `/friends`
- [ ] Per-notification and "mark all read" both work
- [ ] Panel closes on Esc and outside click
- [ ] Empty state when no notifications

### 3C — Group Session Page
- [ ] `/group-sessions` in nav; nav item shows active state
- [ ] Page loads with 0 friends, 0 sessions (all sections show empty states, no crash)
- [ ] Top Picks visible when user has friends with watchlist items; "N friends saved this" label correct
- [ ] Create form: name required, friends multi-select, mode toggle, optional seed
- [ ] Session code auto-generated (8-char, unique)
- [ ] Join by code works; invalid/ended code shows inline error
- [ ] My Sessions shows active sessions with member count and match count
- [ ] Ended sessions show results; cannot swipe in ended sessions

### 3C — Swipe Flow (Async)
- [ ] After joining, member enters swipe view with session movie pool
- [ ] Swipes saved in `session_swipes` with `session_id`
- [ ] Progress indicator: "X of Y swiped"
- [ ] Match detected when all joined members liked same movie
- [ ] Matches panel updates without page reload (on swipe or poll)
- [ ] Seed movie appears first in pool

### 3C — Live Mode
- [ ] "Live" badge distinguishes session type
- [ ] All joined members see same movie (3s poll sync)
- [ ] "Waiting for others..." shown while not all have swiped current movie
- [ ] Session ends when pool exhausted
- [ ] Final screen shows matches sorted by group like count

### 3C — Start from Watchlist
- [ ] "Start Group Session" button on watchlist rows and modal
- [ ] Click pre-fills create form with seed movie
- [ ] Friends who also have that movie suggested as invitees (pre-checked)
- [ ] Page auto-scrolls to create panel

### 3C — Invites & Notifications
- [ ] Creating session sends `session_invite` notification to each invited friend
- [ ] Bell badge increments for invited friends
- [ ] Notification click → one-click join
- [ ] Owner sees who has joined vs. pending in session detail
- [ ] Session code shown to owner for manual sharing
- [ ] Declining invite → `status = 'declined'`

### 3C — Session End & Results
- [ ] Owner can end session via "End Session" button
- [ ] All joined members receive `session_ended` notification
- [ ] Final results: ranked match list (poster, title, like count)
- [ ] Ended sessions appear in "Past Sessions" section
- [ ] No swiping allowed after session ends

---

## Implementation Order (suggested)

Since all three sub-features are interconnected, build in this order to unblock UI work early:

```
1. DB migrations (create.sql additions + ALTER friends default)
2. 3B: Notifications table + GET/POST routes (no UI yet)
3. 3A: Friend request flow (update /friends/add, add accept/decline/delete routes)
4. 3A: Friends page UI (pending requests section + badge)
5. 3B: Bell icon + polling UI in main.hbs
6. 3C: group_sessions + session_members + session_swipes tables
7. 3C: /group-sessions routes (create, join, end, state poll, top-picks)
8. 3C: group-sessions.hbs page (all 3 sections)
9. 3C: Session detail / swipe view
10. 3C: Live mode polling
11. 3C: Watchlist integration ("Start Group Session" button)
12. Final: end-to-end test with 2 real user accounts
```

---

## Notes for Teammates

- **Session code generation:** Use a simple random string — `Math.random().toString(36).substring(2, 10).toUpperCase()` or install `nanoid`. Must retry on collision.
- **No WebSockets needed:** Polling is sufficient. 15s for notifications, 30s for async sessions, 3s for live mode.
- **Movie pool is ephemeral:** Don't store the session's movie pool in the DB. Generate it on the fly per member from TMDb, just like the home deck. This avoids a massive movie metadata table.
- **friends table note:** The UNIQUE constraint is on `(requester_id, addressee_id)`. The existing code uses `MIN(id)` as `requester_id` and `MAX(id)` as `addressee_id` to avoid duplicate pairs. Keep this pattern.
- **Seed movie:** Just a TMDb movie ID stored as a string. Fetch the full movie details from TMDb on the session detail page — don't store movie data in the DB.
- **Live mode simplification:** If time is short, ship async mode first. Live mode is a polling enhancement on top of the same data model.
