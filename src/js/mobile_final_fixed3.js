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
let distanceGuideRect = null;

// Constantes pour l'analyse d'image et conditions de capture
const BRIGHTNESS_MIN = 50;
const BRIGHTNESS_MAX = 200;
const VARIANCE_MIN = 50;
const SIZE_RATIO_MIN = 0.8; // 80% minimum de la taille cible
const SIZE_RATIO_MAX = 1.0; // 100% maximum de la taille cible

const CARD_RATIO = 85.6 / 53.98; // Ratio largeur/hauteur de la carte
// Définir les constantes de résolution
const PROCESSING_WIDTH = 640;
const PROCESSING_HEIGHT = 480;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
// Dimensions de sortie avec le ratio correct de la carte
const OUTPUT_WIDTH = 1000;
const OUTPUT_HEIGHT = Math.round(OUTPUT_WIDTH / CARD_RATIO); // Environ 630

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

    // Configurer la taille du photoCanvas avec le bon ratio
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
          });

        // Démarrer le traitement vidéo
        loadFaceDetector().then(() => {
          // Initialiser le rectangle guide
          distanceGuideRect = calculateGuideRect(canvas.width, canvas.height);
          requestAnimationFrame(processFrame);
        });
      };
    })
    .catch(function (error) {
      console.error("Erreur lors de l'accès à la caméra: ", error);
      document.getElementById("error").style.display = "flex";
      document.getElementById("error").innerText =
        "Erreur lors de l'accès à la caméra: " + error.message;
    });

  // Gérer les boutons d'UI
  document.getElementById("captureBtn").addEventListener("click", function () {
    capturePhoto("manual");
  });

  document.getElementById("retakeBtn").addEventListener("click", function () {
    retakePhoto();
  });

  document.getElementById("confirmBtn").addEventListener("click", function () {
    confirmPhoto();
  });

  document.getElementById("autoCapture").addEventListener("change", function () {
    autoCaptureEnabled = this.checked;
  });

  document.getElementById("showFace").addEventListener("change", function () {
    showFace = this.checked;
  });

  document.getElementById("showCard").addEventListener("change", function () {
    showCard = this.checked;
  });

  document.getElementById("showGuide").addEventListener("change", function () {
    showGuide = this.checked;
  });
}

async function loadFaceDetector() {
  try {
    faceClassifier = new openCv.CascadeClassifier();
    let faceCascadeFile = "haarcascade_frontalface_default.xml";
    let faceCascadeData = await (await fetch(faceCascadeFile)).text();
    faceClassifier.load(faceCascadeData);

    eyeClassifier = new openCv.CascadeClassifier();
    let eyeCascadeFile = "haarcascade_eye.xml";
    let eyeCascadeData = await (await fetch(eyeCascadeFile)).text();
    eyeClassifier.load(eyeCascadeData);

    console.log("Cascades chargées avec succès");
  } catch (error) {
    console.error("Erreur lors du chargement des cascades:", error);
  }
}

function calculateGuideRect(canvasWidth, canvasHeight) {
  // Calculer le rectangle guide en fonction des dimensions de l'écran
  const guideHeight = canvasHeight * 0.7;
  const guideWidth = guideHeight * CARD_RATIO;

  const guideX = (canvasWidth - guideWidth) / 2;
  const guideY = (canvasHeight - guideHeight) / 2;

  return {
    x: guideX,
    y: guideY,
    width: guideWidth,
    height: guideHeight,
  };
}

function drawCardGuide(ctx, canvasWidth, canvasHeight) {
  if (!showGuide) return;

  // Recalculer le rectangle guide
  const guideRect = calculateGuideRect(canvasWidth, canvasHeight);
  
  // Dessiner le rectangle guide avec un style bleu semi-transparent
  ctx.strokeStyle = "rgba(0, 120, 255, 0.8)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.rect(guideRect.x, guideRect.y, guideRect.width, guideRect.height);
  ctx.stroke();

  // Dessiner des coins arrondis décoratifs
  const cornerSize = 20;
  ctx.strokeStyle = "rgba(0, 180, 255, 0.9)";
  ctx.lineWidth = 5;

  // Coin supérieur gauche
  ctx.beginPath();
  ctx.moveTo(guideRect.x + cornerSize, guideRect.y);
  ctx.lineTo(guideRect.x, guideRect.y);
  ctx.lineTo(guideRect.x, guideRect.y + cornerSize);
  ctx.stroke();

  // Coin supérieur droit
  ctx.beginPath();
  ctx.moveTo(guideRect.x + guideRect.width - cornerSize, guideRect.y);
  ctx.lineTo(guideRect.x + guideRect.width, guideRect.y);
  ctx.lineTo(guideRect.x + guideRect.width, guideRect.y + cornerSize);
  ctx.stroke();

  // Coin inférieur gauche
  ctx.beginPath();
  ctx.moveTo(guideRect.x, guideRect.y + guideRect.height - cornerSize);
  ctx.lineTo(guideRect.x, guideRect.y + guideRect.height);
  ctx.lineTo(guideRect.x + cornerSize, guideRect.y + guideRect.height);
  ctx.stroke();

  // Coin inférieur droit
  ctx.beginPath();
  ctx.moveTo(guideRect.x + guideRect.width, guideRect.y + guideRect.height - cornerSize);
  ctx.lineTo(guideRect.x + guideRect.width, guideRect.y + guideRect.height);
  ctx.lineTo(guideRect.x + guideRect.width - cornerSize, guideRect.y + guideRect.height);
  ctx.stroke();
}

// Détection de visage avec OpenCV
async function detectFace(src, gray) {
  try {
    // Vérifier si le classificateur de visage est disponible
    if (!faceClassifier || !openCv) {
      console.warn("Le classificateur de visage ou OpenCV n'est pas disponible");
      return null;
    }

    // Initialiser les variables pour éviter l'erreur "faces is not defined"
    let faces = new openCv.RectVector();
    let faceRect = null;

    // Détecter les visages
    faceClassifier.detectMultiScale(gray, faces);

    // Vérifier si des visages ont été trouvés
    if (faces.size() > 0) {
      // Récupérer le plus grand visage (supposé être le plus proche)
      let bestFace = null;
      let maxArea = 0;

      for (let i = 0; i < faces.size(); i++) {
        const face = faces.get(i);
        const area = face.width * face.height;

        if (area > maxArea) {
          maxArea = area;
          bestFace = face;
        }
      }

      if (bestFace) {
        faceRect = {
          x: bestFace.x,
          y: bestFace.y,
          width: bestFace.width,
          height: bestFace.height,
        };

        // Dessiner le rectangle du visage si l'option est activée
        if (showFace) {
          openCv.rectangle(
            src,
            new openCv.Point(faceRect.x, faceRect.y),
            new openCv.Point(
              faceRect.x + faceRect.width,
              faceRect.y + faceRect.height
            ),
            [0, 255, 0, 255],
            2
          );
        }

        // Détecter les yeux à l'intérieur du visage
        if (showFace) {
          detectEyes(src, gray, faceRect);
        }

        // Mettre à jour le dernier rectangle de visage détecté
        lastFaceRect = faceRect;
      }
    }

    // Libérer la mémoire
    if (faces && typeof faces.delete === 'function') {
      faces.delete();
    }

    return faceRect;
  } catch (error) {
    console.error("Erreur lors de la détection de visage:", error);
    return null;
  }
}

// Détection des yeux dans le visage
async function detectEyes(src, gray, faceRect) {
  try {
    // Vérifier si le classificateur des yeux est disponible
    if (!eyeClassifier || !openCv) {
      return;
    }

    // Initialiser eyes pour éviter les erreurs de référence
    let eyes = new openCv.RectVector();
    
    // Définir la région d'intérêt (ROI) pour les yeux
    const eyesROI = new openCv.Mat();
    const faceRegion = gray.roi(
      new openCv.Rect(
        faceRect.x,
        faceRect.y,
        faceRect.width,
        Math.floor(faceRect.height * 0.6) // Limiter la recherche à la moitié supérieure du visage
      )
    );

    // Appliquer une égalisation d'histogramme pour améliorer le contraste
    openCv.equalizeHist(faceRegion, eyesROI);

    // Détecter les yeux dans la région du visage
    eyeClassifier.detectMultiScale(eyesROI, eyes);

    // Dessiner les rectangles des yeux détectés
    for (let i = 0; i < eyes.size(); ++i) {
      const eye = eyes.get(i);
      const eyeRect = {
        x: faceRect.x + eye.x,
        y: faceRect.y + eye.y,
        width: eye.width,
        height: eye.height,
      };

      openCv.rectangle(
        src,
        new openCv.Point(eyeRect.x, eyeRect.y),
        new openCv.Point(eyeRect.x + eyeRect.width, eyeRect.y + eyeRect.height),
        [255, 0, 0, 255],
        2
      );
    }

    // Libération des ressources
    if (eyes && typeof eyes.delete === 'function') {
      eyes.delete();
    }
    if (eyesROI && typeof eyesROI.delete === 'function') {
      eyesROI.delete();
    }
    if (faceRegion && typeof faceRegion.delete === 'function') {
      faceRegion.delete();
    }
  } catch (error) {
    console.error("Erreur lors de la détection des yeux:", error);
  }
}

function extrapolateCardRectangle(faceRect) {
  if (!faceRect) return null;

  // Facteur de mise à l'échelle (largeur de la carte par rapport à la largeur du visage)
  const s = 3.2;
  const offsetX = -15;
  const offsetY = -10;

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

// Fonction pour capturer une photo
function capturePhoto(mode = "auto") {
  if (!lastFaceRect) {
    console.log("Capture impossible : aucun visage détecté");
    return;
  }

  try {
    // Vérifier d'abord si nous avons un rectangle de carte détecté
    const cardRect = lastCardRect || extrapolateCardRectangle(lastFaceRect);
    if (!cardRect) {
      console.log("Capture impossible : aucun rectangle de carte détecté");
      return;
    }
    
    // Calculer un facteur d'échelle entre la résolution de traitement et la résolution de capture
    const scaleX = CAPTURE_WIDTH / canvas.width;
    const scaleY = CAPTURE_HEIGHT / canvas.height;

    // Adapter le rectangle de la carte à la résolution plus haute
    let highResCardRect = {
      x: Math.round(cardRect.x * scaleX),
      y: Math.round(cardRect.y * scaleY),
      width: Math.round(cardRect.width * scaleX),
      height: Math.round(cardRect.height * scaleY),
    };

    if (video.readyState === 4) {
      // Capturer directement depuis la vidéo haute résolution
      photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
      
      // Capturer exactement le contenu du rectangle bleu (carte) en préservant le ratio
      photoCtx.filter = "none"; // Réinitialiser les filtres précédents
      photoCtx.imageSmoothingEnabled = true;
      photoCtx.imageSmoothingQuality = "high";
      
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

      photoTaken = true;
      document.getElementById("photoScreen").style.display = "flex";
      
      if (autoCaptureEnabled && mode === "auto") {
        autoCaptureEnabled = false;
        document.getElementById("autoCapture").checked = false;
      }

      console.log("Photo capturée en haute résolution");
    } else {
      // Solution de secours utilisant le canvas à basse résolution
      photoCtx.filter = "none"; // Réinitialiser les filtres précédents
      photoCtx.imageSmoothingEnabled = true;
      photoCtx.imageSmoothingQuality = "high";
      
      photoCtx.drawImage(
        canvas,
        cardRect.x,
        cardRect.y,
        cardRect.width,
        cardRect.height,
        0,
        0,
        photoCanvas.width,
        photoCanvas.height
      );

      photoCtx.filter = "contrast(1.1) brightness(1.05)";
      photoTaken = true;
      document.getElementById("photoScreen").style.display = "flex";
    }
  } catch (err) {
    console.error("Erreur lors de la capture haute résolution:", err);
    // Solution de secours
    photoCtx.filter = "none"; // Réinitialiser les filtres
    photoCtx.drawImage(canvas, 0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.filter = "contrast(1.1) brightness(1.05)";
    photoTaken = true;
    document.getElementById("photoScreen").style.display = "flex";
  }
}

// Fonction pour reprendre la photo - CORRIGÉE
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
  
  // Forcer le redémarrage du processFrame avec un délai pour s'assurer que tout est prêt
  console.log("Redémarrage du processus de capture...");
  setTimeout(() => {
    if (!photoTaken) {
      requestAnimationFrame(processFrame);
    }
  }, 200);
}

// Fonction pour confirmer la photo
function confirmPhoto() {
  // Ici, vous pourriez implémenter la logique pour enregistrer la photo
  // Pour cet exemple, nous affichons simplement un message
  const messageDiv = document.getElementById("message");
  messageDiv.innerText = "Photo confirmée et enregistrée !";
  messageDiv.style.display = "block";
  
  // Masquer le message après quelques secondes
  setTimeout(() => {
    messageDiv.style.display = "none";
    
    // Optionnel : permettre de reprendre une photo après confirmation
    retakePhoto();
  }, 3000);
}

// Analyser la qualité de l'image (luminosité, variance)
async function analyzeImageQuality(gray) {
  try {
    const brightnessStdDev = new openCv.Mat();
    let brightnessMean = new openCv.Mat();
    openCv.meanStdDev(gray, brightnessMean, brightnessStdDev);
    
    // Calcul de la variance
    const varianceVal = brightnessStdDev.data64F[0];
    
    // Récupérer les valeurs moyennes de luminosité
    const brightnessVal = brightnessMean.data64F[0];
    
    // Libérer les ressources
    brightnessMean.delete();
    brightnessStdDev.delete();
    
    return {
      brightness: brightnessVal,
      variance: varianceVal,
    };
  } catch (error) {
    console.error("Erreur lors de l'analyse d'image:", error);
    return {
      brightness: 0,
      variance: 0,
    };
  }
}

// Vérifier si la carte est correctement positionnée par rapport au rectangle guide
function checkDistance(cardRect) {
  try {
    if (!cardRect || !distanceGuideRect) {
      return { message: "Veuillez placer votre carte d'identité dans le cadre", correct: false };
    }
    
    // Calculer le centre du rectangle de la carte
    const cardCenterX = cardRect.x + cardRect.width / 2;
    const cardCenterY = cardRect.y + cardRect.height / 2;
    
    // Calculer le centre du rectangle guide
    const guideCenterX = distanceGuideRect.x + distanceGuideRect.width / 2;
    const guideCenterY = distanceGuideRect.y + distanceGuideRect.height / 2;
    
    // Calculer la distance entre les centres
    const deltaX = Math.abs(cardCenterX - guideCenterX);
    const deltaY = Math.abs(cardCenterY - guideCenterY);
    
    // Calculer le rapport de taille entre la carte détectée et le guide
    const widthRatio = cardRect.width / distanceGuideRect.width;
    const heightRatio = cardRect.height / distanceGuideRect.height;
    
    // Vérifier si la carte est bien centrée et a la bonne taille
    const isCentered = deltaX < (distanceGuideRect.width * 0.2) && deltaY < (distanceGuideRect.height * 0.2);
    const hasCorrectSize = widthRatio > SIZE_RATIO_MIN && widthRatio < SIZE_RATIO_MAX && 
                           heightRatio > SIZE_RATIO_MIN && heightRatio < SIZE_RATIO_MAX;
    
    // Message à afficher en fonction des conditions
    let message = "";
    if (!isCentered) {
      message = "Veuillez centrer votre carte dans le cadre";
    } else if (!hasCorrectSize) {
      if (widthRatio < SIZE_RATIO_MIN) {
        message = "Rapprochez-vous, la carte est trop petite";
      } else {
        message = "Éloignez-vous, la carte est trop grande";
      }
    } else {
      message = "Parfait ! Maintenant, tenez bien la carte...";
    }
    
    // Stocker les métriques pour l'affichage
    captureMetrics = {
      widthRatio: widthRatio.toFixed(2),
      heightRatio: heightRatio.toFixed(2),
      deltaX: deltaX.toFixed(0),
      deltaY: deltaY.toFixed(0),
    };
    
    return {
      message: message,
      correct: isCentered && hasCorrectSize,
    };
  } catch (error) {
    console.error("Erreur dans checkDistance:", error);
    return { message: "Erreur lors de l'analyse", correct: false };
  }
}

// Mettre à jour les éléments d'interface utilisateur
function updateUIMetrics(distanceResult, imageQuality) {
  try {
    const metricsDiv = document.getElementById("metrics");
    
    let statusHTML = `<div>
      <b>État:</b> ${distanceResult.message}
    </div>`;
    
    if (captureMetrics.widthRatio) {
      statusHTML += `<div class="small">
        <b>Ratio:</b> ${captureMetrics.widthRatio} | <b>Delta:</b> ${captureMetrics.deltaX}px, ${captureMetrics.deltaY}px
      </div>`;
    }
    
    if (imageQuality) {
      statusHTML += `<div class="small">
        <b>Luminosité:</b> ${imageQuality.brightness.toFixed(0)} | <b>Netteté:</b> ${imageQuality.variance.toFixed(0)}
      </div>`;
    }
    
    metricsDiv.innerHTML = statusHTML;
    
    if (distanceResult.correct) {
      metricsDiv.style.borderLeft = "4px solid green";
    } else {
      metricsDiv.style.borderLeft = "4px solid orange";
    }
  } catch (error) {
    console.error("Erreur lors de la mise à jour de l'interface:", error);
  }
}

// Traitement de la vidéo avec OpenCV
async function processFrame() {
  try {
    // S'assurer que OpenCV est chargé et que la vidéo est prête
    if (!openCv || !video.readyState || video.readyState < 2) {
      requestAnimationFrame(processFrame);
      return;
    }

    // Si une photo a été prise, arrêter le traitement
    if (photoTaken) {
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

    // Dessiner le rectangle guide fixe
    drawCardGuide(ctx, windowWidth, windowHeight);

    // Créer un Mat à partir du canvas
    const src = openCv.imread(canvas);
    const gray = new openCv.Mat();
    openCv.cvtColor(src, gray, openCv.COLOR_RGBA2GRAY);

    // Analyser la qualité de l'image
    const imageQuality = await analyzeImageQuality(gray);

    // Détecter le visage
    const faceRect = await detectFace(src, gray);

    // Si un visage est détecté, extrapoler le rectangle de la carte
    if (faceRect) {
      const cardRect = extrapolateCardRectangle(faceRect);
      lastCardRect = cardRect;

      // Vérifier si la carte est bien positionnée
      const distanceResult = checkDistance(cardRect);

      // Mise à jour de l'interface utilisateur
      updateUIMetrics(distanceResult, imageQuality);

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

      // Condition pour la capture automatique avec tous les critères
      if (
        autoCaptureEnabled &&
        !photoTaken &&
        distanceResult.correct &&
        imageQuality.brightness >= BRIGHTNESS_MIN &&
        imageQuality.brightness <= BRIGHTNESS_MAX &&
        imageQuality.variance >= VARIANCE_MIN
      ) {
        console.log("Conditions remplies pour la capture automatique");
        capturePhoto("auto");
      }
    }

    // Afficher le résultat
    openCv.imshow(canvas, src);

    // Libérer la mémoire
    src.delete();
    gray.delete();

    // Continuer la boucle uniquement si aucune photo n'a été prise
    if (!photoTaken) {
      requestAnimationFrame(processFrame);
    }
  } catch (error) {
    console.error("Erreur dans processFrame:", error);
    // Continuer la boucle malgré l'erreur, sauf si une photo a été prise
    if (!photoTaken) {
      requestAnimationFrame(processFrame);
    }
  }
}
