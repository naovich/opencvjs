/* -------------------------------------------
      Partie 1 : Initialisation et configuration globale
      -------------------------------------------- */

let video = document.getElementById("video");
let canvas = document.getElementById("canvas");
let context = canvas.getContext("2d");
let photoCanvas = document.getElementById("photoCanvas");
let photoContext = photoCanvas.getContext("2d");

let openCv = null;
let faceClassifier = null;
let showGuide = true;
let isDebugVisible = false;
let useContourDetection = false;
let autoCaptureEnabled = true;
let photoTaken = false;
let lastFaceRect = null;
let lastCardRect = null;
let lastCardAngle = 0;

let stabilizationBufferFace = [];
let stabilizationBufferCard = [];
let stabilizationBufferAngle = [];
const BUFFER_SIZE = 5;

let lastFaceDetectionTime = 0;
let lastCardDetectionTime = 0;
const DETECTION_TIMEOUT = 1500;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
const CARD_RATIO = 85.6 / 53.98;
const ANGLE_TOLERANCE = 3;
const ALIGNMENT_TOLERANCE = 5;
const OVERLAP_THRESHOLD = 0.7;
const SIZE_DIFFERENCE_THRESHOLD = 0.2;
const DISTANCE_MIN = 100000;
const DISTANCE_MAX = 300000;
const CONFIDENCE_THRESHOLD = 0.6;

const distanceGuideRect = {
  x: Math.round(VIDEO_WIDTH / 2 - (VIDEO_WIDTH * 0.6) / 2),
  y: Math.round(VIDEO_HEIGHT / 2 - (VIDEO_HEIGHT * 0.5) / 2),
  width: Math.round(VIDEO_WIDTH * 0.6),
  height: Math.round(VIDEO_HEIGHT * 0.5),
};

// onstantes pour qualité d'image
const VARIANCE_MIN = 100;
const BRIGHTNESS_MIN = 50;
const BRIGHTNESS_MAX = 200;

// Configuration des résolutions
const CAPTURE_WIDTH = 1280; // Résolution de capture vidéo
const CAPTURE_HEIGHT = 960; // Résolution de capture vidéo
const PROCESSING_WIDTH = 640; // Résolution pour le traitement
const PROCESSING_HEIGHT = 480; // Résolution pour le traitement
const OUTPUT_WIDTH = 1280; // Résolution de la photo finale
const OUTPUT_HEIGHT = 960; // Résolution de la photo finale

//  le seuil d'alignement des yeux
const EYES_ALIGNMENT_THRESHOLD = 3;

navigator.mediaDevices
  .getUserMedia({
    video: {
      width: { ideal: CAPTURE_WIDTH },
      height: { ideal: CAPTURE_HEIGHT },
    },
  })
  .then((stream) => {
    video.srcObject = stream;
  })
  .catch((err) => {
    console.error("Erreur lors de l'accès à la caméra: " + err);
  });

/* -------------------------------------------
      Partie 2 : Fonctions utilitaires communes
      -------------------------------------------- */

function averageRects(rects) {
  if (!rects || rects.length === 0) return null;
  const validRects = rects.filter((rect) => rect !== null);
  if (validRects.length === 0) return null;
  let sumX = 0,
    sumY = 0,
    sumWidth = 0,
    sumHeight = 0;
  for (const rect of validRects) {
    sumX += rect.x;
    sumY += rect.y;
    sumWidth += rect.width;
    sumHeight += rect.height;
  }
  return {
    x: Math.round(sumX / validRects.length),
    y: Math.round(sumY / validRects.length),
    width: Math.round(sumWidth / validRects.length),
    height: Math.round(sumHeight / validRects.length),
  };
}

function averageAngles(angles) {
  if (!angles || angles.length === 0) return 0;
  let sumSin = 0,
    sumCos = 0;
  for (const angle of angles) {
    const radians = (angle * Math.PI) / 180;
    sumSin += Math.sin(radians);
    sumCos += Math.cos(radians);
  }
  return (
    (Math.atan2(sumSin / angles.length, sumCos / angles.length) * 180) / Math.PI
  );
}

function drawRectangle(src, rect, color, thickness, label = null) {
  let pt1 = new openCv.Point(rect.x, rect.y);
  let pt2 = new openCv.Point(rect.x + rect.width, rect.y + rect.height);
  openCv.rectangle(src, pt1, pt2, color, thickness);
  if (label) {
    openCv.putText(
      src,
      label,
      new openCv.Point(rect.x, rect.y - 10),
      openCv.FONT_HERSHEY_SIMPLEX,
      0.6,
      color,
      2
    );
  }
}

function calculateIntersection(rect1, rect2) {
  let intersectionX = Math.max(rect1.x, rect2.x);
  let intersectionY = Math.max(rect1.y, rect2.y);
  let intersectionWidth =
    Math.min(rect1.x + rect1.width, rect2.x + rect2.width) - intersectionX;
  let intersectionHeight =
    Math.min(rect1.y + rect1.height, rect2.y + rect2.height) - intersectionY;
  return intersectionWidth > 0 && intersectionHeight > 0
    ? intersectionWidth * intersectionHeight
    : 0;
}

/* ----------------------------------------à
           Partie 3 : Détection de visage
          ---------------------------------------- */
async function loadCascadeClassifier() {
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
}

async function detectFace(src, gray) {
  if (!faceClassifier) {
    faceClassifier = await loadCascadeClassifier();
  }
  let faces = new openCv.RectVector();
  faceClassifier.detectMultiScale(gray, faces, 1.3, 7, 0);
  let currentFaceRect = null;
  if (faces.size() > 0) {
    let bestFace = null;
    let bestScore = 0;
    for (let i = 0; i < faces.size(); i++) {
      let face = faces.get(i);
      let area = face.width * face.height;
      let centerX = face.x + face.width / 2;
      let centerY = face.y + face.height / 2;
      let distanceFromCenter = Math.sqrt(
        Math.pow(centerX - VIDEO_WIDTH / 2, 2) +
          Math.pow(centerY - VIDEO_HEIGHT / 2, 2)
      );
      let score = area * (1 - distanceFromCenter / (VIDEO_WIDTH / 2));
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
      lastFaceDetectionTime = Date.now();
      stabilizationBufferFace.push(currentFaceRect);
      if (stabilizationBufferFace.length > BUFFER_SIZE)
        stabilizationBufferFace.shift();
      let stabilizedFaceRect = averageRects(stabilizationBufferFace);
      if (!lastFaceRect) {
        lastFaceRect = stabilizedFaceRect;
      } else {
        const changeX = Math.abs(stabilizedFaceRect.x - lastFaceRect.x);
        const changeY = Math.abs(stabilizedFaceRect.y - lastFaceRect.y);
        const changeWidth = Math.abs(
          stabilizedFaceRect.width - lastFaceRect.width
        );
        const changeHeight = Math.abs(
          stabilizedFaceRect.height - lastFaceRect.height
        );
        if (changeX > 2 || changeY > 2 || changeWidth > 2 || changeHeight > 2) {
          lastFaceRect = {
            x: Math.round(lastFaceRect.x * 0.8 + stabilizedFaceRect.x * 0.2),
            y: Math.round(lastFaceRect.y * 0.8 + stabilizedFaceRect.y * 0.2),
            width: Math.round(
              lastFaceRect.width * 0.8 + stabilizedFaceRect.width * 0.2
            ),
            height: Math.round(
              lastFaceRect.height * 0.8 + stabilizedFaceRect.height * 0.2
            ),
          };
        }
      }
      drawRectangle(src, lastFaceRect, [255, 0, 0, 255], 3, "VISAGE");
    }
  } else if (
    Date.now() - lastFaceDetectionTime < DETECTION_TIMEOUT &&
    lastFaceRect &&
    stabilizationBufferFace.length > 0
  ) {
    drawRectangle(src, lastFaceRect, [255, 0, 0, 180], 2, "VISAGE (p)");
  } else {
    lastFaceRect = null;
    stabilizationBufferFace = [];
  }
  faces.delete();
  return lastFaceRect;
}

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

/*-----------------------------------------
                  Partie 4 : Détection des yeux
        ---------------------------------------- */

async function loadEyeCascadeClassifier() {
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
}

async function eyeDetection(src, faceRect) {
  try {
    if (!faceRect) return { angle: null, eyeRects: [] };

    let faceROI = src.roi(
      new openCv.Rect(faceRect.x, faceRect.y, faceRect.width, faceRect.height)
    );
    let grayFace = new openCv.Mat();
    openCv.cvtColor(faceROI, grayFace, openCv.COLOR_RGBA2GRAY);

    // Charger le classificateur pour les yeux
    if (!window.eyeClassifier) {
      window.eyeClassifier = await loadEyeCascadeClassifier();
    }

    let eyes = new openCv.RectVector();
    window.eyeClassifier.detectMultiScale(
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
        // Critère de tri : on tri par position Y (priorité) puis taille (secondaire)
        score: eye.y * 1000 + eye.width * eye.height,
      });
    }

    // Trier par position verticale (yeux les plus hauts en premier) et taille
    eyesArray.sort((a, b) => a.score - b.score);

    // Filtrer pour ne garder que les yeux dans la moitié supérieure du visage, c'est pour éliminé par exemple la bouche, car des fois il peut y a voir une mauvaise interprétation
    eyesArray = eyesArray.filter((eye) => eye.y < faceRect.height * 0.5);

    // Garder les deux premiers yeux seulement (on fait pour s'assurer de n'avoir que 2 yeux)
    let selectedEyes = eyesArray.slice(0, 2);

    // Si on a deux yeux, les trier de gauche à droite
    if (selectedEyes.length === 2) {
      selectedEyes.sort((a, b) => a.x - b.x);

      // Calculer l'angle entre les deux yeux
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

      // Calculer l'angle de la ligne entre les deux yeux (en degrés)
      let eyesAngle =
        Math.atan2(
          rightEyeCenter.y - leftEyeCenter.y,
          rightEyeCenter.x - leftEyeCenter.x
        ) *
        (180 / Math.PI);

      // Pour chaque œil sélectionné, tracer un rectangle sur l'image
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

      openCv.line(
        src,
        new openCv.Point(leftEyeCenter.x, leftEyeCenter.y),
        new openCv.Point(rightEyeCenter.x, rightEyeCenter.y),
        [0, 255, 255, 255],
        2
      );

      document.getElementById(
        "eyesAlignmentValue"
      ).textContent = `${eyesAngle.toFixed(1)}°`;

      if (Math.abs(eyesAngle) < EYES_ALIGNMENT_THRESHOLD) {
        document.getElementById("eyesAlignmentValue").className =
          "metric status-good";
      } else {
        document.getElementById("eyesAlignmentValue").className =
          "metric status-warning";
      }

      eyes.delete();
      grayFace.delete();
      faceROI.delete();

      return { angle: eyesAngle, eyeRects: selectedEyes };
    } else {
      // Si on n'a pas trouvé exactement 2 yeux
      document.getElementById("eyesAlignmentValue").textContent = "Non détecté";
      document.getElementById("eyesAlignmentValue").className =
        "metric status-warning";

      eyes.delete();
      grayFace.delete();
      faceROI.delete();

      return { angle: null, eyeRects: [] };
    }
  } catch (err) {
    console.error("Erreur dans eyeDetection:", err);
    return { angle: null, eyeRects: [] };
  }
}

/* -------------------------------------------
      Partie 5 : Détection du contour de la carte
      -------------------------------------------- */

function detectCardContour(src, extrapolatedRect, gray) {
  let { edges, contours } = findCardContours(gray);
  let analysis = analyzeContours(contours, edges, extrapolatedRect);
  stabilizeCardDetection(
    analysis.bestMatchIndex,
    analysis.bestRect,
    analysis.cardAngle
  );
  drawCardDetection(
    src,
    contours,
    analysis.bestMatchIndex,
    analysis.isCardHorizontal
  );
  let result = {
    detected: analysis.bestMatchIndex >= 0,
    rect: lastCardRect,
    angle: lastCardAngle,
    isHorizontal: Math.abs(lastCardAngle) < ANGLE_TOLERANCE,
    score: analysis.bestMatchScore,
    imageIsHorizontal: analysis.isImageHorizontal,
  };
  edges.delete();
  contours.delete();
  return result;
}

function findCardContours(gray) {
  let blurred = new openCv.Mat();
  openCv.GaussianBlur(gray, blurred, new openCv.Size(5, 5), 0);
  let edges = new openCv.Mat();
  openCv.Canny(blurred, edges, 50, 150);
  let contours = new openCv.MatVector();
  let hierarchy = new openCv.Mat();
  openCv.findContours(
    edges,
    contours,
    hierarchy,
    openCv.RETR_EXTERNAL,
    openCv.CHAIN_APPROX_SIMPLE
  );
  blurred.delete();
  hierarchy.delete();
  return { edges, contours };
}

function analyzeContours(contours, edges, extrapolatedRect) {
  let bestMatchIndex = -1;
  let bestMatchScore = 0;
  let bestRect = null;
  let cardAngle = 0;
  let horizontalLines = 0;
  let verticalLines = 0;

  for (let i = 0; i < contours.size(); i++) {
    let contour = contours.get(i);
    let area = openCv.contourArea(contour);
    if (area < 10000) continue;
    let approx = new openCv.Mat();
    let epsilon = 0.02 * openCv.arcLength(contour, true);
    openCv.approxPolyDP(contour, approx, epsilon, true);
    if (approx.rows >= 4 && approx.rows <= 6) {
      let rotatedRect = openCv.minAreaRect(contour);
      let rect = openCv.boundingRect(contour);
      let intersectionArea = calculateIntersection(rect, extrapolatedRect);
      let unionArea =
        rect.width * rect.height +
        extrapolatedRect.width * extrapolatedRect.height -
        intersectionArea;
      let overlapScore = intersectionArea / unionArea;
      let aspectRatio = rect.width / rect.height;
      let ratioScore = 1 - Math.abs(aspectRatio - CARD_RATIO) / CARD_RATIO;
      let score = overlapScore * 0.7 + ratioScore * 0.3;
      let angle = rotatedRect.angle;
      if (angle < -45) angle = 90 + angle;
      let lines = new openCv.Mat();
      openCv.HoughLinesP(edges, lines, 1, Math.PI / 180, 50, 50, 10);
      for (let j = 0; j < lines.rows; j++) {
        let line = lines.data32S;
        let x1 = line[j * 4];
        let y1 = line[j * 4 + 1];
        let x2 = line[j * 4 + 2];
        let y2 = line[j * 4 + 3];
        if (
          openCv.pointPolygonTest(contour, new openCv.Point(x1, y1), true) >
            -20 ||
          openCv.pointPolygonTest(contour, new openCv.Point(x2, y2), true) > -20
        ) {
          let dx = Math.abs(x2 - x1);
          let dy = Math.abs(y2 - y1);
          if (dx > 3 * dy) horizontalLines++;
          else if (dy > 3 * dx) verticalLines++;
        }
      }
      lines.delete();
      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestMatchIndex = i;
        bestRect = rect;
        cardAngle = angle;
      }
    }
    approx.delete();
  }

  let isCardHorizontal = Math.abs(cardAngle) < ANGLE_TOLERANCE;
  let isImageHorizontal = horizontalLines > verticalLines;

  if (bestMatchIndex < 0 && horizontalLines + verticalLines > 10) {
    isCardHorizontal = isImageHorizontal;
    cardAngle = isImageHorizontal ? 0 : 90;
  }

  return {
    bestMatchIndex,
    bestMatchScore,
    bestRect,
    cardAngle,
    isCardHorizontal,
    isImageHorizontal,
  };
}

function stabilizeCardDetection(bestMatchIndex, bestRect, cardAngle) {
  if (bestMatchIndex >= 0) {
    lastCardDetectionTime = Date.now();
    stabilizationBufferAngle.push(cardAngle);
    if (stabilizationBufferAngle.length > BUFFER_SIZE)
      stabilizationBufferAngle.shift();
    let stabilizedAngle = averageAngles(stabilizationBufferAngle);
    lastCardAngle = lastCardAngle * 0.8 + stabilizedAngle * 0.2;
    if (bestRect) {
      stabilizationBufferCard.push(bestRect);
      if (stabilizationBufferCard.length > BUFFER_SIZE)
        stabilizationBufferCard.shift();
      let stabilizedCardRect = averageRects(stabilizationBufferCard);
      lastCardRect = lastCardRect
        ? {
            x: Math.round(lastCardRect.x * 0.8 + stabilizedCardRect.x * 0.2),
            y: Math.round(lastCardRect.y * 0.8 + stabilizedCardRect.y * 0.2),
            width: Math.round(
              lastCardRect.width * 0.8 + stabilizedCardRect.width * 0.2
            ),
            height: Math.round(
              lastCardRect.height * 0.8 + stabilizedCardRect.height * 0.2
            ),
          }
        : stabilizedCardRect;
    }
  } else if (Date.now() - lastCardDetectionTime >= DETECTION_TIMEOUT) {
    lastCardRect = null;
    stabilizationBufferCard = [];
    lastCardAngle = 0;
    stabilizationBufferAngle = [];
  }
}

function drawCardDetection(src, contours, bestMatchIndex, isHorizontal) {
  if (bestMatchIndex >= 0) {
    let bestContour = contours.get(bestMatchIndex);
    let rotatedRect = openCv.minAreaRect(bestContour);
    let vertices = openCv.boxPoints(rotatedRect);
    let vertexMat = openCv.matFromArray(4, 1, openCv.CV_32SC2, [
      vertices[0][0],
      vertices[0][1],
      vertices[1][0],
      vertices[1][1],
      vertices[2][0],
      vertices[2][1],
      vertices[3][0],
      vertices[3][1],
    ]);
    let contourColor = isHorizontal ? [0, 255, 0, 255] : [255, 0, 0, 255];
    openCv.drawContours(src, contours, bestMatchIndex, [0, 255, 0, 255], 2);
    let matVec = new openCv.MatVector();
    matVec.push_back(vertexMat);
    openCv.polylines(src, matVec, true, contourColor, 2);
    drawRectangle(
      src,
      lastCardRect,
      contourColor,
      2,
      `CARTE (${lastCardAngle.toFixed(1)}°)`
    );
    matVec.delete();
    vertexMat.delete();
  } else if (
    Date.now() - lastCardDetectionTime < DETECTION_TIMEOUT &&
    lastCardRect
  ) {
    drawRectangle(
      src,
      lastCardRect,
      [0, 255, 0, 180],
      2,
      `CARTE (précédent, ${lastCardAngle.toFixed(1)}°)`
    );
  }
}

// Vérifications d'alignement et de distance
function checkAlignment(faceRect, cardRect, cardAngle, imageIsHorizontal) {
  if (!faceRect || !cardRect)
    return {
      aligned: false,
      message: "Impossible de vérifier l'alignement",
    };
  const isAligned =
    Math.abs(cardAngle) < ALIGNMENT_TOLERANCE || imageIsHorizontal;
  return {
    aligned: isAligned,
    angle: cardAngle,
    message: isAligned
      ? "Alignement correct"
      : `Aligner la carte (${cardAngle.toFixed(1)}°)`,
  };
}

function checkDistance(cardRect, src) {
  if (showGuide) {
    drawRectangle(
      src,
      distanceGuideRect,
      [139, 69, 19, 180],
      2,
      "ZONE OPTIMALE"
    );
  }
  if (!cardRect) return { correct: false, message: "Distance indéterminée" };
  let intersectionArea = calculateIntersection(cardRect, distanceGuideRect);
  let cardArea = cardRect.width * cardRect.height;
  let guideArea = distanceGuideRect.width * distanceGuideRect.height;
  let cardOverlapRatio = intersectionArea / cardArea;
  let guideOverlapRatio = intersectionArea / guideArea;
  if (cardOverlapRatio > 0.7 && guideOverlapRatio > 0.5) {
    return {
      correct: true,
      message: "Distance optimale",
      area: cardArea,
      overlap: cardOverlapRatio,
    };
  } else if (cardArea < guideArea * 0.6) {
    return {
      correct: false,
      message: "Trop loin",
      area: cardArea,
      overlap: cardOverlapRatio,
    };
  } else if (cardArea > guideArea * 1.4) {
    return {
      correct: false,
      message: "Trop proche",
      area: cardArea,
      overlap: cardOverlapRatio,
    };
  } else {
    return {
      correct: false,
      message: "Ajuster la position",
      area: cardArea,
      overlap: cardOverlapRatio,
    };
  }
}

/* -------------------------------------------
      Partie 6 : Analyse de la qualité d'image
      -------------------------------------------- */

async function analyzeImageQuality(gray) {
  try {
    let brightnessMean = new openCv.Mat();
    let brightnessStdDev = new openCv.Mat();
    openCv.meanStdDev(gray, brightnessMean, brightnessStdDev);
    let brightness = Math.round(brightnessMean.data64F[0]);
    brightnessValue.textContent = brightness;
    brightnessValue.className =
      brightness > 100
        ? "metric status-good"
        : brightness > 50
        ? "metric status-warning"
        : "metric status-bad";

    let laplacian = new openCv.Mat();
    openCv.Laplacian(gray, laplacian, openCv.CV_64F);
    let mean = new openCv.Mat();
    let stdDev = new openCv.Mat();
    openCv.meanStdDev(laplacian, mean, stdDev);
    let variance = Math.round(stdDev.data64F[0] * stdDev.data64F[0]);
    varianceValue.textContent = variance;
    varianceValue.className =
      variance > 100
        ? "metric status-good"
        : variance > 50
        ? "metric status-warning"
        : "metric status-bad";

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

/* -------------------------------------------
      Partie 7 : Capture de la photo
      -------------------------------------------- */

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
    // Déplacer le rectangle vers le haut de 2.3% de sa hauteur
    //TODO refacto
    extrapolatedCardRect.y -= Math.round(
      extrapolatedCardRect.height * 0.05
      //extrapolatedCardRect.height * 0.1
    );

    let highResCardRect = {
      x: Math.round(extrapolatedCardRect.x * scaleX),
      y: Math.round(extrapolatedCardRect.y * scaleY),
      width: Math.round(extrapolatedCardRect.width * scaleX),
      height: Math.round(extrapolatedCardRect.height * scaleY),
    };

    if (video.readyState === 4) {
      // Capturer directement depuis la vidéo haute résolution
      photoContext.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
      photoContext.drawImage(
        video,
        highResCardRect.x,
        highResCardRect.y,
        highResCardRect.width,
        highResCardRect.height,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT
      );

      // Appliquer des filtres d'amélioration
      photoContext.filter = "contrast(1.1) brightness(1.05)";
      photoContext.imageSmoothingEnabled = true;
      photoContext.imageSmoothingQuality = "high";

      photoTaken = true;
      document.getElementById("retakePhoto").style.display = "block";
      if (autoCaptureEnabled) {
        autoCaptureEnabled = false;
        document.getElementById("autoCapture").checked = false;
      }

      console.log("Photo capturée en haute résolution");
    } else {
      // Solution de secours utilisant le canvas à basse résolution
      photoContext.drawImage(
        canvas,
        extrapolatedCardRect.x,
        extrapolatedCardRect.y,
        extrapolatedCardRect.width,
        extrapolatedCardRect.height,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT
      );

      photoTaken = true;
      document.getElementById("retakePhoto").style.display = "block";
    }
  } catch (err) {
    console.error("Erreur lors de la capture haute résolution:", err);
    // Solution de secours
    photoContext.drawImage(canvas, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    photoTaken = true;
    document.getElementById("retakePhoto").style.display = "block";
  }
}

/* -------------------------------------------------
      Partie 8 : Mise à jour de l'interface utilisateur
      ---------------------------------------------------- */

function updateStatus(
  cardDetection,
  alignmentResult,
  distanceResult,
  imageQuality
) {
  cardAngleValue.textContent = cardDetection.detected
    ? `${cardDetection.angle.toFixed(1)}°`
    : "Non détecté";
  cardAngleValue.className = cardDetection.detected
    ? cardDetection.isHorizontal
      ? "metric status-good"
      : "metric status-bad"
    : "metric status-warning";
  alignmentValue.textContent = alignmentResult.aligned
    ? "Correct"
    : alignmentResult.message;
  alignmentValue.className = alignmentResult.aligned
    ? "metric status-good"
    : "metric status-bad";
  distanceValue.textContent = distanceResult.correct
    ? distanceResult.message
    : distanceResult.message;
  distanceValue.className = distanceResult.correct
    ? "metric status-good"
    : "metric status-warning";

  // Vérification de la qualité d'image et des conditions
  const isImageQualityGood =
    imageQuality.variance >= VARIANCE_MIN &&
    imageQuality.brightness >= BRIGHTNESS_MIN &&
    imageQuality.brightness <= BRIGHTNESS_MAX;

  const isCardDetectionValid = useContourDetection
    ? cardDetection.detected
    : true;

  if (
    isCardDetectionValid &&
    alignmentResult.aligned &&
    distanceResult.correct &&
    isImageQualityGood
  ) {
    resultStatus.textContent = "✓ Parfait - Prêt pour la capture";
    resultStatus.className = "metric status-good";
  } else if (!isImageQualityGood) {
    resultStatus.textContent = "✗ Qualité d'image insuffisante";
    resultStatus.className = "metric status-warning";
  } else if (useContourDetection && !cardDetection.detected) {
    resultStatus.textContent = "✗ Carte non détectée";
    resultStatus.className = "metric status-warning";
  } else if (!alignmentResult.aligned) {
    resultStatus.textContent = "✗ Carte mal alignée";
    resultStatus.className = "metric status-bad";
  } else if (!distanceResult.correct) {
    resultStatus.textContent = "✗ Ajuster la distance";
    resultStatus.className = "metric status-warning";
  }

  varianceValue.textContent = imageQuality.variance;
  brightnessValue.textContent = imageQuality.brightness;

  if (imageQuality.variance > 100) {
    varianceValue.className = "metric status-good";
  } else if (imageQuality.variance > 50) {
    varianceValue.className = "metric status-warning";
  } else {
    varianceValue.className = "metric status-bad";
  }

  if (imageQuality.brightness > 50 && imageQuality.brightness < 200) {
    brightnessValue.className = "metric status-good";
  } else {
    brightnessValue.className = "metric status-warning";
  }

  return isImageQualityGood;
}

async function processFrame() {
  try {
    // Redimensionner la vidéo haute résolution vers le canvas de traitement
    context.drawImage(video, 0, 0, PROCESSING_WIDTH, PROCESSING_HEIGHT);

    let src = openCv.imread(canvas);
    let gray = new openCv.Mat();
    openCv.cvtColor(src, gray, openCv.COLOR_RGBA2GRAY);

    const imageQuality = await analyzeImageQuality(gray);

    let faceRect = await detectFace(src, gray);
    if (faceRect) {
      // Détection des yeux si l'option est activée
      let eyesData = { angle: null, eyeRects: [] };
      if (showEyes) {
        eyesData = await eyeDetection(src, faceRect);
      } else {
        document.getElementById("eyesAlignmentValue").textContent = "-";
        document.getElementById("eyesAlignmentValue").className = "metric";
      }

      let extrapolatedCardRect = extrapolateCardRectangle(faceRect);
      drawRectangle(src, extrapolatedCardRect, [255, 165, 0, 255], 2, "CARTE");

      let cardDetection;
      if (useContourDetection) {
        cardDetection = detectCardContour(src, extrapolatedCardRect, gray);
      } else {
        cardDetection = {
          detected: false,
          rect: extrapolatedCardRect,
          angle: 0,
          isHorizontal: true,
          imageIsHorizontal: true,
          score: 1.0,
        };
      }

      let alignmentResult = checkAlignment(
        faceRect,
        cardDetection.rect,
        cardDetection.angle,
        cardDetection.imageIsHorizontal
      );
      let distanceResult = checkDistance(cardDetection.rect, src);
      const isImageQualityGood = updateStatus(
        cardDetection,
        alignmentResult,
        distanceResult,
        imageQuality
      );

      openCv.putText(
        src,
        `Angle: ${cardDetection.angle.toFixed(1)}°`,
        new openCv.Point(10, 30),
        openCv.FONT_HERSHEY_SIMPLEX,
        0.7,
        [255, 255, 255, 255],
        2
      );
      if (cardDetection.detected) {
        let faceCenterX = faceRect.x + faceRect.width / 2;
        let faceCenterY = faceRect.y + faceRect.height / 2;
        let cardCenterX = cardDetection.rect.x + cardDetection.rect.width / 2;
        let cardCenterY = cardDetection.rect.y + cardDetection.rect.height / 2;
        openCv.line(
          src,
          new openCv.Point(faceCenterX, faceCenterY),
          new openCv.Point(cardCenterX, cardCenterY),
          [255, 255, 255, 150],
          1
        );
      }

      // Modifier la condition de capture automatique dans processFrame
      if (
        (useContourDetection ? cardDetection.detected : true) &&
        (useContourDetection ? alignmentResult.aligned : true) &&
        distanceResult.correct &&
        imageQuality.variance >= VARIANCE_MIN &&
        imageQuality.brightness >= BRIGHTNESS_MIN &&
        imageQuality.brightness <= BRIGHTNESS_MAX &&
        (!showEyes ||
          (eyesData.angle !== null &&
            Math.abs(eyesData.angle) < EYES_ALIGNMENT_THRESHOLD)) &&
        autoCaptureEnabled &&
        !photoTaken
      ) {
        capturePhoto();
      }
    } else {
      if (showGuide) {
        drawRectangle(
          src,
          distanceGuideRect,
          [139, 69, 19, 180],
          2,
          "ZONE OPTIMALE"
        );
      }
    }

    openCv.imshow(canvas, src);
    src.delete();
    gray.delete();
  } catch (e) {
    console.error("Erreur dans processFrame:", e);
  }
}

document.getElementById("showGuide").addEventListener("change", (e) => {
  showGuide = e.target.checked;
});
document.getElementById("showDebug").addEventListener("change", (e) => {
  isDebugVisible = e.target.checked;
});
document
  .getElementById("useContourDetection")
  .addEventListener("change", (e) => {
    useContourDetection = e.target.checked;
  });
document.getElementById("autoCapture").addEventListener("change", (e) => {
  autoCaptureEnabled = e.target.checked;
});
document
  .getElementById("manualCapture")
  .addEventListener("click", capturePhoto);
document.getElementById("retakePhoto").addEventListener("click", () => {
  photoTaken = false;
  autoCaptureEnabled = true;
  document.getElementById("autoCapture").checked = true;
  document.getElementById("retakePhoto").style.display = "none";
  photoContext.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
});
document.getElementById("showEyes").addEventListener("change", (e) => {
  showEyes = e.target.checked;
});

async function onOpenCvReady() {
  console.log("OpenCV.js est prêt.");
  openCv = await cv;
  setInterval(processFrame, 100);
}

const photoContainer = document.getElementById("photoContainer");
photoContainer.style.width = "640px";
photoContainer.style.height = "480px";
photoContainer.style.overflow = "hidden";
photoContainer.style.border = "1px solid #ccc";
photoContainer.style.borderRadius = "5px";

photoCanvas.style.width = "100%";
photoCanvas.style.height = "100%";
photoCanvas.style.objectFit = "contain";

photoCanvas.width = OUTPUT_WIDTH;
photoCanvas.height = OUTPUT_HEIGHT;
canvas.width = PROCESSING_WIDTH;
canvas.height = PROCESSING_HEIGHT;
