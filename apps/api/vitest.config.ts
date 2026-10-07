import { defineConfig } from 'vitest/config';

// The reorder reference uses local-time Date maths; pin the zone so the comparison is reproducible.
export default defineConfig({ test: { env: { TZ: 'Asia/Karachi' } } });
