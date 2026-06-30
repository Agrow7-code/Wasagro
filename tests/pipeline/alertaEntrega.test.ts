/**
 * T2.3 / T2.5 / T2.7 — Tests for the alert delivery orchestration.
 * Remediation batch: idempotency (#1), cross-tenant (#4), no-recipients (#5),
 * missing-orgId quarantine (#6), M12 disabled (#3), enviarTexto partial failure (#8).
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

// Helper: minimal admin rows (full AdminRow shape with org_id for cross-tenant check)
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

  // Fix #5 — quarantine with 0 recipients returns alert_sent:false, reason:'no_recipients'
  it('quarantine: no admins AND no decision-makers → alert_sent:false, reason:no_recipients', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    getAdminsByFinca.mockResolvedValue([])
    getDecisionMakersByOrg.mockResolvedValue([])
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moko_bacteriano',
      pest_nombre_comun: 'Moko bacteriano',
      is_quarantine: true,
      campos_extraidos: {},
      traceId: 'trace-q5',
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
    expect(result.reason).toBe('no_recipients')
    expect(sender.calls).toHaveLength(0)
  })

  // Fix #6 — quarantine fires without orgId (finca-scoped delivery)
  it('quarantine fires without orgId — finca-scoped delivery (no getDecisionMakersByOrg called)', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: '', // no org available
      pest_type: 'moko_bacteriano',
      pest_nombre_comun: 'Moko bacteriano',
      is_quarantine: true,
      campos_extraidos: {},
      traceId: 'trace-q6',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    // Should fire to finca admins even without org
    expect(result.alert_sent).toBe(true)
    expect(result.reason).toBe('quarantine')
    // getDecisionMakersByOrg must NOT be called when org_id is empty
    expect(getDecisionMakersByOrg).not.toHaveBeenCalled()
    // Finca admins still receive the alert
    expect(sender.calls.map(c => c.to)).toContain(adminA.phone)
  })

  // Fix #8 — enviarTexto throwing mid-loop: remaining recipients still sent, partial failure reflected
  it('quarantine: enviarTexto throws for first recipient — remaining still sent', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // Two admins, one decision-maker. enviarTexto throws on first call only.
    let callCount = 0
    const throwingSender = {
      calls: [] as Array<{ to: string; msg: string }>,
      enviarTexto: vi.fn(async (to: string, msg: string) => {
        callCount++
        if (callCount === 1) throw new Error('simulated send failure')
        throwingSender.calls.push({ to, msg })
      }),
      enviarTemplate: vi.fn(async () => {}),
    }
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moko_bacteriano',
      pest_nombre_comun: 'Moko bacteriano',
      is_quarantine: true,
      campos_extraidos: {},
      traceId: 'trace-q7',
    }
    const deps: AlertaEntregaDeps = {
      sender: throwingSender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
    }

    // Should not throw despite partial failure
    const result = await entregarAlertaPlaga(ctx, deps)
    // The alert was attempted — partial success still marks alert_sent:true
    expect(result.alert_sent).toBe(true)
    // At least 2 sends were attempted (3 targets: adminA, adminB, dmC); first failed, rest succeeded
    expect(throwingSender.calls.length).toBeGreaterThanOrEqual(2)
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

  // Fix T2.5 dedup: non-quarantine path only calls getAdminsByFinca (not getDecisionMakersByOrg).
  // Dedup test for non-quarantine should only use admins list (design §5 ADR-F).
  it('alert delivery dedupes — same phone appears only once when duplicated in admins list', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // Two admin rows with the same phone (same person with two role records)
    const samePhone = '5930001111'
    getAdminsByFinca.mockResolvedValue([
      { ...adminA, phone: samePhone },
      { ...adminB, phone: samePhone },
    ])
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
    // Non-quarantine path must NOT call getDecisionMakersByOrg (design §5 ADR-F)
    expect(getDecisionMakersByOrg).not.toHaveBeenCalled()
  })

  // Fix #5 — non-quarantine: no admins after org filter → alert_sent:false, reason:no_recipients
  it('no admins after cross-tenant org filter → alert_sent:false, reason:no_recipients', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // Admin belongs to different org (cross-tenant contamination scenario)
    getAdminsByFinca.mockResolvedValue([{ ...adminA, org_id: 'ORG999' }])
    getUmbralesAlerta.mockResolvedValue([
      {
        id: 'r6', org_id: 'ORG001', finca_id: null, finca_scope: '*',
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
      traceId: 'trace-m6',
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
    expect(result.reason).toBe('no_recipients')
    expect(sender.calls).toHaveLength(0)
  })
})

// ─── T2.7 / PR#3b — M12 founder-shadow (NOW ENABLED via decision_alerta.ask_count) ─────────────
// PR#3b: is_first_alert is no longer forced false. It now comes from EventHandler
// reading decision_alerta.ask_count at confirmation time.
// Tests verify the ENABLED behavior: preview fires when founderShadow=true + is_first_alert=true.

describe('T2.7 / PR#3b M12 founder-shadow (enabled from PR#3b)', () => {
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

  // M12 ENABLED: founderShadow=true + is_first_alert=true → founder gets preview.
  it('ALERT_FOUNDER_SHADOW=true + is_first_alert=true → founder preview sent (M12 enabled PR#3b)', async () => {
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
      is_first_alert: true, // set by EventHandler from decision_alerta.ask_count=0
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
    // M12 enabled: founder MUST receive a preview on first alert
    const founderCalls = sender.calls.filter(c => c.to === founderPhone)
    expect(founderCalls).toHaveLength(1)
    expect(founderCalls[0]!.msg).toMatch(/PREVIEW/i)
    // Client admin also receives the alert
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
      founderShadow: false, // flag off → no preview
    }

    await entregarAlertaPlaga(ctx, deps)
    const founderCalls = sender.calls.filter(c => c.to === founderPhone)
    expect(founderCalls).toHaveLength(0)
    expect(sender.calls.filter(c => c.to === adminA.phone).length).toBeGreaterThan(0)
  })

  it('is_first_alert=false → no founder preview even if ALERT_FOUNDER_SHADOW=true', async () => {
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
      is_first_alert: false, // ask_count > 0 → not first alert
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
    // Client still receives the alert
    expect(sender.calls.filter(c => c.to === adminA.phone).length).toBeGreaterThan(0)
  })

  it('is_first_alert=undefined → treated as false, no founder preview', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const founderPhone = '5930009999'
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-s4',
      // is_first_alert omitted (pgBoss path, old extraction, M12 inert)
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

// ─── Idempotency guard (#1) ────────────────────────────────────────────────────

describe('Idempotency guard (#1)', () => {
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
        id: 'r7', org_id: 'ORG001', finca_id: null, finca_scope: '*',
        pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 10, enabled: true,
      },
    ])
  })

  it('markAlertaEntregada returns false → alert skipped (already_sent), no enviarTexto', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const markAlertaEntregada = vi.fn().mockResolvedValue(false) // already marked
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-idem1',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
      markAlertaEntregada,
      eventId: 'evt-001',
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(false)
    expect(result.reason).toBe('already_sent')
    expect(sender.calls).toHaveLength(0)
  })

  it('markAlertaEntregada returns true → alert proceeds normally (fresh delivery)', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    const markAlertaEntregada = vi.fn().mockResolvedValue(true) // fresh
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-idem2',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
      markAlertaEntregada,
      eventId: 'evt-002',
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    expect(result.alert_sent).toBe(true)
    expect(sender.calls.length).toBeGreaterThan(0)
  })

  it('retry simulation: second call with same eventId skips re-send', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // First call: fresh (returns true). Second call (retry): already sent (returns false).
    const markAlertaEntregada = vi.fn()
      .mockResolvedValueOnce(true)   // first call: fresh
      .mockResolvedValueOnce(false)  // second call: already marked
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moniliasis',
      pest_nombre_comun: 'Moniliasis',
      is_quarantine: false,
      campos_extraidos: { pct_afectado: 25 },
      traceId: 'trace-idem3',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca,
      getDecisionMakersByOrg,
      getUmbralesAlerta,
      founderPhone: undefined,
      markAlertaEntregada,
      eventId: 'evt-003',
    }

    const first = await entregarAlertaPlaga(ctx, deps)
    expect(first.alert_sent).toBe(true)

    const retry = await entregarAlertaPlaga(ctx, deps)
    expect(retry.alert_sent).toBe(false)
    expect(retry.reason).toBe('already_sent')

    // enviarTexto called only once across both attempts
    expect(sender.calls).toHaveLength(1)
  })

  it('quarantine bypass ignores idempotency guard (always fires)', async () => {
    const { entregarAlertaPlaga } = await import('../../src/pipeline/alertaEntrega.js')
    // markAlertaEntregada returns false — but quarantine should still fire
    const markAlertaEntregada = vi.fn().mockResolvedValue(false)
    const ctx: AlertaEntregaContext = {
      finca_id: 'F001',
      org_id: 'ORG001',
      pest_type: 'moko_bacteriano',
      pest_nombre_comun: 'Moko bacteriano',
      is_quarantine: true, // bypass
      campos_extraidos: {},
      traceId: 'trace-idem4',
    }
    const deps: AlertaEntregaDeps = {
      sender,
      getAdminsByFinca: vi.fn().mockResolvedValue([adminA]),
      getDecisionMakersByOrg: vi.fn().mockResolvedValue([]),
      getUmbralesAlerta,
      founderPhone: undefined,
      markAlertaEntregada,
      eventId: 'evt-004',
    }

    const result = await entregarAlertaPlaga(ctx, deps)
    // Quarantine always fires regardless of idempotency marker
    expect(result.alert_sent).toBe(true)
    expect(result.reason).toBe('quarantine')
    // markAlertaEntregada must NOT have been called for quarantine (H3/ADR-G)
    expect(markAlertaEntregada).not.toHaveBeenCalled()
  })
})
