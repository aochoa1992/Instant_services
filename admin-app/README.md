# LlaveYa Admin · Expo + TypeScript

Portal del equipo operador de LlaveYa, pensado sobre todo para la web (también funciona en iOS y Android). Usa Supabase Auth y las funciones `admin_*` de [`../supabase/migrations/002_administracion.sql`](../supabase/migrations/002_administracion.sql).

## Funciones

- **Solicitudes**: lista con filtro por estado, datos del cliente, cancelar con motivo, reasignar a otro cerrajero aprobado o devolver a Pendiente, e historial de cambios.
- **Cerrajeros**: por aprobar, aprobados y suspendidos. Aprobar, rechazar o suspender con motivo.
- **Nueva solicitud**: crea una solicitud en nombre de un cliente que llama por teléfono y entrega el código de seguimiento.
- **Métricas**: solicitudes por estado y tiempos promedio hasta aceptar y completar, en los últimos 7, 30 o 90 días.

Cada cambio de estado o de cerrajero queda en `historial_solicitudes`, y cada aprobación o suspensión en `historial_cerrajeros`, con el usuario que lo hizo y el motivo.

## Ejecutar

1. Aplica las migraciones de [`../supabase/migrations/`](../supabase/migrations/) en orden.
2. Crea el primer administrador:
   - En Supabase, **Authentication → Users → Add user**, con correo y contraseña.
   - En **SQL Editor**:
     ```sql
     insert into public.admins (id, nombre)
     select id, 'Nombre del administrador' from auth.users where email = 'admin@tudominio.com';
     ```
3. Copia `.env.example` a `.env.local` y configura `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (los mismos valores de las otras apps).
4. Ejecuta `npm install` y `npm run web` en esta carpeta.

Una cuenta que no esté en `admins` no puede entrar al portal, y las funciones `admin_*` la rechazan aunque se llamen directamente. No incluyas en esta app la contraseña de PostgreSQL, una clave secreta ni `service_role`.

Para compilar con EAS, ejecuta `eas init` en esta carpeta para crear el proyecto de Expo.
