import path from 'node:path';

// Where the archive (database, images, exports) lives. Set ARTALOG_DATA_DIR to keep user
// data outside the app folder so the app can be replaced or updated without touching it.
export const DATA_DIR = process.env.ARTALOG_DATA_DIR
  ? path.resolve(process.env.ARTALOG_DATA_DIR)
  : path.join(process.cwd(), 'storage');

// Built frontend (served by the backend when present, so no separate dev server is needed).
export const FRONTEND_DIR = process.env.ARTALOG_FRONTEND_DIR
  ? path.resolve(process.env.ARTALOG_FRONTEND_DIR)
  : path.resolve(process.cwd(), '..', 'frontend', 'dist');
