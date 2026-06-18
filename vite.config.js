import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleDriveApiRequest } from './server/drive-api-handler.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'drive-api-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const handled = await handleDriveApiRequest(req, res);
          if (!handled) next();
        });
      },
    },
  ],
});
