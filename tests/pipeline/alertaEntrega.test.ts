/**
 * T2.3 / T2.5 / T2.7 — Tests for the alert delivery orchestration.
 * Written FIRST (TDD RED phase). Covers:
 *   T2.3 — quarantine bypass: alerta_cuarentena pests always fire, no config needed
 *   T2.5 — non-Sigatoka real-time delivery: configured pest crossing threshold → WhatsApp
 *   T2.7 — M12 founder-shadow: first alert per (finca, pest) routed via founder preview
 *
 * Design: §6.2, §6.3, §6.4
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { AdminRow } from '../../src/pipeline/supabaseQueries.js'
import type { DecisionMakerRow } from '../../src/pipeline/supabaseQueries.js'
import type { IWhatsAppSender } from '../../src/integrations/whatsapp/IWhatsAppSender.js'
import type { ResolvedUmbrales } from '../../src/pipeline/handlers/umbralesAlerta.js'

// We test the alertaEntrega module that will be created by T2.4/T2.6/T2.8
// Import with type-safe destructuring — tests fail at RED because the module doesn't exist yet
import type {
  AlertaEntregaContext,
  AlertaEntregaDeps,
  entregarAlertaPlaga,
} from '../../src/pipeline/alertaEntrega.js'

// Helper: minimal IWhatsAppSender mock
function makeSender(): IWhatsAppSender & { calls: Array<{ to: string; msg: string }> } {
  const calls: Array<{ to: string; msg: string }> = []
  return {
    calls,
    enviarTexto: vi.fn(async (to: string, msg: string) => {
      calls.push({ to, msg })
    }) as Mock,
    enviarTemplate: vi.fn(async () => {}),
  }
}

// Helper: minimal admin rows
const adminA: AdminRow = { id: 'u1', phone: '5930001111', nombre: 'Ana', rol: 'administrador', org_id: 'ORG001', finca_id: 'F001', email: null, onboarding_completo: true, consentimiento_datos: true, status: 'active' }
const adminB: AdminRow = { id: 'u2', phone: '5930002222', nombre: 'Bob', rol: 'propietario', org_id: 'ORG001', finca_id: 'F001', email: null, onboarding_completo: true, consentimiento_datos: true, status: 'active' }

const dmC: DecisionMakerRow = { id: 'u3', phone: '5930003333', nombre: 'Carlos', rol: 'admin_org' }

// ─── T2.3 — Quarantine bypass ─────────────────────────────────────────────────

describe('T2.3 quarantine bypass', () => {
  let sender: ReturnType<typeof makeSender>
  let getAdminsByFinca: Mock
  let getDecisionMakersByOrg: Mock
  let getUmbralesAlerta: Mock

  beforeEach(() => {
    sender = makeSender()
    getAdminsByFinca = vi.fn().mockResolvedValue([adminA, adminB])
    getDecisionMakersByOrg = vi.fn().mockResolvedValue([dmC])
    // For quarantine, umbrales table should NOT be consulted
    getUmbralesAlerta = vi.fn().mockResolvedValue([])
  })

  it('quarantine pest fires regardless of umbrales_alerta state', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moko_bacteriano',
      pest_nombre_comun: 'Moko bacteriano',
      is_quarantine: true,
      campos_extraidos: {},
      traceId: 'trace-q1',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(true)
    // Must deliver to both admins AND decision-makers (design §6.3)
    const phones = sender.calls.map(c => c.to)
    expect(phones).toContain(adminA.phone)
    expect(phones).toContain(adminB.phone)
    expect(phones).toContain(dmC.phone)
  })

  it('quarantine pest fires even when no umbrales_alerta row exists', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'mal_de_panama',
      pest_nombre_comun: 'Mal de Panamá',
      is_quarantine: true,
      campos_extraidos: {},
      traceId: 'trace-q2',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(true)
    // getUmbralesAlerta must NOT have been called (quarantine short-circuits before resolver)
    expect(getUmbralesAlerta).not.toHaveBeenCalled()
  })

  it('quarantine fires even when decision_alerta is decided or opted_out', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moko_bacteriano',
      pest_nombre_comun: 'Moko bacteriano',
      is_quarantine: true,
      campos_extraidos: {},
      traceId: 'trace-q3',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(true)
    // No decision_alerta check for quarantine pests — opt-in/out is irrelevant
    expect(result.reason).toBe('quarantine')
  })

  it('non-quarantine pest with no config → silent (no alert, no error)', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    getUmbralesAlerta.mockResolvedValue([]) // no rows → resolveUmbrales returns null
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'trips_de_la_mancha_roja',
      pest_nombre_comun: 'Trips de la mancha roja',
      is_quarantine: false,
      campos_extraidos: { incidencia: 50 },
      traceId: 'trace-q4',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(false)
    expect(result.reason).toBe('unconfigured')
    expect(sender.calls).toHaveLength(0)
  })
})

// ─── T2.5 — Non-Sigatoka real-time delivery ────────────────────────────────────

describe('T2.5 non-Sigatoka delivery', () => {
  let sender: ReturnType<typeof makeSender>
  let getAdminsByFinca: Mock
  let getDecisionMakersByOrg: Mock
  let getUmbralesAlerta: Mock

  beforeEach(() => {
    sender = makeSender()
    getAdminsByFinca = vi.fn().mockResolvedValue([adminA])
    getDecisionMakersByOrg = vi.fn().mockResolvedValue([dmC])
    getUmbralesAlerta = vi.fn()
  })

  it('Moniliasis configured org-default pct_afectado=20 fires when incidencia=22', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // Row: org-default, enabled, gt 20
    getUmbralesAlerta.mockResolvedValue([
      {
        id: 'r1', org_id: 'ORG001', finca_id: null, finca_scope: '*',
        pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 20, enabled: true,
      },
    ])
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      // LLM emits 'incidencia' alias; extractObservation maps it to 'pct_afectado'
      campos_extraidos: { incidencia: 22 },
      traceId: 'trace-m1',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(true)
    expect(result.resolved_threshold).toBe(20)
    expect(sender.calls.length).toBeGreaterThan(0)
    expect(sender.calls.map(c => c.to)).toContain(adminA.phone)
  })

  it('same pest opted-out (enabled=false row) → no alert', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    getUmbralesAlerta.mockResolvedValue([
      {
        id: 'r2', org_id: 'ORG001', finca_id: null, finca_scope: '*',
        pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 20, enabled: false,
      },
    ])
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { incidencia: 22 },
      traceId: 'trace-m2',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(false)
    expect(result.reason).toBe('opted_out')
    expect(sender.calls).toHaveLength(0)
  })

  it('unconfigured pest → silent, no exception', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    getUmbralesAlerta.mockResolvedValue([]) // empty → null resolved
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'nematodos',
      pest_nombre_comun: 'Nematodos',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 60 },
      traceId: 'trace-m3',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    await expect(entregarAlertaPlaga(ctx, deps)).resolves.not.toThrow()
    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(false)
    expect(result.reason).toBe('unconfigured')
    expect(sender.calls).toHaveLength(0)
  })

  it('structured log written with alert_sent, resolved_threshold, finca_id, pest_type', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    getUmbralesAlerta.mockResolvedValue([
      {
        id: 'r3', org_id: 'ORG001', finca_id: null, finca_scope: '*',
        pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 20, enabled: true,
      },
    ])
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-m4',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    // Result contract must include logging fields
    expect(result).toMatchObject({
      alert_sent: true,
      finca_id: 'F001',
      pest_type: 'moniliasis',
      resolved_threshold: 20,
    })
  })

  it('alert delivery dedupes — same phone appears only once even if in admins AND decision-makers', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // Same phone in both admins and decision-makers
    const samePhone = '5930001111'
    getAdminsByFinca.mockResolvedValue([{ ...adminA, phone: samePhone }])
    getDecisionMakersByOrg.mockResolvedValue([{ ...dmC, phone: samePhone }])
    getUmbralesAlerta.mockResolvedValue([
      {
        id: 'r4', org_id: 'ORG001', finca_id: null, finca_scope: '*',
        pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 10, enabled: true,
      },
    ])
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-m5',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    await entregarAlertaPlaga(ctx, deps)
    const callsToSamePhone = sender.calls.filter(c => c.to === samePhone)
    expect(callsToSamePhone).toHaveLength(1)
  })
})

// ─── T2.7 — M12 founder-shadow (first alert per finca+pest) ───────────────────

describe('T2.7 M12 founder-shadow', () => {
  let sender: ReturnType<typeof makeSender>
  let getAdminsByFinca: Mock
  let getDecisionMakersByOrg: Mock
  let getUmbralesAlerta: Mock

  beforeEach(() => {
    sender = makeSender()
    getAdminsByFinca = vi.fn().mockResolvedValue([adminA])
    getDecisionMakersByOrg = vi.fn().mockResolvedValue([])
    getUmbralesAlerta = vi.fn().mockResolvedValue([
      {
        id: 'r5', org_id: 'ORG001', finca_id: null, finca_scope: '*',
        pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 20, enabled: true,
      },
    ])
  })

  it('ALERT_FOUNDER_SHADOW=true + first alert → founder receives preview before client', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const founderPhone = '5930009999'
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-s1',
      is_first_alert: true, // signal that this is the first alert for (finca, pest)
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone,
      founderShadow: true,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(true)
    // Founder should have received a preview message
    const founderCalls = sender.calls.filter(c => c.to === founderPhone)
    expect(founderCalls.length).toBeGreaterThan(0)
    // Client admin should also receive the alert
    const clientCalls = sender.calls.filter(c => c.to === adminA.phone)
    expect(clientCalls.length).toBeGreaterThan(0)
  })

  it('ALERT_FOUNDER_SHADOW falsy → no founder preview, direct to admins', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const founderPhone = '5930009999'
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-s2',
      is_first_alert: true,
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone,
      founderShadow: false, // disabled
    }

    await entregarAlertaPlaga(ctx, deps)
    const founderCalls = sender.calls.filter(c => c.to === founderPhone)
    expect(founderCalls).toHaveLength(0)
    expect(sender.calls.filter(c => c.to === adminA.phone).length).toBeGreaterThan(0)
  })

  it('not first alert → no founder preview even if ALERT_FOUNDER_SHADOW=true', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const founderPhone = '5930009999'
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-s3',
      is_first_alert: false, // not the first alert
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone,
      founderShadow: true,
    }

    await entregarAlertaPlaga(ctx, deps)
    const founderCalls = sender.calls.filter(c => c.to === founderPhone)
    expect(founderCalls).toHaveLength(0)
  })
})
