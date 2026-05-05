import { useEffect, useState } from 'react'

export interface ResultadoLote {
  loteId:  string
  nombre:  string
  ha:      number
  valor:   number | null
}

export interface MetricaGuardada {
  id:           string
  nombre:       string
  unidad:       string
  formulaTexto: string
  categoria:    string   // 'Plagas' | 'Cosecha' | 'Insumos' | 'Gastos' | 'Labor'
  resultados:   ResultadoLote[]
  creadaEn:     string
}

// ── Mock inicial — métricas que ya tiene la finca ──────────────────────────────

const MOCK: MetricaGuardada[] = [
  {
    id: 'mock-trips',
    nombre: 'Intensidad de trips por hijo',
    unidad: 'trips/hijo',
    formulaTexto: 'Σ(Individuos encontrados) ÷ Σ(Tamaño de muestra)',
    categoria: 'Plagas',
    creadaEn: '2026-04-20',
    resultados: [
      { loteId: 'L1', nombre: 'Lote 1', ha: 2.1, valor: 0.40 },
      { loteId: 'L2', nombre: 'Lote 2', ha: 1.8, valor: 0.15 },
      { loteId: 'L3', nombre: 'Lote 3', ha: 2.4, valor: 0.60 },
      { loteId: 'L4', nombre: 'Lote 4', ha: 1.5, valor: 0.45 },
      { loteId: 'L5', nombre: 'Lote 5', ha: 2.0, valor: 0.25 },
      { loteId: 'L6', nombre: 'Lote 6', ha: 1.9, valor: 0.10 },
      { loteId: 'L7', nombre: 'Lote 7', ha: 2.3, valor: 0.90 },
      { loteId: 'L8', nombre: 'Lote 8', ha: 1.6, valor: 0.20 },
      { loteId: 'L9', nombre: 'Lote 9', ha: 2.0, valor: 0.15 },
    ],
  },
  {
    id: 'mock-rend',
    nombre: 'Rendimiento neto kg/ha',
    unidad: 'kg/ha',
    formulaTexto: 'Σ(Kilos cosechados) ÷ x̄(Cajas cortadas)',
    categoria: 'Cosecha',
    creadaEn: '2026-04-22',
    resultados: [
      { loteId: 'L1', nombre: 'Lote 1', ha: 2.1, valor: 51.7 },
      { loteId: 'L2', nombre: 'Lote 2', ha: 1.8, valor: 56.0 },
      { loteId: 'L3', nombre: 'Lote 3', ha: 2.4, valor: 56.0 },
      { loteId: 'L4', nombre: 'Lote 4', ha: 1.5, valor: 53.6 },
      { loteId: 'L5', nombre: 'Lote 5', ha: 2.0, valor: 52.5 },
      { loteId: 'L6', nombre: 'Lote 6', ha: 1.9, valor: 62.5 },
      { loteId: 'L7', nombre: 'Lote 7', ha: 2.3, valor: 54.4 },
      { loteId: 'L8', nombre: 'Lote 8', ha: 1.6, valor: 53.3 },
      { loteId: 'L9', nombre: 'Lote 9', ha: 2.0, valor: 58.0 },
    ],
  },
]

// ── Store reactivo (pub-sub sin librería externa) ──────────────────────────────

const STORE: MetricaGuardada[] = [...MOCK]
const SUBS  = new Set<() => void>()

export function getMetricas(): MetricaGuardada[] { return [...STORE] }

export function addMetrica(m: MetricaGuardada): void {
  const idx = STORE.findIndex(x => x.id === m.id)
  if (idx >= 0) STORE[idx] = m
  else STORE.unshift(m)
  SUBS.forEach(fn => fn())
}

export function useMetricas(): MetricaGuardada[] {
  const [list, setList] = useState<MetricaGuardada[]>(getMetricas)
  useEffect(() => {
    const handler = () => setList(getMetricas())
    SUBS.add(handler)
    return () => { SUBS.delete(handler) }
  }, [])
  return list
}
