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
// Modifier seulement le ratio de sortie
const OUTPUT_WIDTH = 1000;
const OUTPUT_HEIGHT = Math.round(OUTPUT_WIDTH / CARD_RATIO); // Pour respecter le ratio de la carte

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

// Fonction pour reprendre la photo - CORRIGÉE pour s'assurer qu'elle fonctionne
function retakePhoto() {
  photoTaken = false;
  document.getElementById("photoScreen").style.display = "none";
  
  // Réactiver la capture automatique si elle était activée initialement
  if (document.getElementById("autoCapture").checked) {
    autoCaptureEnabled = true;
  }
  
  // S'assurer que la vidéo est en cours de lecture
  if (video.paused) {
    video.play().catch(err => console.error("Erreur lors du redémarrage de la vidéo:", err));
  }
  
  // Forcer le redémarrage du processus de capture
  console.log("Redémarrage du processus de capture...");
  requestAnimationFrame(processVideo);
}

// Le reste des fonctions existantes conservées comme dans l'original...
function processVideo() {
  try {
    // Si une photo a été prise ou si OpenCV n'est pas encore chargé, ne pas continuer
    if (photoTaken || !openCv) {
      if (!photoTaken) {
        requestAnimationFrame(processVideo);
      }
      return;
    }

    // Si les classificateurs ne sont pas encore chargés, les charger
    if (!faceClassifier) {
      Promise.all([loadFaceClassifier(), loadEyeClassifier()]).then(
        ([face, eye]) => {
          faceClassifier = face;
          eyeClassifier = eye;
          requestAnimationFrame(processVideo);
        }
      );
      return;
    }

    // Dessiner un rectangle guide pour aider l'utilisateur
    if (showGuide) {
      drawGuideRect();
    }

    // Ajuster la taille du canvas aux dimensions de la vidéo pour le traitement
    if (
      canvas.width !== PROCESSING_WIDTH ||
      canvas.height !== PROCESSING_HEIGHT
    ) {
      const displayCanvas = document.createElement("canvas");
      displayCanvas.width = canvas.width;
      displayCanvas.height = canvas.height;
      const displayCtx = displayCanvas.getContext("2d");
      displayCtx.drawImage(canvas, 0, 0);

      canvas.width = PROCESSING_WIDTH;
      canvas.height = PROCESSING_HEIGHT;

      // Dessiner d'abord la vidéo dans le canvas à la résolution de traitement
      ctx.drawImage(
        video,
        0,
        0,
        PROCESSING_WIDTH,
        PROCESSING_HEIGHT
      );

      // Ensuite, redessiner avec les bonnes dimensions d'affichage
      const tempCanvas = canvas.cloneNode();
      document.body.appendChild(tempCanvas);
      tempCanvas.width = PROCESSING_WIDTH;
      tempCanvas.height = PROCESSING_HEIGHT;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(canvas, 0, 0);

      canvas.width = displayCanvas.width;
      canvas.height = displayCanvas.height;
      ctx.drawImage(displayCanvas, 0, 0);

      document.body.removeChild(tempCanvas);
    } else {
      // Dessiner la vidéo dans le canvas
      ctx.drawImage(
        video,
        0,
        0,
        PROCESSING_WIDTH,
        PROCESSING_HEIGHT
      );
    }

    // Créer une image Mat à partir du canvas
    const src = new openCv.Mat(
      PROCESSING_HEIGHT,
      PROCESSING_WIDTH,
      openCv.CV_8UC4
    );
    const cap = new openCv.VideoCapture(canvas);
    cap.read(src);

    // Convertir l'image en niveaux de gris pour la détection de visage
    const gray = new openCv.Mat();
    openCv.cvtColor(src, gray, openCv.COLOR_RGBA2GRAY);

    // Détecter les visages
    const faces = new openCv.RectVector();
    faceClassifier.detectMultiScale(gray, faces);

    // Traiter chaque visage détecté
    if (faces.size() > 0) {
      processDetectedFaces(src, gray, faces);
    }

    // Afficher l'image traitée
    openCv.imshow(canvas, src);

    // Libérer la mémoire
    src.delete();
    gray.delete();
    faces.delete();

    // Continuer le traitement vidéo si aucune photo n'a été prise
    if (!photoTaken) {
      requestAnimationFrame(processVideo);
    }
  } catch (error) {
    console.error("Erreur pendant le traitement de la vidéo:", error);
    requestAnimationFrame(processVideo);
  }
}

function processDetectedFaces(src, gray, faces) {
  try {
    // Trouver le plus grand visage (supposé être le plus proche)
    let maxArea = 0;
    let maxIndex = -1;

    for (let i = 0; i < faces.size(); ++i) {
      const face = faces.get(i);
      const area = face.width * face.height;
      if (area > maxArea) {
        maxArea = area;
        maxIndex = i;
      }
    }

    if (maxIndex >= 0) {
      const face = faces.get(maxIndex);
      const faceRect = {
        x: face.x,
        y: face.y,
        width: face.width,
        height: face.height,
      };

      // Stocker le rectangle du dernier visage détecté
      lastFaceRect = faceRect;

      // Dessiner un rectangle autour du visage si l'option est activée
      if (showFace) {
        openCv.rectangle(
          src,
          new openCv.Point(face.x, face.y),
          new openCv.Point(face.x + face.width, face.y + face.height),
          [0, 255, 0, 255],
          2
        );
      }

      // Extrapoler le rectangle de la carte d'identité à partir du visage
      const cardRect = extrapolateCardRectangle(faceRect);

      // Dessiner un rectangle autour de la carte si l'option est activée
      if (showCard && cardRect) {
        openCv.rectangle(
          src,
          new openCv.Point(cardRect.x, cardRect.y),
          new openCv.Point(
            cardRect.x + cardRect.width,
            cardRect.y + cardRect.height
          ),
          [0, 0, 255, 255],
          2
        );
      }

      // Détecter les yeux à l'intérieur du visage si l'option est activée
      if (showFace) {
        detectEyes(src, gray, faceRect);
      }

      // Vérifier les conditions pour la capture automatique
      if (autoCaptureEnabled && !photoTaken) {
        // Analyser la qualité d'image (luminosité, netteté)
        const imageQuality = analyzeImageQuality(gray);

        // Calculer le pourcentage du rectangle de carte à l'intérieur du rectangle guide
        const insidePercentage = calculateInsidePercentage(cardRect);

        // Mettre à jour les informations d'interface
        updateUIInfo(imageQuality, insidePercentage);

        // Capturer automatiquement si toutes les conditions sont remplies
        if (
          imageQuality.brightness > BRIGHTNESS_MIN &&
          imageQuality.brightness < BRIGHTNESS_MAX &&
          imageQuality.variance > VARIANCE_MIN &&
          insidePercentage > 80
        ) {
          capturePhoto();
        }
      }
    }
  } catch (error) {
    console.error("Erreur pendant le traitement des visages:", error);
  }
}

function detectEyes(src, gray, faceRect) {
  try {
    // Définir la région d'intérêt (ROI) pour les yeux
    const roiRect = new openCv.Rect(
      faceRect.x,
      faceRect.y,
      faceRect.width,
      Math.floor(faceRect.height / 2)
    );
    const roiGray = gray.roi(roiRect);
    const roiSrc = src.roi(roiRect);

    // Détecter les yeux
    const eyes = new openCv.RectVector();
    eyeClassifier.detectMultiScale(roiGray, eyes);

    // Traiter chaque œil détecté
    for (let i = 0; i < eyes.size(); ++i) {
      const eye = eyes.get(i);
      const eyeCenter = new openCv.Point(
        eye.x + eye.width / 2,
        eye.y + eye.height / 2
      );
      const radius = Math.round((eye.width + eye.height) * 0.25);
      openCv.circle(roiSrc, eyeCenter, radius, [255, 0, 0, 255], 2);
    }

    // Libérer la mémoire
    roiGray.delete();
    roiSrc.delete();
    eyes.delete();
  } catch (error) {
    console.error("Erreur pendant la détection des yeux:", error);
  }
}

function extrapolateCardRectangle(faceRect) {
  if (!faceRect) return null;

  // Facteur de mise à l'échelle pour la largeur de la carte
  const s = 3.2;
  const offsetX = 0;
  const offsetY = 0;

  // Hauteur de la carte basée sur la taille du visage
  let cardHeight = faceRect.height * s;
  
  // Largeur de la carte basée sur le ratio standard d'une carte d'identité
  let cardWidth = cardHeight * CARD_RATIO;

  // Position de la carte centrée par rapport au visage
  let cardX = faceRect.x + faceRect.width / 2 - cardWidth / 2 + offsetX;
  let cardY = faceRect.y + faceRect.height / 2 - cardHeight / 2 + offsetY;

  // Créer le rectangle de la carte
  return {
    x: Math.round(cardX),
    y: Math.round(cardY),
    width: Math.round(cardWidth),
    height: Math.round(cardHeight),
  };
}

function drawGuideRect() {
  // Dessiner un rectangle guide pour la carte d'identité
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // Calculer le rectangle guide
  const guideHeight = canvasHeight * 0.7;
  const guideWidth = guideHeight * CARD_RATIO;
  const guideX = (canvasWidth - guideWidth) / 2;
  const guideY = (canvasHeight - guideHeight) / 2;

  // Dessiner le rectangle guide
  ctx.strokeStyle = "rgba(0, 120, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(guideX, guideY, guideWidth, guideHeight);
  ctx.stroke();

  // Dessiner des coins pour ajouter un effet visuel
  const cornerSize = 20;
  ctx.strokeStyle = "rgba(0, 180, 255, 1.0)";
  ctx.lineWidth = 3;

  // Coin supérieur gauche
  ctx.beginPath();
  ctx.moveTo(guideX, guideY + cornerSize);
  ctx.lineTo(guideX, guideY);
  ctx.lineTo(guideX + cornerSize, guideY);
  ctx.stroke();

  // Coin supérieur droit
  ctx.beginPath();
  ctx.moveTo(guideX + guideWidth - cornerSize, guideY);
  ctx.lineTo(guideX + guideWidth, guideY);
  ctx.lineTo(guideX + guideWidth, guideY + cornerSize);
  ctx.stroke();

  // Coin inférieur gauche
  ctx.beginPath();
  ctx.moveTo(guideX, guideY + guideHeight - cornerSize);
  ctx.lineTo(guideX, guideY + guideHeight);
  ctx.lineTo(guideX + cornerSize, guideY + guideHeight);
  ctx.stroke();

  // Coin inférieur droit
  ctx.beginPath();
  ctx.moveTo(guideX + guideWidth - cornerSize, guideY + guideHeight);
  ctx.lineTo(guideX + guideWidth, guideY + guideHeight);
  ctx.lineTo(guideX + guideWidth, guideY + guideHeight - cornerSize);
  ctx.stroke();

  return {
    x: guideX,
    y: guideY,
    width: guideWidth,
    height: guideHeight,
  };
}

function calculateInsidePercentage(cardRect) {
  if (!cardRect) return 0;

  // Récupérer les dimensions du canvas
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // Calculer le rectangle guide
  const guideRect = drawGuideRect();

  // Calculer l'intersection
  const xOverlap = Math.max(
    0,
    Math.min(
      cardRect.x + cardRect.width,
      guideRect.x + guideRect.width
    ) - Math.max(cardRect.x, guideRect.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(
      cardRect.y + cardRect.height,
      guideRect.y + guideRect.height
    ) - Math.max(cardRect.y, guideRect.y)
  );
  const overlapArea = xOverlap * yOverlap;
  const cardArea = cardRect.width * cardRect.height;

  // Calculer le pourcentage de la carte à l'intérieur du guide
  const percentage = (overlapArea / cardArea) * 100;
  return percentage;
}

function analyzeImageQuality(gray) {
  try {
    // Calculer la luminosité moyenne
    const mean = new openCv.Mat();
    const stddev = new openCv.Mat();
    openCv.meanStdDev(gray, mean, stddev);
    
    const brightness = mean.data64F[0];
    const variance = stddev.data64F[0] * stddev.data64F[0]; // Variance
    
    // Libérer la mémoire
    mean.delete();
    stddev.delete();
    
    return {
      brightness: brightness,
      variance: variance,
    };
  } catch (error) {
    console.error("Erreur lors de l'analyse de la qualité d'image:", error);
    return {
      brightness: 0,
      variance: 0,
    };
  }
}

function updateUIInfo(imageQuality, insidePercentage) {
  const infoDiv = document.getElementById("info");
  if (!infoDiv) return;

  let statusClass = "";
  let statusMessage = "";

  if (insidePercentage < 80) {
    statusClass = "warning";
    statusMessage = "Veuillez aligner la carte avec le cadre bleu";
  } else if (
    imageQuality.brightness < BRIGHTNESS_MIN ||
    imageQuality.brightness > BRIGHTNESS_MAX
  ) {
    statusClass = "warning";
    statusMessage = "Ajustez l'éclairage (trop sombre ou trop clair)";
  } else if (imageQuality.variance < VARIANCE_MIN) {
    statusClass = "warning";
    statusMessage = "Image floue, tenez l'appareil stable";
  } else {
    statusClass = "success";
    statusMessage = "Parfait ! Capture en cours...";
  }

  infoDiv.className = statusClass;
  infoDiv.innerHTML = `
    <div>${statusMessage}</div>
    <div class="metrics">
      Lumière: ${Math.round(imageQuality.brightness)}/255 | 
      Netteté: ${Math.round(imageQuality.variance)} | 
      Alignement: ${Math.round(insidePercentage)}%
    </div>
  `;
}

function confirmPhoto() {
  alert("Photo confirmée! Vous pouvez maintenant la télécharger ou la partager.");
  // Ici, vous pourriez implémenter la logique pour enregistrer ou envoyer la photo
}

// Variables pour le zoom et le déplacement
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let zoomLevel = 1;
let panX = 0;
let panY = 0;

function startDrag(e) {
  isDragging = true;
  dragStartX = e.clientX - panX;
  dragStartY = e.clientY - panY;
  e.preventDefault();
}

function drag(e) {
  if (!isDragging) return;
  panX = e.clientX - dragStartX;
  panY = e.clientY - dragStartY;
  applyZoomAndPan();
  e.preventDefault();
}

function endDrag() {
  isDragging = false;
}

function startDragTouch(e) {
  if (e.touches.length === 1) {
    isDragging = true;
    dragStartX = e.touches[0].clientX - panX;
    dragStartY = e.touches[0].clientY - panY;
  }
  e.preventDefault();
}

function dragTouch(e) {
  if (!isDragging || e.touches.length !== 1) return;
  panX = e.touches[0].clientX - dragStartX;
  panY = e.touches[0].clientY - dragStartY;
  applyZoomAndPan();
  e.preventDefault();
}

function endDragTouch() {
  isDragging = false;
}

function applyZoomAndPan() {
  const zoomCanvas = document.getElementById("zoomCanvas");
  zoomCanvas.style.transform = `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`;
}
