# Instant_services

# Proyecto actual: dos apps React Native + Expo + TypeScript

- La aplicación de clientes está en [`expo-app/`](expo-app/README.md).
- La aplicación de prestadores está en [`cerrajero-app/`](cerrajero-app/README.md).
- Ambas se conectan por HTTPS al proyecto Supabase LlaveYa. El esquema está en [`supabase/llaveya_schema.sql`](supabase/llaveya_schema.sql).

La nueva app para iOS, Android y web está en [`expo-app/`](expo-app/README.md). El servidor `server.js` y la versión anterior con Capacitor se conservan como referencia; no son necesarios para las dos apps Expo.

# LlaveYa — web, iOS y Android

> La sección siguiente describe la versión anterior de Capacitor. Para el piloto actual, usa las instrucciones de cada app Expo enlazadas arriba.

LlaveYa comparte una sola interfaz para navegador, iPhone y Android mediante Capacitor. El cliente solicita un servicio y consulta su estado; el gestor ve, acepta y actualiza las solicitudes. Las tres plataformas usan el mismo servidor de datos.

## Probar en la web

Requiere Node.js 20 o superior. Ejecuta `npm install` y `npm start` en esta carpeta. Abre `http://localhost:3000`. La clave de gestor se muestra en la terminal; para fijarla, inicia el servidor con `GESTOR_PIN=una-clave-larga npm start`.

El servidor guarda las solicitudes en `data/solicitudes.json`. Los datos de prueba no se incluyen en el proyecto.

## Preparar iOS y Android

Los proyectos nativos ya están creados en `ios/` y `android/`. Para que funcionen en teléfonos reales, primero publica el servidor en una dirección HTTPS accesible desde internet. Después genera la interfaz móvil con esa dirección:

```sh
API_BASE_URL=https://api.tudominio.com npm run mobile:sync
```

Ese comando reconstruye la interfaz y la copia a iOS y Android. Luego abre el proyecto correspondiente con `npm run ios` (requiere macOS y Xcode) o `npm run android` (requiere Android Studio, JDK y Android SDK). Compila y ejecuta desde el entorno nativo. Cada vez que cambies la interfaz o la dirección de la API, repite `mobile:sync`.

La dirección HTTPS se incorpora al paquete móvil durante la compilación. No uses `localhost` como `API_BASE_URL`: en el teléfono señalaría al propio dispositivo. Para publicar la web por separado, ejecuta `npm run build`; el resultado queda en `dist/`. Si web y API usan dominios diferentes, configura `CORS_ALLOWED_ORIGINS` en el servidor con el origen HTTPS de la web (varios separados por comas).

## Alcance

Esta es una base funcional, aún no lista para operar con datos reales de clientes. Antes de publicarla se necesitan cuentas de gestor con autenticación robusta, protección contra abuso, un almacenamiento de producción y una política de privacidad. Todavía no hay asignación de técnicos, pagos ni notificaciones automáticas. Las aplicaciones nativas no se han compilado ni probado en dispositivos en este entorno.
