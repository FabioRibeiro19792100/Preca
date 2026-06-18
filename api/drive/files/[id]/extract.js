import { handleDriveApiRequest } from '../../../../../server/drive-api-handler.js';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  req.url = `/api/drive/files/${req.query.id}/extract`;
  await handleDriveApiRequest(req, res);
}
