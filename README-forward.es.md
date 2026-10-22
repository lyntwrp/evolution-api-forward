# Evolution API 2.3.7 + forwardMessage

Fork de prueba basado en el tag oficial **2.3.7**, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`. Incorpora únicamente el reenvío
propuesto en el [PR #2595](https://github.com/evolution-foundation/evolution-api/pull/2595),
adaptado para conservar el flujo habitual de envío y limitar los riesgos del endpoint nuevo.
No se han cambiado dependencias, migraciones, autenticación global ni funciones de grupos.
Los cinco archivos modificados en `src/` contienen solo las adiciones relacionadas con reenvío.

**Uso de laboratorio.** La revisión no encontró indicios explícitos de código malicioso
en el diff, pero no garantiza seguridad. La base exacta conserva dependencias con
avisos conocidos, incluido Baileys rc.9 afectado por
[GHSA-qvv5-jq5g-4cgg](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg).
Consulta la auditoría antes de conectar una cuenta. No se ha accedido ni desplegado
en producción, ni se han copiado sus secretos o sesiones.

- [Endpoint, contrato y n8n](docs/forward-message.es.md)
- [Auditoría del PR completo](docs/audit/AUDITORIA-PR2595.md)
- [Resultados y límites de validación](docs/VALIDACION-forward.es.md)
- [Coolify: Dockerfile y Compose aislados](deploy/forward-test/README.es.md)
- [Nodos de ejemplo para importar en una copia del flujo n8n](examples/n8n-forward-test.json)
- [Fork y publicación en GitHub](docs/GITHUB-forward.es.md)

La licencia, los avisos y los recursos de marca del upstream se conservan.
Este es un derivado independiente para pruebas, no una versión oficial publicada por Evolution.
La propuesta de reenvío se atribuye a `alpesdigital-adm` en el PR #2595;
las adaptaciones y sus límites están descritos en la auditoría.

## Llamada mínima

`POST /message/forwardMessage/forward-lab`, header `apikey` con la **credencial nueva de pruebas**:

```json
{
  "number": "120363000000000000@g.us",
  "messageId": "ID_DE_DATA_KEY_ID_DEL_WEBHOOK_DE_PRUEBAS"
}
```

El ID debe existir en la misma instancia de prueba. Un ID exclusivo de producción
no aparece en su base independiente. No hay deduplicación: repetir la llamada puede
publicar dos mensajes. La instancia original y sus flujos de n8n permanecen sin cambios.

## Validación local

Con Node.js 24 y dependencias del lockfile oficial:

```bash
npm ci --ignore-scripts --no-audit --no-fund
DATABASE_PROVIDER=postgresql npm run db:generate
npm run build
npm run lint:check
node --test tests/forward-message.test.cjs
```

En PowerShell: `$env:DATABASE_PROVIDER='postgresql'` antes de `npm run db:generate`.
La instalación local con scripts omitidos se usó para compilar/probar el código,
no para acreditar las dependencias multimedia nativas en Linux. El Dockerfile de
laboratorio instala los scripts necesarios en su construcción. Docker y WhatsApp
real requieren las comprobaciones pendientes descritas en la guía de Coolify.
