export const B2_SAMPLE_USER_AGENT =
  'browser-multipart-upload-compress-data/1.0 (backblaze-b2-samples)';

export function createS3ClientConfig(overrides = {}) {
  const region = process.env['B2_REGION'];
  const applicationKeyId = process.env['B2_APPLICATION_KEY_ID'];
  const applicationKey = process.env['B2_APPLICATION_KEY'];

  const config = {
    ...overrides,
    customUserAgent: B2_SAMPLE_USER_AGENT,
  };

  if (region) {
    config.region = region;
    config.endpoint = `https://s3.${region}.backblazeb2.com`;
  }

  if (applicationKeyId && applicationKey) {
    config.credentials = {
      accessKeyId: applicationKeyId,
      secretAccessKey: applicationKey,
    };
  }

  return config;
}
