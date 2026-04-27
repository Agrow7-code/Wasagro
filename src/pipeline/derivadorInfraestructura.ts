type InfraTipo = 'riel' | 'bomba' | 'riego' | 'cerca' | 'camino' | 'bodega' | 'empacadora' | 'otro'
type EstadoInfra = 'dañado' | 'reparado' | 'en_reparacion' | null
type Urgencia = 'inmediata' | 'esta_semana' | 'puede_esperar'

interface DerivacionInfraestructura {
  requiere_accion: boolean
  urgencia: Urgencia | null
}

const TIPOS_CRITICOS: ReadonlySet<InfraTipo> = new Set(['riel', 'bomba', 'riego'])

export function derivarInfraestructura(
  infraTipo: InfraTipo | null | undefined,
  estado: EstadoInfra | null | undefined,
): DerivacionInfraestructura {
  if (estado === 'reparado') {
    return { requiere_accion: false, urgencia: null }
  }

  if (estado === 'en_reparacion') {
    return { requiere_accion: false, urgencia: null }
  }

  if (estado === 'dañado') {
    if (TIPOS_CRITICOS.has(infraTipo as InfraTipo)) {
      return { requiere_accion: true, urgencia: 'inmediata' }
    }
    return { requiere_accion: true, urgencia: 'esta_semana' }
  }

  return { requiere_accion: false, urgencia: null }
}

export function enriquecerDatosEventoInfraestructura(
  datosEvento: Record<string, unknown>,
): Record<string, unknown> {
  if (datosEvento['infra_tipo'] === undefined && datosEvento['descripcion_dano'] === undefined) {
    return datosEvento
  }

  const derivacion = derivarInfraestructura(
    datosEvento['infra_tipo'] as InfraTipo | null | undefined,
    datosEvento['estado'] as EstadoInfra | null | undefined,
  )

  return {
    ...datosEvento,
    requiere_accion: derivacion.requiere_accion,
    urgencia: derivacion.urgencia,
  }
}
