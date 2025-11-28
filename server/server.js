// server/server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios'); // Nécéssaire pour parler à Google

const app = express();
app.use(express.static(require('path').join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- CONFIGURATION ---
// COLLEX VOTRE CLÉ SECRÈTE (SECRET KEY) ICI
const RECAPTCHA_SECRET_KEY = '6LeQRRssAAAAANxChZwDaKtu6mDF7xOjcY_HRRX1'; 

let waiting = []; 
let rooms = new Map();

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function createRoom(a, b) {
  const roomId = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  rooms.set(roomId, { a, b });
  a.roomId = roomId;
  b.roomId = roomId;
  safeSend(a, { type: 'matched', roomId });
  safeSend(b, { type: 'matched', roomId });
}

function endRoom(roomId, notifyOther = true) {
  const room = rooms.get(roomId);
  if (!room) return;
  const { a, b } = room;
  if (a) { a.roomId = null; if (notifyOther) safeSend(a, { type: 'ended' }); }
  if (b) { b.roomId = null; if (notifyOther) safeSend(b, { type: 'ended' }); }
  rooms.delete(roomId);
}

function pairOrQueue(ws) {
  // SECURITE : On bloque si le captcha n'est pas validé
  if (!ws.isVerified) {
    safeSend(ws, { type: 'error', reason: 'captcha_required' });
    return;
  }

  if (waiting.includes(ws)) return;
  if (waiting.length === 0) {
    waiting.push(ws);
    safeSend(ws, { type: 'queued' });
  } else {
    const partner = waiting.shift();
    if (partner && partner.readyState === WebSocket.OPEN) createRoom(ws, partner);
    else pairOrQueue(ws);
  }
}

const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_MSG_PER_WINDOW = 10; // Augmenté un peu pour les photos

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.isVerified = false; // Par défaut : bloqué
  ws.msgTimestamps = [];

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    // --- 1. VERIFICATION CAPTCHA ---
    if (msg.type === 'verify_captcha') {
      const token = msg.token;
      if (!token) return;

      try {
        // On demande à Google si le token est valide
        const googleUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET_KEY}&response=${token}`;
        const response = await axios.post(googleUrl);
        
        if (response.data.success) {
          ws.isVerified = true;
          safeSend(ws, { type: 'captcha_success' });
        } else {
          safeSend(ws, { type: 'error', reason: 'captcha_failed' });
        }
      } catch (err) {
        console.error("Erreur Google:", err.message);
        safeSend(ws, { type: 'error', reason: 'server_error' });
      }
      return;
    }

    // Rate limiting
    const now = Date.now();
    ws.msgTimestamps = ws.msgTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (ws.msgTimestamps.length >= MAX_MSG_PER_WINDOW) {
      safeSend(ws, { type: 'error', reason: 'rate_limit' });
      return;
    }
    ws.msgTimestamps.push(now);

    // Si pas vérifié, on ignore les autres messages
    if (!ws.isVerified) return;

    // --- LOGIQUE STANDARD ---
    if (msg.type === 'find_partner') {
      pairOrQueue(ws);

    } else if (msg.type === 'chat') {
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        safeSend(other, { type: 'chat', text: msg.text });
      }

    } else if (msg.type === 'next') {
      if (ws.roomId) {
        endRoom(ws.roomId, true);
      }
      pairOrQueue(ws);

    // --- LOGIQUE PHOTOS ---
    } else if (msg.type === 'request_photo') {
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        safeSend(other, { type: 'request_photo' });
      }

    } else if (msg.type === 'response_photo') {
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        safeSend(other, { type: 'response_photo', accepted: msg.accepted });
      }

    } else if (msg.type === 'photo_data') {
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        safeSend(other, { type: 'photo_data', image: msg.image });
      }
    }
  });

  ws.on('close', () => {
    waiting = waiting.filter(s => s !== ws);
    if (ws.roomId) {
      endRoom(ws.roomId, false);
    }
  });

  ws.on('pong', () => ws.isAlive = true);
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on ${PORT}`));