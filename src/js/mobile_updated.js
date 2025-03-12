let canvas, ctx, video, photoCanvas, photoCtx;
let openCv = null;
let faceClassifier = null;
let eyeClassifier = null;
let lastFaceRect = null;
let lastCardRect = null;
let photoTaken = false;
let autoCaptureEnabled = true;
let showFace = true;
let showCard = true;
let showGuide = true;
let captureMetrics = {};

const BRIGHTNESS_MIN = 50;
const BRIGHTNESS_MAX = 200;
const VARIANCE_MIN = 50;

const CARD_RATIO = 85.6 / 53.98;
// Définir les constantes de résolution
const PROCESSING_WIDTH = 640;
const PROCESSING_HEIGHT = 480;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 960;

async function onOpenCvReady() {
  console.log("OpenCV.js est prêt.");
  document.getElementById("loading").style.display = "none";
  openCv = await cv;
  initCamera();
}

function initCamera() {
  video = document.getElementById("video");
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  photoCanvas = document.getElementById("photoCanvas");
  photoCtx = photoCanvas.getContext("2d");

  // Ajuster la taille du canvas à la fenêtre
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Configurer la taille du photoCanvas
    photoCanvas.width = OUTPUT_WIDTH;
    photoCanvas.height = OUTPUT_HEIGHT;
  }

  // Appeler resizeCanvas au chargement et au redimensionnement
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Accéder à la caméra (préférer la caméra arrière sur mobile)
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: CAPTURE_WIDTH },
      height: { ideal: CAPTURE_HEIGHT },
    },
  };

  // Fonction pour démarrer la vidéo avec interaction utilisateur sur iOS
  function startVideoPlayback() {
    if (video.paused) {
      video
        .play()
        .then(() => {
          console.log("Lecture vidéo démarrée avec succès");
          // Retirer l'écouteur d'événement une fois la vidéo démarrée
          document.removeEventListener("touchend", startVideoPlayback);
        })
        .catch((err) => {
          console.error("Erreur lors du démarrage de la vidéo:", err);
        });
    }
  }

  // Ajouter un écouteur d'événement pour iOS
  document.addEventListener("touchend", startVideoPlayback);

  navigator.mediaDevices
    .getUserMedia(constraints)
    .then(function (stream) {
      video.srcObject = stream;
      video.onloadedmetadata = function () {
        // Essayer de démarrer la lecture automatiquement
        video
          .play()
          .then(() => {
            console.log("Lecture vidéo démarrée automatiquement");
          })
          .catch((e) => {
            console.log(
              "Lecture automatique impossible, attente d'interaction utilisateur",
              e
            );
            // L'utilisateur devra toucher l'écran pour démarrer la vidéo sur iOS
          });

        // Commencer le traitement vidéo
        requestAnimationFrame(processVideo);
      };
    })
    .catch(function (err) {
      console.error("Erreur d'accès à la caméra: ", err);
      alert(
        "Impossible d'accéder à la caméra. Veuillez autoriser l'accès à la caméra et recharger la page."
      );
    });

  // Configurer les événements pour les boutons
  document
    .getElementById("captureBtn")
    .addEventListener("click", () => capturePhoto("manuel"));
  document.getElementById("retakePhoto").addEventListener("click", retakePhoto);
  document
    .getElementById("confirmPhoto")
    .addEventListener("click", confirmPhoto);
  // Les gestionnaires d'événements liés au zoom ont été supprimés

  // Configurer les événements pour les options
  document.getElementById("showFace").addEventListener("change", (e) => {
    showFace = e.target.checked;
  });
  document.getElementById("showCard").addEventListener("change", (e) => {
    showCard = e.target.checked;
  });
  document.getElementById("showGuide").addEventListener("change", (e) => {
    showGuide = e.target.checked;
  });
  document.getElementById("autoCapture").addEventListener("change", (e) => {
    autoCaptureEnabled = e.target.checked;
  });

  // Configurer les événements pour le zoom et le déplacement
  const zoomCanvas = document.getElementById("zoomCanvas");
  zoomCanvas.addEventListener("mousedown", startDrag);
  zoomCanvas.addEventListener("mousemove", drag);
  zoomCanvas.addEventListener("mouseup", endDrag);
  zoomCanvas.addEventListener("mouseleave", endDrag);
  zoomCanvas.addEventListener("touchstart", startDragTouch);
  zoomCanvas.addEventListener("touchmove", dragTouch);
  zoomCanvas.addEventListener("touchend", endDragTouch);
}

// Chargement du classificateur pour la détection de visage
async function loadFaceClassifier() {
  try {
    const response = await fetch(
      "src/classifiers/haarcascade_frontalface_default.xml"
    );
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    openCv.FS_createDataFile(
      "/",
      "haarcascade_frontalface_default.xml",
      data,
      true,
      false,
      false
    );
    let classifier = new openCv.CascadeClassifier();
    classifier.load("haarcascade_frontalface_default.xml");
    return classifier;
  } catch (error) {
    console.error(
      "Erreur lors du chargement du classificateur de visage:",
      error
    );
    return null;
  }
}

// Chargement du classificateur pour la détection des yeux
async function loadEyeClassifier() {
  try {
    const response = await fetch("src/classifiers/haarcascade_eye.xml");
    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    openCv.FS_createDataFile(
      "/",
      "haarcascade_eye.xml",
      data,
      true,
      false,
      false
    );
    let classifier = new openCv.CascadeClassifier();
    classifier.load("haarcascade_eye.xml");
    return classifier;
  } catch (error) {
    console.error(
      "Erreur lors du chargement du classificateur des yeux:",
      error
    );
    return null;
  }
}

// Fonction pour capturer une photo
function capturePhoto() {
  if (!lastFaceRect) {
    console.log("Capture impossible : aucun visage détecté");
    return;
  }

  try {
    // Calculer un facteur d'échelle entre la résolution de traitement et la résolution de capture
    const scaleX = CAPTURE_WIDTH / PROCESSING_WIDTH;
    const scaleY = CAPTURE_HEIGHT / PROCESSING_HEIGHT;

    // Adapter le rectangle de la carte à la résolution plus haute
    let extrapolatedCardRect = extrapolateCardRectangle(lastFaceRect);

    // Ajuster la position verticale pour corriger le décalage vers le bas
    // Déplacer le rectangle vers le haut de 5% de sa hauteur
    extrapolatedCardRect.y -= Math.round(
      extrapolatedCardRect.height * 0.05
    );

    let highResCardRect = {
      x: Math.round(extrapolatedCardRect.x * scaleX),
      y: Math.round(extrapolatedCardRect.y * scaleY),
      width: Math.round(extrapolatedCardRect.width * scaleX),
      height: Math.round(extrapolatedCardRect.height * scaleY),
    };

    if (video.readyState === 4) {
      // Capturer directement depuis la vidéo haute résolution
      photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
      photoCtx.drawImage(
        video,
        highResCardRect.x,
        highResCardRect.y,
        highResCardRect.width,
        highResCardRect.height,
        0,
        0,
        photoCanvas.width,
        photoCanvas.height
      );

      // Appliquer des filtres d'amélioration
      photoCtx.filter = "contrast(1.1) brightness(1.05)";
      photoCtx.imageSmoothingEnabled = true;
      photoCtx.imageSmoothingQuality = "high";

      photoTaken = true;
      document.getElementById("photoScreen").style.display = "flex";
      if (autoCaptureEnabled) {
        autoCaptureEnabled = false;
        document.getElementById("autoCapture").checked = false;
      }

      console.log("Photo capturée en haute résolution");
    } else {
      // Solution de secours utilisant le canvas à basse résolution
      photoCtx.drawImage(
        canvas,
        extrapolatedCardRect.x,
        extrapolatedCardRect.y,
        extrapolatedCardRect.width,
        extrapolatedCardRect.height,
        0,
        0,
        photoCanvas.width,
        photoCanvas.height
      );

      photoTaken = true;
      document.getElementById("photoScreen").style.display = "flex";
    }
  } catch (err) {
    console.error("Erreur lors de la capture haute résolution:", err);
    // Solution de secours
    photoCtx.drawImage(canvas, 0, 0, photoCanvas.width, photoCanvas.height);
    photoTaken = true;
    document.getElementById("photoScreen").style.display = "flex";
  }
}

// Le reste des fonctions existantes conservées comme dans l'original...
