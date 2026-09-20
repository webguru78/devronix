import express from "express";
import multer from "multer";
import { captionController } from "../controllers/captionController.js";
import { requireAuth, requireVerified } from "../middleware/authMiddleware.js";
import { checkCaptionCredits } from "../middleware/creditMiddleware.js";

const router = express.Router();

// Configure Multer storage in memory (50MB max limit)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/") ||
      file.originalname.match(/\.(mp4|mov|webm|avi|mkv)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only video and audio files are permitted."), false);
    }
  },
});

// POST /api/captions/transcribe (Protected: Auth + Verified + Credit Check)
router.post(
  "/transcribe",
  requireAuth,
  requireVerified,
  checkCaptionCredits,
  upload.single("video"),
  captionController.transcribeVideo,
);

// POST /api/captions/retranscribe (Re-run Whisper in a new language, no re-upload to Cloudinary)
router.post(
  "/retranscribe",
  upload.single("video"),
  captionController.retranscribeVideo,
);

// GET /api/captions/projects (Get all saved projects)
router.get("/projects", captionController.getProjects);

// GET /api/captions/projects/:id (Get single project)
router.get("/projects/:id", captionController.getProjectById);

// PUT /api/captions/projects/:id (Update project captions and styles)
router.put("/projects/:id", captionController.updateProject);

// POST /api/captions/translate (Translate or transliterate captions)
router.post("/translate", captionController.translateCaptions);

// POST /api/captions/seo-metadata (Generate/Regenerate SEO titles, description, hashtags)
router.post("/seo-metadata", captionController.generateSeoMetadata);

// GET /api/captions/health
router.get("/health", captionController.healthCheck);

export default router;
