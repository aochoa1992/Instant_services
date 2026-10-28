# LlaveYa Cliente · Expo + TypeScript

App local para iOS, Android y web. Las solicitudes se guardan en el proyecto remoto de Supabase mediante HTTPS.

## Ejecutar

1. Comprueba que Supabase tenga aplicadas las migraciones de [`../supabase/migrations/`](../supabase/migrations/).
2. Configura `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` en `.env.local` (ya configurado en este equipo).
3. Ejecuta `npm install` y `npm start` en esta carpeta. Abre la web con `w` o la app en el dispositivo con Expo.

La app llama `crear_solicitud` y `consultar_estado` por la API HTTPS de Supabase. El código de seguimiento tiene 16 caracteres. Mientras la solicitud está Pendiente, el cliente puede cancelarla con `cancelar_solicitud`. La clave publicable puede estar en el cliente; la contraseña de PostgreSQL y las claves secretas nunca deben incluirse en la app.
