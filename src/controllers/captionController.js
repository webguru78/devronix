import { cloudinaryService } from "../services/cloudinaryService.js";
import { whisperService } from "../services/whisperService.js";
import { seoMetadataService } from "../services/seoMetadataService.js";
import { CaptionProject } from "../models/CaptionProject.js";
import { formatWhisperToCaptions } from "../utils/captionFormatter.js";
import { deductCaptionCredit } from "../middleware/creditMiddleware.js";
import mongoose from "mongoose";

export const captionController = {
  /**
   * Transcribe video, upload to Cloudinary, and persist project in MongoDB
   */
  async transcribeVideo(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message:
            "No video file provided. Please upload an MP4, MOV, or WebM video.",
        });
      }

      const originalName = req.file.originalname || "video.mp4";
      const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(1);
      const language = req.body.language || "auto";

      console.log(`[Upload Received]: ${originalName} (${fileSizeMB} MB)`);

      // Run Cloudinary Upload and Whisper Transcription in parallel
      const [cloudinaryResult, whisperResult] = await Promise.all([
        cloudinaryService
          .uploadVideoBuffer(req.file.buffer, originalName)
          .catch((err) => {
            console.error("[Cloudinary Warning]:", err.message);
            return null;
          }),
        whisperService.transcribe(req.file.buffer, originalName, language),
      ]);

      const rawTranscriptText = whisperResult.text || "";
      const targetSeoLang =
        language && language !== "auto"
          ? language
          : whisperResult.language || "en";

      // Execute Caption formatting and SEO Metadata generation in parallel
      const [formattedCaptions, seoMetadata] = await Promise.all([
        formatWhisperToCaptions(whisperResult, language),
        seoMetadataService
          .generateMetadata({
            rawText: rawTranscriptText,
            words: whisperResult.words || [],
            targetLanguage: targetSeoLang,
            tone: "viral",
          })
          .catch((seoErr) => {
            console.warn("[SEO Metadata Parallel Warning]:", seoErr.message);
            return null;
          }),
      ]);

      const videoUrl = cloudinaryResult?.url || null;
      const videoDuration =
        cloudinaryResult?.duration || whisperResult.duration || 0;

      // Persist CaptionProject to MongoDB Atlas if connected
      let savedProject = null;
      if (mongoose.connection.readyState === 1) {
        try {
          savedProject = await CaptionProject.create({
            title: originalName,
            videoUrl: videoUrl || "local_blob",
            publicId: cloudinaryResult?.publicId || null,
            duration: `${Math.round(videoDuration)}s`,
            durationSeconds: videoDuration,
            fileSize: `${fileSizeMB} MB`,
            language: whisperResult.language || "en",
            rawTranscript: rawTranscriptText,
            captions: formattedCaptions,
            seoMetadata: seoMetadata || undefined,
          });
          console.log(
            `[MongoDB]: Saved new CaptionProject _id=${savedProject._id}`,
          );
        } catch (dbErr) {
          console.warn("[MongoDB Save Warning]:", dbErr.message);
        }
      }

      // Deduct credit atomically for the user
      let updatedCredits = null;
      if (req.user && req.user._id) {
        updatedCredits = await deductCaptionCredit(req.user._id);
      }

      return res.status(200).json({
        success: true,
        message: "Video transcribed, captioned, and SEO metadata generated successfully.",
        projectId: savedProject ? savedProject._id : null,
        credits: updatedCredits,
        video: {
          url: videoUrl,
          publicId: cloudinaryResult?.publicId || null,
          title: originalName,
          size: `${fileSizeMB} MB`,
          duration: `${Math.round(videoDuration)}s`,
          durationSeconds: videoDuration,
        },
        transcription: {
          language: whisperResult.language || "en",
          duration: whisperResult.duration || 0,
          rawText: rawTranscriptText,
          segmentsCount: formattedCaptions.length,
        },
        captions: formattedCaptions,
        seoMetadata: seoMetadata || null,
      });
    } catch (error) {
      console.error("[Caption Controller Error]:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to process video with Whisper AI.",
        error: error.toString(),
      });
    }
  },

  /**
   * Get all saved caption projects from MongoDB
   */
  async getProjects(req, res) {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(200).json({ success: true, projects: [] });
      }
      const projects = await CaptionProject.find()
        .sort({ createdAt: -1 })
        .limit(20);
      return res
        .status(200)
        .json({ success: true, count: projects.length, projects });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get single project by ID
   */
  async getProjectById(req, res) {
    try {
      const project = await CaptionProject.findById(req.params.id);
      if (!project) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }
      return res.status(200).json({ success: true, project });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Update project captions and styling
   */
  async updateProject(req, res) {
    try {
      const { captions, styles, title } = req.body;
      const updateData = {};
      if (captions) updateData.captions = captions;
      if (styles) updateData.styles = styles;
      if (title) updateData.title = title;

      const updated = await CaptionProject.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true },
      );

      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }

      return res.status(200).json({ success: true, project: updated });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Re-transcribe an uploaded video in a new language (Whisper only, no Cloudinary re-upload)
   */
  async retranscribeVideo(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No video file provided.",
        });
      }

      const language = req.body.language || "auto";
      const originalName = req.file.originalname || "video.mp4";

      console.log(`[Retranscribe]: ${originalName} → language=${language}`);

      const whisperResult = await whisperService.transcribe(
        req.file.buffer,
        originalName,
        language,
      );

      const formattedCaptions = await formatWhisperToCaptions(whisperResult, language);

      return res.status(200).json({
        success: true,
        message: "Captions regenerated successfully.",
        language,
        transcription: {
          language: whisperResult.language || language,
          duration: whisperResult.duration || 0,
          rawText: whisperResult.text || "",
          segmentsCount: formattedCaptions.length,
        },
        captions: formattedCaptions,
      });
    } catch (error) {
      console.error("[Retranscribe Controller Error]:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to regenerate captions.",
      });
    }
  },

  /**
   * Translates or transliterates an array of captions to a chosen language
   */
  async translateCaptions(req, res) {
    try {
      const { captions, targetLanguage } = req.body;
      if (!captions || !Array.isArray(captions)) {
        return res.status(400).json({
          success: false,
          message: "Captions array is required",
        });
      }

      const { translationService } = await import("../services/translationService.js");
      const translated = await translationService.translateCaptions(captions, targetLanguage || "roman_urdu");

      return res.status(200).json({
        success: true,
        captions: translated,
        targetLanguage: targetLanguage || "roman_urdu",
      });
    } catch (error) {
      console.error("[Caption Translate Controller Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to translate captions",
      });
    }
  },

  /**
   * Generates or re-generates SEO metadata without re-running Whisper
   */
  async generateSeoMetadata(req, res) {
    try {
      const { transcript, captions, targetLanguage = "en", tone = "viral", projectId } = req.body;

      // Extract rawText from explicit transcript or from captions array
      let rawText = (transcript || "").trim();
      if (!rawText && Array.isArray(captions) && captions.length > 0) {
        rawText = captions.map((c) => c.text || "").join(" ").trim();
      }

      if (!rawText) {
        return res.status(400).json({
          success: false,
          message: "Transcript text or captions array is required to generate SEO metadata.",
        });
      }

      const seoMetadata = await seoMetadataService.generateMetadata({
        rawText,
        targetLanguage,
        tone,
      });

      // If projectId is provided and MongoDB is available, persist it
      if (projectId && mongoose.connection.readyState === 1) {
        try {
          await CaptionProject.findByIdAndUpdate(
            projectId,
            { $set: { seoMetadata } },
            { new: true }
          );
        } catch (dbErr) {
          console.warn("[MongoDB SEO Metadata Update Warning]:", dbErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: "SEO metadata generated successfully.",
        seoMetadata,
      });
    } catch (error) {
      console.error("[SEO Metadata Controller Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to generate SEO metadata.",
      });
    }
  },

  /**
   * Health status endpoint
   */
  async healthCheck(req, res) {
    const dbState = mongoose.connection.readyState;
    const dbStatus =
      dbState === 1
        ? "connected"
        : dbState === 2
          ? "connecting"
          : "disconnected";

    return res.status(200).json({
      status: "ok",
      service: "Verbatim AI Backend",
      engine: "OpenAI Whisper v3",
      storage: "Cloudinary Media CDN",
      database: {
        status: dbStatus,
        name: mongoose.connection.name || "verbatim_ai",
      },
      timestamp: new Date().toISOString(),
    });
  },
};
