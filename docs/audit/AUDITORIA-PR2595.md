# Auditoría estática del PR #2595 y criterio para extracción mínima

Fecha: 22 de octubre de 2026. Revisión del diff descargado, sin ejecutar el código de la rama propuesta, sin conectarse a WhatsApp, sin acceder a producción y sin copiar credenciales.

## Conclusión

No encontré indicios explícitos de código malicioso en los cambios de aplicación y automatización revisados: no aparecen destinos de exfiltración añadidos, captura de secretos, ejecución dinámica u órdenes ocultas, operaciones destructivas sobre datos del usuario ni supresión de autenticación. Esto **no constituye una garantía de seguridad**. Es una revisión estática acotada del diff; no una auditoría completa de Evolution API, Baileys, las dependencias publicadas, GitHub Actions o WhatsApp.

**No se debe fusionar el PR completo para satisfacer esta solicitud.** El snapshot real comprende 21 archivos, 16 commits, 1096 adiciones y 524 eliminaciones. Además de `forwardMessage`, cambia administración de grupos, estado leído/no leído, autenticación persistida, reconexiones, eventos webhook, metadatos, dependencias y CI. La descripción inicial «No new dependencies» no describe el snapshot actual: el lockfile añade dependencias transitivas y cambia la biblioteca criptográfica.

La opción adecuada es extraer únicamente DTO, esquema, ruta, controlador y método de reenvío sobre el tag oficial exacto `2.3.7`, con validaciones locales y protección de selección de instancia en la nueva ruta. Los defectos de fiabilidad y seguridad señalados abajo deben corregirse en esa extracción mínima.

**La base exacta conserva vulnerabilidades conocidas**, incluida una crítica aplicable a Baileys rc.9. El parche de reenvío preparado satisface el alcance funcional y puede probarse en el laboratorio aislado; no debe presentarse como una actualización de seguridad ni recomendarse para sustituir producción sin resolver ese riesgo en un cambio separado.

## Evidencia y procedencia

| Elemento | Valor inspeccionado |
|---|---|
| PR | [PR oficial #2595](https://github.com/evolution-foundation/evolution-api/pull/2595) |
| Estado del snapshot | Abierto, no fusionado |
| Head | `2765f4288561d9da55f4e3e9c1f9c41a72dc138b` |
| Base del PR | `main`, `fa09d37892cdbb1d65a250155d293d92230c5b30` |
| Base solicitada para el fork | Tag oficial `2.3.7`, `cd800f2976e1e5b682fbf86a01ee4d85ae61f370` |
| Diff conservado | `pr-2595.diff` |
| Metadata conservada | `provenance.json` |
| SHA-256 del diff descargado | `27d788305d4a328f2370fa08cdb5d195c00ab1512b216acf283875a3912bc6b5` |

La base del PR es distinta del commit solicitado; un merge o cherry-pick masivo no demuestra que el resultado sea exclusivamente v2.3.7 más reenvío. Los números `+N` indicados a continuación se refieren al lado nuevo de los hunks de este snapshot del PR. El PR puede cambiar después de esta revisión; el hash limita la conclusión a los bytes conservados.

## Hallazgos relevantes

### A. Riesgo alto heredado: selección de otra instancia mediante query

En la base oficial, `src/api/abstract/abstract.router.ts:35-37` asigna `request.query` sobre `request.params` dentro de `dataValidate`, después de los guards. `src/api/guards/auth.guard.ts` autoriza usando la instancia de la ruta. Una solicitud autorizada para la instancia A puede contener `?instanceName=B` y cambiar la instancia usada posteriormente por el controlador. La nueva ruta del PR utiliza ese mecanismo. El PR completo introduce una mitigación general en `abstract.router.ts`, hunk `+17` y `+49`, que descarta `instanceName` e `instanceId` provenientes del query.

Este defecto **no fue introducido por la funcionalidad de reenvío ni es indicio de intención maliciosa**. Sin embargo, un backport literal de los cinco archivos de reenvío heredaría el riesgo. Recomendación: en la nueva ruta rechazar los query parameters protegidos, o fijar explícitamente la instancia autenticada tomada de la ruta antes de llamar a `dataValidate`. Cubrir esa decisión con una prueba de que un query no puede reenviar desde otra instancia. No es necesario modificar globalmente todas las rutas para incorporar esta protección a `forwardMessage`.

### B. Validación insuficiente del destinatario y de campos vacíos

En `src/validate/message.schema.ts`, hunk `+65`, el PR solo declara los campos string y reutiliza `isNotEmpty`. El helper heredado usa `if.propertyNames.enum`: la condición puede dejar de aplicar si se incluye una propiedad adicional, por lo que no es equivalente a poner `minLength` en cada campo. Tampoco limita longitud ni prohíbe propiedades adicionales.

En `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, hunk `+586`, cualquier string que contenga `@` se envía a Baileys sin comprobar sufijo ni forma. Si no contiene `@`, elimina cualquier carácter no numérico. No observé inyección de shell o SQL en esa expresión; el problema es la aceptación ambigua de destinatarios y entradas inválidas.

Recomendación: declarar `minLength`, límites de longitud, `additionalProperties: false` y una lista explícita de formatos admitidos en el nuevo esquema; para esta necesidad bastan número internacional, JID de teléfono `@s.whatsapp.net` y grupo `@g.us`, incluyendo el formato legado con guion cuando corresponda. No aceptar URLs, emails arbitrarios ni objetos de mensaje completos desde HTTP. Mantener `number` y `messageId` para que n8n pueda usar el contrato solicitado.

### C. La operación propuesta evita parte del flujo normal de envío

El método del PR llama directamente `this.client.sendMessage(jid, { forward: fullMsg })`. No pasa por `sendMessageWithTyping`, que en v2.3.7 ejecuta comprobaciones de destinatario/grupo y realiza explícitamente persistencia del mensaje enviado, integración Chatwoot, almacenamiento multimedia y emisión del webhook `SEND_MESSAGE`.

No significa que el resto de endpoints se rompa: permanecen sin cambios en una extracción mínima. Sí significa que **no se debe prometer que el nuevo endpoint tiene idénticos efectos de persistencia y webhooks que `sendText`**. Si se conserva el comportamiento mínimo del PR, documentar que devuelve la respuesta de Baileys y que no ejecuta explícitamente ese flujo. Los eventos de la biblioteca que puedan llegar después no sustituyen una garantía contractual ni fueron comprobados con una sesión real.

### D. Obtención del mensaje y errores

El método reutiliza `getMessage({ id: messageId }, true)`. En la base v2.3.7, `whatsapp.baileys.service.ts:523` usa una consulta SQL parametrizada por `this.instanceId` y `key.id`; no concatena `messageId` en SQL. Esto evita una inyección SQL evidente y restringe la búsqueda a la instancia seleccionada. No filtra por chat origen, por lo que depende de que el ID sea suficiente dentro de esa instancia.

El getter heredado captura cualquier error de base de datos y devuelve un objeto de fallback; el PR termina presentando tanto ausencia como ciertos fallos de almacenamiento como error de reenvío. También incluye `error.toString()` en la respuesta. Recomiendo errores acotados para no exponer detalles internos y distinguir ausencia, instancia desconectada y error de envío cuando se pueda sin cambiar el contrato global.

Un `messageId` de producción **no sirve por sí solo en una base de prueba independiente**. El mensaje debe existir en la tabla `Message` de la instancia de prueba; esa cuenta debe tener acceso al chat y a la media necesaria. No compartir ni copiar la base de producción para resolverlo. Usar mensajes nuevos recibidos/sincronizados y almacenados por la cuenta de prueba. Repetir una solicitud puede producir otro mensaje: el PR no añade idempotencia.

### E. Ampliación de la cadena de suministro fuera de alcance

`package.json`, hunk `+77`, actualiza Baileys de `7.0.0-rc.9` a `7.0.0-rc14`. `package-lock.json`, hunks `+5773`, `+10563` y `+15736`, cambia `libsignal` desde un commit Git de `whiskeysockets/libsignal-node` a `libsignal@6.0.0` del registro npm y añade `whatsapp-rust-bridge@0.5.4`. También actualiza familias Jimp/Protobuf y parsers multimedia, añade `win-guid` y elimina dependencias transitivas anteriores.

Los `resolved` añadidos que aparecen en el diff apuntan a `registry.npmjs.org` y llevan hashes de integridad. Eso no prueba que los tarballs sean seguros ni que equivalgan al código esperado. No se inspeccionaron todos los tarballs ni sus scripts. Para el fork solicitado deben mantenerse **idénticos** `package.json` y `package-lock.json` de v2.3.7; el código de reenvío no necesita esta actualización. Un hash de integridad detecta bytes distintos, no benignidad.

### F. Riesgos operativos de los otros cambios

La nueva cola global de `groupMetadata` en `whatsapp.baileys.service.ts`, hunks `+237` y `+4356`, serializa solicitudes de todas las instancias con dos segundos entre operaciones. No observé intención maliciosa, pero una operación pendiente/fallida puede retrasar otras y la cola no tiene límite. Las modificaciones de reconexión en `+275`, `+454` y `+755` permiten reconectar tras `loggedOut` dentro de una ventana temporal; necesitan pruebas propias. Las modificaciones de leído/LID cambian datos enviados a consumidores webhook y pueden afectar su compatibilidad. Todo ello debe excluirse del backport solicitado.

## Inventario de todos los archivos cambiados

| Archivo del PR | Cambio revisado | Decisión para el fork |
|---|---|---|
| `.github/workflows/release-read-state.yml` | Workflow de Node 24, instalación, Prisma, test de read-state, lint, build Docker y carga de imagen comprimida como artifact GitHub. Permiso `contents: read`; sin secretos explícitos ni publicación a un registro externo. Actions por tag, no SHA. | Excluir; no es necesario para reenviar. |
| `package-lock.json` | Refresh extenso de transitivas, registros/hashes, cambio de Baileys/libsignal, nuevos `whatsapp-rust-bridge`/`win-guid`, deduplicación y eliminación de paquetes. | Excluir completo. |
| `package.json` | Baileys rc14 y reordenamiento de `fetch-socks`, que ya existía. | Excluir completo. |
| `src/api/abstract/abstract.router.ts` | Filtrado de campos protegidos desde query; comentario de creación de instancia. | Excluir modificación global; proteger localmente la ruta nueva. |
| `src/api/controllers/group.controller.ts` | Cuatro funciones de administración de grupos. | Excluir. |
| `src/api/controllers/sendMessage.controller.ts` | Import y delegado `forwardMessage`. | Extraer únicamente esto. |
| `src/api/dto/chat.dto.ts` | `lastMessage` en solicitud de marcar leído. | Excluir. |
| `src/api/dto/group.dto.ts` | DTO para modos de grupo y solicitudes de participantes. | Excluir. |
| `src/api/dto/sendMessage.dto.ts` | DTO con `number` y `messageId`. | Extraer únicamente esto. |
| `src/api/integrations/channel/whatsapp/read-state.ts` | Nuevo módulo de 171 líneas: validación de lectura, recibos, app-state y mapeo PN/LID. Sin IO arbitrario añadido: recibe callbacks del socket. | Excluir. |
| `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` | Reenvío más numerosos cambios de reconexión, MAC, leído/LID, metadata/cache y administración de grupos. | Incorporar solo import DTO, método de reenvío y una rama acotada del helper existente que permita conservar persistencia/webhooks. |
| `src/api/routes/group.router.ts` | Cuatro endpoints nuevos protegidos por los guards existentes. | Excluir. |
| `src/api/routes/sendMessage.router.ts` | Import DTO/esquema y ruta `forwardMessage` con guards existentes. | Extraer con protección local de instancia. |
| `src/utils/use-multi-file-auth-state-prisma.ts` | `AppStateSyncKeyData.create` → `fromObject`. | Excluir. |
| `src/utils/use-multi-file-auth-state-provider-files.ts` | Mismo cambio de rehidratación de claves. | Excluir. |
| `src/utils/use-multi-file-auth-state-redis-db.ts` | Mismo cambio de rehidratación de claves. | Excluir. |
| `src/validate/chat.schema.ts` | Solicitud leído con `lastMessage`, timestamp y arrays vacíos condicionados. | Excluir. |
| `src/validate/group.schema.ts` | Esquemas de cuatro endpoints de administración. | Excluir. |
| `src/validate/message.schema.ts` | Esquema para dos campos del endpoint de reenvío. | Extraer y endurecer exclusivamente el nuevo esquema. |
| `test/auth-state-key.test.ts` | Test local de bytes/base64 para claves persistidas; carga Baileys. | Excluir; no prueba reenvío. |
| `test/read-state.test.ts` | 196 líneas de mocks/contrato para leído, mapeos y fallos parciales. Sin llamadas reales a WhatsApp. | Excluir; no prueba reenvío. |

## Riesgos heredados y límites del dictamen

- La base v2.3.7 conserva sus dependencias y defectos anteriores. «Base oficial exacta» no equivale a «base libre de vulnerabilidades». Se ejecutó `npm audit`; se detalla su resultado a continuación. Esto no es un pentest ni un análisis manual de todos los paquetes.
- El helper `getMessage` existente usa SQL JSON de PostgreSQL; la configuración de prueba debe usar PostgreSQL. No se debe prometer compatibilidad con MySQL de esta nueva función sin probarla.
- La base trae telemetría habilitada por defecto en `.env.example` y `src/config/env.config.ts`. El diff no la añade ni añade nuevos eventos de telemetría; para la prueba puede configurarse `TELEMETRY_ENABLED=false` sin modificar el código.
- Proteger el endpoint mediante HTTPS y una API key nueva. Quien tenga autorización para la instancia obtiene capacidad de reenviar contenido almacenado a un destinatario; ese es el efecto funcional solicitado, no una autorización adicional de WhatsApp.
- Reenvío de media, mensajes especiales, contenido efímero, formato de bytes guardado y restricciones de WhatsApp necesitan prueba con una cuenta propia de laboratorio. No se certifica entrega, marca de reenvío para todos los tipos ni disponibilidad futura de media.
- El build (`tsc --noEmit` y `tsup`) y el lint completo han pasado para la extracción; las pruebas específicas se documentan en el informe de validación final. Estos resultados prueban aspectos del código; no certifican ausencia de código malicioso ni sustituyen una prueba real aislada. No se comprobó una sesión real ni se enviaron mensajes en esta auditoría.
- No se verificaron firmas de todos los commits ni provenance de todos los binarios de terceros. No se analizó cada cambio interno de las dependencias nuevas; por eso se excluyen.

## Resultado de `npm audit` en la base conservada

La salida conservada en `npm-audit.json` registra **110 entradas de paquetes afectadas**: 4 críticas, 43 altas, 61 moderadas y 2 bajas. Incluye dependencias de desarrollo y transitivas; npm también propaga afectación a paquetes que dependen de otros. **No significa 110 fallos distintos explotables demostrados** en esta instalación ni 110 vectores comprobados contra el endpoint.

SHA-256 de esa salida: `d63082ec85bfd4816a608509c4d6164b1d740981fa49bf7b4ad09891deaa6061`. La comparación de Git confirma que `package.json` y `package-lock.json` permanecen iguales a los del commit oficial solicitado. La versión instalada de Baileys es `7.0.0-rc.9`.

Dos avisos relevantes contrastados con sus fuentes primarias:

- **Baileys, GHSA-qvv5-jq5g-4cgg / CVE-2026-48063:** el rango afectado de v7 es `>=7.0.0-rc.1 <7.0.0-rc12`; rc.9 está incluido. El aviso describe mensajes/eventos e historial falsificados y corrupción de sincronización de app-state mediante eventos de protocolo manipulados. La versión de reparación indicada es rc12. El fork de base exacta **conserva ese riesgo**; su aislamiento respecto a producción no corrige el protocolo vulnerable. [Aviso del proyecto Baileys](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg).
- **Protobufjs, GHSA-xq3m-2v4x-88gg / CVE-2026-41242:** afecta versiones anteriores a 7.5.5 y requiere que el atacante controle un esquema o descriptor que se cargue en la generación dinámica de código. El reenvío usa el esquema estático incluido en Baileys y no acepta descriptores del usuario; de este hallazgo **no se infiere explotación directa por `forwardMessage`**. Esto no descarta las otras entradas del audit ni otros usos de protobuf en la aplicación. [Aviso de protobuf.js](https://github.com/advisories/GHSA-xq3m-2v4x-88gg).

No se ejecutó `npm audit fix` ni se actualizó automáticamente ninguna dependencia: alteraría el alcance «v2.3.7 oficial exacta más reenvío» y podría introducir cambios funcionales ajenos. La corrección de dependencias debe tratarse como trabajo separado, con un nuevo inventario, diff y pruebas; conservar la base por solicitud del usuario no convierte esas vulnerabilidades en aceptables para producción.

## Diferencias intencionales verificadas en la extracción mínima

La extracción implementada no copia literalmente los defectos del método original. La revisión del diff final de aplicación confirma **cinco archivos fuente y 116 líneas añadidas, sin eliminaciones**. Estas adaptaciones se verificaron estáticamente; el resultado de pruebas se documenta por separado:

- El nuevo esquema prohíbe propiedades adicionales y declara directamente longitud y formatos de destinatario.
- La ruta rechaza todos los query parameters, cerrando localmente el riesgo de sobrescribir la instancia sin cambiar `RouterBroker` para otros endpoints.
- El controlador rechaza canales que no implementen reenvío de Baileys con un error acotado.
- El método rehidrata los datos guardados con `BufferJSON.reviver`, el helper existente `deserializeMessageBuffers` y el esquema `proto.WebMessageInfo.fromObject`; restaura `contextInfo` separado para texto que la base guardó como `conversation`.
- Se limita el contenido origen a tipos ordinarios documentados. Se rechazan wrappers efímeros/de una sola visualización, ediciones y controles, también si se mezclan con texto; no se intenta eludir sus restricciones. Los datos que la base ya haya descartado antes de almacenarlos no se pueden recuperar.
- El envío se integra con `sendMessageWithTyping` y una rama específica de reenvío dentro del helper de envío. Así puede conservar la persistencia, el webhook de envío y el tratamiento normal de grupos existentes, en vez del `client.sendMessage` directo del PR.
- Usa `force: true` en el contenido de reenvío para solicitar explícitamente el marcado de reenviado, también para mensajes originalmente enviados por la propia cuenta. La implementación instalada de Baileys rc.9 acepta esa opción y aumenta el contador al generar el contenido reenviado; su representación final en los clientes WhatsApp y todos los tipos de mensaje requieren una prueba real aislada.
- Se conservan íntegros los manifests y lockfile oficiales v2.3.7; no se importan las actualizaciones de Baileys, libsignal ni transitivas.

Estas adaptaciones forman parte de la funcionalidad de reenvío y su seguridad local. No justifican incorporar el resto de cambios del PR. Que se preserve el flujo habitual también conserva los efectos de las integraciones que el operador decida habilitar; el laboratorio debe arrancar con integraciones externas deshabilitadas o destinos propios de prueba.

## Comprobaciones exigidas a la extracción

1. Confirmar el commit base oficial y conservar la evidencia de `git diff` frente a ese commit.
2. Cambios de aplicación limitados a los cinco archivos del reenvío; sin modificaciones de dependencias, autenticación global, grupos ni eventos existentes.
3. Mantener guards y validar que un query no cambia la instancia autorizada; búsqueda del mensaje confinada al `instanceId` de prueba.
4. Pruebas de formato de grupo, destinatarios inválidos, campos vacíos/adicionales, mensaje ausente, instancia desconectada y error de SDK; build y lint.
5. Infraestructura con PostgreSQL, Redis, volúmenes, credenciales, dominio y sesión de WhatsApp independientes. No usar red/volúmenes `external` de producción ni restaurar sus datos.
6. Ejecutar la prueba real solo al desplegar y emparejar la nueva cuenta autorizada; no modificar la instancia de producción ni afirmar que esa prueba ya se realizó.

## Fuentes primarias

- [PR original #2595](https://github.com/evolution-foundation/evolution-api/pull/2595) y [diff original](https://github.com/evolution-foundation/evolution-api/pull/2595.diff).
- [Snapshot del head auditado](https://github.com/alpesdigital-adm/evolution-api/tree/2765f4288561d9da55f4e3e9c1f9c41a72dc138b).
- [Base oficial solicitada](https://github.com/evolution-foundation/evolution-api/tree/cd800f2976e1e5b682fbf86a01ee4d85ae61f370).
- [Aviso de seguridad Baileys](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg) y [aviso de seguridad protobuf.js](https://github.com/advisories/GHSA-xq3m-2v4x-88gg).

Los archivos locales de evidencia son el material efectivamente leído; los enlaces permiten contrastarlo. Este documento audita el PR original y orienta la extracción; la validación del parche final debe documentarse separadamente.
