import { defineFunction } from '@aws-amplify/backend';

export const nombreFuncion = defineFunction({
  name: 'nombre-funcion',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  environment: {
    LOG_LEVEL: 'INFO'
  }
});
