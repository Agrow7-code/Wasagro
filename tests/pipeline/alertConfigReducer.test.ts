/**
 * T3.3 — Tests for reduceAlertConfig pure reducer.
 * Design: §4.4 — one campo per turn, numeric validation, opt-out, abort after 1 re-ask.
 *
 * Actions:
 *   ask_next   — collected current_campo, move to next pending
 *   persist    — all campos collected, carries upsertPayload
 *   clarify    — non-numeric reply, re-prompt (turn++)
 *   abort      — second non-numeric reply → close session, no persist
 *   opted_out  — opt-out keyword → upsert enabled=false
 */
import { describe, it, expect } from 'vitest'
import { reduceAlertConfig, type PendingAlertConfigCtx, type ReducerResult } from '../../src/pipeline/handlers/alertConfigReducer.js'

function baseCtx(overrides: Partial<PendingAlertConfigCtx> = {}): PendingAlertConfigCtx {
  return {
    pest_type: 'sigatoka_negra',
    finca_id: 'F001',
    org_id: 'ORG001',
    pending_campos: ['ee3a6Severo', 'ee2Avanzado', 'hojasFuncionalesMin'],
    collected: {},
    current_campo: 'ee3a6Severo',
    turn: 0,
    ...overrides,
  }
}

describe('reduceAlertConfig', () => {
  it('numeric reply sets collected[current_campo] → ask_next for next campo', () => {
    const ctx = baseCtx({ pending_campos: ['ee3a6Severo', 'ee2Avanzado'], current_campo: 'ee3a6Severo' })
    const result: ReducerResult = reduceAlertConfig(ctx, '15')
    expect(result.action).toBe('ask_next')
    expect(result.ctx.collected['ee3a6Severo']).toBe(15)
    expect(result.ctx.current_campo).toBe('ee2Avanzado')
    // pending_campos shrinks
    expect(result.ctx.pending_campos).toEqual(['ee2Avanzado'])
  })

  it('numeric reply on last campo → persist action with upsertPayload', () => {
    const ctx = baseCtx({
      pending_campos: ['hojasFuncionalesMin'],
      current_campo: 'hojasFuncionalesMin',
      collected: { ee3a6Severo: 15, ee2Avanzado: 8 },
    })
    const result: ReducerResult = reduceAlertConfig(ctx, '7')
    expect(result.action).toBe('persist')
    expect(result.upsertPayload).toBeDefined()
    expect(result.upsertPayload).toHaveLength(3)
    const campos = result.upsertPayload!.map(r => r.campo)
    expect(campos).toContain('ee3a6Severo')
    expect(campos).toContain('ee2Avanzado')
    expect(campos).toContain('hojasFuncionalesMin')
    // Values stored correctly
    const hojas = result.upsertPayload!.find(r => r.campo === 'hojasFuncionalesMin')
    expect(hojas?.valor).toBe(7)
  })

  it('non-numeric reply on first attempt → clarify action, turn incremented', () => {
    const ctx = baseCtx({ turn: 0 })
    const result = reduceAlertConfig(ctx, 'no sé')
    expect(result.action).toBe('clarify')
    expect(result.ctx.turn).toBe(1)
    // current_campo unchanged
    expect(result.ctx.current_campo).toBe('ee3a6Severo')
  })

  it('non-numeric reply on second attempt (turn=1) → abort', () => {
    const ctx = baseCtx({ turn: 1 })
    const result = reduceAlertConfig(ctx, 'tampoco sé')
    expect(result.action).toBe('abort')
  })

  it('opt-out keyword mid-flow → opted_out action', () => {
    const ctx = baseCtx()
    const result = reduceAlertConfig(ctx, 'no quiero alertas')
    expect(result.action).toBe('opted_out')
  })

  it('opt-out keyword variation "desactivar" → opted_out', () => {
    const ctx = baseCtx()
    const result = reduceAlertConfig(ctx, 'desactivar')
    expect(result.action).toBe('opted_out')
  })

  it('entry resets turn=0 (M11) — turn in ctx starts at 0', () => {
    // This is enforced by the CALLER opening the session with turn=0
    // The reducer preserves turn semantics:
    const ctx = baseCtx({ turn: 0 })
    const result = reduceAlertConfig(ctx, 'abc')
    expect(result.ctx.turn).toBe(1) // after one non-numeric, turn becomes 1
  })

  it('negative numeric → clarify (not positive-finite)', () => {
    const ctx = baseCtx({ turn: 0 })
    const result = reduceAlertConfig(ctx, '-5')
    expect(result.action).toBe('clarify')
  })

  it('zero → clarify (valor must be positive)', () => {
    const ctx = baseCtx({ turn: 0 })
    const result = reduceAlertConfig(ctx, '0')
    expect(result.action).toBe('clarify')
  })

  it('decimal numeric → accepted (15.5 is valid)', () => {
    const ctx = baseCtx({ pending_campos: ['ee3a6Severo'], current_campo: 'ee3a6Severo' })
    const result = reduceAlertConfig(ctx, '15.5')
    expect(result.action).toBe('persist')
    expect(result.upsertPayload![0]?.valor).toBe(15.5)
  })

  it('persist payload has enabled=true for all campos', () => {
    const ctx = baseCtx({ pending_campos: ['ee3a6Severo'], current_campo: 'ee3a6Severo', collected: {} })
    const result = reduceAlertConfig(ctx, '10')
    expect(result.action).toBe('persist')
    for (const row of result.upsertPayload ?? []) {
      expect(row.enabled).toBe(true)
    }
  })

  it('single-campo pest collapses to 1 turn', () => {
    const ctx: PendingAlertConfigCtx = {
      pest_type: 'moniliasis',
      finca_id: 'F001',
      org_id: 'ORG001',
      pending_campos: ['pct_afectado'],
      collected: {},
      current_campo: 'pct_afectado',
      turn: 0,
    }
    const result = reduceAlertConfig(ctx, '20')
    expect(result.action).toBe('persist')
    expect(result.upsertPayload).toHaveLength(1)
  })

  // Fix #8 — upper-bound validation (P1: a typo like 99999 would silence a critical alert)
  it('Fix #8 — percentage campo above 100 → clarify (not accepted)', () => {
    const ctx = baseCtx({ pending_campos: ['ee3a6Severo'], current_campo: 'ee3a6Severo', turn: 0 })
    const result = reduceAlertConfig(ctx, '99999')
    expect(result.action).toBe('clarify')
    expect(result.ctx.turn).toBe(1)
  })

  it('Fix #8 — percentage campo at exactly 100 → accepted (valid boundary)', () => {
    const ctx = baseCtx({ pending_campos: ['ee3a6Severo'], current_campo: 'ee3a6Severo' })
    const result = reduceAlertConfig(ctx, '100')
    expect(result.action).toBe('persist')
    expect(result.upsertPayload![0]?.valor).toBe(100)
  })

  it('Fix #8 — hojasFuncionalesMin above 50 → clarify (count campo, max 50)', () => {
    const ctx: PendingAlertConfigCtx = {
      pest_type: 'sigatoka_negra',
      finca_id: 'F001',
      org_id: 'ORG001',
      pending_campos: ['hojasFuncionalesMin'],
      collected: {},
      current_campo: 'hojasFuncionalesMin',
      turn: 0,
    }
    const result = reduceAlertConfig(ctx, '51')
    expect(result.action).toBe('clarify')
  })

  it('Fix #8 — hojasFuncionalesMin within [1,50] → accepted', () => {
    const ctx: PendingAlertConfigCtx = {
      pest_type: 'sigatoka_negra',
      finca_id: 'F001',
      org_id: 'ORG001',
      pending_campos: ['hojasFuncionalesMin'],
      collected: {},
      current_campo: 'hojasFuncionalesMin',
      turn: 0,
    }
    const result = reduceAlertConfig(ctx, '9')
    expect(result.action).toBe('persist')
    expect(result.upsertPayload![0]?.valor).toBe(9)
  })
})
