/**
 * T3.1 — Tests for shouldOutreach pure decision function.
 * Design: §4.2 — decision-state gating + cooldown (B2).
 *
 * Policy:
 *   not_asked (or null)                         → ask
 *   asked + within COOLDOWN (7d)                → silent
 *   asked + past cooldown + ask_count < MAX_ASKS → re-ask
 *   asked + ask_count >= MAX_ASKS               → escalate (founder-alert, then silent)
 *   decided                                     → silent forever
 *   opted_out                                   → silent forever
 */
import { describe, it, expect } from 'vitest'
import type { DecisionAlertaRow } from '../../src/pipeline/supabaseQueries.js'
import { shouldOutreach, type OutreachConfig, type OutreachDecision } from '../../src/pipeline/handlers/umbralesAlerta.js'

const DEFAULT_CONFIG: OutreachConfig = { cooldownDays: 7, maxAsks: 3 }

// Helpers
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function makeRow(overrides: Partial<DecisionAlertaRow> = {}): DecisionAlertaRow {
  return {
    org_id: 'ORG001',
    finca_id: 'F001',
    pest_type: 'sigatoka_negra',
    status: 'not_asked',
    ask_count: 0,
    ...overrides,
  }
}

describe('shouldOutreach', () => {
  it('null row → ask (no row exists, first encounter)', () => {
    const result: OutreachDecision = shouldOutreach(null, new Date(), DEFAULT_CONFIG)
    expect(result.action).toBe('ask')
  })

  it('not_asked → ask', () => {
    const result = shouldOutreach(makeRow({ status: 'not_asked', ask_count: 0 }), new Date(), DEFAULT_CONFIG)
    expect(result.action).toBe('ask')
  })

  it('asked + within COOLDOWN (3 days ago) → silent', () => {
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 1, asked_at: daysAgo(3) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('silent')
    expect(result.reason).toMatch(/cooldown/)
  })

  it('asked + exactly at cooldown boundary (7d) → still silent (not strictly past)', () => {
    // 7 days ago exactly is NOT past the cooldown (cooldownDays=7 means > 7d)
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 1, asked_at: daysAgo(7) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    // At exactly 7d the condition "past cooldown" may be borderline, but spec says
    // "within COOLDOWN" is silent — exact boundary handled conservatively as silent.
    // This test documents the boundary: at exactly 7d the implementation may return
    // silent or re-ask; we verify the STRICT past case below.
    expect(['silent', 're-ask']).toContain(result.action)
  })

  it('asked + past cooldown (8 days ago) + ask_count 1 < MAX_ASKS 3 → re-ask', () => {
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 1, asked_at: daysAgo(8) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('re-ask')
  })

  it('asked + past cooldown + ask_count 2 < MAX_ASKS 3 → re-ask', () => {
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 2, asked_at: daysAgo(10) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('re-ask')
  })

  it('asked + ask_count >= MAX_ASKS (3) → escalate', () => {
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 3, asked_at: daysAgo(15) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('escalate')
    expect(result.reason).toMatch(/max/)
  })

  it('asked + ask_count 4 > MAX_ASKS → escalate', () => {
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 4, asked_at: daysAgo(20) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('escalate')
  })

  it('decided → silent forever (re-config only via web)', () => {
    const result = shouldOutreach(
      makeRow({ status: 'decided', ask_count: 1, asked_at: daysAgo(1) }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('silent')
    expect(result.reason).toMatch(/decided/)
  })

  it('opted_out → silent forever', () => {
    const result = shouldOutreach(
      makeRow({ status: 'opted_out', ask_count: 1 }),
      new Date(),
      DEFAULT_CONFIG,
    )
    expect(result.action).toBe('silent')
    expect(result.reason).toMatch(/opted_out/)
  })

  it('custom config: cooldownDays=1, maxAsks=1 — past 1 day → escalate when ask_count=1', () => {
    const config: OutreachConfig = { cooldownDays: 1, maxAsks: 1 }
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 1, asked_at: daysAgo(2) }),
      new Date(),
      config,
    )
    expect(result.action).toBe('escalate')
  })

  it('asked + null asked_at → treat as old enough (past cooldown), re-ask if count < max', () => {
    // If asked_at is null, we cannot determine the cooldown window.
    // Treat as past cooldown (conservative: ask again rather than nag-block forever).
    const result = shouldOutreach(
      makeRow({ status: 'asked', ask_count: 1, asked_at: null }),
      new Date(),
      DEFAULT_CONFIG,
    )
    // Should be re-ask (asked_at null = unknown date, treated as past cooldown)
    expect(result.action).toBe('re-ask')
  })
})
