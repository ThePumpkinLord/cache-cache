// server/server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.static(require('path').join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waiting = []; // file d'attente de sockets
let rooms = new Map(); // roomId -> { a, b }

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
  // évite double mise en file
  if (waiting.includes(ws)) return;
  if (waiting.length === 0) {
    waiting.push(ws);
    safeSend(ws, { type: 'queued' });
  } else {
    const partner = waiting.shift();
    if (partner && partner.readyState === WebSocket.OPEN) createRoom(ws, partner);
    else pairOrQueue(ws); // partenaire invalide -> réessaie
  }
}

// anti spam : limiter envoi messages par socket (très basique)
const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_MSG_PER_WINDOW = 5;

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.msgTimestamps = [];

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    // rate limiting
    const now = Date.now();
    ws.msgTimestamps = ws.msgTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (ws.msgTimestamps.length >= MAX_MSG_PER_WINDOW) {
      safeSend(ws, { type: 'error', reason: 'rate_limit' });
      return;
    }
    ws.msgTimestamps.push(now);

    if (msg.type === 'find_partner') {
      pairOrQueue(ws);
    } else if (msg.type === 'chat') {
      const roomId = ws.roomId;
      if (!roomId) { safeSend(ws, { type: 'error', reason: 'not_paired' }); return; }
      const room = rooms.get(roomId);
      if (!room) { safeSend(ws, { type: 'error', reason: 'room_missing' }); return; }
      const other = room.a === ws ? room.b : room.a;
      safeSend(other, { type: 'chat', text: msg.text });

  
    } else if (msg.type === 'request_photo') {
      // L'utilisateur A demande à envoyer des photos
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        safeSend(other, { type: 'request_photo' });
      }
    } else if (msg.type === 'response_photo') {
      // L'utilisateur B accepte ou refuse
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        // msg.accepted sera true ou false
        safeSend(other, { type: 'response_photo', accepted: msg.accepted });
      }
    } else if (msg.type === 'photo_data') {
      // Envoi de l'image (en base64)
      const room = rooms.get(ws.roomId);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        safeSend(other, { type: 'photo_data', image: msg.image });
      }
    }

    else if (msg.type === 'next') {
      // user wants new partner: end current room and requeue them
      if (ws.roomId) {
        const rid = ws.roomId;
        const room = rooms.get(rid);
        const other = room && (room.a === ws ? room.b : room.a);
        // end room and notify other
        endRoom(rid, true);
        // the other one goes back to queue automatically if still connected
        if (other && other.readyState === WebSocket.OPEN) pairOrQueue(other);
      }
      // now requeue the requester
      pairOrQueue(ws);
    }
  });

  ws.on('close', () => {
    // si en file => retirer
    waiting = waiting.filter(s => s !== ws);
    // si dans une room => finir la room et requeue l'autre
    if (ws.roomId) {
      const rid = ws.roomId;
      const room = rooms.get(rid);
      if (room) {
        const other = room.a === ws ? room.b : room.a;
        endRoom(rid, false);
        if (other && other.readyState === WebSocket.OPEN) {
          safeSend(other, { type: 'partner_left' });
          pairOrQueue(other);
        }
      }
    }
  });

  // ping/pong minimal pour détecter morts
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
