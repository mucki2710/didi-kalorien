import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url)), { dotfiles: 'deny' }));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
app.listen(port, host, () => console.log(`Didi Web-App Vorschau: http://${host}:${port} (statisch, ohne Backend)`));
