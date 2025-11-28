// public/client.js

// Éléments existants
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const startBtn = document.getElementById('start');
const nextBtn = document.getElementById('next');
const sendBtn = document.getElementById('send');
const input = document.getElementById('input');

// Nouveaux éléments
const reqPhotoBtn = document.getElementById('req-photo');
const sendPhotoBtn = document.getElementById('send-photo');
const fileInput = document.getElementById('file-input');

// --- LOGIQUE DE VERIFICATION (MODALE) ---
const modal = document.getElementById('verification-modal');
const ageCheck = document.getElementById('age-check');
const captchaCheck = document.getElementById('captcha-check');
const enterBtn = document.getElementById('enter-btn');

function checkValidation() {
  // Active le bouton seulement si les deux sont cochés
  enterBtn.disabled = !(ageCheck.checked && captchaCheck.checked);
}

ageCheck.addEventListener('change', checkValidation);
captchaCheck.addEventListener('change', checkValidation);

enterBtn.addEventListener('click', () => {
  modal.style.display = 'none'; // Cache la modale
  connect(); // Lance la connexion WebSocket seulement après validation
});

// --- LOGIQUE DU CHAT ---

function addLine(text, cls='sys') {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Fonction pour afficher une image
function addImage(base64Src, cls='other') {
  const div = document.createElement('div');
  div.className = cls;
  const img = document.createElement('img');
  img.src = base64Src;
  img.className = 'chat-img';
  div.appendChild(img);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Réinitialise l'interface photo quand on change de partenaire
function resetPhotoUI() {
  reqPhotoBtn.disabled = true; // Désactivé tant qu'on n'est pas matché
  reqPhotoBtn.style.display = 'inline-block';
  sendPhotoBtn.classList.add('hidden');
  fileInput.value = ''; // Reset fichier
}

let socket;

// Note: J'ai déplacé l'appel connect() à l'intérieur du bouton "Entrer" plus haut
function connect() {
  socket = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host);
  
  socket.onopen = () => {
    statusEl.textContent = 'Connecté au serveur';
    addLine('Connexion au serveur établie', 'sys');
  };

  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'queued') {
      addLine('En attente d’un partenaire...', 'sys');
      startBtn.disabled = true;
      nextBtn.disabled = true;
      sendBtn.disabled = true;
      resetPhotoUI();

    } else if (msg.type === 'matched') {
      addLine("Vous êtes connecté à un inconnu.", 'sys');
      startBtn.disabled = true;
      nextBtn.disabled = false;
      sendBtn.disabled = false;
      reqPhotoBtn.disabled = false; // On peut maintenant demander des photos

    } else if (msg.type === 'chat') {
      addLine(msg.text, 'other');

    } else if (msg.type === 'ended' || msg.type === 'partner_left') {
      addLine("Le partenaire est parti.", 'sys');
      nextBtn.disabled = true;
      sendBtn.disabled = true;
      startBtn.disabled = false;
      resetPhotoUI();

    } else if (msg.type === 'error') {
      addLine('Erreur: ' + msg.reason, 'sys');

    // --- GESTION PHOTO ---
    } else if (msg.type === 'request_photo') {
      // L'autre veut partager des photos
      const accept = confirm("Le partenaire souhaite activer le partage de photos. Acceptez-vous ?");
      socket.send(JSON.stringify({ type: 'response_photo', accepted: accept }));
      if (accept) {
        addLine("Vous avez accepté le partage de photos.", 'sys');
        reqPhotoBtn.style.display = 'none'; // Plus besoin de demander
        sendPhotoBtn.classList.remove('hidden'); // On peut envoyer
      } else {
        addLine("Vous avez refusé le partage de photos.", 'sys');
      }

    } else if (msg.type === 'response_photo') {
      // Réponse à ma demande
      if (msg.accepted) {
        addLine("Le partenaire a accepté le partage de photos !", 'sys');
        reqPhotoBtn.style.display = 'none';
        sendPhotoBtn.classList.remove('hidden');
      } else {
        addLine("Le partenaire a refusé le partage de photos.", 'sys');
      }

    } else if (msg.type === 'photo_data') {
      // Réception d'une image
      addImage(msg.image, 'other');
    }
  };

  socket.onclose = () => {
    statusEl.textContent = 'Déconnecté';
    addLine('Déconnecté du serveur', 'sys');
    startBtn.disabled = false;
    nextBtn.disabled = true;
    sendBtn.disabled = true;
    resetPhotoUI();
  };
}

// --- EVENTS ---

startBtn.onclick = () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'find_partner' }));
    addLine('Recherche d’un partenaire...', 'sys');
  }
};

sendBtn.onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  addLine(text, 'me');
  socket.send(JSON.stringify({ type: 'chat', text }));
  input.value = '';
};

nextBtn.onclick = () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'next' }));
    addLine('Recherche d’un nouveau partenaire...', 'sys');
    nextBtn.disabled = true;
    sendBtn.disabled = true;
    resetPhotoUI();
  }
};

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
});

// --- EVENTS PHOTO ---

// 1. Demander la permission
reqPhotoBtn.onclick = () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'request_photo' }));
    addLine('Demande de partage de photos envoyée...', 'sys');
  }
};

// 2. Clic sur le bouton "Envoyer Photo" -> ouvre le sélecteur de fichier
sendPhotoBtn.onclick = () => {
  fileInput.click();
};

// 3. Quand un fichier est choisi
fileInput.onchange = () => {
  const file = fileInput.files[0];
  if (!file) return;

  // Limite de taille simple (ex: 2MB pour ne pas saturer le websocket)
  if (file.size > 2 * 1024 * 1024) {
    alert("L'image est trop lourde (max 2MB)");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    
    // Afficher chez soi
    addImage(base64, 'me');
    
    // Envoyer au serveur
    socket.send(JSON.stringify({ type: 'photo_data', image: base64 }));
  };
  reader.readAsDataURL(file);
};