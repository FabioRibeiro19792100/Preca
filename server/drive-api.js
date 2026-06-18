import http from 'node:http';
import { handleDriveApiRequest } from './drive-api-handler.js';

const PORT = Number(process.env.DRIVE_API_PORT || 5174);

const server = http.createServer(async (req, res) => {
  const handled = await handleDriveApiRequest(req, res);
  if (!handled) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Rota nao encontrada.' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Drive API running at http://127.0.0.1:${PORT}`);
});
