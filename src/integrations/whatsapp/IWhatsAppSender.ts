export interface IWhatsAppSender {
  enviarTexto(to: string, texto: string): Promise<void>
  enviarTemplate(to: string, templateName: string, language?: string): Promise<void>
}
