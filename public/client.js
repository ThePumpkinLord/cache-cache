// public/client.js

// Éléments du DOM
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const startBtn = document.getElementById('start');
const nextBtn = document.getElementById('next');
const sendBtn = document.getElementById('send');
const input = document.getElementById('input');

// Éléments Photos
const reqPhotoBtn = document.getElementById('req-photo');
const photoActions = document.getElementById('photo-actions'); // Conteneur des boutons fichier/cam
const btnFile = document.getElementById('btn-file');
const btnCam = document.getElementById('btn-cam');
const fileInput = document.getElementById('file-input');

// Éléments Verification
const modalVerif = document.getElementById('verification-modal');
const enterBtn = document.getElementById('enter-btn');
const ageCheck = document.getElementById('age-check');

// Éléments Caméra Modal
const modalCam = document.getElementById('camera-modal');
const video = document.getElementById('camera-preview');
const canvas = document.getElementById('camera-canvas');
const snapBtn = document.getElementById('snap-btn');
const closeCamBtn = document.getElementById('close-cam-btn');

let socket;
let captchaToken = null;
let isVerified = false;

// --- 1. GESTION DE LA VERIFICATION (Captcha + Age) ---

// Fonction appelée automatiquement par Google quand le user coche la case
window.onCaptchaSuccess = function(token) {
  console.log("Captcha résolu !");
  captchaToken = token;
  checkValidation();
};

ageCheck.addEventListener('change', checkValidation);

function checkValidation() {
  // On active le bouton Entrer seulement si : Age coché ET Captcha token présent
  if (ageCheck.checked && captchaToken) {
    enterBtn.disabled = false;
  } else {
    enterBtn.disabled = true;
  }
}

enterBtn.addEventListener('click', () => {
  modalVerif.style.display = 'none'; // Cache la modale
  connect(); // Lance la connexion WebSocket
});

// --- 2. FONCTIONS UTILITAIRES ---

function addLine(text, cls='sys') {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addImage(base64, cls='other') {
  const div = document.createElement('div');
  div.className = cls;
  const img = document.createElement('img');
  img.src = base64;
  img.className = 'chat-img';
  div.appendChild(img);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resetPhotoUI() {
  reqPhotoBtn.disabled = true;         // Désactive le bouton demande
  reqPhotoBtn.style.display = 'block'; // Le ré-affiche
  photoActions.classList.add('hidden'); // Cache les boutons d'envoi
}

// --- 3. WEBSOCKET ---

function connect() {
  socket = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host);
  
  socket.onopen = () => {
    statusEl.textContent = 'Vérification en cours...';
    // IMMEDIATEMENT envoyer le token au serveur
    socket.send(JSON.stringify({ type: 'verify_captcha', token: captchaToken }));
  };

  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    // --- Reponse du serveur sur le Captcha ---
    if (msg.type === 'captcha_success') {
      isVerified = true;
      statusEl.textContent = 'Connecté (Vérifié)';
      addLine('Sécurité validée. Cliquez sur Start.', 'sys');
      startBtn.disabled = false;

    } else if (msg.type === 'error' && msg.reason === 'captcha_failed') {
      alert("Erreur de vérification Captcha. Veuillez recharger la page.");
      socket.close();

    // --- Logique Chat Standard ---
    } else if (msg.type === 'queued') {
      addLine('En attente d’un partenaire...', 'sys');
      startBtn.disabled = true; nextBtn.disabled = true; sendBtn.disabled = true;
      resetPhotoUI();

    } else if (msg.type === 'matched') {
      addLine("Vous êtes connecté à un inconnu.", 'sys');
      startBtn.disabled = true; nextBtn.disabled = false; sendBtn.disabled = false;
      
      // On peut maintenant demander des photos
      reqPhotoBtn.disabled = false;

    } else if (msg.type === 'chat') {
      addLine(msg.text, 'other');

    } else if (msg.type === 'ended' || msg.type === 'partner_left') {
      addLine("Le partenaire est parti.", 'sys');
      nextBtn.disabled = true; sendBtn.disabled = true; startBtn.disabled = false;
      resetPhotoUI();

    // --- Logique Photos ---
    } else if (msg.type === 'request_photo') {
      // L'autre demande
      if (confirm("Le partenaire souhaite échanger des photos. Acceptez-vous ?")) {
        socket.send(JSON.stringify({ type: 'response_photo', accepted: true }));
        activatePhotoSharing();
        addLine("Vous avez accepté le partage.", 'sys');
      } else {
        socket.send(JSON.stringify({ type: 'response_photo', accepted: false }));
        addLine("Vous avez refusé le partage.", 'sys');
      }

    } else if (msg.type === 'response_photo') {
      // Réponse à MA demande
      if (msg.accepted) {
        addLine("Le partenaire a accepté !", 'sys');
        activatePhotoSharing();
      } else {
        addLine("Le partenaire a refusé les photos.", 'sys');
      }

    } else if (msg.type === 'photo_data') {
      addImage(msg.image, 'other');
    }
  };

  socket.onclose = () => {
    statusEl.textContent = 'Déconnecté';
    startBtn.disabled = false;
  };
}

function activatePhotoSharing() {
  reqPhotoBtn.style.display = 'none';      // On cache le "?"
  photoActions.classList.remove('hidden'); // On affiche [File] [Cam]
}

// --- 4. LISTENERS BOUTONS ---

startBtn.onclick = () => {
  if (isVerified) socket.send(JSON.stringify({ type: 'find_partner' }));
};

nextBtn.onclick = () => {
  if (isVerified) {
    socket.send(JSON.stringify({ type: 'next' }));
    resetPhotoUI();
  }
};

sendBtn.onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  addLine(text, 'me');
  socket.send(JSON.stringify({ type: 'chat', text }));
  input.value = '';
};
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
});

// --- 5. LOGIQUE PHOTOS ---

// A. Demander
reqPhotoBtn.onclick = () => {
  socket.send(JSON.stringify({ type: 'request_photo' }));
  addLine("Demande de photos envoyée...", 'sys');
};

// B. Upload Fichier
btnFile.onclick = () => fileInput.click();

fileInput.onchange = () => {
  const file = fileInput.files[0];
  if (!file) return;
  // Max 2MB
  if (file.size > 2 * 1024 * 1024) return alert("Image trop lourde (Max 2Mo)");
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    addImage(base64, 'me'); // Affiche chez moi
    socket.send(JSON.stringify({ type: 'photo_data', image: base64 })); // Envoie
  };
  reader.readAsDataURL(file);
};

// C. Caméra
let stream = null;

btnCam.onclick = async () => {
  try {
    // Demande accès webcam
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    modalCam.classList.remove('hidden');
  } catch(err) {
    alert("Erreur caméra : " + err.message);
  }
};

closeCamBtn.onclick = () => {
  stopCamera();
  modalCam.classList.add('hidden');
};

snapBtn.onclick = () => {
  if (!stream) return;
  
  // 1. Dessiner la vidéo sur le canvas invisible
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // 2. Convertir en image base64 (JPEG qualité 0.8)
  const base64 = canvas.toDataURL('image/jpeg', 0.8);
  
  // 3. Envoyer et fermer
  addImage(base64, 'me');
  socket.send(JSON.stringify({ type: 'photo_data', image: base64 }));
  
  stopCamera();
  modalCam.classList.add('hidden');
};

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
}