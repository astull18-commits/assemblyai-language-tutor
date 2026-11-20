import 'dotenv/config';
import express from 'express';
import { tutorRouter } from './tutor.js';
import { createServer } from 'node:http';
import { attachStreaming } from './stream.js';

const app = express();
const server = createServer(app);
app.use(express.json({ limit: '48kb' }));
app.use('/api', tutorRouter);
const model = process.env.ASSEMBLYAI_MODEL || 'universal-3-6-pro';
app.get('/api/health', (_request, response) => response.json({ configured: Boolean(process.env.ASSEMBLYAI_API_KEY), model }));
attachStreaming(server, { key: process.env.ASSEMBLYAI_API_KEY, model });
if (process.env.NODE_ENV === 'production') app.use(express.static('dist'));
else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Voice tutor available at http://localhost:${process.env.PORT || 3000}`));
