import type { EventoCampoExtraido } from '../types/dominio/EventoCampo.js'

type LoteRef = { lote_id: string; nombre_coloquial: string }

const ICONOS: Record<string, string> = {
  labor: '🌾',
  insumo: '🧪',
  plaga: '🐛',
  clima: '🌧️',
  cosecha: '📦',
  gasto: '💰',
  infraestructura: '🔧',
  observacion: '📝',
  nota_libre: '📝',
  calidad: '⭐',
  venta: '🤝',
  inventario: '📋',
}

const NOMBRES: Record<string, string> = {
  labor: 'Labor',
  insumo: 'Aplicación',
  plaga: 'Plaga',
  clima: 'Clima',
  cosecha: 'Cosecha',
  gasto: 'Gasto',
  infraestructura: 'Infraestructura',
  observacion: 'Observación',
  nota_libre: 'Nota',
  calidad: 'Calidad',
  venta: 'Venta',
  inventario: 'Inventario',
}

const LABOR_LABELS: Record<string, string> = {
  chapeo: 'Chapeo',
  deshoje: 'Deshoje',
  enfunde: 'Enfunde',
  apuntalado: 'Apuntalado',
  poda: 'Poda',
  siembra: 'Siembra',
  transplante: 'Transplante',
  otro: 'Trabajo general',
}

const CLIMA_LABELS: Record<string, string> = {
  lluvia: 'Lluvia',
  viento: 'Viento',
  inundacion: 'Inundación',
  sequia: 'Sequía',
  granizo: 'Granizo',
  otro: 'Evento climático',
}

export function buildFeedbackRecibo(
  eventos: EventoCampoExtraido[],
  lotes: LoteRef[],
): string {
  const bloques = eventos.map(e => buildBloqueEvento(e, lotes))
  const cta = '\n¿Está correcto? Responde *sí* ✅\nSi algo está mal, corrígeme.'

  if (bloques.length === 1) {
    return `Esto anoté:\n\n${bloques[0]}${cta}`
  }
  return `Aquí lo que anoté:\n\n${bloques.join('\n\n')}${cta}`
}

export function buildBloqueEvento(
  extracted: EventoCampoExtraido,
  lotes: LoteRef[],
): string {
  const icono = ICONOS[extracted.tipo_evento] ?? '📋'
  const nombre = NOMBRES[extracted.tipo_evento] ?? 'Reporte'
  const loteNombre = extracted.lote_id
    ? lotes.find(l => l.lote_id === extracted.lote_id)?.nombre_coloquial
    : null

  const lineas: string[] = [`*${icono} ${nombre}*`]
  if (loteNombre) lineas.push(`• Lote: ${loteNombre}`)
  if (extracted.fecha_evento) lineas.push(`• Fecha: ${extracted.fecha_evento}`)

  const c = extracted.campos_extraidos as Record<string, unknown>

  switch (extracted.tipo_evento) {
    case 'insumo': {
      if (c['producto']) lineas.push(`• Producto: ${c['producto']}`)
      if (c['dosis_cantidad'] != null && c['dosis_unidad']) {
        lineas.push(`• Dosis: ${c['dosis_cantidad']} ${c['dosis_unidad']}`)
      } else if (c['dosis_cantidad'] != null) {
        lineas.push(`• Dosis: ${c['dosis_cantidad']}`)
      }
      if (c['area_afectada_ha'] != null) lineas.push(`• Área: ${c['area_afectada_ha']} ha`)
      if (c['num_trabajadores'] != null) lineas.push(`• Personas: ${c['num_trabajadores']}`)
      if (c['cantidad_sobrante'] != null && c['unidad_sobrante']) {
        lineas.push(`• Sobrante: ${c['cantidad_sobrante']} ${c['unidad_sobrante']}`)
      }
      break
    }
    case 'plaga': {
      if (c['plaga_tipo']) lineas.push(`• Plaga: ${c['plaga_tipo']}`)
      if (c['area_afectada_ha'] != null) lineas.push(`• Área: ${c['area_afectada_ha']} ha`)
      if (c['tamano_muestra'] != null) lineas.push(`• Plantas muestreadas: ${c['tamano_muestra']}`)
      if (c['individuos_encontrados'] != null) lineas.push(`• Individuos: ${c['individuos_encontrados']}`)
      if (c['organo_afectado']) lineas.push(`• Parte: ${c['organo_afectado']}`)
      break
    }
    case 'labor': {
      if (c['labor_tipo']) {
        lineas.push(`• Trabajo: ${LABOR_LABELS[String(c['labor_tipo'])] ?? c['labor_tipo']}`)
      }
      if (c['num_trabajadores'] != null) {
        const mod = c['modalidad'] ? ` (${c['modalidad']})` : ''
        lineas.push(`• Personas: ${c['num_trabajadores']}${mod}`)
      }
      if (c['area_afectada_ha'] != null) lineas.push(`• Área: ${c['area_afectada_ha']} ha`)
      break
    }
    case 'cosecha': {
      if (c['cantidad'] != null && c['unidad']) {
        lineas.push(`• Cantidad: ${c['cantidad']} ${c['unidad']}`)
      } else if (c['cantidad'] != null) {
        lineas.push(`• Cantidad: ${c['cantidad']}`)
      }
      if (c['rechazo_pct'] != null) lineas.push(`• Rechazo: ${c['rechazo_pct']}%`)
      if (c['brix'] != null) lineas.push(`• Brix: ${c['brix']}`)
      break
    }
    case 'gasto': {
      if (c['concepto']) lineas.push(`• Concepto: ${c['concepto']}`)
      if (c['monto'] != null) {
        const moneda = c['moneda'] ? `${c['moneda']} ` : ''
        lineas.push(`• Monto: ${moneda}${c['monto']}`)
      }
      break
    }
    case 'clima': {
      if (c['clima_tipo']) {
        lineas.push(`• Tipo: ${CLIMA_LABELS[String(c['clima_tipo'])] ?? c['clima_tipo']}`)
      }
      if (c['intensidad']) lineas.push(`• Intensidad: ${c['intensidad']}`)
      if (c['duracion']) lineas.push(`• Duración: ${c['duracion']}`)
      break
    }
    case 'infraestructura': {
      const tipoInfra = c['tipo_infra'] ?? c['tipo_infraestructura']
      if (tipoInfra) lineas.push(`• Tipo: ${tipoInfra}`)
      if (c['descripcion']) lineas.push(`• ${String(c['descripcion']).slice(0, 60)}`)
      break
    }
    case 'observacion':
    case 'nota_libre': {
      if (c['texto_libre']) {
        const texto = String(c['texto_libre'])
        lineas.push(`• ${texto.length > 80 ? texto.slice(0, 77) + '...' : texto}`)
      }
      break
    }
  }

  return lineas.join('\n')
}
