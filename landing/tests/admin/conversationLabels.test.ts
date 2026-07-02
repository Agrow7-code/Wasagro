import { describe, expect, it } from 'vitest'
import { attentionLabel } from '../../src/admin/conversationLabels'

describe('attentionLabel', () => {
  it('returns the human-request label when handoff_reason is auto_human_request', () => {
    expect(attentionLabel({ handoff_status: 'human_paused', handoff_reason: 'auto_human_request' })).toBe(
      'Pidió hablar con una persona',
    )
  })

  it('returns the manual-pause label for any other reason', () => {
    expect(attentionLabel({ handoff_status: 'human_paused', handoff_reason: 'manual' })).toBe(
      'En pausa — la tomaste vos',
    )
  })

  it('returns null when handoff_status is bot', () => {
    expect(attentionLabel({ handoff_status: 'bot', handoff_reason: null })).toBeNull()
  })
})
