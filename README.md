# Instant_services · LlaveYa

Plataforma de servicios de cerrajería inmediata. Tres apps React Native + Expo + TypeScript para iOS, Android y web, conectadas por HTTPS al proyecto Supabase LlaveYa.

- [`expo-app/`](expo-app/README.md): app de clientes. Solicita un servicio, consulta su estado con un código de seguimiento y lo cancela mientras siga Pendiente.
- [`cerrajero-app/`](cerrajero-app/README.md): app de prestadores. Registro, aprobación, ofertas disponibles y gestión de los servicios aceptados.
- [`admin-app/`](admin-app/README.md): portal del equipo operador. Aprueba o suspende cerrajeros, supervisa, cancela y reasigna solicitudes, crea solicitudes por teléfono y muestra métricas.
- [`supabase/migrations/`](supabase/migrations/): esquema de base de datos y funciones RPC que usan las apps.

## Base de datos

Aplica las migraciones en orden en Supabase > SQL Editor:

1. `001_esquema_inicial.sql`: cerrajeros, solicitudes y funciones del cliente y del cerrajero.
2. `002_administracion.sql`: administradores, historial de cambios, cancelación por el cliente y funciones `admin_*`.

## Flujo de ramas

- `main`: código estable o publicado.
- `develop`: integración de lo que se está desarrollando.
- `feature/...`, `fix/...`: salen de `develop` y vuelven a ella mediante pull request.

## Alcance

Base funcional del MVP, aún no lista para operar con datos reales de clientes. Pendiente antes de publicar: protección contra abuso en las solicitudes anónimas, notificaciones, términos y política de privacidad.
