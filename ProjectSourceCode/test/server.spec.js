const chai = require('chai');
const chaiHttp = require('chai-http');
const app = require('../src/index');

chai.use(chaiHttp);
const { expect } = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************

describe('FlickPick Server!', () => {
  // Sample test case given to test / endpoint.
  it('Returns the default welcome message', done => {
    chai
      .request(app)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals('success');
        expect(res.body.message).to.equal('Welcome!');
        done();
      });
  });
});

// *********************** TODO: WRITE 2 UNIT TESTCASES **************************

describe('Testing Add User API', () => {
  it('positive : /register', done => {
    chai
      .request(app)
      .post('/register')
      .redirects(0)
      .send({ username: 'testuser', email: 'test@test.com', password: 'testpassword' })
      .end((err, res) => {
        expect(res).to.have.status(302);
        done();
      });
  });
});

describe('Testing Add User API', () => {
  it('negative : /register - missing fields', done => {
    chai
      .request(app)
      .post('/register')
      .send({ username: '', email: '', password: '' })
      .end((err, res) => {
        expect(res).to.have.status(400);
        done();
      });
  });
});



describe('Testing Watchlist API', () => {
  const agent = chai.request.agent(app);

  before(done => {
    // Try to register testuser first in case DB is clean
    chai.request(app)
      .post('/register')
      .redirects(0)
      .send({ username: 'testuser', email: 'test@test.com', password: 'testpassword' })
      .end(() => {
        // Then login regardless of whether register succeeded or failed
        agent
          .post('/login')
          .send({ username: 'testuser', password: 'testpassword' })
          .end((err, res) => {
            done();
          });
      });
  });

  it('positive : /watchlist add movie', done => {
    agent
      .post('/watchlist')
      .send({ movie_id: 99999, title: 'The Matrix' })
      .end((err, res) => {
        expect(res).to.have.status(201);
        expect(res.body.message).to.equal('Added to watchlist');
        done();
      });
  });

  it('negative : /watchlist duplicate movie', done => {
    agent
      .post('/watchlist')
      .send({ movie_id: 99999, title: 'The Matrix' })
      .end((err, res) => {
        expect(res).to.have.status(409);
        expect(res.body.error).to.equal('Already in watchlist');
        done();
      });
  });
});

describe('DELETE /watchlist/by-movie/:movie_id', () => {
  const agent = chai.request.agent(app);

  before(done => {
    agent
      .post('/login')
      .send({ username: 'testuser', password: 'testpassword' })
      .end(() => done());
  });

  it('removes a watchlist entry by movie_id', done => {
    agent
      .post('/watchlist')
      .send({ movie_id: '88888', title: 'Undo Test Movie' })
      .end(() => {
        agent
          .delete('/watchlist/by-movie/88888')
          .end((err, res) => {
            expect(res).to.have.status(200);
            expect(res.body.success).to.equal(true);
            // Verify row is actually gone: re-inserting should succeed (201), not conflict (409)
            agent
              .post('/watchlist')
              .send({ movie_id: '88888', title: 'Undo Test Movie' })
              .end((err2, res2) => {
                expect(res2).to.have.status(201);
                done();
              });
          });
      });
  });

  it('returns 200 even if movie_id not in watchlist (idempotent)', done => {
    agent
      .delete('/watchlist/by-movie/00000')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.success).to.equal(true);
        done();
      });
  });
});

describe('POST /swipe', () => {
  const agent = chai.request.agent(app);

  before(done => {
    agent
      .post('/login')
      .send({ username: 'testuser', password: 'testpassword' })
      .end(() => done());
  });

  it('positive: records a right swipe and returns success', done => {
    agent
      .post('/swipe')
      .send({
        movie_id: '550',
        title: 'Fight Club',
        genre_ids: '18,53',
        rating: 8.8,
        liked: true,
      })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.success).to.equal(true);
        done();
      });
  });

  it('positive: records a left swipe and returns success', done => {
    agent
      .post('/swipe')
      .send({
        movie_id: '551',
        title: 'Some Movie',
        genre_ids: '28',
        rating: 6.0,
        liked: false,
      })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.success).to.equal(true);
        done();
      });
  });

  it('positive: duplicate swipe on same movie returns success (idempotent)', done => {
    agent
      .post('/swipe')
      .send({
        movie_id: '550',
        title: 'Fight Club',
        genre_ids: '18,53',
        rating: 8.8,
        liked: true,
      })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.success).to.equal(true);
        done();
      });
  });

  it('negative: unauthenticated request is redirected', done => {
    chai
      .request(app)
      .post('/swipe')
      .redirects(0)
      .send({ movie_id: '550', title: 'Fight Club', liked: true })
      .end((err, res) => {
        expect(res).to.have.status(302);
        done();
      });
  });
});
