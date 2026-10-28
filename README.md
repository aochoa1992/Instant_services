# Instant_services · LlaveYa

Plataforma de servicios de cerrajería inmediata. Dos apps React Native + Expo + TypeScript para iOS, Android y web, conectadas por HTTPS al proyecto Supabase LlaveYa.

- [`expo-app/`](expo-app/README.md): app de clientes. Solicita un servicio y consulta su estado con un código de seguimiento.
- [`cerrajero-app/`](cerrajero-app/README.md): app de prestadores. Registro, aprobación, ofertas disponibles y gestión de los servicios aceptados.
- [`supabase/llaveya_schema.sql`](supabase/llaveya_schema.sql): esquema de base de datos y funciones RPC que usan las dos apps.

## Flujo de ramas

- `main`: código estable o publicado.
- `develop`: integración de lo que se está desarrollando.
- `feature/...`, `fix/...`: salen de `develop` y vuelven a ella mediante pull request.

## Alcance

Base funcional del MVP, aún no lista para operar con datos reales de clientes. Pendiente antes de publicar: rol de administrador, protección contra abuso en las solicitudes anónimas, notificaciones y política de privacidad.
