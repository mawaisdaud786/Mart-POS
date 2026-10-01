import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/** Load the repository-root .env (scripts run from package folders). */
export const ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: `${ROOT_DIR}.env`, quiet: true });
