# Uploading large objects to S3-compatible cloud object storage using multipart upload and compression
This sample project was adapted from [amazon-s3-multipart-upload-transfer-acceleration](https://github.com/aws-samples/amazon-s3-multipart-upload-transfer-acceleration) to show a way to implement multipart upload with compression directly from the browser using presigned URLs.

The project was developed and tested against the [Backblaze B2 Cloud Object Storage](https://www.backblaze.com/cloud-storage) [S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api), but it should work with any S3-compatible cloud object storage platform.  

## Differences from the original project:

* As an alternative to deploying the back end AWS Lambda functions, you can run a [simple Node.js app](backendV2/app.js). Note that the back end app does **not** implement any security. You will need to ensure that only authorized clients can call the endpoints.
* The 'Use Transfer Acceleration' option is replaced by 'Compress Data'.
* When compression is enabled:
  * The [Uploader class](frontendV2/src/utils/upload.js) in the JavaScript front end uses [CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream) to `gzip` compress the selected file in the browser before splitting it into chunks and uploading it.
  * The back end [initialize handler](backendV2/lambda/initialize.js) sets the `ContentEncoding` parameter in the `CreateMultipartUploadCommand` object to `gzip`.
  * The front end [React app](frontendV2/src/App.js) displays the original file size, compressed size, as stored, and compression ratio when the upload is complete.

## Deploy the application
### Backend
- Clone this repository to your local computer. 
- From the `backendv2` folder:
  - Run `npm install` to install all dependencies. Optionally, you can use `npm audit` to check for known vulnerabilities on the dependent packages.
  - Copy `.env.template` to `.env` and edit the configuration:

    ```dotenv
    PORT=3030
    BUCKET_NAME=your-bucket-name
    URL_EXPIRES=3600
  
    AWS_ACCESS_KEY_ID=your-backblaze-b2-application-key-id
    AWS_SECRET_ACCESS_KEY=your-backblaze-b2-application-key
    AWS_REGION=your-backblaze-b2-bucket-region
    AWS_ENDPOINT_URL=https://your-backblaze-b2-bucket-endpoint
    ```
  
    Note that `AWS_ENDPOINT_URL` must include the `https://` prefix.

  - Run the backend app with `npm start`

### Frontend 
- From the frontend folder, run `npm install` to install the packages.
- Optionally, you can run `npm audit --production` to check on vulnerabilities.
- Run `npm run start` to launch the frontend application from the browser. 
- Use the user interface shown in the browser.
- For Step 1, enter the back end app's URL, for example, `http://localhost:3030`
- For Step 2 and Step 3, pick a baseline number. Use your available bandwidth, TCP window size, and retry time requirements to determine the optimal part size. This needs to be a minimum of 5 MB though. Web browsers have a limit on the number of concurrent connections to the same server. In Firefox, the default is 6 connections. Specifying a larger number of concurrent connections will result in blocking on the web browser side.
- For Step 4, pick whether to compress the data or not.
- For Step 5, pick a large file to upload.
- The final part of the user interface will show upload progress, the time to upload the file, and the compression ratio achieved, if compression was enabled. 

You can compare the file size in B2 with the local file size to verify that the file is compressed. For example:

```console
% ls -l t8.shakespeare.txt 
-rw-r--r--  1 ppatterson  staff  5458199 Sep 10 11:53 t8.shakespeare.txt
% b2 ls --long b2://metadaddy-public/t8.shakespeare.txt
4_zf1f51fb913357c4f74ed0c1b_f239c4ba1a111c054_d20240910_m192840_c004_v0402007_t0044_u01725996520526  upload  2024-09-10  19:28:40    2010413  t8.shakespeare.txt
```

You can use curl to see the HTTP headers, including `Content-Encoding`:

```console
% curl --head https://metadaddy-public.s3.us-west-004.backblazeb2.com/t8.shakespeare.txt
HTTP/1.1 200 
Server: nginx
Date: Tue, 10 Sep 2024 20:15:08 GMT
Content-Type: binary/octet-stream
Content-Length: 2010413
Connection: keep-alive
Accept-Ranges: bytes
Last-Modified: Tue, 10 Sep 2024 19:28:40 GMT
ETag: "6cf90679afdb4860ea787c69f957b94e-1"
Cache-Control: public
Content-Encoding: gzip
x-amz-request-id: d8f572f67720fede
x-amz-id-2: aMYU1ZmaKOQozsDX3Y7FmoDRiZF1jhmJ5
x-amz-version-id: 4_zf1f51fb913357c4f74ed0c1b_f239c4ba1a111c054_d20240910_m192840_c004_v0402007_t0044_u01725996520526
Strict-Transport-Security: max-age=63072000
```

Note that, by default, curl will not honor the `Content-Encoding` HTTP response header when downloading the file:

```console
% curl -O https://metadaddy-public.s3.us-west-004.backblazeb2.com/t8.shakespeare.txt
% ls -l t8.shakespeare.txt                             
-rw-r--r--  1 ppatterson  staff  2010413 Sep 10 12:32 t8.shakespeare.txt
% file t8.shakespeare.txt
t8.shakespeare.txt: gzip compressed data, original size modulo 2^32 5458199
```

You must provide the `--compressed` option to have curl decompress the file:

```console
% curl --compressed -O https://metadaddy-public.s3.us-west-004.backblazeb2.com/t8.shakespeare.txt
% ls -l t8.shakespeare.txt
-rw-r--r--  1 ppatterson  staff  5458199 Sep 10 12:34 t8.shakespeare.txt
% file t8.shakespeare.txt
t8.shakespeare.txt: ASCII text
```

If you are using a library or SDK to download the file, check the documentation for how it handles the `Content-Encoding` HTTP response header. For example, the [Python requests library will automatically decode the response body](https://github.com/psf/requests/blob/main/docs/community/faq.rst#encoded-data) if `Content-Encoding` is set to `gzip`. The AWS SDK for Python, boto3, in contrast, [does not](https://github.com/boto/botocore/issues/1255); you must write code to decompress the file.

See the [original project](https://github.com/aws-samples/amazon-s3-multipart-upload-transfer-acceleration) for discussion of [improving throughput by uploading parts in parallel](https://github.com/aws-samples/amazon-s3-multipart-upload-transfer-acceleration#improved-throughput--you-can-upload-parts-in-parallel-to-improve-throughput) and [tuning part size for quick recovery from network issues](https://github.com/aws-samples/amazon-s3-multipart-upload-transfer-acceleration#quick-recovery-from-any-network-issues--smaller-part-size-minimizes-the-impact-of-restarting-a-failed-upload-due-to-a-network-error).
