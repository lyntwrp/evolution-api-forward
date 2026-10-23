# Manager: cabeceras de autenticación en Webhook

Fuente oficial fijada por el submódulo: `f054b9bc28083152d4948f835e3346fd0add39db`.
`webhook-header-auth.patch` contiene los cambios de código revisables: formulario,
validación, tipo de datos y traducciones. No cambia dependencias del Manager.
`manager/dist` contiene la compilación que utiliza el Dockerfile; Coolify no
necesita descargar ni construir el submódulo para utilizarla.

Desde la raíz del repositorio, para reproducirla con Node 24 y npm:

```bash
git submodule update --init evolution-manager-v2
node manager-customization/build.cjs
```

El script exige la revisión exacta y un submódulo limpio, aplica el parche,
instala el lockfile existente con `npm ci --ignore-scripts`, compila, reemplaza
únicamente `manager/dist`, registra sus hashes y revierte su parche al terminar.
No ejecutarlo mientras se esté editando ese submódulo. No cambiar el gitlink a
un commit local sin publicar: todo el código añadido está incluido en el parche.
`bundle-manifest.json` identifica fuente, parche y archivos generados.

Pruebas del conversor/validador desde la raíz, con las dependencias del backend:

```bash
node --test tests/manager-webhook-headers.test.cjs
```

La prueba extrae el helper del parche publicado y ejecuta su implementación;
la compilación del Manager verifica además los tipos con sus propias versiones.
El formulario mantiene cabeceras preexistentes, permite eliminarlas y oculta el
valor. Rechaza nombres duplicados sin distinguir mayúsculas, nombres inválidos
y saltos de línea. Un fallo al cargar impide guardar una configuración vacía
sobre las credenciales existentes. No imprime errores Axios completos.

El backend oficial ya guardaba y enviaba `webhook.headers`; R2 añade su edición
visual y bloquea redirecciones cuando hay cabeceras personalizadas para evitar
reenviar credenciales a otro destino. El token permanece en la base de datos
según el mecanismo existente, sin cifrado adicional.
