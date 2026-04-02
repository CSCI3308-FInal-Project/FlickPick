const chai     = require('chai');
const chaiHttp = require('chai-http');
const app      = require('../src/index');

chai.use(chaiHttp);
const { expect } = chai;

describe('FlickPick Server', () => {

  describe('GET /login', () => {
    it('should return 200', done => {
      chai.request(app)
        .get('/login')
        .end((err, res) => {
          expect(res).to.have.status(200);
          done();
        });
    });
  });

  describe('GET /register', () => {
    it('should return 200', done => {
      chai.request(app)
        .get('/register')
        .end((err, res) => {
          expect(res).to.have.status(200);
          done();
        });
    });
  });

  describe('GET / (unauthenticated)', () => {
    it('should redirect to /login', done => {
      chai.request(app)
        .get('/')
        .redirects(0)
        .end((err, res) => {
          expect(res).to.have.status(302);
          expect(res.headers.location).to.equal('/login');
          done();
        });
    });
  });

  describe('POST /login (invalid credentials)', () => {
    it('should return 200 and re-render login with a message', done => {
      chai.request(app)
        .post('/login')
        .send({ username: 'nobody', password: 'wrongpass' })
        .end((err, res) => {
          expect(res).to.have.status(200);
          done();
        });
    });
  });

  describe('GET /watchlist (unauthenticated)', () => {
    it('should redirect to /login', done => {
      chai.request(app)
        .get('/watchlist')
        .redirects(0)
        .end((err, res) => {
          expect(res).to.have.status(302);
          expect(res.headers.location).to.equal('/login');
          done();
        });
    });
  });

  describe('POST /watchlist (unauthenticated)', () => {
    it('should redirect to /login', done => {
      chai.request(app)
        .post('/watchlist')
        .send({ movie_id: '123', title: 'Test' })
        .redirects(0)
        .end((err, res) => {
          expect(res).to.have.status(302);
          expect(res.headers.location).to.equal('/login');
          done();
        });
    });
  });

  describe('DELETE /watchlist/1 (unauthenticated)', () => {
    it('should redirect to /login', done => {
      chai.request(app)
        .delete('/watchlist/1')
        .redirects(0)
        .end((err, res) => {
          expect(res).to.have.status(302);
          expect(res.headers.location).to.equal('/login');
          done();
        });
    });
  });

});
