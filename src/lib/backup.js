import { S3Client, PutObjectCommand, HeadBucketCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getRow, getRows, run } from './db';
import { encrypt, decrypt } from './crypto';

const SETTINGS_KEYS = [
  'backup_endpoint',
  'backup_region',
  'backup_bucket',
  'backup_access_key_id',
  'backup_secret_access_key',
  'backup_prefix',
  'backup_provider',
  'backup_schedule',
];

const ENCRYPTED_KEYS = ['backup_access_key_id', 'backup_secret_access_key'];

export async function getBackupConfig() {
  const rows = await getRows(`SELECT key, value FROM app_settings WHERE key LIKE 'backup_%'`);

  const config = {};
  for (const row of rows) {
    const val = ENCRYPTED_KEYS.includes(row.key) ? decrypt(row.value) : row.value;
    // strip prefix for cleaner keys
    const shortKey = row.key.replace('backup_', '');
    config[shortKey] = val;
  }
  return config;
}

export async function saveBackupConfig(config) {
  for (const fullKey of SETTINGS_KEYS) {
    const shortKey = fullKey.replace('backup_', '');
    const rawVal = config[shortKey];
    if (rawVal === undefined) continue;
    const val = ENCRYPTED_KEYS.includes(fullKey) ? encrypt(rawVal) : rawVal;
    await run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [fullKey, val]
    );
  }
}

export async function deleteBackupConfig() {
  await run(`DELETE FROM app_settings WHERE key LIKE 'backup_%'`);
}

function buildS3Client(config) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region || 'auto',
    credentials: {
      accessKeyId: config.access_key_id,
      secretAccessKey: config.secret_access_key,
    },
    forcePathStyle: true,
  });
}

export async function testConnection(config) {
  const client = buildS3Client(config);
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  return true;
}

export async function runBackup() {
  throw new Error(
    'Manual backup not supported in PostgreSQL mode. Supabase automatically backs up your database.'
  );
}

export async function getBackupHistory(limit = 20) {
  return getRows(`SELECT * FROM backup_history ORDER BY started_at DESC LIMIT ?`, [limit]);
}

export async function listRemoteBackups() {
  const config = await getBackupConfig();
  if (!config.endpoint || !config.bucket || !config.access_key_id || !config.secret_access_key) {
    throw new Error('Backup not configured');
  }

  const client = buildS3Client(config);
  const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';

  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
    })
  );

  return (result.Contents || [])
    .filter((obj) => obj.Key.endsWith('.db'))
    .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))
    .map((obj) => ({
      key: obj.Key,
      filename: obj.Key.split('/').pop(),
      size: obj.Size,
      lastModified: obj.LastModified.toISOString(),
    }));
}

export async function createSnapshot() {
  throw new Error(
    'Manual backup not supported in PostgreSQL mode. Supabase automatically backs up your database.'
  );
}

export async function restoreBackup() {
  throw new Error(
    'Manual backup not supported in PostgreSQL mode. Supabase automatically backs up your database.'
  );
}

export async function uploadToS3(filePath, filename, config) {
  const { default: fs } = await import('fs');
  const client = buildS3Client(config);
  const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';
  const key = `${prefix}${filename}`;

  const body = fs.readFileSync(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
    })
  );

  return key;
}
