# Validación del fork de prueba

Fecha: 22 de octubre de 2026. Base: etiqueta oficial `2.3.7`, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`. Head del PR inspeccionado:
`2765f4288561d9da55f4e3e9c1f9c41a72dc138b`.

## Resultados ejecutados

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
