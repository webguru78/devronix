import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { clipController } from "../controllers/clipController.js";
import { authMiddleware, requireAuth, requireVerified } from "../middleware/authMiddleware.js";
import { checkClipCredits } from "../middleware/creditMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "../../temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Multer Disk Storage for video files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    const unique = `upload_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit for up to 1 hour videos
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/") ||
      file.originalname.match(/\.(mp4|mov|webm|avi|mkv|m4v)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only video files (.mp4, .mov, .webm, .mkv) are permitted."), false);
    }
  },
});

const router = express.Router();

// POST /api/clips/upload (Upload video file) - Protected with Auth, Verified, and Credit Check
router.post(
  "/upload",
  requireAuth,
  requireVerified,
  checkClipCredits,
  upload.single("video"),
  clipController.uploadAndQueueJob
);

// GET /api/clips/youtube/info (Fetch metadata for YouTube preview)
router.get("/youtube/info", requireAuth, clipController.getYouTubeInfo);

// POST /api/clips/youtube (Direct YouTube URL clip generation) - Protected with Auth, Verified, and Credit Check
router.post(
  "/youtube",
  requireAuth,
  requireVerified,
  checkClipCredits,
  clipController.queueYouTubeJob
);

// Apply auth identification middleware to remaining clip query routes
router.use(authMiddleware);

// GET /api/clips/:jobId (Poll status & results of a specific clip job)
router.get("/:jobId", clipController.getJobStatus);

// GET /api/clips (List user's recent clip jobs)
router.get("/", clipController.getUserJobs);

// PUT /api/clips/:jobId/clips/:clipId (Save edited captions, template, language for a clip)
router.put("/:jobId/clips/:clipId", clipController.updateClipCaptions);

// POST /api/clips/merge (Merge clips with FFmpeg on server preserving audio)
router.post("/merge", clipController.mergeClips);

export default router;
