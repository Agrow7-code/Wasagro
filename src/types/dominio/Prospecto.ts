export interface ContextoProspecto {
  historial: Array<{ rol: 'usuario' | 'agente'; contenido: string }>
  paso_actual: number
  datos_recopilados: Record<string, unknown>
}

export interface RespuestaProspecto {
  paso_completado: number
  siguiente_paso: number
  tipo_contacto: 'trabajador' | 'decision_maker' | 'otro' | 'sin_clasificar'
  datos_extraidos: {
    nombre: string | null
    finca_nombre: string | null
    cultivo_principal: string | null
    pais: string | null
    tamanio_aproximado: string | null
    interes_demo: boolean
    horario_preferido: string | null
  }
  enviar_link_demo: boolean
  guardar_en_prospectos: boolean
  mensaje_para_usuario: string
}
