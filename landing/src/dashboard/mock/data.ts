export interface KPIData {
  label: string
  value: string
  delta: string
  deltaType: 'positive' | 'negative' | 'neutral'
  source: string
  variant?: 'default' | 'alert' | 'success'
}

export interface Evento {
  id: string
  tipo: 'labor' | 'plaga' | 'cosecha' | 'insumo' | 'clima' | 'gasto'
  titulo: string
  sub: string
  lote: string
  trabajador: string
  hora: string
  fuente: 'voz' | 'texto' | 'imagen'
  estado: 'confirmado' | 'validacion' | 'alerta'
  confianza: number
  nota?: string
}

export interface Lote {
  id: string
  nombre: string
  hectareas: number
  eventos: number
  trend: 'up' | 'stable' | 'down'
  alerta?: string
  sparkData: number[]
  cultivo: string
}

export interface Alerta {
  id: string
  tipo: string
  lote: string
  descripcion: string
  valor: string
  valorColor: 'red' | 'warn'
  hace: string
}

export interface Finca {
  id: string
  nombre: string
  cultivo: string
  hectareas: number
  lotes: number
  eventos: number
  alertas: number
  trabajadores: number
  meta: number
  estado: 'ok' | 'alerta'
  ultimoEvento: string
  alertaDesc?: string
}

export interface LoteTraza {
  id: string
  nombre: string
  finca: string
  cobertura: number
  eventos: number
  selected?: boolean
}

export interface Certificacion {
  id: string
  nombre: string
  emisor: string
  estado: 'vigente' | 'vence' | 'vencida'
  vencimiento: string
}

// ── ADMIN FINCA (Carlos Mendoza · Finca El Progreso) ────────────

export const kpisAdmin: KPIData[] = [
  {
    label: 'Eventos hoy',
    value: '23',
    delta: '+4 vs ayer',
    deltaType: 'positive',
    source: 'Última actualización · 14:31',
  },
  {
    label: 'Eventos esta semana',
    value: '87',
    delta: 'Meta: 5 eventos/día',
    deltaType: 'neutral',
    source: 'Lun–Vie promedio: 17.4/día',
  },
  {
    label: 'Alertas sin resolver',
    value: '2',
    delta: '↑1 desde ayer',
    deltaType: 'negative',
    source: 'Ver detalle →',
    variant: 'alert',
  },
  {
    label: 'Trabajadores activos hoy',
    value: '7/9',
    delta: '2 sin reportar hoy',
    deltaType: 'neutral',
    source: '7 activos · 2 inactivos',
  },
]

export const eventosHoy: Evento[] = [
  {
    id: 'E-2024-0891',
    tipo: 'insumo',
    titulo: 'Aplicación fungicida preventivo',
    sub: 'Lote 3 · 2.5 L/ha · Mancozeb 80%',
    lote: 'Lote 3',
    trabajador: 'J. Caicedo',
    hora: '08:43',
    fuente: 'voz',
    estado: 'confirmado',
    confianza: 97,
  },
  {
    id: 'E-2024-0892',
    tipo: 'plaga',
    titulo: 'Sigatoka amarilla detectada',
    sub: 'Lote 7 · Severidad 3/5 · 0.8 ha afectada',
    lote: 'Lote 7',
    trabajador: 'M. Torres',
    hora: '09:15',
    fuente: 'imagen',
    estado: 'alerta',
    confianza: 91,
    nota: 'Último tratamiento: hace 18 días. Revisar protocolo.',
  },
  {
    id: 'E-2024-0893',
    tipo: 'labor',
    titulo: 'Deshierbe manual completado',
    sub: 'Lote 2 · 3 jornales · 1.2 ha',
    lote: 'Lote 2',
    trabajador: 'R. Quiñonez',
    hora: '10:20',
    fuente: 'texto',
    estado: 'confirmado',
    confianza: 99,
  },
  {
    id: 'E-2024-0894',
    tipo: 'cosecha',
    titulo: 'Cosecha banano – Lote 5',
    sub: 'Lote 5 · 420 kg · 4.2 cajas/planta',
    lote: 'Lote 5',
    trabajador: 'L. Mendoza',
    hora: '11:05',
    fuente: 'voz',
    estado: 'confirmado',
    confianza: 96,
  },
  {
    id: 'E-2024-0895',
    tipo: 'insumo',
    titulo: 'Fertilización foliar',
    sub: 'Lote 4 · 3.0 L/ha · dosis alta',
    lote: 'Lote 4',
    trabajador: 'J. Caicedo',
    hora: '12:30',
    fuente: 'voz',
    estado: 'validacion',
    confianza: 82,
    nota: 'Dosis supera el límite recomendado. Requiere revisión.',
  },
  {
    id: 'E-2024-0896',
    tipo: 'gasto',
    titulo: 'Compra de insumos – almacén',
    sub: 'Lote - · $186 · Fertilizantes + fungicidas',
    lote: '-',
    trabajador: 'C. Mendoza',
    hora: '13:15',
    fuente: 'texto',
    estado: 'confirmado',
    confianza: 100,
  },
]

export const alertas: Alerta[] = [
  {
    id: 'A-001',
    tipo: '⚠ PLAGA · SIGATOKA',
    lote: 'Lote 7',
    descripcion: 'Severidad',
    valor: '3/5',
    valorColor: 'red',
    hace: 'Detectada hace 5h',
  },
  {
    id: 'A-002',
    tipo: '⚠ DOSIS · EXCESO',
    lote: 'Lote 4',
    descripcion: 'Dosis aplicada',
    valor: '3.0 L/ha (+20%)',
    valorColor: 'warn',
    hace: 'Detectada hace 2h',
  },
]

export const lotes: Lote[] = [
  { id: 'L1', nombre: 'Lote 1', hectareas: 2.1, eventos: 12, trend: 'up', sparkData: [3,4,5,3,6,8,5], cultivo: 'Cacao' },
  { id: 'L2', nombre: 'Lote 2', hectareas: 1.8, eventos: 9, trend: 'stable', sparkData: [5,5,4,6,5,5,4], cultivo: 'Cacao' },
  { id: 'L3', nombre: 'Lote 3', hectareas: 2.4, eventos: 14, trend: 'up', sparkData: [2,4,5,6,7,9,10], cultivo: 'Banano' },
  { id: 'L4', nombre: 'Lote 4', hectareas: 1.5, eventos: 11, trend: 'up', alerta: 'DOSIS ALTA', sparkData: [6,7,8,7,9,11,10], cultivo: 'Banano' },
  { id: 'L5', nombre: 'Lote 5', hectareas: 2.0, eventos: 8, trend: 'stable', sparkData: [8,7,6,8,7,9,8], cultivo: 'Banano' },
  { id: 'L6', nombre: 'Lote 6', hectareas: 1.9, eventos: 5, trend: 'down', sparkData: [9,7,6,5,4,5,5], cultivo: 'Cacao' },
  { id: 'L7', nombre: 'Lote 7', hectareas: 2.3, eventos: 16, trend: 'up', alerta: 'SIGATOKA', sparkData: [4,6,8,10,12,14,16], cultivo: 'Banano' },
  { id: 'L8', nombre: 'Lote 8', hectareas: 1.6, eventos: 7, trend: 'stable', sparkData: [6,7,6,7,8,7,7], cultivo: 'Cacao' },
  { id: 'L9', nombre: 'Lote 9', hectareas: 2.0, eventos: 5, trend: 'down', sparkData: [8,7,7,6,5,5,5], cultivo: 'Cacao' },
]

// Events table (last 5 for the table)
export const eventosTabla = eventosHoy.slice(0, 5)

// ── GERENTE AGRICOLA (Roberto Vargas · 3 fincas) ────────────────

export const kpisGerente: KPIData[] = [
  {
    label: 'Eventos totales · semana',
    value: '241',
    delta: '+18 vs semana ant.',
    deltaType: 'positive',
    source: 'Promedio: 80/semana/finca',
  },
  {
    label: 'Fincas activas esta semana',
    value: '3/3',
    delta: 'Todas en operación',
    deltaType: 'positive',
    source: 'Último evento: hace 43 min',
    variant: 'success',
  },
  {
    label: 'Alertas sin resolver',
    value: '5',
    delta: '↑2 vs semana ant.',
    deltaType: 'negative',
    source: '3 fincas afectadas →',
    variant: 'alert',
  },
  {
    label: 'Trabajadores que reportaron',
    value: '24/27',
    delta: '3 sin actividad esta semana',
    deltaType: 'neutral',
    source: '24 activos · 3 inactivos',
  },
]

export const fincas: Finca[] = [
  {
    id: 'F001',
    nombre: 'Finca El Progreso',
    cultivo: 'Cacao + Banano',
    hectareas: 18,
    lotes: 9,
    eventos: 87,
    alertas: 2,
    trabajadores: 9,
    meta: 87,
    estado: 'alerta',
    ultimoEvento: 'hace 1h',
    alertaDesc: '2 alertas activas · Sigatoka, dosis',
  },
  {
    id: 'F002',
    nombre: 'Finca La Esperanza',
    cultivo: 'Banano',
    hectareas: 24,
    lotes: 12,
    eventos: 104,
    alertas: 0,
    trabajadores: 12,
    meta: 96,
    estado: 'ok',
    ultimoEvento: 'hace 43 min',
  },
  {
    id: 'F003',
    nombre: 'Finca San Pedro',
    cultivo: 'Cacao',
    hectareas: 11,
    lotes: 6,
    eventos: 50,
    alertas: 3,
    trabajadores: 6,
    meta: 58,
    estado: 'alerta',
    ultimoEvento: 'hace 6h',
    alertaDesc: '3 alertas · Monilia, registro bajo',
  },
]

// ── EXPORTADORA (AgroExport S.A.) ───────────────────────────────

export const kpisExportadora: KPIData[] = [
  {
    label: 'Fincas proveedoras activas',
    value: '12',
    delta: '+2 vs mes anterior',
    deltaType: 'positive',
    source: 'Ciclo Mayo 2026',
  },
  {
    label: 'Cobertura de trazabilidad',
    value: '78%',
    delta: '+6% vs ciclo anterior',
    deltaType: 'positive',
    source: 'Meta: 90% para auditoría',
    variant: 'success',
  },
  {
    label: 'Fincas con datos incompletos',
    value: '3',
    delta: 'Bloqueantes para auditoría',
    deltaType: 'negative',
    source: 'Ver fincas →',
    variant: 'alert',
  },
  {
    label: 'Lotes con trazabilidad completa',
    value: '64/82',
    delta: '18 pendientes de registro',
    deltaType: 'neutral',
    source: 'Ciclo de exportación activo',
  },
]

export interface FincaProveedora {
  id: string
  nombre: string
  productor: string
  hectareas: number
  cobertura: number
  eventos: number
  alertas: number
  estado: 'completo' | 'parcial' | 'incompleto'
  ultimaActividad: string
}

export const fincasProveedoras: FincaProveedora[] = [
  { id: 'F001', nombre: 'El Progreso', productor: 'Carlos Mendoza', hectareas: 18, cobertura: 92, eventos: 87, alertas: 2, estado: 'completo', ultimaActividad: 'hace 1h' },
  { id: 'F002', nombre: 'La Esperanza', productor: 'Miguel Torres', hectareas: 24, cobertura: 88, eventos: 104, alertas: 0, estado: 'completo', ultimaActividad: 'hace 43 min' },
  { id: 'F003', nombre: 'San Pedro', productor: 'Ana Quiñonez', hectareas: 11, cobertura: 58, eventos: 50, alertas: 3, estado: 'parcial', ultimaActividad: 'hace 6h' },
  { id: 'F004', nombre: 'Finca Hermosa', productor: 'Luis Vargas', hectareas: 15, cobertura: 34, eventos: 28, alertas: 1, estado: 'incompleto', ultimaActividad: 'hace 2 días' },
  { id: 'F005', nombre: 'El Paraíso', productor: 'Rosa Mendoza', hectareas: 20, cobertura: 79, eventos: 91, alertas: 0, estado: 'completo', ultimaActividad: 'hace 2h' },
]

export const lotesTraza: LoteTraza[] = [
  { id: 'L3-F001', nombre: 'Lote 3', finca: 'El Progreso', cobertura: 95, eventos: 14, selected: true },
  { id: 'L7-F001', nombre: 'Lote 7', finca: 'El Progreso', cobertura: 88, eventos: 16 },
  { id: 'L1-F002', nombre: 'Lote 1', finca: 'La Esperanza', cobertura: 100, eventos: 11 },
  { id: 'L5-F002', nombre: 'Lote 5', finca: 'La Esperanza', cobertura: 72, eventos: 8 },
  { id: 'L2-F003', nombre: 'Lote 2', finca: 'San Pedro', cobertura: 45, eventos: 7 },
  { id: 'L4-F003', nombre: 'Lote 4', finca: 'San Pedro', cobertura: 61, eventos: 9 },
  { id: 'L1-F004', nombre: 'Lote 1', finca: 'Finca Hermosa', cobertura: 30, eventos: 5 },
  { id: 'L3-F004', nombre: 'Lote 3', finca: 'Finca Hermosa', cobertura: 38, eventos: 6 },
]

export const certificaciones: Certificacion[] = [
  { id: 'C1', nombre: 'Global G.A.P.', emisor: 'GLOBALG.A.P. · Ciclo 2025–2026', estado: 'vigente', vencimiento: 'Vence 30 Sep 2026' },
  { id: 'C2', nombre: 'Rainforest Alliance', emisor: 'RA-CERT · Ciclo 2025–2026', estado: 'vence', vencimiento: 'Vence 15 Jun 2026' },
  { id: 'C3', nombre: 'Fairtrade', emisor: 'FLO-CERT · Ciclo 2024–2025', estado: 'vencida', vencimiento: 'Venció 28 Feb 2026' },
]

// ── AGRICULTOR INDIVIDUAL (Juan Caicedo) ─────────────────────────

export interface HistorialEvento {
  id: string
  tipo: Evento['tipo']
  titulo: string
  sub: string
  hora: string
  fuente: 'voz' | 'texto' | 'imagen'
  confianza: number
}

export interface HistorialDia {
  fecha: string
  eventos: HistorialEvento[]
}

export const historialAgricultor: HistorialDia[] = [
  {
    fecha: 'Hoy · 25 Abr',
    eventos: [
      { id: 'h1', tipo: 'insumo', titulo: 'Aplicación fungicida', sub: 'Lote 3 · 2.5 L/ha · Mancozeb 80%', hora: '08:43', fuente: 'voz', confianza: 97 },
      { id: 'h2', tipo: 'labor', titulo: 'Deshierbe manual', sub: 'Lote 2 · 3 jornales · 1.2 ha', hora: '10:20', fuente: 'texto', confianza: 99 },
      { id: 'h3', tipo: 'cosecha', titulo: 'Cosecha banano', sub: 'Lote 5 · 420 kg · 4.2 cajas/planta', hora: '11:05', fuente: 'voz', confianza: 96 },
    ],
  },
  {
    fecha: 'Ayer · 24 Abr',
    eventos: [
      { id: 'h4', tipo: 'insumo', titulo: 'Fertilización foliar', sub: 'Lote 6 · 1.5 L/ha · Nitrato amonio', hora: '09:10', fuente: 'voz', confianza: 94 },
      { id: 'h5', tipo: 'plaga', titulo: 'Reporte sigatoka', sub: 'Lote 7 · Severidad 2/5', hora: '14:30', fuente: 'imagen', confianza: 88 },
    ],
  },
  {
    fecha: 'Mié · 23 Abr',
    eventos: [
      { id: 'h6', tipo: 'labor', titulo: 'Apuntalamiento', sub: 'Lote 3 · 45 plantas · 2 jornales', hora: '08:00', fuente: 'texto', confianza: 100 },
      { id: 'h7', tipo: 'cosecha', titulo: 'Cosecha cacao', sub: 'Lote 1 · 3.2 qq · calidad 1ra', hora: '13:45', fuente: 'voz', confianza: 93 },
      { id: 'h8', tipo: 'clima', titulo: 'Lluvia intensa', sub: 'Toda la finca · 48mm', hora: '16:00', fuente: 'texto', confianza: 100 },
    ],
  },
]
