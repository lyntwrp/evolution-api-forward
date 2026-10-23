# Aviso de demora en Integrations

Revisión del 23 de octubre de 2026. Se reprodujo localmente el aviso con el código
real de los controladores, las consultas del Manager y la configuración de
`deploy/forward-test/compose.yaml`. No se consultaron credenciales ni respuestas
del servidor del usuario, y no se activó ninguna integración.

## Causa reproducida

El Compose de pruebas desactiva N8n, EvoAI, Dify, Typebot, OpenAI y Chatwoot.
Flowise queda desactivado por su valor predeterminado. El menú del Manager muestra
esas opciones aunque el servidor las tenga desactivadas.

Al abrir n8n, por ejemplo, el Manager consulta `/n8n/find/{instancia}`. La API
responde HTTP 400 con `N8n is disabled`. El Manager reintenta hasta completar
cuatro intentos y muestra el aviso genérico:

> The application is taking longer than expected to load, please try again in a few minutes.

Eso no significa necesariamente que la aplicación esté tardando en cargar.
En la reproducción, el rechazo ocurre antes de consultar la base de datos.
El código de las integraciones no fue modificado por el reenvío; el Manager
parte de la misma revisión fijada en Evolution 2.3.7.

Si el despliegue usa los valores de nuestro Compose, esta es la causa esperada.
Que otra instalación oficial funcione es compatible con que tenga esos módulos
habilitados. No se ha comparado su configuración efectiva.

## Cómo confirmarlo en tu instalación

1. Abre las herramientas de desarrollador del navegador y la pestaña **Network / Red**.
2. Abre la integración que falla y busca su petición `find`.
3. Revisa únicamente el estado HTTP y el mensaje de **Response / Respuesta**.
   Si dice `is disabled`, coincide con este diagnóstico.

No compartas la petición completa, las cabeceras `apikey`, los tokens, ni archivos
HAR sin sanitizar. Un 401/403, 404, 500 o un error de red necesita otro diagnóstico.
**EvolutionBot es una excepción:** no depende de uno de estos indicadores; si
ese apartado falla, no se explica por las variables descritas aquí.

## Qué cambiar si necesitas una integración interna

Para n8n interno se necesita `N8N_ENABLED=true` dentro del contenedor. En el Compose
de pruebas está fijado como `false`: añadir una variable con ese nombre en Coolify
no sustituye un valor literal del YAML. Habría que cambiar ese ajuste del Compose
y volver a desplegar. No se hizo, porque esta revisión solicitó solo diagnóstico.

El nuevo Compose de producción sí expone `FORWARD_PROD_N8N_ENABLED` y los
equivalentes de los otros módulos; elige únicamente el que vayas a configurar.
Activar un módulo puede requerir sus propios ajustes adicionales.

**El webhook que recibe tu workflow n8n funciona con `N8N_ENABLED=false`.**
Ese indicador corresponde al módulo de bots interno de Evolution, no al envío
HTTP de eventos ni al nodo de reenvío existente.
