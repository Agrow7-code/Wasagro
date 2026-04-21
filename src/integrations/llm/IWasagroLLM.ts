import type { EntradaEvento, EventoCampoExtraido } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ResumenSemanal } from '../../types/dominio/Resumen.js'

export interface IWasagroLLM {
  extraerEvento(input: EntradaEvento, traceId: string): Promise<EventoCampoExtraido>
  corregirTranscripcion(raw: string, traceId: string): Promise<string>
  analizarImagen(imageUrl: string, traceId: string): Promise<string>
  onboardar(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding>
  resumirSemana(eventos: EventoCampoExtraido[], traceId: string): Promise<ResumenSemanal>
}
