import { defineBackend } from '@aws-amplify/backend';
import { nombreFuncion } from './functions/nombre-funcion/resource';
import { portalAutoDemo } from './functions/portal-auto-demo/resource';

/**
 * Backend Gen 2 mínimo y conservador.
 * No agrega permisos IAM adicionales (principio de menor privilegio).
 */
defineBackend({
  nombreFuncion,
  portalAutoDemo
});
