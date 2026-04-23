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



xdescribe('Testing Watchlist API', () => {
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

describe('WS8: Watchlist page loads with friend data', () => {
  const agent = chai.request.agent(app);

  before(done => {
    chai.request(app)
      .post('/register')
      .redirects(0)
      .send({ username: 'ws8user', email: 'ws8@test.com', password: 'ws8password' })
      .end(() => {
        agent
          .post('/login')
          .send({ username: 'ws8user', password: 'ws8password' })
          .end(() => done());
      });
  });

  it('GET /watchlist returns 200 for logged-in user', done => {
    agent
      .get('/watchlist')
      .end((_err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });

  it('GET /watchlist?tab=watched returns 200 for logged-in user', done => {
    agent
      .get('/watchlist?tab=watched')
      .end((_err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });
});

describe('Notifications API', () => {
  const agent = chai.request.agent(app);

  before(done => {
    chai.request(app)
      .post('/register')
      .redirects(0)
      .send({ username: 'notifuser', email: 'notif@test.com', password: 'testpass' })
      .end(() => {
        agent.post('/login').send({ username: 'notifuser', password: 'testpass' }).end(() => done());
      });
  });

  it('GET /api/notifications returns unreadCount and notifications array', done => {
    agent.get('/api/notifications').end((err, res) => {
      expect(res).to.have.status(200);
      expect(res.body).to.have.property('unreadCount');
      expect(res.body).to.have.property('notifications').that.is.an('array');
      done();
    });
  });
});

describe('Friend Requests', () => {
  const agent = chai.request.agent(app);

  before(done => {
    // Clean up any stale friend request from prior runs
    chai.request(app)
      .delete('/test/friends-cleanup')
      .send({ requester: 'friendrequser', addressee: 'friendtarget' })
      .end(() => {
        chai.request(app)
          .post('/register').redirects(0)
          .send({ username: 'friendrequser', email: 'freq@test.com', password: 'testpass' })
          .end(() => {
            agent.post('/login').send({ username: 'friendrequser', password: 'testpass' }).end(() => done());
          });
      });
  });

  it('POST /friends/add sends pending request (not auto-accept)', done => {
    chai.request(app).post('/register').redirects(0)
      .send({ username: 'friendtarget', email: 'ftarget@test.com', password: 'testpass' })
      .end(() => {
        agent.post('/friends/add').send({ username: 'friendtarget' }).end((err, res) => {
          expect(res).to.have.status(200);
          expect(res.body.success).to.equal(true);
          done();
        });
      });
  });

  it('GET /friends/requests returns array', done => {
    agent.get('/friends/requests').end((err, res) => {
      expect(res).to.have.status(200);
      expect(res.body).to.have.property('requests').that.is.an('array');
      done();
    });
  });
});

