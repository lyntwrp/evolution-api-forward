# Versiones congeladas del fork

Base oficial: tag `2.3.7`, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`.
El fork conserva sus dependencias, incluido Baileys `7.0.0-rc.9`.
Estas versiones identifican cambios funcionales; no son una certificación de
seguridad ni corrigen los riesgos heredados descritos en la
[auditoría](audit/AUDITORIA-PR2595.md).

## R1: reenvío probado

- Tag: `forward-2-3-7-r1`.
- Commit de código: `30ee9e1d1b60ce0af462546c666ff0f1fdbacbb7`.
- Incluye `forwardMessage`, conservación de tarjetas, aislamiento del contenido
  reenviado y eliminación de tarjetas obsoletas después de editar mensajes.
- El usuario confirmó la prueba real de esta versión en el laboratorio.
- Conserva el despliegue de laboratorio en `deploy/forward-test`.

El tag debe apuntar directamente a ese commit. La preparación de documentación
posterior no modifica retroactivamente lo que se probó. Consulta los detalles y
límites de las comprobaciones en [VALIDACION-forward.es.md](VALIDACION-forward.es.md).

## R2: Manager y preparación de producción independiente

- Rama de preparación: `release/forward-2-3-7-r2`.
- Tag: `forward-2-3-7-r2` (candidata pendiente de prueba real con n8n).
- Parte de R1 y prepara los ajustes de Manager para webhook con cabeceras,
  más el despliegue separado en `deploy/forward-production`.
- Bloquea las redirecciones HTTP al enviar cabeceras personalizadas, para no
  trasladar el token a otro destino. Utiliza la URL final del receptor.
- El reenvío y sus dependencias conservan la base de R1; las modificaciones de
  interfaz deben comprobarse por separado.
- Esta documentación no afirma que R2 esté desplegada ni probada con una sesión
  real. Registra el commit final y el resultado de esa prueba antes de activarla.

La guía de instalación está en
[deploy/forward-production/README.es.md](../deploy/forward-production/README.es.md).
Seleccionar una rama permite recibir cambios futuros; seleccionar y registrar
el commit completo identifica exactamente el código de esa instalación.

## Dependencias conservadas

No se debe modificar `package.json` ni regenerar el lockfile para poner el nombre
del fork. La versión npm permanece `2.3.7`; el nombre de release se registra en
el tag y en las etiquetas OCI de la imagen. Así se evita mezclar cambios de
dependencias con una modificación de presentación.

Hashes SHA-256 de los **bytes almacenados en Git** en R1:

| Archivo | SHA-256 |
|---|---|
| `package.json` | `5006d0ae1cbd0566835a9152840593497565a4eb1b6f2541a5c7a7a8d6e4ad30` |
| `package-lock.json` | `f86969cbdd228dd1391c2e8538873b0ab519d8a12c366258c4e095564ede3b1f` |

Los hashes de un checkout Windows pueden diferir por conversión de finales de
línea. La comparación entre commits evita esa ambigüedad:

```bash
git diff 30ee9e1d1b60ce0af462546c666ff0f1fdbacbb7 HEAD -- package.json package-lock.json prisma
```

Para R2 esa comparación debe quedar vacía. `npm ci` conserva las versiones del
lockfile; una construcción sigue ejecutando scripts de las dependencias
heredadas. El commit no fija las actualizaciones de imágenes base ni paquetes
Alpine. Para reutilizar exactamente los binarios probados, promueve la misma
imagen y despliega su digest; conserva además los digests de PostgreSQL y Redis.

## Publicación y automatizaciones heredadas

Los nombres propuestos no llevan puntos para evitar el patrón `*.*.*` del
workflow heredado `.github/workflows/publish_docker_image.yml`. Ese workflow
construye el Dockerfile raíz y apunta al registro de imágenes del proyecto
original. No debe utilizarse para publicar este fork. Los pushes a `main` o
`develop` también tienen publicación automática heredada; no uses esas ramas
para estas versiones.

Una etiqueta como `2.3.7-forward.1` **sí coincide** con ese patrón. Antes de adoptar
etiquetas de ese tipo, reemplaza o desactiva explícitamente la publicación
heredada y configura el registro propio. No añadas secretos de producción para
intentar completar un workflow heredado.

Los tags pueden borrarse o moverse si los permisos lo permiten; conserva el SHA
completo y aplica reglas de protección cuando estén disponibles. No hagas
force-push ni muevas un tag ya usado por una instalación. Una nueva corrección
requiere otro identificador y su validación correspondiente.

La publicación del código o de un tag no verifica una imagen ni una instalación.
En Coolify, desactiva el despliegue automático de la instalación estable y
confirma el commit que aparece antes de cada actualización deliberada.
