# Example Company - Verificación Documental de Motocicletas

Aplicación web construida con React + Vite + TypeScript + TailwindCSS para simular la validación documental de expedientes de motocicletas.

## Características

- Interfaz operativa con identidad Example Company.
- Portal de validación en `/validation`.
- Carga de 4 documentos con estado por slot:
  - Factura
  - Certificado de origen
  - Fotoplaca
  - Fotoserial
- Validación simulada (mocks) para:
  - tipo documental
  - coincidencia de placa
  - coincidencia de serial
  - estado general del expediente
- Dashboard de resultados con checklist, mensajes y acciones condicionales.
- Preparado para despliegue SPA en AWS Amplify.

## Stack

- React 18
- Vite
- TypeScript
- TailwindCSS
- React Router DOM

## Estructura del proyecto

```text
src/
  components/
    layout/
    ui/
    validation/
  pages/
    HomePage.tsx
    ValidationPortalPage.tsx
  mocks/
    documents.ts
    validation.ts
  types/
    validation.ts
  data/
    homeContent.ts
  assets/
  App.tsx
  main.tsx
```

## Instalación

```bash
npm install
```

## Desarrollo local

```bash
npm run dev
```

App disponible por defecto en `http://localhost:5173`.

## Build de producción

```bash
npm run build
```

El output se genera en `dist/`.

## Despliegue en AWS Amplify

Este proyecto es SPA y funciona con el flujo estándar de Amplify para Vite.

Sugerencias en Amplify:

- Build command: `npm run build`
- Output directory: `dist`

Si configuras redirects/rewrite en Amplify, usa una regla de SPA para redirigir rutas a `index.html`.

## Mocks y escenarios

La validación mock vive en:

- `src/mocks/documents.ts`
- `src/mocks/validation.ts`

Puedes forzar escenarios por nombre de archivo:

- Si contiene `mismatch` o `error` -> expediente con observaciones.
- Si contiene `manual` o `ilegible` -> revisión manual.
- Si los nombres son coherentes por tipo -> expediente validado.

## Scripts

- `npm run dev` - desarrollo
- `npm run build` - type-check + build
- `npm run preview` - vista previa de build
