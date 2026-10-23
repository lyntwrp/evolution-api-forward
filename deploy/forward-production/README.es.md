# Instalación independiente en Coolify

Este Compose prepara una instalación nueva de la versión congelada del fork.
Construye el código seleccionado en Coolify usando el mismo Dockerfile del
laboratorio, sin actualizar Node a otra versión mayor, Baileys ni las dependencias
npm. El laboratorio de `deploy/forward-test` permanece separado.

**El nombre «producción» describe el destino, no una certificación de seguridad.**
Esta versión conserva Baileys `7.0.0-rc.9` y su vulnerabilidad crítica
[GHSA-qvv5-jq5g-4cgg](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg).
También conserva el defecto de autorización de rutas oficiales que permite
sobrescribir la instancia mediante parámetros de consulta. La ruta nueva
`forwardMessage` rechaza esos parámetros; las demás rutas heredadas no se han
corregido globalmente. No usar esta instalación como separación segura entre
clientes que no confían entre sí. Consulta la
[auditoría](../../docs/audit/AUDITORIA-PR2595.md). La decisión de conservar la
versión probada conserva también estos riesgos.

## 1. Seleccionar una versión fija

Consulta [las versiones del fork](../../docs/RELEASES-forward.es.md). Esta guía y
su Compose existen a partir de R2: elige el tag R2 publicado y registra su commit
completo. R1 identifica el código de reenvío probado; R2 añade cambios de Manager
y preparación del despliegue que requieren su propia comprobación antes del uso
real. El commit R1 no contiene este directorio de producción.

En Coolify usa un recurso **nuevo**, del repositorio propio, y fija el commit
completo de la versión elegida si tu interfaz ofrece ese campo. Si seleccionas
una rama, comprueba el commit que aparece en el despliegue y desactiva el
despliegue automático para que una publicación posterior no cambie esta
instalación. Un nombre de rama no congela por sí mismo el contenido.

No selecciones `main`, `develop` ni el Compose de la raíz heredado. El valor de
`FORWARD_PROD_SOURCE_REVISION` es una etiqueta informativa; **no selecciona el
código** que Coolify construye.

## 2. Crear el recurso

1. Añade una aplicación desde el repositorio Git en un entorno nuevo.
2. En **Build strategy / Build pack**, selecciona **Docker Compose**.
3. Escribe **Base directory**: `/deploy/forward-production`.
4. Escribe **Docker compose location**: `/compose.yaml`.
5. Guarda y carga el Compose. Deben aparecer solamente `api`, `postgres` y
   `redis`. El servicio `api` tiene `build:` y utiliza
   `deploy/forward-test/Dockerfile`, situado en el mismo repositorio.
6. Deja desactivados **Connect to predefined network** y **Raw (deploy file as-is)**.
   El proxy debe conectar únicamente con `api`; PostgreSQL y Redis permanecen
   en la red interna. Comprueba esa separación en el Compose que genere Coolify.

Los tres volúmenes se llaman localmente `forward_prod_instances`,
`forward_prod_postgres` y `forward_prod_redis`. Compose les añade el prefijo del
recurso. No hay volúmenes externos, nombres globales de contenedores ni puertos
publicados para PostgreSQL/Redis.

## 3. Variables y dominio

En **Environment Variables** del recurso nuevo, añade estas variables. Usa
valores nuevos; no copies el `.env`, las claves, sesiones o bases de otra
instalación.

| Variable | Valor |
|---|---|
| `FORWARD_PROD_SERVER_URL` | Tu dominio público, por ejemplo `https://evolution.tudominio.com`, sin `/` final ni `:8080`. |
| `FORWARD_PROD_API_KEY` | Una clave nueva para esta API. |
| `FORWARD_PROD_POSTGRES_PASSWORD` | Una contraseña nueva para esta base. |
| `FORWARD_PROD_REDIS_PASSWORD` | Otra contraseña nueva para Redis. |
| `FORWARD_PROD_SOURCE_REVISION` | El commit completo que realmente seleccionaste en Coolify. |
| `FORWARD_PROD_RELEASE` | Identificador de la versión seleccionada, por ejemplo `forward-2-3-7-r2`. |

Genera los tres secretos por separado; 64 caracteres hexadecimales aleatorios
evitan problemas de codificación en las URI de conexión. No los escribas en
GitHub. Las cuatro primeras variables son obligatorias; un valor vacío impide
resolver el Compose.

Configura el dominio HTTPS **solo en `api`**, puerto interno `8080`. Si Coolify
combina dominio y puerto de destino en un único campo, el formato equivalente es
`https://evolution.tudominio.com:8080`. La URL pública y
`FORWARD_PROD_SERVER_URL` siguen siendo `https://evolution.tudominio.com`.
El servicio usa HTTP internamente; Coolify termina HTTPS en el proxy.

Opcionalmente cambia `FORWARD_PROD_SERVER_NAME` y `FORWARD_PROD_PHONE_CLIENT`.
Son nombres de presentación, **no el nombre de una instancia WhatsApp**.

Guarda las variables y despliega cuando hayas comprobado el recurso, commit,
dominio y volúmenes. Este despliegue ejecuta las migraciones oficiales en su
propio PostgreSQL. No sustituye una aplicación existente.

## 4. Crear la instancia y configurar el webhook

1. Abre `https://TU-DOMINIO/manager/` e inicia sesión con la API key nueva.
2. Crea la instancia y elige su nombre, por ejemplo `NumeroProduccion`. El nombre
   es libre y debe coincidir exactamente con el usado en n8n.
3. Vincula el número que hayas reservado para esta instalación. No copies una
   sesión activa ni conectes la misma sesión simultáneamente en dos servidores.
   Migrar un número que ya funciona en otra instalación es una operación aparte.
4. En la instancia, configura el webhook hacia la **Production URL** del flujo
   n8n que corresponda. Si el flujo escucha un único evento general, deja
   **Webhook by events** desactivado y activa `MESSAGES_UPSERT`.
5. Configura las cabeceras de autenticación siguiendo la
   [guía de Header Auth](../../docs/WEBHOOK-HEADER-AUTH.es.md). El secreto del
   webhook es independiente de la API key de Evolution.

En el nodo HTTP de n8n usa la credencial Header Auth propia de esta instalación
(`apikey`) y cambia dominio/nombre de instancia:

```text
POST https://TU-DOMINIO/message/forwardMessage/NOMBRE-DE-INSTANCIA
```

```json
{
  "number": "NUMERO-DESTINO-O-GRUPO@g.us",
  "messageId": "ID-DE-UN-MENSAJE-RECIBIDO-EN-ESTA-INSTANCIA"
}
```

Reemplaza `number` por un teléfono internacional válido o un JID completo de
grupo; el texto del ejemplo es un marcador. Un ID obtenido en otra base no
existirá aquí. Prueba primero con un mensaje nuevo y un destinatario controlado,
incluyendo tarjeta de enlace y multimedia. Un estado HTTP 201 indica que la API
aceptó el envío; confirma la recepción en el teléfono. No actives reintentos
automáticos para reenvíos cuyo resultado sea incierto.

## 5. Integraciones opcionales

Los módulos adicionales están desactivados inicialmente. `FORWARD_PROD_N8N_ENABLED`,
`FORWARD_PROD_CHATWOOT_ENABLED`, `FORWARD_PROD_TYPEBOT_ENABLED`,
`FORWARD_PROD_OPENAI_ENABLED`, `FORWARD_PROD_DIFY_ENABLED`,
`FORWARD_PROD_EVOAI_ENABLED` y `FORWARD_PROD_FLOWISE_ENABLED` admiten `true` o `false`.
Activa solamente el módulo que vayas a configurar y vuelve a desplegar.
Los webhooks de instancia y el nodo HTTP de n8n funcionan aunque
`FORWARD_PROD_N8N_ENABLED=false`; ese indicador controla la integración interna.

También se exponen indicadores para RabbitMQ, SQS, Kafka, NATS, WebSocket,
Pusher y S3. Activar un indicador no configura automáticamente sus servidores,
credenciales ni permisos. Si necesitas uno, añade explícitamente sus variables
de Evolution al bloque `environment:` del Compose antes de habilitarlo. Añadir
una variable en Coolify que el Compose no utiliza no garantiza que llegue al
contenedor. No actives estos módulos para resolver un fallo de carga del Manager.

## 6. Qué queda congelado

El commit fija el código y `npm ci` instala las versiones del lockfile conservado.
Baileys sigue siendo `7.0.0-rc.9`. La receta usa el mismo `node:24-alpine` del
laboratorio, pero esa etiqueta, `postgres:15-alpine`, `redis:7-alpine` y los
paquetes Alpine pueden cambiar al reconstruir. Por eso **código y dependencias
npm congelados no significan una imagen idéntica byte por byte**.

Para conservar exactamente una imagen ya probada, registra su ID/digest en el
servidor de pruebas y promueve esa misma imagen a un registro propio autorizado,
sin reconstruirla. Conserva el digest de la imagen y los de PostgreSQL y Redis.
En una copia controlada del Compose, sustituye únicamente `api.build` por
`api.image: TU-REGISTRO/TU-IMAGEN@sha256:DIGEST-REAL` y fija las otras dos imágenes
por sus digests reales. No uses los marcadores como valores ni inventes digests.
Las etiquetas `latest` o de una rama no identifican una imagen inmutable.
Este paso es opcional; el despliegue habitual de esta guía construye desde Git.

## 7. Copias de seguridad y vuelta a una versión anterior

Antes de una actualización posterior, registra el commit, la configuración y
la imagen que realmente se ejecutan. Guarda los secretos mediante tu gestor de
secretos, nunca en un commit ni en registros de diagnóstico.

Para obtener una copia coordinada, pausa los flujos que envían mensajes y detén
solo el servicio API de este recurso. Mantén PostgreSQL disponible para su copia
lógica y guarda también el volumen de sesiones. Conserva una copia consistente
de Redis mediante el procedimiento de respaldo del servicio. Usa el respaldo
de PostgreSQL de Coolify o `pg_dump`, y comprueba la restauración en una instalación
aislada. No trates una copia de archivos de PostgreSQL en ejecución como una
copia válida sin un procedimiento específico del motor.

Si una actualización falla, pausa los envíos y vuelve a la imagen/commit
anterior conservando los volúmenes. R1 y R2 no cambian esquemas ni migraciones
respecto de la base oficial; esto no garantiza compatibilidad con cualquier
versión futura. Revisa las migraciones antes de volver atrás entre versiones.
Una restauración de base/sesiones desde una copia debe ser deliberada: puede
perder mensajes posteriores y provocar publicaciones duplicadas si se reanudan
las automatizaciones sin revisión. No elimines volúmenes para hacer rollback.

## Validación y alcance

La preparación de estos archivos no crea recursos ni despliega servicios.
El análisis estático comprueba variables, servicios, redes y volúmenes; la
configuración efectiva de Coolify y el entorno Linux deben verificarse en el
recurso nuevo. El healthcheck consulta `/manager/`; demuestra que el servidor
HTTP responde, no que WhatsApp esté conectado ni que el webhook o el reenvío
hayan funcionado. Confirma esas tres operaciones antes de habilitar flujos reales.
