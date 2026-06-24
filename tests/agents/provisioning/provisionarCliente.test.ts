import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabaseQueries before importing the module under test
vi.mock('../../../src/pipeline/supabaseQueries.js', () => ({
  getUserByPhone: vi.fn(),
  provisionarClienteAtomico: vi.fn(),
}))

import {
  provisionarCliente,
  type ProvisionInput,
  type ProvisionDeps,
} from '../../../src/agents/provisioning/provisionarCliente.js'
import {
  getUserByPhone,
  provisionarClienteAtomico,
} from '../../../src/pipeline/supabaseQueries.js'

// ─── Typed mock helpers ──────────────────────────────────────────────────────

const mockGetUserByPhone = vi.mocked(getUserByPhone)
const mockProvisionarClienteAtomico = vi.mocked(provisionarClienteAtomico)

// ─── Base input fixture ──────────────────────────────────────────────────────

function baseInput(overrides: Partial<ProvisionInput> = {}): ProvisionInput {
  return {
    nombreOrg: 'Bananera San Marcos',
    pais: 'EC',
    tipoOrg: 'empresa',
    telefonoAdmin: '+593987654321',
    nombreAdmin: 'Carlos López',
    cultivoPrincipal: 'banano',
    fincasContratadas: 1,
    usuariosContratados: 1,
    consentTexto: 'Acepto los términos de uso de Wasagro v1.',
    ...overrides,
  }
}

const testDeps: ProvisionDeps = { client: {} as any }

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('provisionarCliente — happy path', () => {
  it('calls provisionarClienteAtomico when phone does not exist and returns yaExistia=false', async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG002', usuarioId: 'uuid-admin-1' })

    const result = await provisionarCliente(baseInput(), testDeps)

    expect(result).toEqual({
      orgId: 'ORG002',
      usuarioId: 'uuid-admin-1',
      yaExistia: false,
    })
    expect(mockProvisionarClienteAtomico).toHaveBeenCalledOnce()
  })

  it('passes correct args to provisionarClienteAtomico (matching ProvisionarClienteAtomicoArgs shape)', async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG003', usuarioId: 'uuid-admin-2' })

    const input = baseInput()
    await provisionarCliente(input, testDeps)

    const [args, client] = mockProvisionarClienteAtomico.mock.calls[0]!
    // p_org_id must NOT be present (generated inside RPC)
    expect(args).not.toHaveProperty('p_org_id')
    expect(args.p_nombre_org).toBe(input.nombreOrg)
    expect(args.p_pais).toBe(input.pais)
    expect(args.p_phone).toBe(input.telefonoAdmin)
    expect(args.p_nombre_admin).toBe(input.nombreAdmin)
    expect(args.p_consent_texto).toBe(input.consentTexto)
    expect(args.p_fincas).toBe(input.fincasContratadas ?? 1)
    expect(args.p_usuarios).toBe(input.usuariosContratados ?? 1)
    // tipo_org maps 'empresa' → 'empresa' (valid enum value)
    expect(args.p_tipo).toBe('empresa')
    // client is forwarded
    expect(client).toBe(testDeps.client)
  })

  it("maps tipoOrg 'cooperativa' to 'empresa' (unsupported enum value falls back)", async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG004', usuarioId: 'uuid-admin-3' })

    await provisionarCliente(baseInput({ tipoOrg: 'cooperativa' }), testDeps)

    const [args] = mockProvisionarClienteAtomico.mock.calls[0]!
    expect(args.p_tipo).toBe('empresa')
  })

  it("maps tipoOrg 'individual' → 'individual' (valid pass-through)", async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG005', usuarioId: 'uuid-admin-4' })

    await provisionarCliente(baseInput({ tipoOrg: 'individual' }), testDeps)

    const [args] = mockProvisionarClienteAtomico.mock.calls[0]!
    expect(args.p_tipo).toBe('individual')
  })
})

// ─── tipoOrg undefined default ───────────────────────────────────────────────

describe('provisionarCliente — tipoOrg mapping', () => {
  it("maps tipoOrg undefined (omitted) to 'empresa'", async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG010', usuarioId: 'uuid-admin-10' })

    // Omit tipoOrg entirely — should not throw and should default to 'empresa'
    const input = baseInput()
    delete (input as Partial<ProvisionInput>).tipoOrg
    await provisionarCliente(input, testDeps)

    const [args] = mockProvisionarClienteAtomico.mock.calls[0]!
    expect(args.p_tipo).toBe('empresa')
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('provisionarCliente — idempotency (phone already exists)', () => {
  const existingUser = {
    id: 'uuid-existing',
    phone: '+593987654321',
    nombre: 'Carlos López',
    rol: 'admin_org',
    org_id: 'ORG001',
    finca_id: null,
    email: null,
    onboarding_completo: false,
    consentimiento_datos: true,
    status: 'activo',
  }

  it('returns existing orgId/usuarioId with yaExistia=true when phone is found', async () => {
    mockGetUserByPhone.mockResolvedValue(existingUser)

    const result = await provisionarCliente(baseInput(), testDeps)

    expect(result).toEqual({
      orgId: 'ORG001',
      usuarioId: 'uuid-existing',
      yaExistia: true,
    })
  })

  it('does NOT call provisionarClienteAtomico when phone already exists', async () => {
    mockGetUserByPhone.mockResolvedValue(existingUser)

    await provisionarCliente(baseInput(), testDeps)

    expect(mockProvisionarClienteAtomico).not.toHaveBeenCalled()
  })

  it('does NOT call provisionarClienteAtomico on re-run (consent not duplicated)', async () => {
    mockGetUserByPhone.mockResolvedValue(existingUser)

    // Two consecutive calls with the same phone
    await provisionarCliente(baseInput(), testDeps)
    await provisionarCliente(baseInput(), testDeps)

    // The RPC (which also inserts consent) must never be called
    expect(mockProvisionarClienteAtomico).not.toHaveBeenCalled()
  })
})

// ─── Orphan user (exists in DB but org_id is null) ───────────────────────────

describe('provisionarCliente — orphan user (phone exists, org_id is null)', () => {
  const orphanUser = {
    id: 'uuid-orphan',
    phone: '+593987654321',
    nombre: 'Carlos López',
    rol: 'admin_org',
    org_id: null as unknown as string, // anomalous DB state: user without org
    finca_id: null,
    email: null,
    onboarding_completo: false,
    consentimiento_datos: false,
    status: 'activo',
  }

  it("rejects with 'orphan_user_no_org' when getUserByPhone returns a row with null org_id", async () => {
    mockGetUserByPhone.mockResolvedValue(orphanUser)

    await expect(
      provisionarCliente(baseInput(), testDeps),
    ).rejects.toThrow('orphan_user_no_org')
  })

  it('does NOT call provisionarClienteAtomico for an orphan user (no double-provisioning)', async () => {
    mockGetUserByPhone.mockResolvedValue(orphanUser)

    await expect(provisionarCliente(baseInput(), testDeps)).rejects.toThrow()
    expect(mockProvisionarClienteAtomico).not.toHaveBeenCalled()
  })

  it('includes the phone number in the orphan error message for human intervention', async () => {
    mockGetUserByPhone.mockResolvedValue(orphanUser)

    await expect(
      provisionarCliente(baseInput(), testDeps),
    ).rejects.toThrow('+593987654321')
  })
})

// ─── getUserByPhone throws ────────────────────────────────────────────────────

describe('provisionarCliente — getUserByPhone throws', () => {
  it('propagates DB error from getUserByPhone (does not swallow into false idempotency)', async () => {
    const dbError = new Error('connection timeout')
    mockGetUserByPhone.mockRejectedValue(dbError)

    await expect(
      provisionarCliente(baseInput(), testDeps),
    ).rejects.toThrow('connection timeout')
  })

  it('does NOT call provisionarClienteAtomico when getUserByPhone throws', async () => {
    mockGetUserByPhone.mockRejectedValue(new Error('DB unavailable'))

    await expect(provisionarCliente(baseInput(), testDeps)).rejects.toThrow()
    expect(mockProvisionarClienteAtomico).not.toHaveBeenCalled()
  })
})

// ─── Consent validation ──────────────────────────────────────────────────────

describe('provisionarCliente — consent validation', () => {
  it('rejects with consent_required when consentTexto is empty string', async () => {
    await expect(
      provisionarCliente(baseInput({ consentTexto: '' }), testDeps),
    ).rejects.toThrow('consent_required')
    expect(mockGetUserByPhone).not.toHaveBeenCalled()
    expect(mockProvisionarClienteAtomico).not.toHaveBeenCalled()
  })

  it('rejects with consent_required when consentTexto is whitespace only', async () => {
    await expect(
      provisionarCliente(baseInput({ consentTexto: '   ' }), testDeps),
    ).rejects.toThrow('consent_required')
    expect(mockProvisionarClienteAtomico).not.toHaveBeenCalled()
  })

  it('rejects before any DB call (getUserByPhone not called on consent failure)', async () => {
    await expect(
      provisionarCliente(baseInput({ consentTexto: '' }), testDeps),
    ).rejects.toThrow()

    // Must reject synchronously before any async DB call
    expect(mockGetUserByPhone).not.toHaveBeenCalled()
  })
})

// ─── Seed best-effort ────────────────────────────────────────────────────────

describe('provisionarCliente — seed best-effort', () => {
  it('resolves successfully even when seed helper throws', async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG006', usuarioId: 'uuid-admin-5' })

    const seedSpy = vi.fn().mockRejectedValue(new Error('DB timeout'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await provisionarCliente(baseInput(), {
      ...testDeps,
      seedMetricasPlantilla: seedSpy,
    })

    expect(result.yaExistia).toBe(false)
    expect(result.orgId).toBe('ORG006')
    consoleSpy.mockRestore()
  })

  it('logs the seed error with the actual error object via console.error (P4 — not a silent swallow)', async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG007', usuarioId: 'uuid-admin-6' })

    const seedError = new Error('seed failed — metricas insert conflict')
    const seedSpy = vi.fn().mockRejectedValue(seedError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await provisionarCliente(baseInput(), {
      ...testDeps,
      seedMetricasPlantilla: seedSpy,
    })

    // Must log the actual error, not just call console.error with no args (P4: logged with content)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[provisionarCliente]'),
      seedError,
    )
    consoleSpy.mockRestore()
  })

  it('skips seed when seedMetricasPlantilla is not provided (PR-D not implemented)', async () => {
    mockGetUserByPhone.mockResolvedValue(null)
    mockProvisionarClienteAtomico.mockResolvedValue({ orgId: 'ORG008', usuarioId: 'uuid-admin-7' })

    // No seedMetricasPlantilla in deps — should not throw
    const result = await provisionarCliente(baseInput(), testDeps)
    expect(result.orgId).toBe('ORG008')
  })
})
