/*global describe, it, beforeEach, before, after*/
'use strict'
const path = require('path')
const ServiceManager = require('five-bells-service-manager')
const ServiceGraph = require('../lib/service-graph')
const _ = require('lodash')
const fetch = require('node-fetch')

const services = new ServiceManager(
  path.resolve(process.cwd(), 'node_modules/'),
  path.resolve(process.cwd(), 'data/'))

const integrationTestUri = 'http://localhost:8042/'

function demoLedgerName (number) {
  return 'demo.ledger' + number + '.'
}

function * buildServiceGraph (serviceManager, graphConf) {
  const graph = new ServiceGraph(serviceManager)
  const connectorNames = _.keys(graphConf.edge_list_map)
  const numConnectors = connectorNames.length
  const numLedgers = graphConf.num_ledgers
  let ledgerHosts = {}
  let ledgerConnectors = {}
  let connectorEdges = new Array(numConnectors)
  for (let i = 0; i < numConnectors; i++) {
    const edges = graphConf.edge_list_map[connectorNames[i]]
    connectorEdges[i] =
      edges.map((edge) => {
        const source = edge.source
        const target = edge.target
        const sourceAddress = demoLedgerName(source)
        const targetAddress = demoLedgerName(target)
        ledgerHosts[sourceAddress] = 'http://localhost:' + (3000 + source)
        ledgerHosts[targetAddress] = 'http://localhost:' + (3000 + target)
        if (!ledgerConnectors[sourceAddress]) ledgerConnectors[sourceAddress] = []
        ledgerConnectors[sourceAddress].push(connectorNames[i])
        if (!ledgerConnectors[targetAddress]) ledgerConnectors[targetAddress] = []
        ledgerConnectors[targetAddress].push(connectorNames[i])
        return {source: sourceAddress,
                target: targetAddress}
      })
  }
  for (let i = 0; i < numLedgers; i++) {
    const ledger = demoLedgerName(i)
    yield graph.startLedger(ledger, 3000 + i,
                            {recommendedConnectors: ledgerConnectors[ledger]})
  }
  yield graph.setupAccounts()
  for (let i = 0; i < numConnectors; i++) {
    const opts = {edges: connectorEdges[i],
                  routeBroadcastInterval: 10 * 1000,
                  routeExpiry: 15 * 1000,
                  integrationTestUri: integrationTestUri,
                  integrationTestName: connectorNames[i],
                  integrationTestPort: (4200 + i)}
    yield graph.startConnector(connectorNames[i], opts)
  }
  return graph
}

function * fetchNReports (nConnectors, firstPort) {
  for (let i = 0; i < nConnectors; i++) {
    yield fetch('http://localhost:' + (firstPort + i) + '/routes')
  }
}

function withNFetchedReports (nConnectors, firstPort, done, err) {
  const all = Promise.all(fetchNReports(nConnectors, firstPort))
  all.then((r) => {
    const reportPromises = r.map((res) => res.json())
    const allJson = Promise.all(reportPromises)
    allJson.then((reports) => done(reports),
                 (er) => err(er))
  }, err)
}

function uniqueDestinations (routeList) {
  let destSet = new Set()
  routeList.forEach((route) => destSet.add(route.destination_ledger))
  return destSet
}

function describeReachabilityFailure (reports, numLedgers) {
  let message = 'The following connectors are missing routes:\n'
  reports.forEach((report) => {
    const destSet = uniqueDestinations(report.routes)
    let missing = []
    for (let i = 0; i < numLedgers; i++) {
      if (!destSet.has(demoLedgerName(i))) missing.push(demoLedgerName(i))
    }
    if (missing.length > 0) {
      message += report.name + ' can\'t reach: ' + missing.join(', ') + '\n'
    }
  })
  return message
}

function describeDeadlineFailure (reports, deadline) {
  let message = 'The following connectors received broadcast messages with new routes after the expected time-to-stabilize: '
  let slow = []
  reports.forEach((report) => {
    if (report.last_new_receive >= deadline) slow.push(report.name)
  })
  return message + slow.join(', ')
}

function * assertFullReachabilityAndQuietude (graphConfFilename, testThis, done, allowedTimeForPropogation) {
  const graphConfPath = path.resolve(__dirname, '../tests/graph_configurations/' + graphConfFilename)
  const graphConf = require(graphConfPath)
  const graph = yield buildServiceGraph(services, graphConf)
  const numConnectors = _.size(graph.connectors)
  const numLedgers = graphConf.num_ledgers
  testThis.timeout(allowedTimeForPropogation + 2000)
  const deadline = Date.now() + allowedTimeForPropogation
  setTimeout(() => {
    withNFetchedReports(numConnectors, 4200,
                        (reports) => {
                          if (numConnectors !== reports.length) done(new Error('expected ' + numConnectors + ' reports; got: ' + reports.length))
                          else if (!_.every(reports, (report) => uniqueDestinations(report.routes).size === numLedgers)) {
                            done(new Error(describeReachabilityFailure(reports, numLedgers) + 'reports:\n', reports))
                          } else if (!_.every(reports, (report) => report.last_new_receive < deadline)) {
                            done(new Error(describeDeadlineFailure(reports, deadline)))
                          } else done()
                        },
                        done)
  }, allowedTimeForPropogation + 15000)
}

describe('Routing', function () {
  before(function * () {
    services.killAll()
  })
  beforeEach(function * () {})
  after(function () {
    services.killAll()
  })

  describe('propagation completes', function () {
    it('4 node loop', function * (done) {
      yield assertFullReachabilityAndQuietude('loop4.json', this, done, 30000)
    })

    it('13 node loop', function * (done) {
      yield assertFullReachabilityAndQuietude('loop13.json', this, done, 45000)
    })

    it('5 connector, 4 ledger double loop', function * (done) {
      yield assertFullReachabilityAndQuietude('loop4_chord1.json', this, done, 90000)
    })
    it('9 connector, 8 ledger figure-eight', function * (done) {
      yield assertFullReachabilityAndQuietude('fig8.json', this, done, 90000)
    })
  })
})
