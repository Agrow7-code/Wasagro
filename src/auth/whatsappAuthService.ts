import { crearSenderWhatsApp } from '../integrations/whatsapp/index.js'

export async function sendOTPViaWhatsApp(phone: string, code: string): Promise<void> {
  const sender = crearSenderWhatsApp()
  
  const mensaje = `Tu código de acceso a Wasagro es:

*${code}*

Válido por 10 minutos. No lo compartas con nadie.`

  await sender.enviarTexto(phone, mensaje)
}
