# Validación del fork de prueba

Fecha: 22 de octubre de 2026. Base: etiqueta oficial `2.3.7`, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`. Head del PR inspeccionado:
`2765f4288561d9da55f4e3e9c1f9c41a72dc138b`.

## Resultados iniciales ejecutados

| Comprobación | Resultado |
|---|---|
| Procedencia Git | Tag y commit oficial comprobados contra el remoto; base del PR y diff real conservados. |
| Alcance de aplicación | 5 archivos `src/`, 116 líneas añadidas, 0 eliminaciones. Sin cambios en manifests, lockfile, Prisma, autenticación global, otras rutas o administración de grupos. |
| Instalación local | `npm ci --ignore-scripts --no-audit --no-fund`, 1120 paquetes; sin cambios de lockfile. |
| Prisma | `DATABASE_PROVIDER=postgresql npm run db:generate`, cliente generado sin base real ni secretos. |
| Build | `npm run build` aprobado: TypeScript sin emisión y empaquetado CJS/ESM con tsup. |
| Estilo completo | `npm run lint:check` aprobado. |
| Pruebas nuevas | `node --test tests/forward-message.test.cjs`: 12 aprobadas, 0 fallos. |
| n8n | JSON válido, dos nodos conectados; preparación ejecutada con un item ficticio conserva grupo e ID y produce el endpoint esperado. Sin ejecución real de n8n. |
| Compose | YAML parseado, 3 servicios y 3 volúmenes, sin `ports`, `container_name`, recursos `external` ni nombres globales. |
| Configuración | ConfigService inicializado sin `.env` con valores ficticios equivalentes al Compose; puerto, almacenamiento, Redis, autenticación, CORS y telemetría comprobados. |
| Dependencias | `npm audit` reporta 110 entradas afectadas, incluidas 4 críticas; no aprobado como base segura. Véase la auditoría. |
| Espacios y cambios | `git diff --check` aprobado. |

Entorno local: Windows, Node.js `24.18.1`, npm `11.16.0`. No se arrancó el servidor
real de Evolution ni se contactó una base, Redis, webhook o cuenta WhatsApp reales.
El script oficial `npm test` apunta a un archivo ausente y modo watch en esta base;
por eso se utilizó el comando explícito de las pruebas nuevas, sin modificar
`package.json` ni simular una suite upstream que no existe.

## Qué prueban los 12 casos

Las pruebas cargan el código TypeScript real en módulos aislados, con Express,
validador, guard de API key y generación/protobuf de Baileys rc.9 reales. Se simulan
la base, Redis, transporte WhatsApp y los demás efectos externos.

- Validación de campos, grupos con/sin guion, teléfono/JID y rechazo de formatos/campos adicionales.
- Consulta SQL parametrizada, ligada al `instanceId`, con rechazo de ID inexistente o de otra instancia.
- Recorrido por tratamiento de grupos, persistencia y webhook normales.
- Marca de reenviado y aumento de contador usando la generación real de Baileys.
- Conservación de contexto y recuperación de bytes de media desde objetos numéricos, base64 y dos formas de JSON Buffer.
- Rechazo de tipos especiales y de contenido mixto malformado antes de enviar.
- Resolución habitual de teléfono y nuevo ID de salida.
- Error de transporte sin persistir ni emitir éxito.
- Envío de texto existente conserva contenido y efectos habituales.
- Respuesta controlada para canal incompatible o instancia no cargada.
- Ruta HTTP exige la API key autorizada y bloquea cambios de instancia mediante query.

Son pruebas de código y contrato con efectos simulados; no acreditan entrega real,
estado de sesión, apariencia visual en el teléfono, ejecución completa de producción
ni ausencia de vulnerabilidades. Tampoco son un pentest general de Evolution.

## Pendiente en el laboratorio

Docker no está instalado en este equipo. No se construyó/arrancó la imagen Linux,
ni se ejecutaron migraciones de una base vacía, conexión QR o mensajes reales.
La [guía Coolify](../deploy/forward-test/README.es.md) explica cómo validarlos con
servicios y cuenta independientes. Primero construir, comprobar migraciones y
salud; después enviar un texto de prueba y verificar el mensaje y el webhook.
Luego comprobar imagen, audio, video, documento y los errores de origen/destino.

El Compose mantiene credenciales vacías hasta que el operador cree secretos nuevos.
No se ha alterado ni desplegado la instancia de producción. El fork y sus pruebas
no certifican seguridad: conserva la vulnerabilidad conocida de Baileys y otros
avisos de la base oficial solicitada.

## Ajuste del empaquetado por memoria

El registro de construcción compartido por el usuario el 22 de octubre muestra
que la instalación, Prisma y TypeScript terminan, pero tsup agota el heap de Node
cerca de 954 MiB al generar múltiples entradas CJS/ESM con mapas de fuente.

Se ajustó exclusivamente el Dockerfile del laboratorio para ejecutar:

```bash
npm exec --no -- tsc --noEmit
npm exec --no -- tsup src/main.ts --format cjs --no-sourcemap
```

Los dos pasos se ejecutaron localmente con
`NODE_OPTIONS=--max-old-space-size=512` y terminaron correctamente. Se comprobó la
sintaxis de `dist/main.js`, la presencia de `forwardMessage`, las tres traducciones
y la ausencia de ESM/mapas de fuente adicionales. El límite corresponde al heap
V8; no es una medición del consumo total de RAM del proceso o de Docker.

La configuración oficial de tsup, sus loaders y su copia de traducciones se
conservan. `src`, dependencias, lockfile y Prisma siguen intactos respecto a la
implementación revisada. No se inició el bundle ni se accedió a producción para
esta comprobación. La construcción Linux y el arranque corregidos se deben
confirmar en el siguiente despliegue de pruebas.

## Corrección de la vista previa al reenviar

La prueba del usuario confirmó la entrega y la marca de reenviado, pero sin la
tarjeta del enlace. Se reprodujo localmente la pérdida: el normalizador oficial
elimina `extendedTextMessage` antes del guardado, y la operación de reenvío de
Baileys no vuelve a generar una tarjeta a partir del enlace.

Se cambió únicamente el servicio Baileys para conservar campos de vista previa
en el JSON de almacenamiento y reconstruirlos en `forwardMessage`. Los objetos
de webhook y Chatwoot conservan su formato anterior. Se cubren recepción,
envío e importación del historial. No hay cambios de esquema, migraciones,
dependencias, rutas, autenticación o contrato HTTP. Los campos visuales de
`externalAdReply` se conservan por separado sin restaurar contexto innecesario.
Las tarjetas de enlace se invalidan si cambia el texto, y las contextuales se
omiten cuando el registro está marcado como editado.

Validación de esta corrección:

- **21 pruebas aprobadas** en `tests/forward-message.test.cjs`, con código real
  del servicio y generación/protobuf de Baileys, persistencia y transporte simulados.
- Incluye la ruta de tarjeta con miniatura normal y de alta calidad, ida y vuelta
  por JSON, búsqueda limitada a la instancia, reenvío y segundo guardado.
- Comprueba la marca/contador, texto anterior sin tarjeta, ausencia de la copia
  interna en el mensaje enviado y el webhook, y omisión de tarjetas obsoletas.
- **TypeScript y lint completos aprobados.** El bundle CJS de `src/main.ts`,
  equivalente al usado por el Dockerfile de pruebas, se generó correctamente
  con heap V8 de 512 MiB.

No se construyó una imagen Docker ni se desplegó el servicio durante esta
validación. No se conectó una cuenta WhatsApp ni se enviaron mensajes reales.
La vista previa ordinaria requiere un mensaje nuevo recibido después del
despliegue; la prueba visual en el teléfono queda pendiente.

## Correcciones de seguridad del 23 de octubre de 2026

La auditoría posterior del commit `fd8d008c` reprodujo dos defectos:

1. Se validaba el tipo principal, pero se entregaba a Baileys todo el mensaje
   almacenado. Podían acompañarlo claves de distribución de grupo o un segundo
   contenido con citas privadas.
2. La edición por API conservaba el campo auxiliar de vista previa y su texto
   anterior, aunque el texto principal ya hubiera cambiado.

El reenvío reconstruye ahora un único contenido permitido. Excluye metadatos de
claves y transporte, rechaza contenidos ambiguos y limpia el contexto original,
también en contactos anidados. Conserva los campos de tarjeta, miniatura normal
y HQ, bytes multimedia y el contador que Baileys incrementa una sola vez. La
edición guarda una copia del mensaje sin el campo auxiliar obsoleto después de
un envío exitoso, sin mutar el objeto anterior si la persistencia falla.

Validación ejecutada:

- **27 pruebas aprobadas** con código real del servicio y protobuf/generación
  real de Baileys, y base/transporte/webhooks simulados.
- Regresión de recepción de grupo, almacenamiento JSON y reenvío: datos de
  distribución de claves sintéticos ausentes del mensaje generado y de su
  segundo guardado; tarjeta y miniatura HQ conservadas.
- Los once tipos permitidos siguen funcionando; contenido múltiple, tipos
  desconocidos y controles mezclados se rechazan antes de enviar.
- La edición exitosa elimina el campo auxiliar y la consulta posterior no lo
  devuelve. Mensajes sin editar y fallos de envío/guardado conservan la tarjeta.
- TypeScript, lint completo y bundle CJS de `src/main.ts` con heap V8 de 512 MiB
  comprobados antes de publicar esta corrección.

No hay cambios de endpoint, credenciales, dependencias, lockfile, Prisma o
Compose. No se ejecutó una limpieza retroactiva de registros editados antes de
esta corrección, ni se enviaron mensajes reales o se accedió a producción. La
prueba visual posterior corresponde a la instancia de laboratorio del usuario.
Baileys sigue en la versión oficial base `7.0.0-rc.9`; sus avisos de seguridad
heredados requieren un cambio separado. Estas pruebas no certifican la seguridad
general de Evolution o de sus dependencias.
