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
        requestAnimationFrame(processFrame);
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

  // Retrait des gestionnaires d'événements pour le zoom et le déplacement
  // qui ne sont pas présents dans la version mobile
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

// Détection de visage
async function detectFace(src, gray) {
  if (!faceClassifier) {
    faceClassifier = await loadFaceClassifier();
  }

  try {
    const faces = new openCv.RectVector();
    const minSize = new openCv.Size(80, 80);
    const maxSize = new openCv.Size(300, 300);

    // Détecter les visages
    faceClassifier.detectMultiScale(gray, faces, 1.1, 5, 0, minSize, maxSize);

    if (faces.size() > 0) {
      // Sélectionner le plus grand visage
      let bestFace = new openCv.Rect(0, 0, 0, 0);
      let maxArea = 0;

      for (let i = 0; i < faces.size(); i++) {
        const face = faces.get(i);
        const area = face.width * face.height;
        if (area > maxArea) {
          maxArea = area;
          bestFace = face;
        }
      }

      // Stabiliser le rectangle du visage pour éviter les tremblements
      if (lastFaceRect) {
        // Moyenne mobile pour stabiliser la position du rectangle
        const alpha = 0.7; // Facteur de lissage (0-1)
        bestFace.x = Math.round(
          alpha * lastFaceRect.x + (1 - alpha) * bestFace.x
        );
        bestFace.y = Math.round(
          alpha * lastFaceRect.y + (1 - alpha) * bestFace.y
        );
        bestFace.width = Math.round(
          alpha * lastFaceRect.width + (1 - alpha) * bestFace.width
        );
        bestFace.height = Math.round(
          alpha * lastFaceRect.height + (1 - alpha) * bestFace.height
        );
      }

      // Mettre à jour le dernier rectangle de visage
      lastFaceRect = {
        x: bestFace.x,
        y: bestFace.y,
        width: bestFace.width,
        height: bestFace.height,
      };

      // Dessiner le rectangle du visage si l'option est activée
      if (showFace) {
        openCv.rectangle(
          src,
          new openCv.Point(bestFace.x, bestFace.y),
          new openCv.Point(
            bestFace.x + bestFace.width,
            bestFace.y + bestFace.height
          ),
          [0, 255, 0, 255],
          2
        );
      }

      // Détecter les yeux pour une meilleure précision
      await detectEyes(src, lastFaceRect);

      return lastFaceRect;
    } else {
      return lastFaceRect; // Conserver le dernier rectangle détecté
    }
  } catch (error) {
    console.error("Erreur lors de la détection du visage:", error);
    return lastFaceRect;
  } finally {
    // Nettoyage mémoire
    // faces.delete(); // Uncomment if needed
  }
}

// Détection des yeux
async function detectEyes(src, faceRect) {
  if (!faceRect) return;
  if (!eyeClassifier) {
    eyeClassifier = await loadEyeClassifier();
  }

  try {
    // Créer une région d'intérêt (ROI) pour la moitié supérieure du visage
    const eyeRegionHeight = Math.round(faceRect.height * 0.5);
    const eyeRegionTop = faceRect.y + Math.round(faceRect.height * 0.2);
    const eyeRegionRect = new openCv.Rect(
      faceRect.x,
      eyeRegionTop,
      faceRect.width,
      eyeRegionHeight
    );

    // Extraction de la région des yeux
    const faceROI = src.roi(eyeRegionRect);
    const grayROI = new openCv.Mat();
    openCv.cvtColor(faceROI, grayROI, openCv.COLOR_RGBA2GRAY);

    // Détecter les yeux
    const eyes = new openCv.RectVector();
    eyeClassifier.detectMultiScale(grayROI, eyes);

    let eyeCount = 0;
    let leftEye = null;
    let rightEye = null;

    // Analyser les yeux détectés
    for (let i = 0; i < eyes.size() && eyeCount < 2; i++) {
      const eye = eyes.get(i);
      const eyeCenter = { x: eye.x + eye.width / 2, y: eye.y + eye.height / 2 };
      const eyeArea = eye.width * eye.height;

      // Filtrer les faux positifs (trop petits ou trop grands)
      if (eyeArea < 100 || eyeArea > 10000) continue;

      // Déterminer si c'est l'œil gauche ou droit
      if (eyeCenter.x < faceRect.width / 2) {
        // Œil gauche (du point de vue de la caméra)
        leftEye = eye;
      } else {
        // Œil droit (du point de vue de la caméra)
        rightEye = eye;
      }

      eyeCount++;

      // Dessiner le rectangle de l'œil si l'option est activée
      if (showFace) {
        openCv.rectangle(
          faceROI,
          new openCv.Point(eye.x, eye.y),
          new openCv.Point(eye.x + eye.width, eye.y + eye.height),
          [255, 0, 0, 255],
          2
        );
      }
    }

    // Libérer la mémoire
    faceROI.delete();
    grayROI.delete();
    eyes.delete();

    return { leftEye, rightEye };
  } catch (error) {
    console.error("Erreur lors de la détection des yeux:", error);
    return null;
  }
}

// Extrapolation du rectangle de la carte à partir du visage
// Alignée avec l'implémentation desktop.js
function extrapolateCardRectangle(faceRect) {
  if (!faceRect) return null;

  // Utiliser la même logique que desktop.js
  const s = 3.2;
  const offsetX = -15;
  const offsetY = -10;
  let cardHeight = faceRect.height * s;
  let cardWidth = cardHeight * CARD_RATIO;
  let cardX = faceRect.x - faceRect.width * 0.4 + offsetX;
  let faceCenterY = faceRect.y + faceRect.height / 2;
  let cardY = faceCenterY - cardHeight / 2 + offsetY;

  return { x: cardX, y: cardY, width: cardWidth, height: cardHeight };
}

// Fonction pour capturer une photo
function capturePhoto(mode = "auto") {
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

// Fonction pour reprendre la photo
function retakePhoto() {
  photoTaken = false;
  document.getElementById("photoScreen").style.display = "none";
}

// Fonction pour confirmer la photo
function confirmPhoto() {
  // Convertir le canvas en base64
  const photoData = photoCanvas.toDataURL("image/jpeg");
  // Ici, vous pouvez envoyer la photo à un serveur ou l'enregistrer localement
  console.log("Photo confirmée et prête à être envoyée");
}

// Fonctions pour calculer les métriques
function calculateAlignment(faceRect, cardRect) {
  if (!faceRect || !cardRect) return "Non calculé";

  // Calculer l'alignement horizontal
  const faceCenter = faceRect.x + faceRect.width / 2;
  const cardCenter = cardRect.x + cardRect.width / 2;
  const deviation = Math.abs(faceCenter - cardCenter);
  const maxAllowedDeviation = faceRect.width * 0.1;

  if (deviation < maxAllowedDeviation) {
    return "Bon";
  } else if (deviation < maxAllowedDeviation * 2) {
    return "Moyen";
  } else {
    return "Mauvais";
  }
}

function calculateDistance(cardRect) {
  if (!cardRect) return "Non calculée";

  // La taille idéale de la carte sur l'écran
  const idealWidth = canvas.width * 0.6;
  const currentWidth = cardRect.width;
  const ratio = currentWidth / idealWidth;

  if (ratio > 0.9 && ratio < 1.1) {
    return "Bonne";
  } else if (ratio <= 0.9) {
    return "Trop loin";
  } else {
    return "Trop près";
  }
}

async function analyzeImageQuality(gray) {
  try {
    // Calculer la luminosité moyenne
    let brightnessMean = new openCv.Mat();
    let brightnessStdDev = new openCv.Mat();
    openCv.meanStdDev(gray, brightnessMean, brightnessStdDev);
    let brightness = Math.round(brightnessMean.data64F[0]);

    // Calculer la variance (mesure de netteté)
    let laplacian = new openCv.Mat();
    openCv.Laplacian(gray, laplacian, openCv.CV_64F);
    let mean = new openCv.Mat();
    let stdDev = new openCv.Mat();
    openCv.meanStdDev(laplacian, mean, stdDev);
    let variance = Math.round(stdDev.data64F[0] * stdDev.data64F[0]);

    // Libérer la mémoire
    brightnessMean.delete();
    brightnessStdDev.delete();
    laplacian.delete();
    mean.delete();
    stdDev.delete();

    return { brightness, variance };
  } catch (error) {
    console.error("Erreur lors de l'analyse de la qualité d'image:", error);
    return { brightness: 0, variance: 0 };
  }
}

function calculateCardAngle(cardRect) {
  // Cette fonction serait utilisée pour calculer l'angle de rotation de la carte
  // si nous avions une détection de contours plus avancée
  // Pour l'instant, nous retournons simplement 0 (carte droite)
  return 0;
}

// Dessiner le rectangle guide pour la carte
function drawCardGuide(ctx, width, height) {
  if (!showGuide) return;

  // Calculer les dimensions du guide
  const cardWidth = width * 0.7;
  const cardHeight = cardWidth / CARD_RATIO;
  const cardX = (width - cardWidth) / 2;
  const cardY = height * 0.55;

  // Dessiner le rectangle guide
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);
  ctx.setLineDash([]);

  // Ajouter un texte d'instruction
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.font = "18px Arial";
  ctx.textAlign = "center";
  ctx.fillText(
    "Alignez votre carte d'identité avec ce cadre",
    width / 2,
    cardY - 10
  );
}

// Traitement de la vidéo avec OpenCV
async function processFrame() {
  try {
    if (!openCv || !video.readyState || video.readyState < 2) {
      requestAnimationFrame(processFrame);
      return;
    }

    // Ajuster la taille du canvas à la fenêtre
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // Déterminer le ratio d'aspect
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = windowWidth / windowHeight;

    // Calculer les dimensions de la vidéo dans le canvas
    let drawWidth,
      drawHeight,
      offsetX = 0,
      offsetY = 0;

    if (videoRatio > canvasRatio) {
      // La vidéo est plus large que le canvas
      drawHeight = windowHeight;
      drawWidth = video.videoWidth * (windowHeight / video.videoHeight);
      offsetX = (windowWidth - drawWidth) / 2;
    } else {
      // La vidéo est plus haute que le canvas
      drawWidth = windowWidth;
      drawHeight = video.videoHeight * (windowWidth / video.videoWidth);
      offsetY = (windowHeight - drawHeight) / 2;
    }

    // Effacer le canvas
    ctx.clearRect(0, 0, windowWidth, windowHeight);

    // Dessiner la vidéo centrée dans le canvas
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

    // Créer un Mat à partir du canvas
    const src = openCv.imread(canvas);
    const gray = new openCv.Mat();
    openCv.cvtColor(src, gray, openCv.COLOR_RGBA2GRAY);

    // Détecter le visage
    const faceRect = await detectFace(src, gray);

    // Si un visage est détecté, extrapoler le rectangle de la carte
    if (faceRect) {
      const cardRect = extrapolateCardRectangle(faceRect);
      lastCardRect = cardRect;

      // Dessiner le rectangle de la carte si l'option est activée
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

      // Analyser la qualité de l'image pour la capture automatique
      if (autoCaptureEnabled && !photoTaken) {
        try {
          const imageQuality = await analyzeImageQuality(gray);

          // Vérifier si les conditions sont bonnes pour la capture automatique
          if (
            imageQuality.brightness > BRIGHTNESS_MIN &&
            imageQuality.brightness < BRIGHTNESS_MAX &&
            imageQuality.variance > VARIANCE_MIN &&
            calculateAlignment(faceRect, cardRect) === "Bon" &&
            calculateDistance(cardRect) === "Bonne"
          ) {
            capturePhoto("auto");
          }
        } catch (error) {
          console.error(
            "Erreur lors de l'analyse de qualité pour auto capture:",
            error
          );
        }
      }
    }

    // Dessiner le rectangle guide
    drawCardGuide(ctx, windowWidth, windowHeight);

    // Afficher le résultat
    openCv.imshow(canvas, src);

    // Libérer la mémoire
    src.delete();
    gray.delete();

    // Continuer la boucle
    requestAnimationFrame(processFrame);
  } catch (error) {
    console.error("Erreur dans processFrame:", error);
    requestAnimationFrame(processFrame);
  }
}
