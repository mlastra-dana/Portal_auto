# Example Company - Autogestion Vehicular

Aplicacion web construida con React + Vite + TypeScript + TailwindCSS para registrar informacion de vehiculos orientada a seguros de autos.

## Caracteristicas

- Identidad visual Example Company desde `src/brand/Marca_example`.
- Inicio del flujo por cedula o RIF.
- Portal de autogestion en `/validation`.
- Carga de un documento vehicular:
  - Certificado de origen
  - Carnet de circulacion
- Deteccion simulada del tipo documental.
- Extraccion simulada de datos del vehiculo:
  - titular
  - placa
  - VIN / serial de carroceria
  - serial de motor
  - marca, modelo, ano, color y uso
- Revision editable antes del envio.
- Envio demo de payload estructurado a DANAConnect por consola.
- Preparado para despliegue SPA en AWS Amplify.

## Stack

- React 18
- Vite
- TypeScript
- TailwindCSS
- React Router DOM

## Desarrollo local

```bash
npm install
npm run dev
```

App disponible por defecto en `http://localhost:5173`.

## Build de produccion

```bash
npm run build
```

El output se genera en `dist/`.
