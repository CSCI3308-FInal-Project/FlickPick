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


  describe('POST /register', () => {
    it('should return 302', done => {
      const word = Date.now();

      chai.request(app)
        .post('/register')
        .redirects(0)
        .send({
          username: `user${word}`,
          email: `user${word}@test.com`,
          password: 'testing123'
        })
        .end((err, res) => {
          expect(res).to.have.status(302);
          expect(res.headers.location).to.equal('/login');
          done();
        });
    });

    it('should return 200 for duplicate user', done => {
      const word = Date.now();
      const user = {
        username: `dupuser${word}`,
        email: `dup${word}@test.com`,
        password: 'testing123'
      };

      chai.request(app)
        .post('/register')
        .send(user)
        .end(() => {
          chai.request(app)
            .post('/register')
            .send(user)
            .end((err, res) => {
              expect(res).to.have.status(200);
              done();
            });
        });
    });
  });
  });