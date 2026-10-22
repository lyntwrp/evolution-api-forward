# Repositorio propio y procedencia

Repositorio preparado: [lyntwrp/evolution-api-forward](https://github.com/lyntwrp/evolution-api-forward).
La rama que debes seleccionar es `forward-only-2.3.7`.

La rama de este trabajo es `forward-only-2.3.7`; su primer padre debe ser exactamente
el commit oficial `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`. No se fusionó el PR completo.
El tag oficial se llama **`2.3.7`**, sin prefijo `v`.

Comprueba desde la raíz:

```bash
git merge-base 2.3.7 forward-only-2.3.7
git diff 2.3.7...forward-only-2.3.7 --stat
git diff 2.3.7...forward-only-2.3.7 -- package.json package-lock.json prisma
```

El último comando no debe mostrar diferencias. El cambio ejecutable está limitado
a cinco archivos bajo `src/`; el resto son documentación, pruebas y empaquetado aislado.
Selecciona esta rama o su commit personalizado en Coolify, nunca una rama actual de upstream.

## Si lo publicas en otra cuenta de GitHub

1. En [el repositorio oficial](https://github.com/evolution-foundation/evolution-api),
   pulsa **Fork**, elige tu cuenta y un nombre como `evolution-api-forward`.
2. Descarga/clona este resultado revisado. Añade tu fork como remote sin sustituir
   el origen oficial y publica únicamente la rama preparada:

```bash
git remote rename origin upstream
git remote add origin https://github.com/TU-USUARIO/evolution-api-forward.git
git push -u origin forward-only-2.3.7
```

Si el checkout ya tiene `upstream`, omite el rename. No hagas force-push sobre una
rama existente con trabajo propio. Configura `forward-only-2.3.7` como rama predeterminada
en Settings → Branches/General según la interfaz de GitHub. Los workflows de
publicación heredados de upstream no son necesarios para Coolify: no los habilites
ni añadas secretos de producción. Coolify construye directamente este código.

No pulses Sync fork para actualizar la rama preparada sin revisar la diferencia:
eso puede añadir cambios ajenos a v2.3.7 + reenvío. Mantén la licencia y los avisos
del proyecto original. La creación/publicación del fork no despliega la aplicación.
