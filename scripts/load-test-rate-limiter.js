// k6 load test — Wasagro rate limiter
// Install: https://grafana.com/docs/k6/latest/set-up/install-k6/
// Run:     k6 run scripts/load-test-rate-limiter.js
//
// Requires BASE_URL env var (default: http://localhost:3000)

import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

const errorRate = new Rate('errors')
const rateLimitTrend = new Trend('rate_limit_ttfb')

export const options = {
  scenarios: {
    // Scenario 1: Auth endpoint — 10 req / 15 min
    auth_burst: {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 5,
      maxVUs: 20,
      timeUnit: '1s',
      startRate: 0,
      stages: [
        { duration: '5s', target: 2 },
        { duration: '10s', target: 2 },
        { duration: '5s', target: 0 },
      ],
      exec: 'authBurst',
    },

    // Scenario 2: API endpoint — 60 req / min
    api_steady: {
      executor: 'ramping-arrival-rate',
      preAllocatedVUs: 10,
      maxVUs: 50,
      timeUnit: '1m',
      startRate: 0,
      stages: [
        { duration: '10s', target: 30 },
        { duration: '20s', target: 60 },
        { duration: '10s', target: 80 },
        { duration: '10s', target: 0 },
      ],
      exec: 'apiSteady',
    },

    // Scenario 3: Concurrent spike on API
    api_spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '3s', target: 30 },
        { duration: '5s', target: 30 },
        { duration: '3s', target: 0 },
      ],
      exec: 'apiSpike',
      startTime: '40s',
    },
  },
  thresholds: {
    errors: ['rate<0.15'],
    http_req_duration: ['p(95)<500'],
  },
}

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJwaG9uZSI6IjU5Mzk4NzY1NDMyMSIsInJvbCI6ImFncmljdWx0b3IiLCJmaW5jYV9pZCI6IkYwMDEiLCJleHAiOjk5OTk5OTk5OTl9.placeholder'

export function authBurst() {
  const phone = `+59390000${__VU.toString().padStart(4, '0')}`

  group('POST /api/auth/request-otp', () => {
    const res = http.post(
      `${BASE_URL}/api/auth/request-otp`,
      JSON.stringify({ phone }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { endpoint: 'auth_request_otp' },
      },
    )

    const accepted = check(res, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    })

    if (res.status === 429) {
      rateLimitTrend.add(res.timings.waiting)
      check(res, {
        '429 has rate-limit headers': (r) =>
          r.headers['X-RateLimit-Limit'] !== undefined,
      })
    }

    errorRate.add(!accepted)
  })

  sleep(1)
}

export function apiSteady() {
  group('GET /api/finca/F001', () => {
    const res = http.get(`${BASE_URL}/api/finca/F001`, {
      headers: { Authorization: `Bearer ${FAKE_JWT}` },
      tags: { endpoint: 'api_finca_get' },
    })

    const accepted = check(res, {
      'status is 200, 401, 403, or 429': (r) =>
        [200, 401, 403, 429].includes(r.status),
    })

    if (res.status === 429) {
      rateLimitTrend.add(res.timings.waiting)
    }

    errorRate.add(!accepted)
  })

  sleep(1)
}

export function apiSpike() {
  const endpoints = [
    { method: 'GET', path: '/api/finca/F001' },
    { method: 'GET', path: '/api/finca/F001/lotes' },
    { method: 'GET', path: '/api/metricas/F001' },
  ]

  const ep = endpoints[__ITER % endpoints.length]

  const res = http.request(
    ep.method,
    `${BASE_URL}${ep.path}`,
    null,
    {
      headers: { Authorization: `Bearer ${FAKE_JWT}` },
      tags: { endpoint: `spike_${ep.path.replace(/\//g, '_')}` },
    },
  )

  const accepted = check(res, {
    'status is 200, 401, 403, or 429': (r) =>
      [200, 401, 403, 429].includes(r.status),
  })

  if (res.status === 429) {
    rateLimitTrend.add(res.timings.waiting)
    check(res, {
      '429 has rate-limit headers': (r) =>
        r.headers['X-RateLimit-Limit'] !== undefined,
    })
  }

  errorRate.add(!accepted)

  sleep(0.2)
}

export function handleSummary(data) {
  const passed = data.metrics.errors
    ? data.metrics.errors.values.rate < 0.15
    : true

  return {
    stdout: `
===========================================
  Wasagro Rate Limiter Load Test Results
===========================================

  Total requests:  ${data.metrics.iterations ? data.metrics.iterations.values.count : 'N/A'}
  Error rate:      ${data.metrics.errors ? (data.metrics.errors.values.rate * 100).toFixed(2) + '%' : 'N/A'}
  p95 latency:     ${data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'].toFixed(1) + 'ms' : 'N/A'}

  Rate limit TTFB: ${rateLimitTrend.values ? 'avg=' + rateLimitTrend.values.avg.toFixed(1) + 'ms' : 'N/A'}

  429 responses:   ${data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 'N/A'} total reqs

  Overall:         ${passed ? 'PASS ✓' : 'FAIL ✗'}

===========================================
`,
  }
}
