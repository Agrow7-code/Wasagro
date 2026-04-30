import { Resend } from 'resend';

// PRUEBA MANUAL DE RESEND
// Ejecutar con: npx tsx tests/manual-email-test.ts

const resend = new Resend('re_3raqzQWn_Bwv2mMPKBJsrmSMcAv4hbVu6');

async function testEmail() {
  console.log('🚀 Iniciando prueba de envío a wasagro@proton.me...');
  
  try {
    const { data, error } = await resend.emails.send({
      from: 'Wasagro SDR <onboarding@resend.dev>', // Usamos el dominio de prueba de Resend
      to: 'wasagro@proton.me',
      subject: '🚜 Prueba de Sistema: Wasagro SDR Handoff',
      html: `
        <h1>¡Conexión Exitosa!</h1>
        <p>Este es un correo de prueba generado por el agente SDR de Wasagro.</p>
        <hr />
        <ul>
          <li><strong>Estado:</strong> Operativo ✅</li>
          <li><strong>Proveedor:</strong> Resend</li>
          <li><strong>Destino:</strong> Handoff de Leads</li>
        </ul>
        <p>Si estás viendo esto, la integración está lista para recibir prospectos calificados.</p>
      `,
    });

    if (error) {
      console.error('❌ Error de Resend:', error);
    } else {
      console.log('✅ Correo enviado exitosamente!');
      console.log('ID del mensaje:', data?.id);
    }
  } catch (err) {
    console.error('💥 Error inesperado:', err);
  }
}

testEmail();
