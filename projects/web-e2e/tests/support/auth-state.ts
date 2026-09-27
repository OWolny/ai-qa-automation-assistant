import path from 'node:path';

// Kept in its own module (not a spec) so both the setup project and auth.spec.ts
// can import the same path without one test file importing another.
export const PRACTICE_USER_STORAGE_STATE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'playwright',
  '.auth',
  'practice-user.json',
);
