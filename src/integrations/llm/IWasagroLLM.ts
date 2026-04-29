import type { EntradaEvento, ExtraccionMultiEvento } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, ContextoOnboardingAgricultor, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ContextoProspecto, RespuestaProspecto } from '../../types/dominio/Prospecto.js'
import type { ResumenSemanal, EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import type { EntradaSDR, RespuestaSDR } from '../../types/dominio/SDRTypes.js'
import type { ClasificacionExcel, EntradaClasificacionExcel } from '../../types/dominio/Excel.js'
import type { DiagnosticoV2VK } from '../../types/dominio/Vision.js'

export type TipoImagen = 'plaga_cultivo' | 'documento_tabla' | 'otro'

export interface ContextoOCR {
  finca_nombre?: string | undefined
  cultivo_principal?: string | undefined
  lista_lotes?: string | undefined
}

export interface ResultadoOCR {
  tipo_documento: string
  registros: Record<string, unknown>[]
  texto_completo_visible: string
  confianza_lectura: number
  advertencia: string | null
}

export interface IWasagroLLM {
  extraerEventos(input: EntradaEvento, traceId: string): Promise<ExtraccionMultiEvento>
  corregirTranscripcion(raw: string, traceId: string): Promise<string>
  describirImagenVisual(imageUrl: string, traceId: string): Promise<string>
  diagnosticarSintomaV2VK(descripcionVisual: string, contextoRAG: string, input: EntradaEvento, traceId: string): Promise<DiagnosticoV2VK>
  clasificarTipoImagen(base64: string, mimeType: string, traceId: string): Promise<TipoImagen>
  extraerDocumentoOCR(base64: string, mimeType: string, contexto: ContextoOCR, traceId: string): Promise<ResultadoOCR>
  onboardarAdmin(mensaje: string, contexto: ContextoConversacion, traceId: string): Promise<RespuestaOnboarding>
  onboardarAgricultor(mensaje: string, contexto: ContextoOnboardingAgricultor, traceId: string): Promise<RespuestaOnboarding>
  atenderProspecto(mensaje: string, contexto: ContextoProspecto, traceId: string): Promise<RespuestaProspecto>
  resumirSemana(entrada: EntradaResumenSemanal, traceId: string): Promise<ResumenSemanal>
  atenderSDR(entrada: EntradaSDR, traceId: string): Promise<RespuestaSDR>
  clasificarExcel(entrada: EntradaClasificacionExcel, traceId: string): Promise<ClasificacionExcel>
}
