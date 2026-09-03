// Prove that the production bucket lives behind R2's EU-jurisdiction endpoint,
// which is what /privacy claims and what CLAUDE.md calls the conclusive check.
//
// A bucket created against `<account>.eu.r2.cloudflarestorage.com` is reachable
// only through that host: the plain `r2.cloudflarestorage.com` has no knowledge
// of it. An unauthenticated request cannot show that -- both hosts check the
// signature before the bucket and answer the same 400 -- so the discriminating
// request is an authenticated HeadBucket, which answers 404 on the plain host
// for a bucket that is jurisdiction-restricted and 200 for one that is not.
//
// Run it with the production credentials in the environment:
//
//   S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... pnpm r2:verify
//
// Nothing it prints carries the account id, so its output is safe to paste into
// a pull request in this public repository.

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

export type Probe = { ok: true; status: number } | { ok: false; name: string; status?: number };

export type Verdict = {
  result: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  exitCode: 0 | 1 | 2;
  reason: string;
};

const R2_HOST_SUFFIX = ['r2', 'cloudflarestorage', 'com'];

function labels(endpoint: string): string[] {
  return new URL(endpoint).hostname.split('.');
}

/** `https://<id>.eu.r2.cloudflarestorage.com` -> `https://<id>.r2.cloudflarestorage.com`. */
export function plainEndpoint(endpoint: string): string {
  const parts = labels(endpoint);
  const suffix = parts.slice(-R2_HOST_SUFFIX.length);
  if (suffix.join('.') !== R2_HOST_SUFFIX.join('.')) {
    throw new Error(`S3_ENDPOINT is not an r2.cloudflarestorage.com host: ${maskEndpoint(endpoint)}`);
  }
  if (parts.length === R2_HOST_SUFFIX.length + 1) {
    throw new Error('S3_ENDPOINT carries no jurisdiction label — it is already the plain endpoint');
  }
  const url = new URL(endpoint);
  url.hostname = [parts[0], ...suffix].join('.');
  return url.toString().replace(/\/$/, '');
}

/**
 * The account id is deliberately not written down in this public repository.
 * Built by hand rather than through URL's hostname setter, which rejects the
 * angle brackets and leaves the real id in place without saying so.
 */
export function maskEndpoint(endpoint: string): string {
  const { hostname } = new URL(endpoint);
  const masked = ['<ACCOUNT_ID>', ...labels(endpoint).slice(1)].join('.');
  return endpoint.replace(hostname, masked).replace(/\/$/, '');
}

function missing(probe: Probe): boolean {
  return !probe.ok && (probe.status === 404 || probe.name === 'NotFound' || probe.name === 'NoSuchBucket');
}

export function verdict(eu: Probe, plain: Probe): Verdict {
  if (!eu.ok) {
    return {
      result: 'INCONCLUSIVE',
      exitCode: 2,
      reason: `the bucket is not reachable on its own EU endpoint (${eu.name}), so nothing can be concluded about the plain one — check the credentials and the bucket name`,
    };
  }
  if (missing(plain)) {
    return {
      result: 'PASS',
      exitCode: 0,
      reason: 'the plain endpoint has no knowledge of this bucket, which is what jurisdiction-restricted means',
    };
  }
  if (plain.ok) {
    return {
      result: 'FAIL',
      exitCode: 1,
      reason: 'the plain endpoint can see this bucket, so it is NOT jurisdiction-restricted — /privacy is wrong until this is fixed',
    };
  }
  return {
    result: 'INCONCLUSIVE',
    exitCode: 2,
    reason: `the plain endpoint answered ${plain.name}, which discriminates nothing — it refuses the caller rather than denying the bucket exists`,
  };
}

async function head(endpoint: string, bucket: string, region: string, credentials: { accessKeyId: string; secretAccessKey: string }): Promise<Probe> {
  const s3 = new S3Client({ endpoint, region, credentials, forcePathStyle: true });
  try {
    const out = await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, status: out.$metadata.httpStatusCode ?? 200 };
  } catch (error) {
    // The name and status only: a network-level message carries the hostname,
    // and the hostname carries the account id this script exists to keep out
    // of its own output.
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return { ok: false, name: e.name ?? 'UnknownError', status: e.$metadata?.httpStatusCode };
  } finally {
    s3.destroy();
  }
}

async function main(): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION ?? 'auto';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    console.error('Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY first.');
    console.error('Vercel will not decrypt the sensitive three, so take them from Cloudflare.');
    process.exit(2);
  }

  const plain = plainEndpoint(endpoint);
  const credentials = { accessKeyId, secretAccessKey };
  console.log(`bucket          ${bucket}`);
  console.log(`eu endpoint     ${maskEndpoint(endpoint)}`);
  console.log(`plain endpoint  ${maskEndpoint(plain)}`);

  const euProbe = await head(endpoint, bucket, region, credentials);
  const plainProbe = await head(plain, bucket, region, credentials);
  const describe = (p: Probe) => (p.ok ? `${p.status} reachable` : `${p.status ?? '—'} ${p.name}`);
  console.log(`\nHeadBucket on the EU endpoint    ${describe(euProbe)}`);
  console.log(`HeadBucket on the plain endpoint ${describe(plainProbe)}`);

  const answer = verdict(euProbe, plainProbe);
  console.log(`\n${answer.result}: ${answer.reason}`);
  process.exit(answer.exitCode);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
