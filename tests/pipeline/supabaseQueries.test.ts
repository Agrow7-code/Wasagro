import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/integrations/supabase.js', () => ({
  supabase: {},
}))

import {
  getMensajeByWamid,
  registrarMensaje,
  actualizarMensaje,
  getUserByPhone,
  getLotesByFinca,
  getOrCreateSession,
  saveEvento,
  getEventosRevisionSigatoka,
  getEventoSigatokaById,
  createSDRProspecto,
  getSDRProspecto,
  getSDRProspectosPendingApproval,
  updateFincaCoordenadas,
  // provisioning entry point — org_id generation + org/admin/consent are atomic inside the RPC
  provisionarClienteAtomico,
  // trial + farm-seed helpers (PR-D)
  startTrial,
  // T1.11/T1.12 — configurable alert thresholds persistence
  getUmbralesAlerta,
  upsertUmbralAlerta,
  getDecisionMakersByOrg,
  getDecisionAlerta,
  upsertDecisionAlerta,
  // Fix 5 (remediation) — idempotency guard for pest alert delivery
  markAlertaEntregada,
} from '../../src/pipeline/supabaseQueries.js'

function crearThenable(result: unknown) {
  const obj: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  }
  obj['then'] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return obj
}

function crearSupabaseMock() {
  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  }
  return { from: vi.fn().mockReturnValue(chainMethods), _chain: chainMethods }
}

describe('supabaseQueries', () => {
  describe('getMensajeByWamid', () => {
    it('retorna null si no existe el wamid', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })

      const result = await getMensajeByWamid('wamid.XYZ', mock as any)
      expect(result).toBeNull()
    })

    it('retorna el mensaje si existe', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: { id: 'uuid-1', wa_message_id: 'wamid.XYZ', status: 'processed' }, error: null })

      const result = await getMensajeByWamid('wamid.XYZ', mock as any)
      expect(result?.id).toBe('uuid-1')
    })

    it('lanza error si Supabase devuelve error', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: new Error('DB error') })

      await expect(getMensajeByWamid('wamid.XYZ', mock as any)).rejects.toThrow('DB error')
    })
  })

  describe('getUserByPhone', () => {
    it('retorna usuario cuando existe', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({
        data: { id: 'usr-1', phone: '593987654321', onboarding_completo: true, finca_id: 'F001' },
        error: null,
      })

      const result = await getUserByPhone('593987654321', mock as any)
      expect(result?.id).toBe('usr-1')
      expect(result?.finca_id).toBe('F001')
    })
  })

  describe('getLotesByFinca', () => {
    it('retorna lista de lotes', async () => {
      const lotes = [{ lote_id: 'F001-L01', finca_id: 'F001', nombre_coloquial: 'El de arriba', hectareas: 2.5 }]
      const thenable = crearThenable({ data: lotes, error: null })
      const mockFinal = { from: vi.fn().mockReturnValue(thenable) }

      const result = await getLotesByFinca('F001', mockFinal as any)
      expect(result).toHaveLength(1)
      expect(result[0]?.lote_id).toBe('F001-L01')
    })
  })

  describe('saveEvento', () => {
    it('retorna el UUID del evento creado', async () => {
      const mock = crearSupabaseMock()
      mock._chain.single.mockResolvedValue({ data: { id: 'evt-uuid-1' }, error: null })

      const id = await saveEvento({
        finca_id: 'F001',
        tipo_evento: 'insumo',
        status: 'complete',
        datos_evento: { producto: 'mancozeb' },
        descripcion_raw: 'Apliqué mancozeb',
        confidence_score: 0.9,
      }, mock as any)

      expect(id).toBe('evt-uuid-1')
    })
  })

  describe('registrarMensaje', () => {
    it('retorna el UUID del mensaje creado', async () => {
      const mock = crearSupabaseMock()
      mock._chain.single.mockResolvedValue({ data: { id: 'msg-uuid-1' }, error: null })

      const id = await registrarMensaje({
        wa_message_id: 'wamid.ABC',
        phone: '593987654321',
        tipo_mensaje: 'text',
        contenido_raw: 'hola',
      }, mock as any)

      expect(id).toBe('msg-uuid-1')
    })
  })

  describe('getOrCreateSession', () => {
    it('retorna sesión activa existente si la hay', async () => {
      const existingSession = { session_id: 'ses-1', phone: '593987654321', tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {}, status: 'active', finca_id: null, paso_onboarding: null }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: existingSession, error: null })

      const result = await getOrCreateSession('593987654321', 'reporte', mock as any)
      expect(result.session_id).toBe('ses-1')
    })

    it('crea nueva sesión si no hay activa', async () => {
      const newSession = { session_id: 'ses-2', phone: '593987654321', tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: {}, status: 'active', finca_id: null, paso_onboarding: null }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })
      mock._chain.single.mockResolvedValue({ data: newSession, error: null })

      const result = await getOrCreateSession('593987654321', 'reporte', mock as any)
      expect(result.session_id).toBe('ses-2')
    })

    it('resume sesiones en CUALQUIER estado no terminal, no solo active (bug pending_*)', async () => {
      // Regresión: el filtro enumeraba ['active','pending_confirmation'] y dejaba
      // afuera pending_location_confirm / pending_excel_confirm / pending_sigatoka_aclaracion,
      // creando una sesión nueva vacía y perdiendo el flujo. Debe excluir solo 'completed'.
      const pendingSession = { session_id: 'ses-3', phone: '593987654321', tipo_sesion: 'reporte', clarification_count: 0, contexto_parcial: { sigatoka_evento_id: 'evt-1' }, status: 'pending_sigatoka_aclaracion', finca_id: null, paso_onboarding: null }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: pendingSession, error: null })

      const result = await getOrCreateSession('593987654321', 'reporte', mock as any)

      expect(result.session_id).toBe('ses-3')
      expect(mock._chain.neq).toHaveBeenCalledWith('status', 'completed')
    })
  })

  describe('getEventosRevisionSigatoka', () => {
    it('filtra por finca, requires_review y tipo_documento sigatoka', async () => {
      const eventos = [{ id: 'e1', created_at: '2026-06-08', datos_evento: { tipo_documento: 'muestreo_sigatoka_banano' }, imagen_path: 'F001/a.jpg', confidence_score: 0.5 }]
      const thenable = crearThenable({ data: eventos, error: null })
      const mock = { from: vi.fn().mockReturnValue(thenable) }

      const result = await getEventosRevisionSigatoka('F001', mock as any)

      expect(result).toHaveLength(1)
      expect((thenable['eq'] as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('status', 'requires_review')
      expect((thenable['eq'] as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('datos_evento->>tipo_documento', 'muestreo_sigatoka_banano')
    })

    it('devuelve [] cuando no hay eventos', async () => {
      const thenable = crearThenable({ data: null, error: null })
      const mock = { from: vi.fn().mockReturnValue(thenable) }
      expect(await getEventosRevisionSigatoka('F001', mock as any)).toEqual([])
    })
  })

  describe('getEventoSigatokaById', () => {
    it('devuelve el evento con finca_id para authz', async () => {
      const ev = { id: 'e1', finca_id: 'F001', status: 'requires_review', created_at: 'x', datos_evento: {}, imagen_path: null, confidence_score: 0.4 }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: ev, error: null })

      const result = await getEventoSigatokaById('e1', mock as any)
      expect(result?.finca_id).toBe('F001')
    })

    it('devuelve null cuando no existe', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })
      expect(await getEventoSigatokaById('nope', mock as any)).toBeNull()
    })
  })

  describe('actualizarMensaje', () => {
    it('llama update sin error', async () => {
      const thenable = crearThenable({ error: null })
      const mockFinal = { from: vi.fn().mockReturnValue(thenable) }

      await expect(actualizarMensaje('msg-1', { status: 'processed' }, mockFinal as any)).resolves.toBeUndefined()
    })
  })
})

// ─── provisioning ─────────────────────────────────────────────────────────────
// org_id generation + org/admin/consent creation are atomic inside the RPC
// (advisory lock, single transaction). The TS surface exposes only the RPC wrapper.
describe('provisioning helpers', () => {
  describe('provisionarClienteAtomico', () => {
    it('llama rpc sin p_org_id (generado internamente) y retorna el UUID del admin', async () => {
      // Fix 4: p_org_id is no longer a caller argument — the RPC generates it atomically.
      const adminUuid = 'b1c2d3e4-0000-0000-0000-000000000001'
      const rpcMock = vi.fn().mockResolvedValue({ data: { usuario_id: adminUuid, org_id: 'ORG002' }, error: null })
      const mock = { ...crearSupabaseMock(), rpc: rpcMock }

      const args = {
        p_nombre_org: 'Exportadora Test',
        p_tipo: 'empresa' as const,
        p_pais: 'EC',
        p_fincas: 1,
        p_usuarios: 1,
        p_phone: '593987654321',
        p_nombre_admin: 'Carlos López',
        p_consent_texto: 'Acepto los términos de uso de Wasagro.',
      }

      const result = await provisionarClienteAtomico(args, mock as any)

      expect(rpcMock).toHaveBeenCalledWith('provisionar_cliente_atomico', args)
      // Returns both the UUID and the generated org_id
      expect(result.usuarioId).toBe(adminUuid)
      expect(result.orgId).toBe('ORG002')
    })

    it('lanza si rpc devuelve error', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'unique violation' } })
      const mock = { ...crearSupabaseMock(), rpc: rpcMock }

      await expect(provisionarClienteAtomico({
        p_nombre_org: 'Test', p_tipo: 'empresa' as const,
        p_pais: 'EC', p_fincas: 1, p_usuarios: 1,
        p_phone: '593987654321', p_nombre_admin: 'Admin', p_consent_texto: 'texto',
      }, mock as any)).rejects.toThrow('unique violation')
    })
  })
})

// ─── Phase 8: SDR Supabase query tests (REQ-mem coverage) ──────────────────────

describe('SDR supabaseQueries', () => {
  describe('createSDRProspecto', () => {
    it('inserta prospecto con defaults de DB (score_champion=7, score_presupuesto=5 vienen del schema)', async () => {
      const prospectoConDefaults = {
        id: 'uuid-sdr-1',
        phone: '593987654321',
        narrativa_asignada: 'A',
        segmento_icp: 'desconocido',
        score_total: 0,
        score_eudr_urgency: 0,
        score_tamano_cartera: 0,
        score_calidad_dato: 0,
        score_champion: 7,
        score_presupuesto: 5,
        score_timeline_decision: 0,
        status: 'new',
        turns_total: 0,
      }
      const mock = crearSupabaseMock()
      mock._chain.single.mockResolvedValue({ data: prospectoConDefaults, error: null })

      const result = await createSDRProspecto({ phone: '593987654321', narrativa_asignada: 'A' }, mock as any)

      // should NOT explicitly override the DB defaults
      const insertCall = mock._chain.insert.mock.calls[0][0] as Record<string, unknown>
      expect(insertCall).not.toHaveProperty('score_champion')
      expect(insertCall).not.toHaveProperty('score_presupuesto')

      // should return the DB row including the defaults
      expect(result['score_champion']).toBe(7)
      expect(result['score_presupuesto']).toBe(5)
    })

    it('usa "desconocido" como segmento_icp por defecto', async () => {
      const mock = crearSupabaseMock()
      mock._chain.single.mockResolvedValue({ data: { id: 'uuid-1', phone: '593987654321' }, error: null })

      await createSDRProspecto({ phone: '593987654321', narrativa_asignada: 'B' }, mock as any)

      const insertCall = mock._chain.insert.mock.calls[0][0] as Record<string, unknown>
      expect(insertCall['segmento_icp']).toBe('desconocido')
    })
  })

  describe('getSDRProspecto', () => {
    it('retorna null para número de teléfono desconocido', async () => {
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })

      const result = await getSDRProspecto('5930000000000', mock as any)

      expect(result).toBeNull()
      expect(mock._chain.eq).toHaveBeenCalledWith('phone', '5930000000000')
    })

    it('retorna el prospecto cuando existe', async () => {
      const prospectoExistente = { id: 'uuid-sdr-1', phone: '593987654321', status: 'en_discovery' }
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle.mockResolvedValue({ data: prospectoExistente, error: null })

      const result = await getSDRProspecto('593987654321', mock as any)

      expect(result).toEqual(prospectoExistente)
    })
  })

  describe('getSDRProspectosPendingApproval', () => {
    it('filtra por status qualified y founder_notified_at IS NOT NULL', async () => {
      const pendientes = [
        { id: 'uuid-1', phone: '593111111111', status: 'qualified', founder_notified_at: '2026-04-24T10:00:00Z' },
        { id: 'uuid-2', phone: '593222222222', status: 'qualified', founder_notified_at: '2026-04-24T09:00:00Z' },
      ]
      const mock = crearSupabaseMock()
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['not'] = vi.fn().mockReturnThis()
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['order'] = vi.fn().mockResolvedValue({ data: pendientes, error: null })

      const result = await getSDRProspectosPendingApproval(mock as any)

      expect(mock._chain.eq).toHaveBeenCalledWith('status', 'qualified')
      expect(result).toHaveLength(2)
    })

    it('retorna array vacío cuando no hay prospectos pendientes', async () => {
      const mock = crearSupabaseMock()
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['not'] = vi.fn().mockReturnThis()
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['order'] = vi.fn().mockResolvedValue({ data: [], error: null })

      const result = await getSDRProspectosPendingApproval(mock as any)

      expect(result).toEqual([])
    })
  })

  // ─── startTrial idempotency (Fix 4 — T-15 regression guard) ────────────────
  describe('startTrial', () => {
    it('emite UPDATE con .eq(org_id) y .is(trial_inicio, null) — guarda idempotencia', async () => {
      // This test exercises the REAL startTrial implementation with a mock client.
      // A regression that removes the `.is('trial_inicio', null)` guard MUST fail here.
      const mock = crearSupabaseMock()
      mock._chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      // The chain terminates when the awaitable resolves (no .single()/.maybeSingle()
      // needed — update().eq().is() is the terminal form that resolves via then).
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['is'] = vi.fn().mockResolvedValue({ data: null, error: null })

      await startTrial('ORG002', mock as any)

      // Must call .update with a trial_inicio timestamp
      expect(mock._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ trial_inicio: expect.any(String) }),
      )
      // Must scope to the right org
      expect(mock._chain.eq).toHaveBeenCalledWith('org_id', 'ORG002')
      // CRITICAL: idempotency guard — only update if trial_inicio IS NULL
      const isMock = (mock._chain as Record<string, ReturnType<typeof vi.fn>>)['is']
      expect(isMock).toHaveBeenCalledWith('trial_inicio', null)
    })

    it('lanza si Supabase devuelve error', async () => {
      const mock = crearSupabaseMock()
      ;(mock._chain as Record<string, ReturnType<typeof vi.fn>>)['is'] = vi.fn().mockResolvedValue({ error: { message: 'DB error' } })

      await expect(startTrial('ORG002', mock as any)).rejects.toThrow('DB error')
    })
  })

  describe('updateFincaCoordenadas', () => {
    it('llama rpc con los parámetros correctos', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: null })
      const mock = { ...crearSupabaseMock(), rpc: rpcMock }

      await updateFincaCoordenadas('F001', -1.2345, -79.5678, mock as any)

      expect(rpcMock).toHaveBeenCalledWith('update_finca_coordenadas', {
        p_finca_id: 'F001',
        p_lat: -1.2345,
        p_lng: -79.5678,
      })
    })

    it('lanza error si rpc falla', async () => {
      const rpcMock = vi.fn().mockResolvedValue({ error: { message: 'rpc error' } })
      const mock = { ...crearSupabaseMock(), rpc: rpcMock }

      await expect(updateFincaCoordenadas('F001', -1.2345, -79.5678, mock as any)).rejects.toThrow()
    })
  })
})

// ─── T1.11 — configurable alert thresholds persistence tests ─────────────────

describe('getUmbralesAlerta', () => {
  it('returns combined org-default and per-finca rows for a pest_type', async () => {
    const rows = [
      { org_id: 'ORG001', finca_id: null, pest_type: 'sigatoka_negra', campo: 'ee3a6Severo', valor: 10, enabled: true },
      { org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra', campo: 'ee3a6Severo', valor: 15, enabled: true },
    ]
    const mock = crearSupabaseMock()
    // Simulate the chained query returning rows
    const thenableMock = { ...mock._chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: rows, error: null }).then(resolve) }
    mock.from.mockReturnValue(thenableMock)

    const result = await getUmbralesAlerta('ORG001', 'F001', 'sigatoka_negra', mock as any)
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns org-default (finca_id NULL) rows — SQL NULL-safe via finca_scope OR (Fix 1)', async () => {
    // This test verifies Fix 1: the query uses .or('finca_id.eq.F001,finca_id.is.null')
    // NOT .in('finca_id', ['F001', null]), which would never match NULL rows in SQL.
    const orgDefaultRow = { org_id: 'ORG001', finca_id: null, finca_scope: '*', pest_type: 'sigatoka_negra', campo: 'ee3a6Severo', valor: 10, enabled: true }
    const orMock = vi.fn().mockReturnThis()
    const thenFn = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [orgDefaultRow], error: null }).then(resolve)
    const chainMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: orMock,
      then: thenFn,
    }
    const mock = { from: vi.fn().mockReturnValue(chainMock) }

    const result = await getUmbralesAlerta('ORG001', 'F001', 'sigatoka_negra', mock as any)
    // Must have used .or() — not .in('finca_id', ...) which never matches NULLs
    expect(orMock).toHaveBeenCalled()
    const orArg: string = orMock.mock.calls[0][0]
    expect(orArg).toContain('finca_id.is.null')
    // The org-default row IS returned
    expect(result).toHaveLength(1)
    expect(result[0].finca_id).toBeNull()
  })

  it('resolveUmbrales picks per-finca over org-default when both exist', async () => {
    // Verifies the full org-default → per-finca precedence end-to-end
    const { resolveUmbrales } = await import('../../src/pipeline/handlers/umbralesAlerta.js')
    const rows = [
      // org-default: ee3a6Severo at 10
      { id: 'r1', org_id: 'ORG001', finca_id: null, finca_scope: '*', pest_type: 'sigatoka_negra', campo: 'ee3a6Severo', operador: 'gt' as const, valor: 10, enabled: true },
      // per-finca override: ee3a6Severo at 15
      { id: 'r2', org_id: 'ORG001', finca_id: 'F001', finca_scope: 'F001', pest_type: 'sigatoka_negra', campo: 'ee3a6Severo', operador: 'gt' as const, valor: 15, enabled: true },
    ]
    const resolved = resolveUmbrales(rows)
    expect(resolved).not.toBeNull()
    // Per-finca (15) wins over org-default (10)
    expect(resolved!['ee3a6Severo'].valor).toBe(15)
    expect(resolved!['ee3a6Severo'].source).toBe('finca')
  })

  it('returns empty array when no rows exist (silent path)', async () => {
    const mock = crearSupabaseMock()
    const thenableMock = { ...mock._chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) }
    mock.from.mockReturnValue(thenableMock)

    const result = await getUmbralesAlerta('ORG001', 'F001', 'sigatoka_negra', mock as any)
    expect(result).toEqual([])
  })

  it('throws when Supabase returns an error', async () => {
    const dbError = new Error('DB fail')
    const mock = crearSupabaseMock()
    const thenableMock = {
      ...mock._chain,
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve({ data: null, error: dbError }).then(resolve),
    }
    mock.from.mockReturnValue(thenableMock)

    // getUmbralesAlerta throws when error is truthy
    await expect(getUmbralesAlerta('ORG001', 'F001', 'sigatoka_negra', mock as any)).rejects.toThrow()
  })
})

describe('upsertUmbralAlerta', () => {
  it('calls upsert with named constraint uq_umbrales_alerta_scope (Fix 4 — generated cols need named constraint)', async () => {
    // Fix 4: onConflict must reference the named UNIQUE constraint, not column list,
    // because finca_scope is GENERATED ALWAYS and PostgREST rejects generated cols in onConflict.
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const mock = { from: vi.fn().mockReturnValue({ upsert: upsertMock }) }

    await upsertUmbralAlerta(
      { org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra', campo: 'ee3a6Severo', operador: 'gt', valor: 12, enabled: true },
      mock as any,
    )

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'ORG001', campo: 'ee3a6Severo' }),
      expect.objectContaining({ onConflict: 'uq_umbrales_alerta_scope' }),
    )
  })

  it('throws when Supabase returns an error', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: new Error('conflict') })
    const mock = { from: vi.fn().mockReturnValue({ upsert: upsertMock }) }

    await expect(upsertUmbralAlerta(
      { org_id: 'ORG001', finca_id: null, pest_type: 'moniliasis', campo: 'pct_afectado', operador: 'gt', valor: 20, enabled: true },
      mock as any,
    )).rejects.toThrow()
  })
})

describe('getDecisionMakersByOrg', () => {
  it('returns decision-makers (director/admin_org) with onboarding_completo', async () => {
    const users = [
      { id: 'u1', phone: '593987000001', nombre: 'Director A', rol: 'director' },
      { id: 'u2', phone: '593987000002', nombre: 'Admin B', rol: 'admin_org' },
    ]
    const mock = crearSupabaseMock()
    const thenableMock = { ...mock._chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: users, error: null }).then(resolve) }
    mock.from.mockReturnValue(thenableMock)

    const result = await getDecisionMakersByOrg('ORG001', mock as any)
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns an empty array when no decision-makers exist', async () => {
    const mock = crearSupabaseMock()
    const thenableMock = { ...mock._chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) }
    mock.from.mockReturnValue(thenableMock)

    const result = await getDecisionMakersByOrg('ORG_EMPTY', mock as any)
    expect(result).toEqual([])
  })

  it('deduplicates users by phone', async () => {
    const users = [
      { id: 'u1', phone: '593987000001', nombre: 'Director A', rol: 'director' },
      { id: 'u1b', phone: '593987000001', nombre: 'Director A dup', rol: 'director' },
      { id: 'u2', phone: '593987000002', nombre: 'Admin B', rol: 'admin_org' },
    ]
    const mock = crearSupabaseMock()
    const thenableMock = { ...mock._chain, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: users, error: null }).then(resolve) }
    mock.from.mockReturnValue(thenableMock)

    const result = await getDecisionMakersByOrg('ORG001', mock as any)
    const phones = result.map(r => r.phone)
    expect(phones).toHaveLength(new Set(phones).size)
  })
})

describe('getDecisionAlerta', () => {
  it('returns the decision_alerta row when it exists', async () => {
    const row = { id: 'da-1', org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra', status: 'asked', ask_count: 1, asked_at: new Date().toISOString() }
    const mock = crearSupabaseMock()
    mock._chain.maybeSingle.mockResolvedValue({ data: row, error: null })

    const result = await getDecisionAlerta('ORG001', 'F001', 'sigatoka_negra', mock as any)
    expect(result?.status).toBe('asked')
  })

  it('returns null when no row exists', async () => {
    const mock = crearSupabaseMock()
    mock._chain.maybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getDecisionAlerta('ORG001', 'F001', 'moniliasis', mock as any)
    expect(result).toBeNull()
  })
})

describe('upsertDecisionAlerta', () => {
  it('calls upsert with correct UNIQUE constraint columns', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const mock = { from: vi.fn().mockReturnValue({ upsert: upsertMock }) }

    await upsertDecisionAlerta(
      { org_id: 'ORG001', finca_id: 'F001', pest_type: 'sigatoka_negra', status: 'asked', ask_count: 1, asked_at: new Date().toISOString() },
      mock as any,
    )

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'ORG001', status: 'asked' }),
      expect.objectContaining({ onConflict: 'org_id,finca_id,pest_type' }),
    )
  })
})

// ─── Fix 5 (remediation) — markAlertaEntregada unit tests ────────────────────
// Tests the per-event idempotency guard for pest alert delivery.
// The function does a conditional UPDATE (WHERE alerta_plaga_entregada_at IS NULL):
//   - Row updated (data.length > 0) → returns true (fresh delivery, proceed to send)
//   - Row not updated (data.length = 0, already set) → returns false (skip re-send)
//   - DB error → fail-open returns true (one missed mark beats silently dropping a real alert, P4/P7)

describe('markAlertaEntregada', () => {
  function crearMarkMock() {
    // Chain: .from().update().eq().is().select() → { data, error }
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn(),
    }
    const mock = { from: vi.fn().mockReturnValue(chain), _chain: chain }
    return mock
  }

  it('fresh event (alerta_plaga_entregada_at null) → returns true + issues UPDATE', async () => {
    const mock = crearMarkMock()
    // Simulates one row updated (the event was not yet marked)
    mock._chain.select.mockResolvedValue({ data: [{ id: 'evt-fresh' }], error: null })

    const result = await markAlertaEntregada('evt-fresh', mock as any)

    expect(result).toBe(true)
    // Must issue the UPDATE scoped to the event id
    expect(mock._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ alerta_plaga_entregada_at: expect.any(String) }),
    )
    expect(mock._chain.eq).toHaveBeenCalledWith('id', 'evt-fresh')
    // Must only update rows where alerta_plaga_entregada_at IS NULL (idempotency guard)
    expect(mock._chain.is).toHaveBeenCalledWith('alerta_plaga_entregada_at', null)
  })

  it('already-set (alerta_plaga_entregada_at not null) → returns false (no re-deliver)', async () => {
    const mock = crearMarkMock()
    // UPDATE WHERE IS NULL matched no rows (already marked) → data=[]
    mock._chain.select.mockResolvedValue({ data: [], error: null })

    const result = await markAlertaEntregada('evt-already', mock as any)

    expect(result).toBe(false)
  })

  it('DB error → fail-open returns true (one missed mark beats silent drop, P4/P7)', async () => {
    const mock = crearMarkMock()
    // DB returns error
    mock._chain.select.mockResolvedValue({ data: null, error: { message: 'connection timeout' } })

    const result = await markAlertaEntregada('evt-db-err', mock as any)

    // Fail-open: returns true so the caller proceeds with delivery rather than dropping the alert
    expect(result).toBe(true)
  })
})
