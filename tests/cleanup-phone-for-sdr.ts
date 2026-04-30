import { supabase } from '../src/integrations/supabase.js';

// SCRIPT DE LIMPIEZA PARA PRUEBA SDR
// Ejecutar con: npx tsx tests/cleanup-phone-for-sdr.ts

const PHONE_TO_CLEAN = '593987310830';

async function cleanup() {
  console.log(`🧹 Iniciando limpieza para el número: ${PHONE_TO_CLEAN}...`);

  try {
    // 1. Eliminar de sdr_interacciones (relacionado con sdr_prospectos)
    const { data: prospectos } = await supabase
      .from('sdr_prospectos')
      .select('id')
      .eq('phone', PHONE_TO_CLEAN);

    if (prospectos && prospectos.length > 0) {
      const ids = prospectos.map(p => p.id);
      const { error: err1 } = await supabase
        .from('sdr_interacciones')
        .delete()
        .in('prospecto_id', ids);
      if (err1) console.error('❌ Error eliminando interacciones SDR:', err1.message);
      else console.log('✅ Interacciones SDR eliminadas.');

      // 2. Eliminar de sdr_prospectos
      const { error: err2 } = await supabase
        .from('sdr_prospectos')
        .delete()
        .eq('phone', PHONE_TO_CLEAN);
      if (err2) console.error('❌ Error eliminando prospecto SDR:', err2.message);
      else console.log('✅ Prospecto SDR eliminado.');
    }

    // 3. Eliminar de sesiones_activas
    const { error: err3 } = await supabase
      .from('sesiones_activas')
      .delete()
      .eq('phone', PHONE_TO_CLEAN);
    if (err3) console.error('❌ Error eliminando sesiones activas:', err3.message);
    else console.log('✅ Sesiones activas eliminadas.');

    // 4. Buscar el usuario para ver su finca_id antes de borrar
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, finca_id')
      .eq('phone', PHONE_TO_CLEAN)
      .maybeSingle();

    if (usuario) {
      // 5. Eliminar de usuarios
      const { error: err4 } = await supabase
        .from('usuarios')
        .delete()
        .eq('phone', PHONE_TO_CLEAN);
      if (err4) console.error('❌ Error eliminando usuario:', err4.message);
      else console.log('✅ Usuario eliminado de la tabla principal.');

      // Nota: No eliminamos la finca per se para no romper data histórica, 
      // pero el número ya no está asociado a ella.
    }

    console.log('\n✨ ¡Limpieza completada! El sistema ahora te tratará como un número desconocido. Procede con la prueba SDR.');

  } catch (err) {
    console.error('💥 Error inesperado durante la limpieza:', err);
  }
}

cleanup();
