// SDR funnel scoring (Task B) — emite langfuse.score con value numérico cuando
// el FSM cae en estado terminal. Habilita widgets "conversion rate por modelo /
// prompt version / narrativa" en LangFuse.
//
// Contrato fijado acá:
//   meeting_confirmed → +1 (booked)
//   declined          → -1
//   dormant           →  0
//   in-flight states (pitch_sent, closing, brochure_sent, meeting_proposed,
//                     objection_handling, triage, discovery) → no score
//   reentry al MISMO estado terminal → no score (idempotent)

import { describe, it, expect, vi } from 'vitest'
import { scoreTerminalTransition, isTerminalSDRState } from '../../../src/agents/sdr/outcomeScoring.js'
import type { SDRFsmState } from '../../../src/agents/sdr/context.js'

function makeSink() {
  return { score: vi.fn() }
}

const META = {
  prospectoId: 'p-1',
  phone:       '593987654321',
  narrativa:   'A',
  cultivo:     'cacao',
  segmento:    'exportadora',
  turnCount:   3,
  source:      'router' as const,
}

describe('isTerminalSDRState', () => {
  it('returns true ONLY for meeting_confirmed / declined / dormant', () => {
    expect(isTerminalSDRState('meeting_confirmed')).toBe(true)
    expect(isTerminalSDRState('declined')).toBe(true)
    expect(isTerminalSDRState('dormant')).toBe(true)
  })

  it('returns false for every in-flight state', () => {
    const inflight: SDRFsmState[] = [
      'triage', 'discovery', 'pitch_sent', 'closing',
      'brochure_sent', 'objection_handling', 'meeting_proposed',
    ]
    for (const s of inflight) {
      expect(isTerminalSDRState(s)).toBe(false)
    }
  })
})

describe('scoreTerminalTransition', () => {
  it('emits sdr_outcome=+1 when FSM lands in meeting_confirmed', () => {
    const sink = makeSink()
    const emitted = scoreTerminalTransition(sink, 'meeting_proposed', 'meeting_confirmed', META)
    expect(emitted).toBe(true)
    expect(sink.score).toHaveBeenCalledOnce()
    const call = sink.score.mock.calls[0]![0]
    expect(call.name).toBe('sdr_outcome')
    expect(call.value).toBe(1)
    const comment = JSON.parse(call.comment as string)
    expect(comment).toMatchObject({
      from: 'meeting_proposed',
      to:   'meeting_confirmed',
      prospectoId: 'p-1',
      narrativa:   'A',
      cultivo:     'cacao',
    })
  })

  it('emits sdr_outcome=-1 when FSM lands in declined', () => {
    const sink = makeSink()
    scoreTerminalTransition(sink, 'closing', 'declined', META)
    expect(sink.score.mock.calls[0]![0].value).toBe(-1)
  })

  it('emits sdr_outcome=0 when FSM lands in dormant', () => {
    const sink = makeSink()
    scoreTerminalTransition(sink, 'discovery', 'dormant', META)
    expect(sink.score.mock.calls[0]![0].value).toBe(0)
  })

  it('NO emite cuando el "to" no es terminal', () => {
    const sink = makeSink()
    const emitted = scoreTerminalTransition(sink, 'triage', 'discovery', META)
    expect(emitted).toBe(false)
    expect(sink.score).not.toHaveBeenCalled()
  })

  it('NO emite cuando from === to (reentry, idempotent)', () => {
    const sink = makeSink()
    const emitted = scoreTerminalTransition(sink, 'meeting_confirmed', 'meeting_confirmed', META)
    expect(emitted).toBe(false)
    expect(sink.score).not.toHaveBeenCalled()
  })

  it('idempotency: declined → declined (re-entry on chaser tick) NO emite', () => {
    const sink = makeSink()
    scoreTerminalTransition(sink, 'declined', 'declined', META)
    expect(sink.score).not.toHaveBeenCalled()
  })

  it('idempotency: dormant → dormant (chaser tick repetido) NO emite', () => {
    const sink = makeSink()
    scoreTerminalTransition(sink, 'dormant', 'dormant', META)
    expect(sink.score).not.toHaveBeenCalled()
  })

  it('incluye meta completa en el comment para grouping en widgets', () => {
    const sink = makeSink()
    scoreTerminalTransition(sink, 'pitch_sent', 'declined', {
      ...META,
      source: 'meeting_confirmation',
    })
    const comment = JSON.parse(sink.score.mock.calls[0]![0].comment as string)
    expect(comment.source).toBe('meeting_confirmation')
    expect(comment.segmento).toBe('exportadora')
    expect(comment.turnCount).toBe(3)
  })

  it('acepta meta con campos opcionales en null', () => {
    const sink = makeSink()
    scoreTerminalTransition(sink, 'closing', 'declined', {
      prospectoId: 'p-2',
      phone:       '593900000000',
      narrativa:   null,
      cultivo:     null,
      segmento:    null,
    })
    expect(sink.score).toHaveBeenCalledOnce()
    const comment = JSON.parse(sink.score.mock.calls[0]![0].comment as string)
    expect(comment.narrativa).toBeNull()
  })
})
