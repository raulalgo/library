import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Dev only: src/poster.ts (open the site with ?poster) renders the opening frame and saves it here, as
// POST /__save/<path in the project>. Only paths under public/poster/ and src/poster.css are written.
export default defineConfig({
  plugins: [
    {
      name: 'save-poster',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__save/', (req, res) => {
          const path = decodeURIComponent(req.url!.slice(1));
          if (req.method !== 'POST' || !(path.startsWith('public/poster/') || path === 'src/poster.css') || path.includes('..')) {
            res.statusCode = 403;
            return res.end();
          }
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const file = resolve(server.config.root, path);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, Buffer.concat(chunks));
            res.end('ok');
          });
        });
      },
    },
  ],
});
