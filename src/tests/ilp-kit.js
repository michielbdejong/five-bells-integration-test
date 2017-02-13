/*global describe, it, beforeEach, before, after*/
'use strict'

const path = require('path')
const ServiceManager = require('five-bells-service-manager')
const KitManager = require('../lib/kit-manager')
const request = require('superagent')
const assert = require('assert')
const spawn = require('child_process').spawn

const services = new ServiceManager(
  path.resolve(process.cwd(), 'node_modules/'),
  path.resolve(process.cwd(), 'data/'))
const kitManager = new KitManager(services)

const configFiles = [ require.resolve('../tests/data/kit1-env.list'),
                      require.resolve('../tests/data/kit2-env.list')]
                      // if more complex test cases require more ilp kit instances,
                      // add more env.list files below.
                      // require.resolve('../tests/data/kit3-env.list')]

// sleep time expects milliseconds
function sleep (time) {
  return new Promise((resolve) => setTimeout(resolve, time))
}

function assertStatusCode (resp, expectedStatus) {
  assert.equal(resp.statusCode, expectedStatus, `HTTP status code is ${resp.statusCode}, 
        but expected is ${expectedStatus}`)
}

// sets up Apache as a reverse-proxy and for handling SSL connections
function * setupApache () {
  const image = process.env.CIRCLE_BUILD_IMAGE
  if (!image) {
    console.log('WARN: Not running on CircleCI. ' +
      'Please setup Apache configuration manually.')
  } else if (image !== 'ubuntu-14.04') {
    throw new Error('Incompatible build image, use Ubuntu 14.04 instead.')
  } else {
    try {
      const scriptPath = require.resolve('../../assets/ci/setup_ssl.sh')
      const scriptDir = path.resolve(scriptPath, '..')
      spawn('sh', [scriptPath], {
        cwd: scriptDir,
        stdio: 'inherit'
      })
      yield sleep(5000)
    } catch (e) {
      throw new Error('Failed to setup Apache as a reverse-proxy: ' + e.message)
    }
  }
}

describe('ILP Kit Test Suite -', function () {
  before(function * () {
    try {
      // accept self-signed certificates
      process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

      yield setupApache()

      let startupPromises = []
      for (const config of configFiles) {
        const p = kitManager.startKit(config)
        startupPromises.push(p)
      }
      yield Promise.all(startupPromises)
      yield sleep(10000) // let the ilp-kits start

      // setup peering
      yield kitManager.setupPeering(kitManager.kits[0], kitManager.kits[1], {
        limit: 200,
        currency: 'USD'
      })

      yield sleep(20000) // wait until routes are broadcasted
    } catch (e) {
      console.log(e)
    }
  })

  beforeEach(function * () {
    try {
      yield kitManager.setupAccounts()
    } catch (e) { console.log(e) }
  })

  after(function * () {
    // turn back on certificate check
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 1
    services.killAll()
  })

  describe('User API -', function () {
    it('Get a user', function * () {
      const config = kitManager.kits[0]
      const expectedUser = 'alice'
      const resp = yield request
        .get(`http://${config.API_HOSTNAME}:${config.API_PORT}/users/${expectedUser}`)
        .auth(expectedUser, expectedUser)

      const expectedStatus = 200
      assert.equal(resp.statusCode, expectedStatus, `HTTP status code is ${resp.statusCode}, 
        but expected is ${expectedStatus}`)
      assert.equal(resp.body.username, expectedUser, `Username is ${resp.body.username}, 
        but expected is ${expectedUser}`)
    })

    it('Create a user', function * () {
      const config = kitManager.kits[0]
      const expectedUser = 'daryl'
      const resp = yield request
        .post(`http://${config.API_HOSTNAME}:${config.API_PORT}/users/${expectedUser}`)
        .auth('admin', 'admin')
        .send({
          username: 'daryl',
          email: 'daryl@some.example',
          password: 'daryl'
        })

      const expectedStatus = 201
      assert.equal(resp.statusCode, expectedStatus, `HTTP status code is ${resp.statusCode}, 
        but expected is ${expectedStatus}`)
      assert.equal(resp.body.username, expectedUser, `Username is ${resp.body.username}, 
        but expected is ${expectedUser}`)
      yield kitManager.assertBalance(kitManager.kits[0], 'daryl', '0')
    })

    it('Update a user', function * () {
      const config = kitManager.kits[0]
      const expectedMail = 'alice@alice.example'
      const expectedName = 'AliceAlice'
      const resp = yield request
        .put(`http://${config.API_HOSTNAME}:${config.API_PORT}/users/alice`)
        .auth('alice', 'alice')
        .send({
          email: expectedMail,
          name: expectedName,
          password: 'alice'
        })

      const expectedStatus = 200
      assert.equal(resp.statusCode, expectedStatus, `HTTP status code is ${resp.statusCode}, 
        but expected is ${expectedStatus}`)
      assert.equal(resp.body.name, expectedName, `Name is ${resp.body.username}, 
        but expected is ${expectedName}`)
      assert.equal(resp.body.email, expectedMail, `Mail is ${resp.body.username}, 
        but expected is ${expectedMail}`)
    })
  })

  describe('Payment API -', function () {
    it('request a quote', function * () {
      const config = kitManager.kits[0]
      const sourceAmount = 5.1016
      const destinationAmount = 5
      const resp = yield request
        .post(`https://${config.API_HOSTNAME}:${config.API_PUBLIC_PORT}/api/payments/quote`)
        .auth('alice', 'alice')
        .set('Content-Type', 'application/json')
        .send({ destination: 'bob@wallet2.example', destinationAmount })
      assertStatusCode(resp, 200)

      assert(resp.body.sourceAmount, sourceAmount,
        `sourceAmount is ${resp.body.sourceAmount}, but expected is ${sourceAmount}`)
      assert.equal(resp.body.destinationAmount, destinationAmount,
        `destinationAmount is ${resp.body.destinationAmount}, but expected is ${destinationAmount}`)
    })

    it('Make an intraledger payment', function * () {
      const config = kitManager.kits[0]
      const resp = yield request
        .put(`https://${config.API_HOSTNAME}:${config.API_PUBLIC_PORT}/api/payments/9efa70ec-08b9-11e6-b512-3e1d05defe78`)
        .auth('alice', 'alice')
        .set('Content-Type', 'application/json')
        .send({
          destination: 'bob@wallet1.example:443',
          destinationAmount: 1,
          sourceAmount: 1,
          message: 'intraledger payment test'
        })
      assertStatusCode(resp, 200)
      yield kitManager.assertBalance(kitManager.kits[0], 'alice', '999')
      yield kitManager.assertBalance(kitManager.kits[0], 'bob', '1001')
    })

    it('Make an interledger payment (same currency)', function * () {
      const config = kitManager.kits[0]
      const resp = yield request
        .put(`https://${config.API_HOSTNAME}:${config.API_PUBLIC_PORT}/api/payments/aaaa70ec-08b9-11e6-b512-3e1d05defe78`)
        .auth('alice', 'alice')
        .set('Content-Type', 'application/json')
        .send({
          destination: 'bob@wallet2.example:443',
          destinationAmount: 5,
          message: 'interledger payment test'
        })
      assertStatusCode(resp, 200)

      // Alice should have:
      //    1000      USD
      //  -    5      USD (sent to Bob)
      //  /   (1 - 0.01)  (connie@wallet2 spread/fee: 1%)
      //  /   (1 - 0.01)  (connie@wallet1 spread/fee: 1%)
      //  ==============
      //     994.8984 USD

      yield kitManager.assertBalance(kitManager.kits[0], 'alice', 994.8984)
      yield kitManager.assertBalance(kitManager.kits[1], 'bob', 1005)
      yield kitManager.assertBalance(kitManager.kits[0], 'connie', 1005.1016)
      yield kitManager.assertBalance(kitManager.kits[1], 'connie', 995)
    })

    it.skip('Make an interledger payment (cross-currency)', function * () {
      const config = kitManager.kits[1]
      const resp = yield request
        .put(`https://${config.API_HOSTNAME}:${config.API_PUBLIC_PORT}/api/payments/bbbb70ec-08b9-11e6-b512-3e1d05defe78`)
        .auth('alice', 'alice')
        .set('Content-Type', 'application/json')
        .send({
          destination: 'bob@wallet3.example:443',
          destinationAmount: 100,
          message: 'interledger payment test'
        })
      assertStatusCode(resp, 200)
      // TODO: configure a static exchange rate and assert that the balances match
    })

    it('Reject a payment with missing destinationAmount', function * () {
      let throws = false
      const config = kitManager.kits[0]
      try {
        yield request
          .put(`https://${config.API_HOSTNAME}:${config.API_PUBLIC_PORT}/api/payments/cccc70ec-08b9-11e6-b512-3e1d05defe78`)
          .auth('alice', 'alice')
          .set('Content-Type', 'application/json')
          .send({
            destination: 'bob@wallet2.example:443',
            sourceAmount: 22,
            message: 'interledger payment test'
          })
      } catch (err) {
        throws = true
        assertStatusCode(err.response, 500)
      }
      assert(throws, 'Expected an error, but none was thrown.')

      // No funds should have been moved
      const balances = []
      balances.push(kitManager.assertBalance(kitManager.kits[0], 'alice', 1000))
      balances.push(kitManager.assertBalance(kitManager.kits[1], 'bob', 1000))
      balances.push(kitManager.assertBalance(kitManager.kits[0], 'connie', 1000))
      balances.push(kitManager.assertBalance(kitManager.kits[1], 'connie', 1000))
      yield Promise.all(balances)
    })
  })
})
