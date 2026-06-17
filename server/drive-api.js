import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const PORT = Number(process.env.DRIVE_API_PORT || 5174);
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const SERVICE_ACCOUNT_NAMES = [
  'precatorios-499019-6d5153a459a4.json',
  'service-account.json',
  'google-service-account.json',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function extractFolderId(folderUrl) {
  const value = String(folderUrl || '').trim();
  if (!value) throw new Error('Informe a URL da pasta do Google Drive.');

  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const folderIndex = parts.indexOf('folders');
    if (folderIndex >= 0 && parts[folderIndex + 1]) return parts[folderIndex + 1];
    const queryId = parsed.searchParams.get('id');
    if (queryId) return queryId;
  } catch {
    if (!value.includes('/') && value.length >= 10) return value;
  }

  throw new Error('Nao foi possivel identificar o ID da pasta do Google Drive.');
}

async function looksLikeServiceAccount(filePath) {
  try {
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return payload.type === 'service_account' && Boolean(payload.client_email);
  } catch {
    return false;
  }
}

async function findLocalServiceAccountJson() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  const parentDir = path.dirname(projectRoot);
  const candidateDirs = [
    projectRoot,
    parentDir,
    path.join(parentDir, 'New project 5'),
  ];

  for (const dir of candidateDirs) {
    for (const filename of SERVICE_ACCOUNT_NAMES) {
      const candidate = path.join(dir, filename);
      if (await looksLikeServiceAccount(candidate)) return candidate;
    }
  }

  for (const dir of candidateDirs) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const candidate = path.join(dir, entry.name);
      if (await looksLikeServiceAccount(candidate)) return candidate;
    }
  }

  const parentEntries = await fs.readdir(parentDir, { withFileTypes: true }).catch(() => []);
  for (const entry of parentEntries) {
    if (!entry.isDirectory()) continue;
    const siblingDir = path.join(parentDir, entry.name);
    for (const filename of SERVICE_ACCOUNT_NAMES) {
      const candidate = path.join(siblingDir, filename);
      if (await looksLikeServiceAccount(candidate)) return candidate;
    }
  }

  return null;
}

async function buildDriveClient() {
  if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [DRIVE_READONLY_SCOPE],
    });
    return { drive: google.drive({ version: 'v3', auth }), credentialSource: 'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON' };
  }

  const keyFile = await findLocalServiceAccountJson();
  if (!keyFile) {
    throw new Error('Credencial do Google Drive nao encontrada no projeto ou em projetos irmaos.');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: [DRIVE_READONLY_SCOPE],
  });
  return { drive: google.drive({ version: 'v3', auth }), credentialSource: keyFile };
}

async function listFolderFiles(drive, folderId) {
  const files = [];
  let pageToken;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 1000,
      pageToken,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return files;
}

async function downloadDriveFile(drive, fileId) {
  const response = await drive.files.get(
    {
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    },
    { responseType: 'arraybuffer' },
  );

  return Buffer.from(response.data);
}

function normalizeProcess(value) {
  return String(value || '').trim();
}

function matchFilesToProcesses(files, processes) {
  return processes.map((processNumber) => {
    const target = normalizeProcess(processNumber);
    const matches = files
      .filter((file) => String(file.name || '').includes(target))
      .map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        url: file.webViewLink || `https://drive.google.com/file/d/${file.id}`,
        modifiedTime: file.modifiedTime,
      }));

    return {
      process: target,
      status: matches.length ? 'found' : 'missing',
      matches,
    };
  });
}

async function handleSearch(req, res) {
  const body = await readJsonBody(req);
  const folderId = extractFolderId(body.folderUrl);
  const processes = Array.isArray(body.processes)
    ? body.processes.map(normalizeProcess).filter(Boolean)
    : [];

  if (!processes.length) {
    jsonResponse(res, 400, { error: 'Informe ao menos um numero de processo.' });
    return;
  }

  const { drive, credentialSource } = await buildDriveClient();
  const files = await listFolderFiles(drive, folderId);
  const results = matchFilesToProcesses(files, processes);

  jsonResponse(res, 200, {
    folderId,
    scannedFiles: files.length,
    credentialSource: path.basename(credentialSource),
    results,
  });
}

async function handleDownload(req, res, fileId) {
  const { drive } = await buildDriveClient();
  const bytes = await downloadDriveFile(drive, fileId);

  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(bytes);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      const credentialPath = await findLocalServiceAccountJson();
      jsonResponse(res, 200, {
        ok: true,
        credentialFound: Boolean(credentialPath || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON),
        credentialSource: credentialPath ? path.basename(credentialPath) : null,
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/drive/search') {
      await handleSearch(req, res);
      return;
    }

    const downloadMatch = req.url.match(/^\/api\/drive\/files\/([^/]+)\/download$/);
    if (req.method === 'GET' && downloadMatch) {
      await handleDownload(req, res, downloadMatch[1]);
      return;
    }

    jsonResponse(res, 404, { error: 'Rota nao encontrada.' });
  } catch (error) {
    jsonResponse(res, 500, { error: error.message || 'Erro inesperado.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Drive API running at http://127.0.0.1:${PORT}`);
});
