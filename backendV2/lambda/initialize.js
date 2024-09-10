import { S3Client, CreateMultipartUploadCommand} from '@aws-sdk/client-s3';

const BUCKET_NAME = process.env['BUCKET_NAME'];

const s3 = new S3Client();

export async function handler(event) {
	console.log(event);
	if (!event.body) {
		throw new Error("event.body is not defined");
	}
	const body = JSON.parse(event.body);
	if (!body.name) {
		throw new Error("name of the file is required");
	}

	const multipartParams = {
		Bucket: BUCKET_NAME,
		Key: body.name,
	}
	if (body.compressData) {
		multipartParams['ContentEncoding'] = 'gzip'
	}
	const command = new CreateMultipartUploadCommand(multipartParams);
	const multipartUpload = await s3.send(command);

	return {
		statusCode: 200,
		body: JSON.stringify({
			fileId: multipartUpload.UploadId,
			fileKey: multipartUpload.Key,
		}),
		headers: {
			'Access-Control-Allow-Origin': '*'
		}
	};
}
