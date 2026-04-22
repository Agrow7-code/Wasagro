export interface IWhatsAppSender {
  enviarTexto(to: string, texto: string): Promise<void>
}
