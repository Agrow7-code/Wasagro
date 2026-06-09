export type PlanSegment = 'agricultor' | 'productor' | 'pyme' | 'corporativo' | 'trial' | 'free' | 'starter' | 'enterprise'

export const PRICE_PER_FINCA = 8
export const PRICE_PER_USER = 4

export function getBasePrice(fincas: number, usuarios: number): number {
  if (fincas === 1 && usuarios <= 3) return 10
  if (fincas === 1 && usuarios >= 4) return 15
  if (fincas >= 2 && fincas <= 5) return 15
  if (fincas >= 6 && fincas <= 20) return 25
  return 50
}

export function calcularPrecio(fincas: number, usuarios: number): number {
  const base = getBasePrice(fincas, usuarios)
  return base + PRICE_PER_FINCA * fincas + PRICE_PER_USER * usuarios
}

export function getSegmentLabel(fincas: number, usuarios: number): string {
  if (fincas === 1 && usuarios <= 3) return 'Agricultor'
  if (fincas === 1 && usuarios >= 4) return 'Productor'
  if (fincas >= 2 && fincas <= 5) return 'Productor'
  if (fincas >= 6 && fincas <= 20) return 'Pyme / Agroexportadora'
  return 'Corporativo'
}

export function inferPlanSegment(fincas: number, usuarios: number): PlanSegment {
  if (fincas === 1 && usuarios <= 3) return 'agricultor'
  if (fincas <= 5) return 'productor'
  if (fincas <= 20) return 'pyme'
  return 'corporativo'
}

export const PAID_PLANS: PlanSegment[] = ['agricultor', 'productor', 'pyme', 'corporativo', 'starter', 'enterprise']

export function isPaidPlan(plan: string): boolean {
  return (PAID_PLANS as string[]).includes(plan)
}
