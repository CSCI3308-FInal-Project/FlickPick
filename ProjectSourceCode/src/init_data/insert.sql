-- Seed data for development
-- Passwords are hashed with bcrypt (cost factor 10)

-- Clean up test user on every startup so tests always start from a clean state
DELETE FROM swipe_history WHERE user_id = (SELECT id FROM users WHERE username = 'testuser');
DELETE FROM watchlist     WHERE user_id = (SELECT id FROM users WHERE username = 'testuser');
DELETE FROM profile       WHERE user_id = (SELECT id FROM users WHERE username = 'testuser');
DELETE FROM friends       WHERE requester_id = (SELECT id FROM users WHERE username = 'testuser')
                             OR addressee_id  = (SELECT id FROM users WHERE username = 'testuser');
DELETE FROM group_sessions WHERE owner_id IN (SELECT id FROM users WHERE username = 'testuser' OR email = 'test@test.com');
DELETE FROM users WHERE username = 'testuser' OR email = 'test@test.com';

-- admin / password: admin1302
INSERT INTO users (username, email, password)
VALUES (
  'admin',
  'admin@flickpick.com',
  '$2b$10$Q3R1xJvX5KzUeW2mN8pLOuZ6YvHsDcFbGtAkMwXnPqIrElTsVyjCu'
)
ON CONFLICT DO NOTHING;
