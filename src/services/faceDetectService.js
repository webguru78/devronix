/**
 * faceDetectService.js
 *
 * Zero-dependency face/subject detection for computing the optimal horizontal
 * crop offset when converting 16:9 source video → 9:16 vertical output.
 *
 * Strategy:
 *   1. Extract N sample frames from the clip as raw RGB pixel data via ffmpeg
 *      (rawvideo pipe — no disk writes, no extra npm packages)
 *   2. Scan each frame column-by-column counting "skin-tone" pixels
 *      (a broad HSV-like skin range in RGB space covering diverse skin tones)
 *   3. Find the weighted centroid X of skin-tone pixels across sampled frames
 *   4. Clamp and return cropX = centroid_x − 540 (centers the 1080px window on the subject)
 *   5. Fallback: if no skin found → return center crop offset
 *
 * Output frame size for detection: scaled DOWN to 192×108 (10× smaller) to
 * make the scan 100× faster while preserving column ratios perfectly.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const FFMPEG_PATH = ffmpegInstaller.path;

// ─── Skin Tone Detection Parameters ──────────────────────────────────────────
// Covers a broad range of human skin tones in RGB space.
// Reference: Kovac et al. "Human Skin Colour Clustering for Face Detection" (2003)
const SKIN_R_MIN = 60,
  SKIN_R_MAX = 255;
const SKIN_G_MIN = 40,
  SKIN_G_MAX = 220;
const SKIN_B_MIN = 20,
  SKIN_B_MAX = 190;

function isSkinPixel(r, g, b) {
  if (r < SKIN_R_MIN || r > SKIN_R_MAX) return false;
  if (g < SKIN_G_MIN || g > SKIN_G_MAX) return false;
  if (b < SKIN_B_MIN || b > SKIN_B_MAX) return false;
  // R must be dominant channel for skin
  if (r <= g || r <= b) return false;
  // R−G gap: differentiates skin from grass/yellow objects
  const rg = r - g;
  if (rg < 10 || rg > 155) return false;
  // R−B gap: differentiates skin from blue-ish backgrounds
  if (r - b < 15) return false;
  // Brightness: reject very dark and very washed-out pixels
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 30 || lum > 230) return false;
  return true;
}

// ─── Frame Extraction ─────────────────────────────────────────────────────────
const DETECT_W = 192; // 1920 / 10
const DETECT_H = 108; // 1080 / 10

/**
 * Extracts a single video frame at `timeOffset` seconds as raw RGB bytes
 * at reduced resolution (DETECT_W × DETECT_H) for fast scanning.
 * Returns a Buffer of DETECT_W * DETECT_H * 3 bytes, or null on failure.
 */
function extractFrameRaw(videoPath, timeOffset) {
  return new Promise((resolve) => {
    const chunks = [];
    const args = [
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, timeOffset)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${DETECT_W}:${DETECT_H}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ];

    const proc = spawn(FFMPEG_PATH, args, { windowsHide: true });
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.on("close", () => {
      const buf = Buffer.concat(chunks);
      const expected = DETECT_W * DETECT_H * 3;
      resolve(buf.length >= expected * 0.5 ? buf : null);
    });
    proc.on("error", () => resolve(null));
    proc.stderr.on("data", () => {}); // suppress stderr noise
  });
}

// ─── Skin Column Scorer ───────────────────────────────────────────────────────

/**
 * Given raw RGB frame buffer, returns an array[DETECT_W] of skin-pixel counts per column.
 */
function scoreSkinColumns(frameBuffer) {
  const colScores = new Float32Array(DETECT_W).fill(0);
  const totalPixels = DETECT_W * DETECT_H;
  for (let i = 0; i < totalPixels; i++) {
    const r = frameBuffer[i * 3];
    const g = frameBuffer[i * 3 + 1];
    const b = frameBuffer[i * 3 + 2];
    if (isSkinPixel(r, g, b)) {
      colScores[i % DETECT_W] += 1;
    }
  }
  return colScores;
}

/**
 * Compute weighted centroid column from skin scores array.
 * Returns column index (0–DETECT_W) or null if no significant skin found.
 */
function findSkinCentroidX(colScores) {
  let totalWeight = 0;
  let weightedSum = 0;
  let maxScore = 0;

  for (let c = 0; c < DETECT_W; c++) {
    if (colScores[c] > maxScore) maxScore = colScores[c];
    totalWeight += colScores[c];
    weightedSum += colScores[c] * c;
  }

  // Require at least 0.5% skin column density, otherwise treat as no face
  if (maxScore < DETECT_H * 0.005 || totalWeight < 1) return null;
  return weightedSum / totalWeight;
}

// ─── Dual-Subject Cluster Detection ──────────────────────────────────────────

/**
 * Given accumulated skin column scores across DETECT_W columns, detects up to two
 * prominent distinct horizontal subject/speaker clusters.
 *
 * @param {Float32Array} colScores - Skin pixel scores across DETECT_W columns
 * @param {number} scaledWidth960  - Scaled video width when height is 960 (for 1080x960 panels)
 * @param {number} maxCropX960     - Maximum horizontal crop offset (scaledWidth960 - 1080)
 * @param {number} scaledWidth1920 - Scaled video width when height is 1920 (for 1080x1920 single frame)
 * @param {number} maxCropX1920    - Maximum horizontal crop offset (scaledWidth1920 - 1080)
 * @returns {{
 *   isSplit: boolean,
 *   cropX1: number,
 *   cropX2: number,
 *   singleCropX: number,
 *   subjectsCount: number
 * }}
 */
function findSubjectClusters(
  colScores,
  scaledWidth960,
  maxCropX960,
  scaledWidth1920,
  maxCropX1920,
) {
  const singleFallback = Math.round(maxCropX1920 / 2);
  const splitLeftFallback = 0;
  const splitRightFallback = maxCropX960;

  // 1. Smooth column scores with 7-column moving average to eliminate sensor grain
  const smoothed = new Float32Array(DETECT_W);
  const radius = 3;
  for (let i = 0; i < DETECT_W; i++) {
    let sum = 0;
    let count = 0;
    for (let r = -radius; r <= radius; r++) {
      const idx = i + r;
      if (idx >= 0 && idx < DETECT_W) {
        sum += colScores[idx];
        count++;
      }
    }
    smoothed[i] = count > 0 ? sum / count : 0;
  }

  // 2. Divide frame into left half and right half to identify distinct side-by-side subjects
  // Typically podcast guests sit on left & right sides (with microphones in between)
  const midCol = Math.floor(DETECT_W / 2);
  let leftTotal = 0,
    leftWeighted = 0,
    leftMax = 0;
  let rightTotal = 0,
    rightWeighted = 0,
    rightMax = 0;

  for (let c = 0; c < DETECT_W; c++) {
    const val = smoothed[c];
    if (c < midCol) {
      if (val > leftMax) leftMax = val;
      leftTotal += val;
      leftWeighted += val * c;
    } else {
      if (val > rightMax) rightMax = val;
      rightTotal += val;
      rightWeighted += val * c;
    }
  }

  const overallMax = Math.max(leftMax, rightMax);
  const minThreshold = DETECT_H * 0.006; // Significant skin density threshold

  // Compute centroids of each half
  const leftCentroid = leftTotal > 0 ? leftWeighted / leftTotal : null;
  const rightCentroid = rightTotal > 0 ? rightWeighted / rightTotal : null;

  // Single-subject check: if one side is vastly dominant (> 80% of total skin energy)
  // or one side has virtually no skin pixels, treat as a single speaker/subject video.
  const totalSkin = leftTotal + rightTotal;
  const isSingleLeft = rightTotal < totalSkin * 0.18 || rightMax < minThreshold;
  const isSingleRight = leftTotal < totalSkin * 0.18 || leftMax < minThreshold;

  if (
    totalSkin < minThreshold * 2 ||
    isSingleLeft ||
    isSingleRight ||
    leftCentroid === null ||
    rightCentroid === null
  ) {
    // Single speaker fallback
    const singleCentroid = findSkinCentroidX(colScores);
    let singleCropX = singleFallback;
    if (singleCentroid !== null) {
      const norm = singleCentroid / DETECT_W;
      const centerPx = Math.round(norm * scaledWidth1920);
      singleCropX = Math.max(0, Math.min(maxCropX1920, centerPx - 540));
    }

    console.log(
      `[MultiSubjectDetect]: Single speaker detected (leftTotal=${Math.round(leftTotal)}, rightTotal=${Math.round(rightTotal)}) -> single 9:16 cropX=${singleCropX}`,
    );

    return {
      isSplit: false,
      cropX1: splitLeftFallback,
      cropX2: splitRightFallback,
      singleCropX,
      subjectsCount: 1,
    };
  }

  // 3. Two speakers detected! Compute separate cropX for top (Speaker 1) and bottom (Speaker 2)
  const normLeft = leftCentroid / DETECT_W;
  const normRight = rightCentroid / DETECT_W;

  const leftCenter960 = Math.round(normLeft * scaledWidth960);
  const rightCenter960 = Math.round(normRight * scaledWidth960);

  // 1080px window centered on each subject (scaled for height 960)
  let cropX1 = Math.max(0, Math.min(maxCropX960, leftCenter960 - 540));
  let cropX2 = Math.max(0, Math.min(maxCropX960, rightCenter960 - 540));

  console.log(
    `[MultiSubjectDetect]: Dual speakers detected! Speaker A (col ${leftCentroid.toFixed(1)} -> cropX1=${cropX1}), Speaker B (col ${rightCentroid.toFixed(1)} -> cropX2=${cropX2})`,
  );

  return {
    isSplit: true,
    cropX1,
    cropX2,
    singleCropX: singleFallback,
    subjectsCount: 2,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const faceDetectService = {
  /**
   * Detects up to 2 distinct subjects in the video for Split-Screen Dual Framing.
   * If only 1 subject is present, automatically signals fallback to single-crop.
   *
   * @param {string} videoPath       - Path to the source video file
   * @param {number} startTime       - Clip start offset in seconds
   * @param {number} duration        - Clip duration in seconds
   * @param {number} [srcWidth=1920] - Source video width in pixels
   * @param {number} [srcHeight=1080]- Source video height in pixels
   * @param {number} [sampleCount=4] - Number of frames to sample
   * @returns {Promise<{
   *   isSplit: boolean,
   *   cropX1: number,
   *   cropX2: number,
   *   singleCropX: number,
   *   subjectsCount: number
   * }>}
   */
  async detectMultipleSubjectRegions(
    videoPath,
    startTime,
    duration,
    srcWidth = 1920,
    srcHeight = 1080,
    sampleCount = 4,
  ) {
    const scaledWidth960 = Math.round(srcWidth * (960 / (srcHeight || 1080)));
    const maxCropX960 = Math.max(0, scaledWidth960 - 1080);
    const scaledWidth1920 = Math.round(srcWidth * (1920 / (srcHeight || 1080)));
    const maxCropX1920 = Math.max(0, scaledWidth1920 - 1080);

    const fallbackResult = {
      // Never duplicate an uncertain/single-speaker frame into two panels.
      // A split is only safe after two distinct regions are actually detected.
      isSplit: false,
      cropX1: 0,
      cropX2: maxCropX960,
      singleCropX: Math.round(maxCropX1920 / 2),
      subjectsCount: 1,
    };

    try {
      const offsets = [];
      for (let i = 0; i < sampleCount; i++) {
        const pct = 0.15 + (0.7 * i) / Math.max(1, sampleCount - 1);
        offsets.push(startTime + duration * pct);
      }

      const frames = await Promise.all(
        offsets.map((t) => extractFrameRaw(videoPath, t)),
      );

      const accumulatedScores = new Float32Array(DETECT_W).fill(0);
      let framesUsed = 0;

      for (const frame of frames) {
        if (!frame) continue;
        const scores = scoreSkinColumns(frame);
        for (let c = 0; c < DETECT_W; c++) accumulatedScores[c] += scores[c];
        framesUsed++;
      }

      if (framesUsed === 0) {
        console.log(
          `[FaceDetect]: No frames extracted — default left/right split.`,
        );
        return fallbackResult;
      }

      return findSubjectClusters(
        accumulatedScores,
        scaledWidth960,
        maxCropX960,
        scaledWidth1920,
        maxCropX1920,
      );
    } catch (err) {
      console.warn(
        `[FaceDetect]: Multi-subject detection error (${err.message}) — fallback split.`,
      );
      return fallbackResult;
    }
  },

  /**
   * Single-subject detection for classic single 9:16 frame.
   */
  async getCropX(
    videoPath,
    startTime,
    duration,
    srcWidth = 1920,
    srcHeight = 1080,
    sampleCount = 4,
  ) {
    const scaledWidth = Math.round(srcWidth * (1920 / (srcHeight || 1080)));
    const maxCropX = Math.max(0, scaledWidth - 1080);
    const centerCropX = Math.round(maxCropX / 2);

    if (scaledWidth <= 1080) return 0;

    try {
      const offsets = [];
      for (let i = 0; i < sampleCount; i++) {
        const pct = 0.15 + (0.7 * i) / Math.max(1, sampleCount - 1);
        offsets.push(startTime + duration * pct);
      }

      const frames = await Promise.all(
        offsets.map((t) => extractFrameRaw(videoPath, t)),
      );

      const accumulatedScores = new Float32Array(DETECT_W).fill(0);
      let framesUsed = 0;

      for (const frame of frames) {
        if (!frame) continue;
        const scores = scoreSkinColumns(frame);
        for (let c = 0; c < DETECT_W; c++) accumulatedScores[c] += scores[c];
        framesUsed++;
      }

      if (framesUsed === 0) return centerCropX;

      const centroidCol = findSkinCentroidX(accumulatedScores);
      if (centroidCol === null) return centerCropX;

      const normalizedCentroidX = centroidCol / DETECT_W;
      const subjectCenterInScaled = Math.round(
        normalizedCentroidX * scaledWidth,
      );

      let cropX = subjectCenterInScaled - 540;
      cropX = Math.max(0, Math.min(maxCropX, cropX));

      if (Math.abs(cropX - centerCropX) < scaledWidth * 0.05) {
        return centerCropX;
      }

      return cropX;
    } catch (err) {
      return centerCropX;
    }
  },
};
