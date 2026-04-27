import type { EntradaEvento, ExtraccionMultiEvento } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, ContextoOnboardingAgricultor, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ContextoProspecto, RespuestaProspecto } from '../../types/dominio/Prospecto.js'
import type { ResumenSemanal, EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import type { EntradaSDR, RespuestaSDR } from '../../types/dominio/SDRTypes.js'
import type { ClasificacionExcel, EntradaClasificacionExcel } from '../../types/dominio/Excel.js'

export interface IWasagroLLM {
  extraerEventos(input: EntradaEvento, traceId: string): Promise<ExtraccionMultiEvento>
  corregirTranscripcion(raw: string, traceId: string): Promise<string>
  analizarImagen(imageUrl: string, traceId: string): Promise<string>
  onboardarAdmin(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding>
  onboardarAgricultor(mensaje: string, contexto: ContextoOnboardingAgricultor, traceId: string): Promise<RespuestaOnboarding>
  atenderProspecto(mensaje: string, contexto: ContextoProspecto, traceId: string): Promise<RespuestaProspecto>
  resumirSemana(entrada: EntradaResumenSemanal, traceId: string): Promise<ResumenSemanal>
  atenderSDR(entrada: EntradaSDR, traceId: string): Promise<RespuestaSDR>
  clasificarExcel(entrada: EntradaClasificacionExcel, traceId: string): Promise<ClasificacionExcel>
}
