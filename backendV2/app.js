// Simple Node.js back end app to wrap Lambda functions
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

import * as initialize from './lambda/initialize.js';
import * as getPreSignedUrls from './lambda/getPreSignedUrls.js';
import * as finalize from './lambda/finalize.js';

const app = express();

// CORS - allow requests from anywhere
app.use(cors());

// We want unparsed body for all content types
app.use(bodyParser.text({type: '*/*'}));

// Default to listen on 3030, so we don't clash with the front end React app
const PORT = process.env['PORT'] || 3030;

// Map URL paths to handler functions
const handlers = {
  '/initialize': initialize.handler,
  '/getPreSignedUrls': getPreSignedUrls.handler,
  '/finalize': finalize.handler,
}

app.post(Object.keys(handlers), async (req, res) => {
  const handler = handlers[req.path];
  const event = {
    "body": await req.body,
  };
  try {
    const result = await handler(event);
    res.set(result.headers);
    res.set('Content-Type', 'application/json');
    res.status(result.statusCode).send(result.body);
  } catch (e) {
    console.log(e.stack);
    res.status(500).end();
  }
});

app.listen(PORT, () =>
    console.log(`Listening on port ${PORT}`),
);
