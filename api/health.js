import { handleDriveApiRequest } from '../server/drive-api-handler.js';

export default async function handler(req, res) {
  req.url = '/api/health';
  await handleDriveApiRequest(req, res);
}
