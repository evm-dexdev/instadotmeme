import { startAmberAgent } from '../agent/amber.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import fs from 'fs';



import { startTikTok }    from './tiktok.js';
import { startInstagram } from './instagram.js';

import { createToken } from './pumpfun.js';

dotenv.config();


if (!process.env.PUMP_PRIVATE_KEY) throw new Error("Missing PUMP_PRIVATE_KEY");
if (!process.env.SOLANA_RPC_URL)  throw new Error("Missing SOLANA_RPC_URL");

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET","POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});


app.use(express.static(join(__dirname, 'public')));


app.get('/favicon.ico', (req, res) => {
  const svgFavicon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ff417a;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#ff7642;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#ffcb42;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="80" height="80" x="10" y="10" fill="url(#grad)" />
      <rect width="10" height="10" x="10" y="10" fill="#8a2387" />
      <rect width="10" height="10" x="80" y="10" fill="#8a2387" />
      <rect width="10" height="10" x="10" y="80" fill="#8a2387" />
      <rect width="10" height="10" x="80" y="80" fill="#8a2387" />
      <text x="50" y="65" font-family="Arial" font-size="50" font-weight="bold" text-anchor="middle" fill="white">T</text>
    </svg>
  `;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svgFavicon);
});


const connectedClients = new Set();
io.on('connection', (socket) => {
  connectedClients.add(socket.id);
  console.log(`Client connected: ${socket.id} (Total: ${connectedClients.size})`);
  socket.emit('serverMessage', {
    message: 'Connected to Meme Token Monitor',
    timestamp: new Date().toISOString()
  });
  socket.on('disconnect', reason => {
    connectedClients.delete(socket.id);
    console.log(`Client disconnected: ${socket.id} (Reason: ${reason}) (Total: ${connectedClients.size})`);
  });
  socket.on('error', err => {
    console.error(`Socket error for ${socket.id}:`, err);
  });
});


function emitTestToken() {
  if (!io) return false;
  const svg = `
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ff417a"/>
      <text x="100" y="120" font-family="Arial" font-size="72" font-weight="bold" text-anchor="middle" fill="white">TEST</text>
    </svg>`;
  const base64 = Buffer.from(svg).toString('base64');
  const token = {
    name: 'Test Token',
    ticker: 'TEST',
    pumpFunLink: 'https://pump.fun/coin/test',
    instagramPost: 'https://instagram.com/p/test',
    timestamp: new Date().toISOString(),
    mintAddress: 'test',
    imageData: `data:image/svg+xml;base64,${base64}`
  };
  console.log(`Emitting test token to ${connectedClients.size} clients`);
  io.emit('newToken', token);
  return true;
}
app.get('/api/test-emit', (req, res) => {
  res.json({ success: emitTestToken(), connectedClients: connectedClients.size });
});


app.get('/api/token-history', (req, res) => {
  const file = './token-history.json';
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const valid = Array.isArray(data) ? data.filter(t => t.name && t.ticker && t.pumpFunLink) : [];
      return res.json(valid);
    } catch {
      return res.json([]);
    }
  }
  return res.json([]);
});


try {
  console.log('Starting Instagram...');
  startInstagram(io);
  console.log('Instagram started');
} catch (err) {
  console.error('Instagram failed to start:', err);
}


try {
  console.log('Starting TikTok...');
  startTikTok(io);
  console.log('TikTok started');
} catch (err) {
  console.error('TikTok failed to start:', err);
}


try {
  console.log('Starting Amber agent...');
  startAmberAgent(io);
  console.log('Amber agent started');
} catch (err) {
  console.error('Amber agent failed to start:', err);
}


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT}`);
});
