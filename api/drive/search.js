import { handleDriveApiRequest } from '../../server/drive-api-handler.js';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  req.url = '/api/drive/search';
  await handleDriveApiRequest(req, res);
}
