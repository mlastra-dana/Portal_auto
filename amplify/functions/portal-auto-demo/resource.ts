import { defineFunction } from '@aws-amplify/backend';

export const portalAutoDemo = defineFunction({
  name: 'Portal_auto_demo',
  entry: './handler.py',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    LOG_LEVEL: 'INFO'
  }
});
