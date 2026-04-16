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
