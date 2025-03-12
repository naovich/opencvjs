// Variables pour le canvas et la vidéo
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

// Constantes pour les métriques
const BRIGHTNESS_MIN = 50;
const BRIGHTNESS_MAX = 200;
const VARIANCE_MIN = 50;

// Constantes
const CARD_RATIO = 85.6 / 53.98; // Ratio standard d'une carte d'identité
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;

// Fonction appelée lorsque OpenCV est chargé
async function onOpenCvReady() {
  console.log("OpenCV.js est prêt.");
  document.getElementById("loading").style.display = "none";
  openCv = await cv;
  initCamera();
}

// Initialisation de la caméra
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
    photoCanvas.width = CAPTURE_WIDTH;
    photoCanvas.height = CAPTURE_HEIGHT;
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

// Détection de visage
async function detectFace(src, gray) {
  if (!faceClassifier) {
    faceClassifier = await loadFaceClassifier();
    if (!faceClassifier) return null;
  }

  let faces = new openCv.RectVector();
  faceClassifier.detectMultiScale(gray, faces, 1.3, 5, 0);

  let currentFaceRect = null;
  if (faces.size() > 0) {
    // Prendre le plus grand visage ou celui le plus au centre
    let bestFace = null;
    let bestScore = 0;

    for (let i = 0; i < faces.size(); i++) {
      let face = faces.get(i);
      let area = face.width * face.height;
      let centerX = face.x + face.width / 2;
      let centerY = face.y + face.height / 2;
      let distanceFromCenter = Math.sqrt(
        Math.pow(centerX - gray.cols / 2, 2) +
          Math.pow(centerY - gray.rows / 2, 2)
      );
      let score = area * (1 - distanceFromCenter / (gray.cols / 2));

      if (score > bestScore) {
        bestScore = score;
        bestFace = face;
      }
    }

    if (bestFace) {
      currentFaceRect = {
        x: bestFace.x,
        y: bestFace.y,
        width: bestFace.width,
        height: bestFace.height,
      };

      // Dessiner le rectangle du visage si l'option est activée
      if (showFace) {
        let pt1 = new openCv.Point(currentFaceRect.x, currentFaceRect.y);
        let pt2 = new openCv.Point(
          currentFaceRect.x + currentFaceRect.width,
          currentFaceRect.y + currentFaceRect.height
        );
        openCv.rectangle(src, pt1, pt2, [0, 255, 0, 255], 2);
      }
    }
  }

  faces.delete();
  lastFaceRect = currentFaceRect;
  return currentFaceRect;
}

// Détection des yeux
async function detectEyes(src, faceRect) {
  if (!faceRect) return [];
  if (!eyeClassifier) {
    eyeClassifier = await loadEyeClassifier();
    if (!eyeClassifier) return [];
  }

  try {
    let faceROI = src.roi(
      new openCv.Rect(faceRect.x, faceRect.y, faceRect.width, faceRect.height)
    );
    let grayFace = new openCv.Mat();
    openCv.cvtColor(faceROI, grayFace, openCv.COLOR_RGBA2GRAY);

    let eyes = new openCv.RectVector();
    eyeClassifier.detectMultiScale(
      grayFace,
      eyes,
      1.1,
      5,
      0,
      new openCv.Size(20, 20)
    );

    let eyesArray = [];
    for (let i = 0; i < eyes.size(); i++) {
      let eye = eyes.get(i);
      eyesArray.push({
        x: eye.x,
        y: eye.y,
        width: eye.width,
        height: eye.height,
        score: eye.y * 1000 + eye.width * eye.height,
      });
    }

    // Trier par position verticale et taille
    eyesArray.sort((a, b) => a.score - b.score);

    // Filtrer pour ne garder que les yeux dans la moitié supérieure du visage
    eyesArray = eyesArray.filter((eye) => eye.y < faceRect.height * 0.5);

    // Garder les deux premiers yeux seulement
    let selectedEyes = eyesArray.slice(0, 2);

    // Si on a deux yeux, les trier de gauche à droite
    if (selectedEyes.length === 2) {
      selectedEyes.sort((a, b) => a.x - b.x);

      // Dessiner les rectangles des yeux si l'option d'affichage du visage est activée
      if (showFace) {
        selectedEyes.forEach((eye) => {
          let eyeRect = new openCv.Rect(
            faceRect.x + eye.x,
            faceRect.y + eye.y,
            eye.width,
            eye.height
          );
          let pt1 = new openCv.Point(eyeRect.x, eyeRect.y);
          let pt2 = new openCv.Point(
            eyeRect.x + eyeRect.width,
            eyeRect.y + eyeRect.height
          );
          openCv.rectangle(src, pt1, pt2, [238, 130, 238, 255], 2);
        });
      }

      // Dessiner la ligne entre les yeux
      let leftEye = selectedEyes[0];
      let rightEye = selectedEyes[1];

      let leftEyeCenter = {
        x: faceRect.x + leftEye.x + leftEye.width / 2,
        y: faceRect.y + leftEye.y + leftEye.height / 2,
      };

      let rightEyeCenter = {
        x: faceRect.x + rightEye.x + rightEye.width / 2,
        y: faceRect.y + rightEye.y + rightEye.height / 2,
      };

      // Dessiner la ligne entre les yeux si l'option d'affichage du visage est activée
      if (showFace) {
        openCv.line(
          src,
          new openCv.Point(leftEyeCenter.x, leftEyeCenter.y),
          new openCv.Point(rightEyeCenter.x, rightEyeCenter.y),
          [0, 255, 255, 255],
          2
        );
      }
    }

    eyes.delete();
    grayFace.delete();
    faceROI.delete();

    return selectedEyes;
  } catch (err) {
    console.error("Erreur dans detectEyes:", err);
    return [];
  }
}

// Extrapolation du rectangle de la carte à partir du visage
function extrapolateCardRectangle(faceRect) {
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

// Capture de la photo
async function capturePhoto(mode = "auto") {
  if (!lastFaceRect) {
    console.log("Capture impossible : aucun visage détecté");
    return;
  }

  try {
    // Extrapoler le rectangle de la carte
    let extrapolatedCardRect = extrapolateCardRectangle(lastFaceRect);
    let lastCardRect = extrapolatedCardRect; // Utiliser le rectangle extrapolé

    // Créer un Mat à partir du canvas pour l'analyse de qualité
    // Utiliser le canvas actuel plutôt que de créer un nouveau Mat directement à partir de la vidéo
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    // Convertir le canvas en Mat
    const src = openCv.imread(tempCanvas);

    // Convertir en niveaux de gris
    const gray = new openCv.Mat();
    openCv.cvtColor(src, gray, openCv.COLOR_RGBA2GRAY);

    // Analyser la qualité de l'image
    const imageQuality = await analyzeImageQuality(gray);

    // Libérer la mémoire
    src.delete();
    gray.delete();

    // Évaluer la luminosité
    let brightnessEvaluation;
    if (
      imageQuality.brightness > BRIGHTNESS_MIN &&
      imageQuality.brightness < BRIGHTNESS_MAX
    ) {
      brightnessEvaluation = imageQuality.brightness + " (Bonne)";
    } else if (imageQuality.brightness <= BRIGHTNESS_MIN) {
      brightnessEvaluation = imageQuality.brightness + " (Trop sombre)";
    } else {
      brightnessEvaluation = imageQuality.brightness + " (Trop claire)";
    }

    // Évaluer la netteté
    let varianceEvaluation;
    if (imageQuality.variance > VARIANCE_MIN) {
      varianceEvaluation = imageQuality.variance + " (Bonne)";
    } else {
      varianceEvaluation = imageQuality.variance + " (Insuffisante)";
    }

    // Enregistrer les métriques de capture
    captureMetrics = {
      mode: mode,
      timestamp: new Date().toLocaleTimeString(),
      faceRect: { ...lastFaceRect },
      cardRect: { ...extrapolatedCardRect },
      alignment: calculateAlignment(lastFaceRect, extrapolatedCardRect),
      distance: calculateDistance(extrapolatedCardRect),
      brightness: brightnessEvaluation,
      variance: varianceEvaluation,
      cardAngle: calculateCardAngle(extrapolatedCardRect),
    };

    if (video.readyState === 4) {
      // Récupérer les dimensions et positions actuelles de la vidéo dans le canvas
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;
      let drawWidth,
        drawHeight,
        offsetX = 0,
        offsetY = 0;

      if (videoRatio > canvasRatio) {
        // La vidéo est plus large que le canvas
        drawHeight = canvas.height;
        drawWidth = video.videoWidth * (canvas.height / video.videoHeight);
        offsetX = (canvas.width - drawWidth) / 2;
      } else {
        // La vidéo est plus haute que le canvas
        drawWidth = canvas.width;
        drawHeight = video.videoHeight * (canvas.width / video.videoWidth);
        offsetY = (canvas.height - drawHeight) / 2;
      }

      // Calculer les coordonnées proportionnelles dans la vidéo originale
      const scaleX = video.videoWidth / drawWidth;
      const scaleY = video.videoHeight / drawHeight;

      // Ajuster les coordonnées du rectangle par rapport à la vidéo originale
      const sourceX = (lastCardRect.x - offsetX) * scaleX;
      const sourceY = (lastCardRect.y - offsetY) * scaleY;
      const sourceWidth = lastCardRect.width * scaleX;
      const sourceHeight = lastCardRect.height * scaleY;

      // Capturer depuis la vidéo avec les coordonnées ajustées
      photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
      photoCtx.drawImage(
        video,
        Math.max(0, sourceX),
        Math.max(0, sourceY),
        Math.min(sourceWidth, video.videoWidth),
        Math.min(sourceHeight, video.videoHeight),
        0,
        0,
        photoCanvas.width,
        photoCanvas.height
      );

      // Améliorer la qualité de l'image
      photoCtx.filter = "contrast(1.1) brightness(1.05)";
      photoCtx.imageSmoothingEnabled = true;
      photoCtx.imageSmoothingQuality = "high";

      // Afficher l'écran de photo
      document.getElementById("photoScreen").style.display = "flex";
      photoTaken = true;

      // Afficher les métriques de capture
      const metricsDiv = document.getElementById("photoMetrics");
      metricsDiv.innerHTML = `
              <strong>Mode de capture:</strong> ${
                captureMetrics.mode === "auto" ? "Automatique" : "Manuel"
              }<br>
              <strong>Heure:</strong> ${captureMetrics.timestamp}<br>
              <strong>Alignement visage-carte:</strong> ${
                captureMetrics.alignment || "Non mesuré"
              }<br>
              <strong>Distance caméra-carte:</strong> ${
                captureMetrics.distance || "Non mesurée"
              }<br>
              <strong>Luminosité:</strong> ${
                captureMetrics.brightness || "Non mesurée"
              }<br>
              <strong>Netteté:</strong> ${
                captureMetrics.variance || "Non mesurée"
              }<br>
              <strong>Alignement de la carte:</strong> ${
                captureMetrics.cardAngle
                  ? captureMetrics.cardAngle + "°"
                  : "Non mesuré"
              }
            `;

      console.log("Photo capturée");
    }
  } catch (err) {
    console.error("Erreur lors de la capture:", err);
  }
}

// Reprendre la photo
function retakePhoto() {
  document.getElementById("photoScreen").style.display = "none";
  photoTaken = false;
  // Restaurer l'état de la capture automatique en fonction de la checkbox
  autoCaptureEnabled = document.getElementById("autoCapture").checked;
}

// Confirmer la photo
function confirmPhoto() {
  alert(
    "Photo validée! Vous pouvez implémenter ici l'action souhaitée (envoi au serveur, etc.)"
  );
}

// Fonctions pour calculer les métriques
function calculateAlignment(faceRect, cardRect) {
  if (!faceRect || !cardRect) return "Non détecté";

  // Calculer les centres
  const faceCenterX = faceRect.x + faceRect.width / 2;
  const faceCenterY = faceRect.y + faceRect.height / 2;
  const cardCenterX = cardRect.x + cardRect.width / 2;

  // Vérifier si le visage est centré horizontalement dans la carte
  const horizontalOffset = Math.abs(faceCenterX - cardCenterX);
  const maxOffset = cardRect.width * 0.1; // 10% de la largeur de la carte

  if (horizontalOffset <= maxOffset) {
    return "Correct";
  } else if (faceCenterX < cardCenterX) {
    return "Visage trop à gauche";
  } else {
    return "Visage trop à droite";
  }
}

function calculateDistance(cardRect) {
  if (!cardRect) return "Non mesurée";

  // Calculer la surface de la carte
  const cardArea = cardRect.width * cardRect.height;

  // Calculer la surface idéale (basée sur les dimensions du canvas)
  const idealWidth = canvas.width * 0.7;
  const idealHeight = idealWidth / CARD_RATIO;
  const idealArea = idealWidth * idealHeight;

  // Comparer les surfaces
  const ratio = cardArea / idealArea;

  if (ratio > 0.8 && ratio < 1.2) {
    return "Distance optimale";
  } else if (ratio <= 0.8) {
    return "Trop loin";
  } else {
    return "Trop proche";
  }
}

async function analyzeImageQuality(gray) {
  try {
    // Mesurer la luminosité
    let brightnessMean = new openCv.Mat();
    let brightnessStdDev = new openCv.Mat();
    openCv.meanStdDev(gray, brightnessMean, brightnessStdDev);
    let brightness = Math.round(brightnessMean.data64F[0]);

    // Mesurer la netteté avec Laplacian
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

    return { variance, brightness };
  } catch (err) {
    console.error("Erreur dans analyzeImageQuality:", err);
    return { variance: 0, brightness: 0 };
  }
}

// Les fonctions calculateBrightness et calculateVariance ont été remplacées par l'utilisation directe de analyzeImageQuality

function calculateCardAngle(cardRect) {
  if (!cardRect) return null;

  // Dans cette version simplifiée, nous supposons que la carte est horizontale
  // Une implémentation plus avancée utiliserait OpenCV pour détecter l'angle réel
  return 0;
}

// Dessiner le rectangle guide pour la carte
function drawCardGuide(ctx, width, height) {
  // Calculer les dimensions du rectangle guide
  const guideWidth = width * 0.85; // 85% de la largeur de l'écran
  const guideHeight = guideWidth / CARD_RATIO;

  // Calculer la position pour centrer le rectangle
  const guideX = (width - guideWidth) / 2;
  const guideY = (height - guideHeight) / 2;

  // Dessiner le rectangle guide
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(guideX, guideY, guideWidth, guideHeight);
  ctx.setLineDash([]);

  return { x: guideX, y: guideY, width: guideWidth, height: guideHeight };
}

// Traitement de la vidéo avec OpenCV
async function processVideo() {
  try {
    // Vérifier si la vidéo est en cours de lecture
    if (
      video.readyState === video.HAVE_ENOUGH_DATA &&
      openCv &&
      typeof openCv !== "undefined"
    ) {
      // Ajuster le ratio pour maintenir les proportions
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;

      let drawWidth,
        drawHeight,
        offsetX = 0,
        offsetY = 0;

      if (videoRatio > canvasRatio) {
        // La vidéo est plus large que le canvas
        drawHeight = canvas.height;
        drawWidth = video.videoWidth * (canvas.height / video.videoHeight);
        offsetX = (canvas.width - drawWidth) / 2;
      } else {
        // La vidéo est plus haute que le canvas
        drawWidth = canvas.width;
        drawHeight = video.videoHeight * (canvas.width / video.videoWidth);
        offsetY = (canvas.height - drawHeight) / 2;
      }

      // Dessiner la vidéo sur le canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

      // Dessiner le rectangle guide pour la carte
      const guideRect = drawCardGuide(ctx, canvas.width, canvas.height);

      // Traitement OpenCV
      if (!photoTaken) {
        let src = openCv.imread(canvas);
        let gray = new openCv.Mat();
        openCv.cvtColor(src, gray, openCv.COLOR_RGBA2GRAY);

        // Détecter le visage
        const faceRect = await detectFace(src, gray);

        if (faceRect) {
          // Détecter les yeux
          await detectEyes(src, faceRect);

          // Extrapoler et dessiner le rectangle de la carte si l'option est activée
          const cardRect = extrapolateCardRectangle(faceRect);
          if (showCard) {
            let pt1 = new openCv.Point(cardRect.x, cardRect.y);
            let pt2 = new openCv.Point(
              cardRect.x + cardRect.width,
              cardRect.y + cardRect.height
            );
            openCv.rectangle(src, pt1, pt2, [255, 165, 0, 255], 2);
          }

          // Capture automatique si un visage est détecté
          if (autoCaptureEnabled && !photoTaken) {
            // Vérifier si le visage est bien positionné par rapport au guide
            const cardCenterX = cardRect.x + cardRect.width / 2;
            const cardCenterY = cardRect.y + cardRect.height / 2;
            const guideCenterX = guideRect.x + guideRect.width / 2;
            const guideCenterY = guideRect.y + guideRect.height / 2;

            const distanceX = Math.abs(cardCenterX - guideCenterX);
            const distanceY = Math.abs(cardCenterY - guideCenterY);

            // Si la carte est bien positionnée, capturer automatiquement
            if (distanceX < 50 && distanceY < 50) {
              capturePhoto("auto");
            }
          }
        }

        // Afficher le résultat OpenCV
        openCv.imshow(canvas, src);
        src.delete();
        gray.delete();
      }
    } else {
      // Si la vidéo n'est pas prête, afficher un message
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "white";
      ctx.font = "20px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        "Touchez l'écran pour activer la caméra",
        canvas.width / 2,
        canvas.height / 2
      );
    }

    // Continuer la boucle
    requestAnimationFrame(processVideo);
  } catch (e) {
    console.error("Erreur dans processVideo:", e);
    requestAnimationFrame(processVideo);
  }
}
