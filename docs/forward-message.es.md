# Endpoint forwardMessage y n8n

## Contrato

`POST https://TU-DOMINIO-DE-PRUEBAS/message/forwardMessage/{instanceName}`

Headers: `apikey` (API key global nueva o token autorizado de esa instancia),
`Content-Type: application/json`. Usa HTTPS.

```json
{
  "number": "120363000000000000@g.us",
  "messageId": "ID_ORIGINAL_DEL_WEBHOOK_DE_PRUEBAS"
}
```

| Campo | Significado |
|---|---|
| `instanceName` en la ruta | Nombre de la instancia Baileys cargada y conectada, por ejemplo `forward-lab`. |
| `number` | Destino: grupo con JID completo `@g.us` (incluido legado con guion), teléfono internacional solo dígitos o JID `@s.whatsapp.net`. Los números sin JID pasan por la normalización habitual de v2.3.7. |
| `messageId` | ID original `data.key.id` del webhook `messages.upsert`; no el ID de ejecución n8n ni el ID interno de la fila Prisma. String sin espacios, máximo 200 caracteres. |

Solo admite estas dos propiedades en el cuerpo, sin query parameters. No admite
`text`, `media`, `quoted`, `force`, `delay`, `@lid`, `@broadcast`, newsletters ni JIDs
arbitrarios. Es un contrato deliberadamente pequeño para esta incorporación.

La búsqueda reutiliza `getMessage` y está parametrizada por el ID y el `instanceId`
de la instancia seleccionada. PostgreSQL es el proveedor de este laboratorio; el
getter oficial usa sintaxis JSON de PostgreSQL y no se acredita MySQL.
No busca ni descarga mensajes de producción a partir del ID.

La cuenta de prueba debe recibir y guardar el mensaje origen, pertenecer al grupo
destino y tener permiso para escribir en él. Mantén
`DATABASE_SAVE_DATA_NEW_MESSAGE=true`. El guardado de mensajes recibidos se realiza
antes del webhook en la base oficial. También pueden utilizarse mensajes ya
sincronizados y almacenados en esa misma instancia, sin garantía de historial completo.

## Comportamiento y errores

Utiliza la operación nativa de Baileys con `forward` y `force: true`, que solicita
la marca de reenviado incluso para contenido propio. Restaura bytes multimedia
persistidos y contexto de texto antes de llamar a la biblioteca. No reconstruye
la publicación como un `sendText` o `sendMedia` nuevo desde n8n.

Esta adaptación pasa por el flujo habitual de envío: comprobación del destinatario,
tratamiento de grupos, guardado si está habilitado y evento `send.message`. La respuesta
`201` tiene el mismo formato preparado por ese flujo (campos como `key`, `message`,
`messageType`, `messageTimestamp`, `instanceId`), con un ID **nuevo** para el envío.
La forma exacta depende del tipo de contenido; `201` no acredita entrega ni lectura.
La apariencia final del indicador en WhatsApp y los tipos especiales necesitan prueba real.

| Resultado | Acción |
|---|---|
| `201` | Registrar `body.key.id` y el grupo; no reenviar automáticamente otra vez. |
| `400` por formato o query | Corregir cuerpo/URL. No mandar propiedades adicionales. |
| `400 Message not found in this instance` | Verificar ID y almacenamiento en la instancia de prueba. El getter heredado también oculta ciertos errores de base; revisar sus registros si existe el mensaje. |
| `400` por canal no compatible | Utilizar `WHATSAPP-BAILEYS`, cargado y conectado. |
| `401` | Seleccionar la nueva credencial `apikey` autorizada para esa instancia. |
| `404` de instancia/grupo | Revisar el nombre de instancia, pertenencia al grupo y conexión. Los helpers heredados pueden presentar algunos errores de grupo como `400`. |
| Timeout, red o error después de enviar | Comprobar si el mensaje llegó antes de repetir: el envío y el guardado no son una transacción con WhatsApp. |

No hay cola ni idempotencia añadidas. Se admiten texto, imagen, video, audio, PTV,
documento, sticker, contacto/lista de contactos y ubicación ordinaria. Se rechazan
wrappers de una sola visualización, efímeros, ediciones, mensajes de protocolo,
reacciones y tipos fuera de esa lista, incluso cuando se mezclan con texto.
Los documentos ya normalizados por la base se admiten; un wrapper
`documentWithCaptionMessage` aún sin normalizar se rechaza. La media original puede
haber expirado o dejar de estar disponible. Si la base ya descartó una envoltura o
metadato antes del almacenamiento, este endpoint no puede reconstruir su política
original. No se añade un mecanismo para eludir restricciones de WhatsApp.

El getter original devuelve la primera coincidencia de `key.id` dentro de la
instancia; no añade filtro por chat origen ni una clave única. IDs duplicados
entre chats de una misma instancia serían ambiguos. El alcance mantiene ese
getter sin modificarlo globalmente.

## Conservación de la vista previa de enlaces

La base 2.3.7 convierte `extendedTextMessage` en `conversation` antes de guardar,
eliminando título, descripción y miniatura. Este fork conserva ahora una copia
limitada de los campos originales de la tarjeta en
`message.__evolutionForwardPreview`, dentro de la columna JSON existente.
Se aplica al guardar mensajes recibidos, enviados e importados del historial.
No cambia el formato del webhook ni la normalización que utilizan n8n y Chatwoot.
La consulta autenticada de mensajes puede mostrar ese campo adicional en el JSON
almacenado; no contiene claves de la API.

`forwardMessage` reconstruye la tarjeta antes de generar el reenvío y elimina el
campo reservado antes de entregar el mensaje a Baileys. También conserva los
campos visuales de una tarjeta `externalAdReply` ya presente en el contexto,
sin restaurar citas, menciones, identificadores publicitarios ni contadores
anteriores. La marca de reenviado y su contador siguen a cargo de Baileys.

La copia se liga al texto original para no reutilizar una tarjeta de enlace
después de editarlo. En mensajes con estado `EDITED` se omite la tarjeta contextual
anterior. Se guardan únicamente los campos de vista previa permitidos, incluidos
los bytes y referencias de miniaturas de mayor resolución; no se descargan URLs
para fabricar una tarjeta nueva.

No requiere dependencias, migraciones ni cambios en el cuerpo del POST o el
workflow. Para probar la tarjeta ordinaria debes desplegar esta corrección en
el laboratorio y recibir un mensaje **nuevo** que ya muestre la vista previa.
Los campos descartados por versiones anteriores no se pueden recuperar de esa
fila. Una tarjeta contextual que ya esté en `contextInfo.externalAdReply` sí
puede conservarse al reenviar ese registro, salvo el caso editado descrito arriba.

La comprobación automatizada valida que los metadatos llegan a la generación de
Baileys. La representación final en WhatsApp requiere una prueba real; las
referencias de miniaturas o media originales pueden haber expirado.

## Adaptación a tu nodo HTTP actual

Tu nodo ya usa `POST`, `url = {{ $json.url }}` y
`jsonBody = {{ JSON.stringify($json.body) }}`. Puede conservar esas expresiones,
el batching de un item cada 2000 ms y el timeout de 60000 ms. Crea una **copia del
flujo** y una credencial Header Auth nueva (`apikey`) para el dominio de pruebas.
No reutilices la credencial ni los webhooks de producción.

El nodo que prepara cada envío debe producir:

```json
{
  "url": "https://evolution-forward-test.example.com/message/forwardMessage/forward-lab",
  "body": {
    "number": "120363000000000000@g.us",
    "messageId": "ID_RECIBIDO_EN_EL_WEBHOOK_DE_PRUEBAS"
  }
}
```

El archivo [n8n-forward-test.json](../examples/n8n-forward-test.json) contiene dos
nodos importables. Conéctalos a una rama de pruebas cuyos items tengan `groupJid`
y `messageId`. Edita solo el dominio y el nombre de instancia en el nodo de preparación;
selecciona la nueva credencial en el HTTP. No incluye credenciales, tokens ni IDs
de credenciales existentes. Las expresiones no dependen del nombre de tu Webhook.

Para obtener el ID en una rama inmediatamente después del webhook n8n, puede ser
`{{ $json.body.data.key.id }}` si el nodo Webhook entrega el evento en `body`, o
`{{ $json.data.key.id }}` si ya lo desenvolviste. Comprueba la estructura real del
evento; no tomes `key.id` de una respuesta de otro envío por accidente.

Como tienes `neverError: true` y respuesta completa, un `400` también continúa
por la salida normal. Añade una condición después del HTTP: éxito únicamente si
`statusCode === 201`; registra `body` en los demás casos. Con `continueRegularOutput`,
comprueba también errores de transporte. Mantén desactivados los reintentos
automáticos mientras no sepas si el envío se realizó.

Para evitar ciclos cuando añadas el webhook de salida, activa inicialmente solo
`MESSAGES_UPSERT` en la instancia, filtra `data.key.fromMe === false` y comprueba
el chat origen autorizado en el flujo de pruebas. No conviertas eventos `send.message`
en entradas que se vuelven a reenviar. Los dos segundos de separación son control
de ritmo, no garantía contra límites o restricciones de WhatsApp.
