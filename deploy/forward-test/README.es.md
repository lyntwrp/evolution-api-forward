# Instancia de prueba independiente en Coolify

Este directorio construye el código del checkout actual: base oficial v2.3.7
(`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`) con el cambio de reenvío revisado.
No utiliza una imagen de un fork ajeno. No se ha desplegado nada desde este trabajo.

**Esta base exacta conserva vulnerabilidades conocidas.** Incluye Baileys
`7.0.0-rc.9`, afectado por la vulnerabilidad crítica
[GHSA-qvv5-jq5g-4cgg](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg), que permite
suplantar eventos de mensajes y alterar estado de sesión. El aviso publica la
corrección en `7.0.0-rc12`; actualizarla cambiaría la base solicitada y no forma
parte de este cambio mínimo. Úsalo únicamente para la prueba aislada, con una
cuenta y datos prescindibles, y consulta la
[auditoría del cambio y dependencias](../../docs/audit/AUDITORIA-PR2595.md).
La ausencia de indicios maliciosos en el PR no certifica que la instalación sea segura.

## Separación de producción

`compose.yaml` crea su propio PostgreSQL, Redis y tres volúmenes persistentes:
sesiones WhatsApp, PostgreSQL y Redis. Docker/Coolify añade el identificador del
recurso a sus nombres; no hay volúmenes externos, nombres globales de contenedor,
puertos publicados de base de datos/Redis ni redes de producción declaradas.
La red de datos es interna; solamente la API tiene otra red para salir a WhatsApp.
También tiene prefijos y etiquetas de prueba propios.

Crea un recurso **nuevo** y un dominio **nuevo**. Deja desactivada la opción
**Connect to predefined network** y conserva la gestión normal de Compose de
Coolify. No uses **Raw (deploy file as-is)**: este archivo deja que Coolify configure
el proxy. Coolify documenta la red por recurso y el significado de esos ajustes
en su [guía de Docker Compose](https://coolify.io/docs/applications/builds/docker-compose).
Revisa que el Compose generado mantenga a PostgreSQL y Redis fuera de las redes
compartidas antes de desplegar.

## Configuración en Coolify

1. En un proyecto/entorno de pruebas, añade una aplicación desde el repositorio
   propio de GitHub y selecciona la rama que contiene el cambio revisado.
2. Elige **Docker Compose** como estrategia de construcción. Usa **Base Directory**
   `/` y **Docker Compose Location** `/deploy/forward-test/compose.yaml`.
3. Guarda y carga la definición. En las variables de este recurso crea los valores
   de `.env.example`: URL y tres secretos nuevos. Los campos con `${VARIABLE:?}`
   son obligatorios; no despliegues con los campos vacíos. Genera cada secreto por
   separado; una cadena aleatoria hexadecimal de 64 caracteres evita caracteres
   que requieren codificación en las URI de PostgreSQL/Redis. Usa el gestor de
   secretos de Coolify y no pegues esos valores en Git.
4. Configura el dominio HTTPS exclusivamente para el servicio `api`, puerto
   interno `8080`. Si tu interfaz usa un solo campo, el valor equivalente es
   `https://evolution-forward-test.tudominio.com:8080`. En
   `FORWARD_TEST_SERVER_URL` usa `https://evolution-forward-test.tudominio.com`,
   sin `:8080`. El dominio debe apuntar al servidor; la URL pública usa HTTPS normal.
   Consulta [Dominios en Coolify](https://coolify.io/docs/core/networking/domains).
5. Antes de pulsar **Deploy**, revisa que el recurso, dominio, volúmenes y variables
   correspondan a las pruebas. El despliegue ejecutará las migraciones oficiales
   exclusivamente en el PostgreSQL de este Compose.
6. Cuando decidas desplegar, revisa los registros de construcción y los tres
   estados de salud. El healthcheck consulta `/manager/` y confirma que el proceso
   HTTP sirve los archivos locales; no acredita
   conexión a WhatsApp ni que el reenvío real haya funcionado.

`FORWARD_TEST_SOURCE_REVISION` es una etiqueta opcional para identificar el commit
personalizado; no descarga ni cambia el código. Coolify construye la rama/commit
seleccionado en la aplicación. Selecciona el commit revisado antes de desplegar.

## Sesión y datos de prueba

Abre `/manager` en el dominio nuevo y utiliza la API key nueva, o crea la instancia
por la API habitual. Ponle un nombre distinto, por ejemplo `forward-lab`.
Conecta un **número WhatsApp de pruebas distinto** y un grupo de pruebas en el que
ese número pueda enviar mensajes. No copies el volumen de sesiones ni vincules
la cuenta usada en producción. Así la prueba de conexión, cierre de sesión o
reenvío no actúa sobre la cuenta productiva.

Configura un webhook propio de pruebas hacia otro flujo o ruta de n8n. El Compose
desactiva los webhooks globales: activa `MESSAGES_UPSERT` en la instancia de pruebas.
`N8N_ENABLED=false` desactiva la integración interna de Evolution; **no impide**
que los nodos HTTP de n8n llamen a la API ni que se envíen webhooks de instancia.
En n8n crea otra credencial Header Auth `apikey` con el secreto nuevo.
El CORS permanece en `*` con credenciales de navegador desactivadas: el middleware
oficial v2.3.7 rechaza las solicitudes sin cabecera `Origin` si se restringe a una
lista de dominios. Esto permite el nodo HTTP habitual de n8n y el healthcheck;
la API sigue exigiendo `apikey` en las rutas protegidas. No publiques esa clave
en código de navegador.

El reenvío busca el mensaje guardado en la **misma instancia y base de datos** que
recibe la llamada. Un `messageId` capturado exclusivamente en producción no existe
automáticamente en esta instalación. Envía primero un mensaje nuevo a la cuenta
de pruebas y usa su `data.key.id` del webhook de pruebas; el destino puede ser el
JID completo del grupo `...@g.us`. Mantén activado
`DATABASE_SAVE_DATA_NEW_MESSAGE=true` como en este Compose. No migres la base de
producción para resolver un mensaje no encontrado. Para multimedia, prueba
también la disponibilidad del contenido original: un identificador almacenado
por sí solo no garantiza que WhatsApp siga ofreciendo el archivo.

## Construcción y comprobación manual

Desde la raíz del repositorio, en una máquina con Docker:

```bash
cp deploy/forward-test/.env.example deploy/forward-test/.env
# Edita SOLO este .env de pruebas con valores nuevos antes de continuar.
docker compose --project-name evolution-forward-lab --env-file deploy/forward-test/.env -f deploy/forward-test/compose.yaml config --quiet
docker compose --project-name evolution-forward-lab --env-file deploy/forward-test/.env -f deploy/forward-test/compose.yaml build api
```

La primera orden de Docker valida la configuración sin iniciarla. La segunda
construye la imagen personalizada y ejecuta generación Prisma, TypeScript y
`tsup`. No conecta a tu base real durante la construcción. No ejecutes `up` en
el servidor productivo ni sustituyas el Compose existente.

El Dockerfile dedicado usa `npm ci` y el lockfile oficial sin cambiarlos, conserva
los scripts necesarios de las dependencias y desactiva solamente el hook local
de Husky con `HUSKY=0`. No usa `--ignore-scripts`: Prisma y dependencias nativas
pueden necesitar sus scripts en Linux. Esa instalación requiere acceso a los
registros/orígenes ya fijados en el lockfile y ejecuta código de dependencias;
la revisión del cambio de reenvío no equivale a auditar toda esa cadena.

No se ejecuta `manager_install.sh` ni se descarga la rama actual del submódulo:
el `manager/dist` oficial ya está versionado y se copia tal cual. Tampoco se copia
el `.env.example` raíz con sus credenciales demostrativas. El cliente Prisma se
genera con una URI ficticia sin conexión y las migraciones arrancan con los
secretos de tiempo de ejecución. La telemetría y Sentry quedan desactivados.
`Dockerfile.dockerignore` restringe el contexto a los archivos requeridos por la
construcción y excluye los `.env` de despliegue y las sesiones. Docker describe
este mecanismo en [archivos de exclusión por Dockerfile](https://docs.docker.com/build/concepts/context/#filename-and-location).

Las imágenes de Node/PostgreSQL/Redis usan etiquetas de versión que pueden recibir
actualizaciones; el código de Evolution permanece fijado al checkout revisado.
Para reconstrucciones idénticas, fija esas tres imágenes por digest después de
obtenerlas y registrar los digests en el servidor de pruebas.

La sintaxis YAML y la separación declarada de servicios/redes/volúmenes pasaron
la revisión estática. `ConfigService` también inicializó correctamente sin `.env`,
usando solamente las variables del Compose y valores ficticios para los secretos.
Aquí no hay Docker disponible: no se ha construido ni iniciado este Compose.
Quedan pendientes la construcción Linux, las migraciones en la base vacía, la
conexión del teléfono y el envío real. Comprueba primero texto a un único grupo,
luego imagen/audio/documento y los errores de ID inexistente o de otra instancia.
Mantén el intervalo de n8n y revisa el `statusCode`; no hagas reintentos automáticos
de reenvíos dudosos porque pueden duplicar publicaciones.

## Detener la prueba

Detén exclusivamente el recurso nuevo en Coolify. Conserva sus volúmenes si
quieres conservar la sesión. Eliminar los volúmenes de este recurso borra sus
datos y exige una nueva vinculación; no selecciones almacenamiento de producción.
Un rollback consiste en parar esta prueba: no necesita modificar la instalación
productiva ni sus flujos actuales de n8n.
