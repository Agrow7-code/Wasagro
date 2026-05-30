import { randomInt } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { supabase } from '../integrations/supabase.js'

const BCRYPT_ROUNDS = 10

export async function requestOTP(phone: string): Promise<string> {
  console.log(`[otpService] Solicitando OTP para ${phone}`)

  // 1. Verificar rate limiting
  const { count, error: countError } = await supabase
    .from('otp_codes')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .gt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())

  if (countError) {
    console.error('[otpService] Error en rate limit check:', countError)
    throw countError
  }

  if (count && count >= 3) {
    throw new Error('Demasiadas solicitudes de código. Intenta de nuevo en 15 minutos.')
  }

  // 2. Generar código de 6 dígitos
  const code = randomInt(100000, 1000000).toString()

  // 3. Hash con bcrypt antes de persistir
  const codeHash = await hash(code, BCRYPT_ROUNDS)

  const { error: insertError } = await supabase
    .from('otp_codes')
    .insert({
      phone,
      code: codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })

  if (insertError) {
    console.error('[otpService] Error insertando OTP:', insertError)
    throw insertError
  }

  return code
}

export async function verifyOTP(phone: string, code: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('phone', phone)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return { success: false, error: 'Código no encontrado o expirado. Solicita uno nuevo.' }
  }

  if (data.intentos >= 3) {
    return { success: false, error: 'Máximo de intentos alcanzado. Solicita un nuevo código.' }
  }

  const isMatch = await compare(code, data.code)
  if (!isMatch) {
    await supabase
      .from('otp_codes')
      .update({ intentos: data.intentos + 1 })
      .eq('id', data.id)

    return { success: false, error: `Código incorrecto. Intentos restantes: ${2 - data.intentos}` }
  }

  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('id', data.id)

  return { success: true }
}
