# Proteger Evolution → n8n con Header Auth

Disponible en R2. El reenvío y las vistas previas conservan el código de R1.
No hace falta recrear el flujo ni activar la integración interna `N8N_ENABLED`.

## 1. Configurar el nodo Webhook de n8n

1. Abre el flujo y su primer nodo **Webhook** (el que recibe los eventos).
2. Conserva **POST**, su ruta y el resto de sus ajustes.
3. En **Authentication**, elige **Header Auth**.
4. En la credencial que aparece, elige crear una nueva.
5. Escribe **Name**: `X-Evolution-Webhook-Token`.
6. En **Value**, pega un secreto nuevo y aleatorio que guardarás también en
   Evolution. Puedes generarlo con tu gestor de contraseñas; usa al menos
   32 caracteres aleatorios sin espacios ni saltos de línea. No uses la API key.
7. Guarda la credencial y el flujo. Publica/activa el flujo según tu versión
   de n8n. Copia su **Production URL**, que debe comenzar con `https://`.

La [documentación oficial de n8n](https://docs.n8n.io/integrations/builtin/credentials/webhook/)
describe esta credencial por nombre y valor. El token es un valor literal:
no añadas `Bearer` salvo que hayas elegido expresamente `Authorization` y el
mismo valor completo en ambos extremos.

## 2. Configurar Evolution Manager

1. Abre tu instancia y entra en **Eventos → Webhook**.
2. Mantén la URL de producción de n8n y los eventos de tu flujo. En el flujo
   simple de reenvío, `MESSAGES_UPSERT` está activo y **Webhook por Eventos**
   está desactivado.
3. En **Autenticación por cabecera**, pulsa **Añadir cabecera**.
4. En **Nombre de la cabecera** deja `X-Evolution-Webhook-Token`.
5. En **Token / valor**, pega exactamente el mismo secreto de n8n.
6. Pulsa **Guardar**, al final de la página. Recarga para confirmar que la
   cabecera sigue presente; el token aparece oculto.

Usa la URL final, sin redirecciones. R2 no sigue redirecciones cuando se envían
cabeceras personalizadas. El nombre `jwt_key` tiene una función especial heredada
de generación JWT; no lo uses como nombre de la cabecera estática.

## 3. Probar

Realiza el cambio durante una pausa de envíos: mientras los dos extremos no
coincidan, n8n rechazará las peticiones. Después envía un mensaje nuevo al número
de pruebas y revisa que se inicia la ejecución y llega el reenvío. Prueba también
un enlace cuya tarjeta aparezca en el original.

Un `401` señala credenciales ausentes o distintas; revisa nombre y valor en ambos
extremos. Evolution trata ese estado como no reintentable. Una `404` puede indicar
URL incorrecta o flujo sin publicar; no uses la Test URL para operación continua.
No publiques capturas con el valor visible ni exportes credenciales para pedir ayuda.

## Las dos credenciales son distintas

| Dirección | Configuración |
|---|---|
| Evolution → Webhook n8n | Token nuevo en `X-Evolution-Webhook-Token`. |
| Nodo HTTP n8n → Evolution | Credencial existente `apikey` para llamar a `forwardMessage`. |

No modifiques la credencial del nodo HTTP por este cambio. El cuerpo del evento
y el contrato `POST /message/forwardMessage/{instancia}` siguen iguales.

Ocultar el campo no cifra el token: Evolution conserva las cabeceras en su base
de datos y sus administradores pueden consultarlas. Usa HTTPS, protege la base y
rota el secreto si se expone. Header Auth autentica al emisor que conoce el token;
no incorpora firma por mensaje ni protección adicional contra repetición.
