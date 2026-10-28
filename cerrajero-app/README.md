# LlaveYa Cerrajero · Expo + TypeScript

App local para iOS, Android y web. Usa Supabase Auth y las funciones PostgreSQL del proyecto remoto a través de HTTPS.

## Ejecutar

1. Comprueba que Supabase tenga aplicadas las migraciones de [`../supabase/migrations/`](../supabase/migrations/).
2. Configura `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` en `.env.local` (ya configurado en este equipo).
3. Ejecuta `npm install` y `npm start` en esta carpeta.
4. Registra una cuenta de cerrajero con correo y contraseña. Si Supabase solicita confirmar el correo, hazlo y después inicia sesión.
5. Un administrador aprueba al cerrajero desde el portal [`../admin-app/`](../admin-app/README.md). Solo entonces verá las ofertas.

La app consulta ofertas cada siete segundos. `aceptar_servicio` asigna una solicitud a un único cerrajero mediante una actualización condicional en la base de datos. Los datos de contacto del cliente solo aparecen en **Mis servicios** del cerrajero asignado.

La clave publicable puede estar en el cliente. No incluyas en esta app la contraseña de PostgreSQL, una clave secreta ni `service_role`.
