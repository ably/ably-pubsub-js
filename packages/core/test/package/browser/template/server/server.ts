import express from 'express';
import path from 'node:path';

async function startWebServer(listenPort: number) {
  const server = express();
  server.get('/', (req, res) => res.send('OK'));
  server.use(express.static(path.join(__dirname, '/resources')));
  for (const filename of ['index-default.js', 'index-liveobjects.js', 'index-modular.js']) {
    server.use(`/${filename}`, express.static(path.join(__dirname, '..', 'dist', filename)));
  }

  server.listen(listenPort);
}

startWebServer(4567);
