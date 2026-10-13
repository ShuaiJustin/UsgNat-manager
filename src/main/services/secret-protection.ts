import { app, safeStorage } from 'electron';
import path from 'node:path';
import { SecretStorage } from './secret-storage';

export const secretStorage = new SecretStorage(
  path.join(app.getPath('userData'), '.credential-key'),
  safeStorage
);
