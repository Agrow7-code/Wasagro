// Node.js load test for Wasagro rate limiter
// No dependencies — uses built-in http/https modules
// Run: node scripts/load-test-node.mjs
//
// Env: BASE_URL (default: http://localhost:3000)

import http from 'node:http'
import https from 'node:https'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const CONCURRENT = 20
const TOTAL_REQUESTS = 200
const DELAY_MS = 50

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJwaG9uZSI6IjU5Mzk4NzY1NDMyMSIsInJvbCI6ImFncmljdWx0b3IiLCJmaW5jYV9pZCI6IkYwMDEiLCJleHAiOjk5OTk5OTk5OTl9.placeholder'

const results = {
  total: 0,
  ok: 0,
  rateLimited: 0,
  auth: 0,
  errors: 0,
  latencies: [],
  statusCodes: {},
}

function fetchUrl(method, path, headers = {}, body = null) {
  const url = new URL(path, BASE_URL)
  const start = performance.now()
  const mod = url.protocol === 'https:' ? https : http

  return new Promise((resolve) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    }

    const req = mod.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          latency: performance.now() - start,
          body: data,
        })
      })
    })

    req.on('error', (err) => {
      resolve({ status: 0, headers: {}, latency: performance.now() - start, body: err.message, error: true })
    })

    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function runAuthTest() {
  console.log('\n── Auth Endpoint: POST /api/auth/request-otp ──')
  console.log('   Limit: 10 req / 15 min\n')

  let rateLimitedCount = 0

  for (let i = 0; i < 15; i++) {
    const phone = `+59390000${String(i).padStart(4, '0')}`
    const res = await fetchUrl('POST', '/api/auth/request-otp', {}, { phone })
    results.total++

    results.statusCodes[res.status] = (results.statusCodes[res.status] || 0) + 1
    results.latencies.push(res.latency)

    if (res.status === 429) {
      rateLimitedCount++
      results.rateLimited++
      const limit = res.headers['x-ratelimit-limit']
      const remaining = res.headers['x-ratelimit-remaining']
      console.log(`  [${i + 1}/15] 429 Rate Limited (limit=${limit}, remaining=${remaining})`)
    } else if (res.status === 200) {
      results.auth++
      console.log(`  [${i + 1}/15] 200 OK (${res.latency.toFixed(0)}ms)`)
    } else {
      results.errors++
      console.log(`  [${i + 1}/15] ${res.status} (${res.latency.toFixed(0)}ms)`)
    }
  }

  console.log(`\n  Auth: ${results.auth} accepted, ${rateLimitedCount} rate-limited`)
}

async function runApiBurstTest() {
  console.log('\n── API Endpoint: GET /api/finca/F001 (burst) ──')
  console.log('   Limit: 60 req / min')
  console.log(`   Sending ${CONCURRENT} concurrent x ${Math.ceil(TOTAL_REQUESTS / CONCURRENT)} rounds\n`)

  let rateLimitedCount = 0
  let round = 0

  for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENT) {
    round++
    const batch = []

    for (let j = 0; j < CONCURRENT && i + j < TOTAL_REQUESTS; j++) {
      const endpoints = [
        { method: 'GET', path: '/api/finca/F001' },
        { method: 'GET', path: '/api/finca/F001/lotes' },
        { method: 'GET', path: '/api/metricas/F001' },
      ]
      const ep = endpoints[j % endpoints.length]

      batch.push(
        fetchUrl(ep.method, ep.path, { Authorization: `Bearer ${FAKE_JWT}` })
      )
    }

    const responses = await Promise.all(batch)

    for (const res of responses) {
      results.total++
      results.statusCodes[res.status] = (results.statusCodes[res.status] || 0) + 1
      results.latencies.push(res.latency)

      if (res.status === 429) {
        rateLimitedCount++
        results.rateLimited++
      } else if ([200, 401, 403].includes(res.status)) {
        results.ok++
      } else if (res.error) {
        results.errors++
      } else {
        results.ok++
      }
    }

    const roundRateLimited = responses.filter((r) => r.status === 429).length
    const avgLatency = responses.reduce((s, r) => s + r.latency, 0) / responses.length
    process.stdout.write(`  Round ${round}: ${responses.length} reqs, ${roundRateLimited} rate-limited, avg ${avgLatency.toFixed(0)}ms\n`)

    await new Promise((r) => setTimeout(r, DELAY_MS))
  }

  console.log(`\n  API: ${results.ok} accepted, ${rateLimitedCount} rate-limited`)
}

function printSummary() {
  const latencies = results.latencies.sort((a, b) => a - b)
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0
  const avg = latencies.reduce((s, l) => s + l, 0) / (latencies.length || 1)

  console.log('\n==========================================')
  console.log('  Wasagro Rate Limiter Load Test Results')
  console.log('==========================================')
  console.log(`  Total requests:  ${results.total}`)
  console.log(`  Accepted:        ${results.ok + results.auth}`)
  console.log(`  Rate-limited:    ${results.rateLimited}`)
  console.log(`  Errors:          ${results.errors}`)
  console.log(`  Error rate:      ${((results.errors / (results.total || 1)) * 100).toFixed(2)}%`)
  console.log()
  console.log('  Status codes:')
  for (const [code, count] of Object.entries(results.statusCodes).sort()) {
    console.log(`    ${code}: ${count}`)
  }
  console.log()
  console.log('  Latency:')
  console.log(`    avg:  ${avg.toFixed(1)}ms`)
  console.log(`    p50:  ${p50.toFixed(1)}ms`)
  console.log(`    p95:  ${p95.toFixed(1)}ms`)
  console.log(`    p99:  ${p99.toFixed(1)}ms`)
  console.log()
  console.log(`  Overall: ${results.errors < results.total * 0.15 ? 'PASS' : 'FAIL'}`)
  console.log('==========================================')
}

async function main() {
  console.log(`Target: ${BASE_URL}`)
  console.log(`Concurrent: ${CONCURRENT}, Total: ${TOTAL_REQUESTS}\n`)

  try {
    const health = await fetchUrl('GET', '/health')
    if (health.status !== 200) {
      console.warn(`Warning: /health returned ${health.status} — server may not be running`)
    } else {
      console.log('Health check: OK')
    }
  } catch {
    console.warn('Warning: Could not reach /health — make sure the server is running')
  }

  await runAuthTest()
  await runApiBurstTest()
  printSummary()
}

main().catch(console.error)
