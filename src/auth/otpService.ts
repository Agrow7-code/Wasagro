import { supabase } from '../integrations/supabase.js'

const OTP_TIMEOUT_MS = 7000 // 7 segundos máximo para operaciones de OTP

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${context} no respondió en ${timeoutMs}ms`)), timeoutMs)
  )
  return Promise.race([promise, timeout])
}

export async function requestOTP(phone: string): Promise<string> {
  // 1. Verificar rate limiting (máximo 3 solicitudes en 15 minutos)
  const rateLimitQuery = supabase
    .from('otp_codes')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .gt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())

  const { count, error: countError } = await withTimeout(
    rateLimitQuery,
    OTP_TIMEOUT_MS,
    'rate_limit_check'
  )

  if (countError) throw countError
  if (count && count >= 3) {
    throw new Error('Demasiadas solicitudes de código. Intenta de nuevo en 15 minutos.')
  }

  // 2. Limpiar códigos expirados para este número
  const cleanupQuery = supabase
    .from('otp_codes')
    .delete()
    .eq('phone', phone)
    .lt('expires_at', new Date().toISOString())

  await withTimeout(
    cleanupQuery,
    OTP_TIMEOUT_MS,
    'cleanup_expired'
  ).catch(() => { /* Ignorar errores de limpieza */ })

  // 3. Generar código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString()

  // 4. Guardar en Supabase
  const insertQuery = supabase
    .from('otp_codes')
    .insert({
      phone,
      code,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })

  const { error: insertError } = await withTimeout(
    insertQuery,
    OTP_TIMEOUT_MS,
    'insert_otp'
  )

  if (insertError) throw insertError

  return code
}

export async function requestOTP(phone: string): Promise<string> {
  // 1. Verificar rate limiting (máximo 3 solicitudes en 15 minutos)
  const { count, error: countError } = await withTimeout<any>(
    supabase
      .from('otp_codes')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .gt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()),
    OTP_TIMEOUT_MS,
    'rate_limit_check'
  )

  if (countError) throw countError
  if (count && count >= 3) {
    throw new Error('Demasiadas solicitudes de código. Intenta de nuevo en 15 minutos.')
  }

  // 2. Limpiar códigos expirados para este número
  await withTimeout<any>(
    supabase
      .from('otp_codes')
      .delete()
      .eq('phone', phone)
      .lt('expires_at', new Date().toISOString()),
    OTP_TIMEOUT_MS,
    'cleanup_expired'
  ).catch(() => { /* Ignorar errores de limpieza */ })

  // 3. Generar código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString()

  // 4. Guardar en Supabase
  const { error: insertError } = await withTimeout<any>(
    supabase
      .from('otp_codes')
      .insert({
        phone,
        code,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      }),
    OTP_TIMEOUT_MS,
    'insert_otp'
  )

  if (insertError) throw insertError

  return code
}

export async function verifyOTP(phone: string, code: string): Promise<{ success: boolean; error?: string }> {
  // 1. Buscar código activo
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

  // 2. Validar intentos
  if (data.intentos >= 3) {
    return { success: false, error: 'Máximo de intentos alcanzado. Solicita un nuevo código.' }
  }

  // 3. Verificar coincidencia
  if (data.code !== code) {
    // Incrementar intentos
    await supabase
      .from('otp_codes')
      .update({ intentos: data.intentos + 1 })
      .eq('id', data.id)

    return { success: false, error: `Código incorrecto. Intentos restantes: ${2 - data.intentos}` }
  }

  // 4. Marcar como usado
  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('id', data.id)

  return { success: true }
}
