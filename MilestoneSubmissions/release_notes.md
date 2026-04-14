# FlickPick — Release Notes

## Week of March 25, 2026 (v0.1)

### Features Implemented
- Initial project setup with `.gitignore` and base configuration
- Lab 8 project proposal finalized and submitted
- Wireframes completed: home, login, register, profile, watchlist, group session
- Use case diagram added

### Known Issues / Limitations
- Application not yet functional; wireframes and proposal only
- No backend or database integration yet

---

## Week of March 31, 2026 (v0.2)

### Features Implemented
- TMDb API integrated on home route to serve dynamic movie cards
- Home page (`home.hbs`) rewritten to render movie cards from TMDb data
- Swipe animations and card advancement logic added
- Watchlist endpoint added (`POST /save`)
- Working watchlist prototype created
- Forgot password feature implemented
- Register page updated with confirm password validation

### Known Issues / Limitations
- Watchlist persistence not fully tested across sessions
- Forgot password flow may not handle all edge cases
- No unit tests yet for new routes

---

## Week of April 6, 2026 (v0.3)

### Features Implemented
- Lab 10 base setup with UAT plan documentation
- Docker container issues resolved for Lab 10 environment
- UAT plan (`FlickPick_UAT_Plan`) added to milestone submissions
- Positive and negative unit tests added for `/register` route
- Register route error handling improved
- Watchlist management unit tests added (positive and negative cases)

### Known Issues / Limitations
- UAT testing not yet fully executed against all routes
- Test coverage limited to `/register` and watchlist management so far
- Group session feature not yet implemented
- Friends list not yet implemented

---

## Week of April 13, 2026 (v0.4)

### Features Implemented
- Movie synopsis now displayed on watchlist page
- Director and cast fetched via `/api/movie/:tmdbId` proxy and shown in watchlist detail modal
- Watchlist dropdown navigation fixed
- Production deployment stabilized: removed `prestart` script, adjusted Render blueprint for free plan

### Known Issues / Limitations
- Login only accepts username — email login not yet supported
- No drag-to-swipe gesture (buttons only)
- App is not mobile-responsive
- Group session feature not yet implemented
- Friends list not yet implemented
- No swipe history tracking or personalized recommendations
- Profile page shows hardcoded demo data only
- No user review system
