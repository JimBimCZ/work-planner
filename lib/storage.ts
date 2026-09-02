import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Fifteen minutes, deliberately longer than the five-minute signing window
// below, so a URL minted at the start of a window is still valid at its end.
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const SIGNING_WINDOW_MS = 5 * 60 * 1000;

function config() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

export function storageConfigured(): boolean {
  return config() !== null;
}

function client() {
  const settings = config();
  if (!settings) throw new Error('Attachment storage is not configured');
  return {
    bucket: settings.bucket,
    s3: new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      // MinIO serves buckets as a path segment rather than a subdomain, and R2
      // accepts the same form. Without this the SDK builds a host that neither
      // resolves locally nor matches R2's certificate.
      forcePathStyle: true,
    }),
  };
}

export function objectKey(boardId: string, attachmentId: string): string {
  return `boards/${boardId}/${attachmentId}`;
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  const { s3, bucket } = client();
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

// The signing timestamp is rounded down to a five-minute window so repeat
// renders of the same inline image produce the *same* URL and the browser's own
// cache answers them. A fresh signature per request would make every render a
// cache miss and another billable Class B operation. Caching the 302 instead
// would stretch revocation from seconds to minutes, which is the property this
// route exists to provide — so the stability goes here, not in a header.
//
// `signingDate` is NOT confirmed to exist on this SDK's presigner options —
// Step 6 proves or disproves it. If it does not type-check or does not produce
// a stable URL, delete this option and the SIGNING_WINDOW_MS constant; the
// feature is correct without it, only chattier. Do not keep an option that
// silently does nothing.
export async function presignGet(
  key: string,
  filename: string,
  inline: boolean,
): Promise<string> {
  const { s3, bucket } = client();
  const disposition = inline ? 'inline' : 'attachment';
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `${disposition}; filename="${filename.replace(/"/g, '')}"`,
    }),
    {
      expiresIn: SIGNED_URL_TTL_SECONDS,
      signingDate: new Date(Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS),
    },
  );
}

export async function headObject(
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  const { s3, bucket } = client();
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      size: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      '$metadata' in error &&
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw error;
  }
}

// Best effort by design, and it lives HERE rather than in lib/actions: every
// export of a 'use server' module becomes a callable endpoint, so exporting a
// "delete these keys" helper from there would hand the browser an unauthorised
// object-delete API. Nothing in this module is reachable from a client.
export async function forgetObjects(keys: string[]): Promise<void> {
  try {
    await deleteObjects(keys);
  } catch (error) {
    console.error('attachment objects left behind', { keys, error });
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { s3, bucket } = client();
  // DeleteObjects takes up to 1000 keys per call, which is why a board-wide
  // delete is a handful of requests rather than one per row.
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}
