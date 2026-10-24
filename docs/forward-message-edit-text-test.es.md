# Prueba: reenviar con otro texto conservando el preview

Rama: `test/forward-r2-edit-text`, creada desde R2
`5ab35ef5c017909fbaeb330dde1fdfb347fcce5d`.
Esta ampliación no está en el tag estable `forward-2-3-7-r2` ni modifica esa release.

## Petición

Se conserva `POST /message/forwardMessage/{instanceName}`, autenticado con
la credencial Header Auth `apikey`. Ahora puede añadirse **`text`**:

```json
{
  "number": "120363000000000000@g.us",
  "messageId": "ID_ORIGINAL_DEL_WEBHOOK",
  "text": "¡Promoción de hoy! Más información: https://ejemplo.com/producto"
}
```

Sustituye el destino y el ID por los de la prueba. El mensaje original del
ejemplo debe tener la tarjeta de `https://ejemplo.com/producto` y contener ese
enlace. La URL de la tarjeta debe estar guardada en esta instancia.

`text` reemplaza todo el texto de la copia reenviada. No edita el mensaje
original en WhatsApp ni su registro en la base de datos. La copia enviada se
guarda como un mensaje nuevo con un ID nuevo, usando el flujo habitual de R2.

- Si omites `text`, se conserva el comportamiento de R2 y su contrato anterior.
- En esta prueba, `text` se admite únicamente para mensajes de texto, incluidos
  los que llevan tarjeta. No sustituye captions de imágenes, videos o documentos.
  Esos contenidos siguen reenviándose normalmente al omitir `text`.
- El valor debe ser un string no vacío, con algún carácter distinto de espacios,
  y de hasta 65536 unidades de texto según la validación del servidor.
- No se permiten más propiedades ni query parameters. El resto de validaciones,
  autenticación y restricciones de tipos de R2 se conserva.

## Cuándo se conserva la tarjeta

Primero se recupera la tarjeta válida del mensaje original igual que en R2;
después se modifica exclusivamente una copia del contenido que se enviará.
Se mantienen título, descripción, miniatura y metadatos de mayor resolución,
además de la marca y el contador normal de reenvío.

Para cambiar el texto, **cada URL de tarjeta debe aparecer idéntica en el texto
original y en el texto nuevo, separada por espacios o saltos de línea**.
Se utiliza `matchedText` para la tarjeta normal y `sourceUrl` para una tarjeta
contextual `externalAdReply`. Si hay ambas tarjetas, se comprueban ambas URLs.

La comprobación es deliberadamente conservadora en esta rama. No se interpreta
como equivalente otro dominio, un enlace acortado, cambiar HTTP/HTTPS, añadir
parámetros o modificar la ruta. Evita pegar puntuación o paréntesis al enlace;
deja espacios a ambos lados. Si no puede demostrarse la coincidencia con una URL
guardada, se responde **400 antes de enviar**, sin perder la tarjeta original.

Ejemplo de mensaje original:

```text
Mira esta oferta: https://ejemplo.com/producto
```

Texto nuevo permitido:

```text
¡Promoción de hoy! Consulta los detalles:
https://ejemplo.com/producto
```

Cambiar o quitar el enlace de una tarjeta produce 400. No se genera otra tarjeta
ni se descargan URLs para fabricar un preview. Si conservas el enlace original
y añades otro, la tarjeta seguirá correspondiendo al original. Un texto origen
sin tarjeta puede cambiarse, pero no se inventa un preview para los enlaces nuevos.
Proporcionar exactamente el texto original no exige comprobaciones adicionales
de URL y conserva el comportamiento normal de R2.

Las tarjetas que ya eran obsoletas por una edición anterior no se recuperan al
poner su texto antiguo en `text`. Esta opción no elimina la protección de R2
contra tarjetas antiguas, citas, menciones, claves de grupo ni controles.

## Cómo probar con tu workflow n8n

1. En **el recurso de pruebas de Coolify**, selecciona la rama
   `test/forward-r2-edit-text` y despliega. Mantén Build strategy **Compose**,
   Base directory `/deploy/forward-test` y Docker compose location `/compose.yaml`.
   Conserva las variables propias de ese laboratorio.
2. Recibe un mensaje nuevo con enlace y tarjeta en la instancia de pruebas.
3. Copia su `data.key.id` y elige un destinatario controlado.
4. En una copia del nodo HTTP que ya funciona, añade `text` al objeto `body`
   que se entrega a `forwardMessage`, con el mismo enlace completo.
   Si el nodo usa `jsonBody = {{ JSON.stringify($json.body) }}`, conserva la
   expresión y añade `text` en el nodo que prepara ese objeto.
5. Ejecuta una sola vez y confirma `statusCode === 201`, un nuevo `body.key.id`,
   el texto sustituido y la tarjeta visible en el teléfono destino.
6. Comprueba un reenvío sin `text`: debe conservar el comportamiento anterior.
7. En una prueba aparte, cambia el enlace en `text`: debe devolver 400 y no enviar.

El Header Auth del Webhook Evolution → n8n sigue igual. No confundas ese token
con la credencial `apikey` del nodo HTTP n8n → Evolution.

Un error 400 de URL se reconoce por:
`Replacement text must keep each original preview URL as a separate word`.
Si el error es `Replacement text is only supported for text messages`, el origen
es un contenido diferente de texto. Para reenviarlo sin cambios, omite `text`.

No hay idempotencia añadida: un timeout o fallo después de enviar requiere revisar
el destino antes de repetir. Los riesgos heredados y dependencias de R2 permanecen.
No se actualiza Baileys, el Manager, Prisma, los webhooks ni los métodos de grupos.
