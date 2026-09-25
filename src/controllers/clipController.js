import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ClipJob } from "../models/ClipJob.js";
import { clipQueueService } from "../services/clipQueueService.js";
import { ffmpegService } from "../services/ffmpegService.js";
import { youtubeService } from "../services/youtubeService.js";
import { generateAssSubtitles } from "../utils/assSubtitleGenerator.js";
import { deductClipCredit } from "../middleware/creditMiddleware.js";
import cloudinary from "../config/cloudinary.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "../../temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 1 Hour Cap (3600 seconds)
const MAX_VIDEO_DURATION_SECONDS = 3600;
const MAX_JOBS_PER_USER_WINDOW = 8;
const JOB_WINDOW_MS = 10 * 60 * 1000;
const recentJobStarts = new Map();

function allowJobStart(userId) {
  const now = Date.now();
  const key = userId || "guest_user";
  const stamps = (recentJobStarts.get(key) || []).filter(
    (t) => now - t < JOB_WINDOW_MS,
  );
  if (stamps.length >= MAX_JOBS_PER_USER_WINDOW) {
    return false;
  }
  stamps.push(now);
  recentJobStarts.set(key, stamps);
  return true;
}

export const clipController = {
  /**
   * Fetches metadata for YouTube URL preview
   * GET /api/clips/youtube/info?url=...
   */
  async getYouTubeInfo(req, res) {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ success: false, message: "YouTube URL is required." });
      }

      const info = await youtubeService.getVideoInfo(url);
      return res.status(200).json({ success: true, info });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to fetch YouTube video details.",
      });
    }
  },

  /**
   * Starts a new auto-clip generation job directly from a YouTube URL
   * POST /api/clips/youtube
   */
  async queueYouTubeJob(req, res) {
    try {
      const userId = req.userId || "guest_user";
      const { youtubeUrl, title, language, templateId, framingMode } = req.body;
      const targetLanguage = language || "roman_urdu";
      const targetTemplate = templateId || "hormozi_gold_impact";
      const targetFraming = framingMode || "smart_blur";

      if (!youtubeUrl) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid YouTube video URL.",
        });
      }

      if (!allowJobStart(userId)) {
        return res.status(429).json({
          success: false,
          message: "Too many clip jobs in a short time. Please wait a few minutes and try again.",
        });
      }

      // 1. Fetch info to check length & get metadata
      const info = await youtubeService.getVideoInfo(youtubeUrl);
      const detectedDuration = Math.round(Number(info.duration) || 0);

      if (detectedDuration > MAX_VIDEO_DURATION_SECONDS) {
        return res.status(400).json({
          success: false,
          message: `Video is ${Math.round(detectedDuration / 60)} minutes. The maximum allowed length is 1 hour (60 minutes).`,
        });
      }

      const jobTitle = (title || "").trim() || info.title || "YouTube Video";

      // 2. Create job in MongoDB with "downloading" status
      const job = await ClipJob.create({
        userId,
        title: jobTitle,
        originalVideoUrl: youtubeUrl,
        sourceType: "youtube",
        language: targetLanguage,
        templateId: targetTemplate,
        framingMode: targetFraming,
        durationSeconds: detectedDuration,
        status: "downloading",
        currentStep: "Downloading high-definition video from YouTube...",
        progress: 5,
      });

      // Deduct credit atomically
      let updatedCredits = null;
      if (req.user && req.user._id) {
        updatedCredits = await deductClipCredit(req.user._id);
      }

      // Return immediately so frontend shows the live tracker
      res.status(201).json({
        success: true,
        message: "YouTube clip job started successfully.",
        jobId: job._id,
        credits: updatedCredits,
        job: {
          _id: job._id,
          title: job.title,
          status: job.status,
          durationSeconds: detectedDuration,
          currentStep: job.currentStep,
          createdAt: job.createdAt,
        },
      });

      // 3. Download in background and enqueue into clip pipeline
      (async () => {
        const localVideoPath = path.join(
          TEMP_DIR,
          `yt_${job._id}_${Date.now()}.mp4`,
        );

        try {
          console.log(`[Clip Controller]: Downloading YouTube video for job ${job._id}...`);
          await youtubeService.downloadVideo(youtubeUrl, localVideoPath);

          await ClipJob.findByIdAndUpdate(job._id, {
            status: "queued",
            currentStep: "YouTube video downloaded successfully. Queued for AI processing...",
            progress: 10,
          });

          console.log(`[Clip Controller]: Enqueuing downloaded YouTube job ${job._id}...`);
          clipQueueService.enqueue(job._id.toString(), localVideoPath);
        } catch (dlErr) {
          console.error(`[Clip Controller]: YouTube download failed for job ${job._id}:`, dlErr.message);
          try {
            if (fs.existsSync(localVideoPath)) fs.unlinkSync(localVideoPath);
          } catch (_) {}

          await ClipJob.findByIdAndUpdate(job._id, {
            status: "failed",
            error: `Failed to download YouTube video: ${dlErr.message}. Make sure the video is public and accessible.`,
            currentStep: "YouTube download failed.",
          });
        }
      })();
    } catch (error) {
      console.error("[Clip Controller YouTube Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to start YouTube clip generation job.",
      });
    }
  },
  /**
   * Starts a new auto-clip generation job via file upload
   * POST /api/clips/upload
   */
  async uploadAndQueueJob(req, res) {
    let localFilePath = null;
    try {
      const userId = req.userId || "guest_user";
      const { title, language, templateId, framingMode } = req.body;
      const targetLanguage = language || "roman_urdu";
      const targetTemplate = templateId || "hormozi_gold_impact";
      const targetFraming = framingMode || "smart_blur";

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select a video file to upload.",
        });
      }

      if (!allowJobStart(userId)) {
        try {
          if (req.file.path && fs.existsSync(req.file.path))
            fs.unlinkSync(req.file.path);
        } catch (_) {}
        return res.status(429).json({
          success: false,
          message:
            "Too many clip jobs in a short time. Please wait a few minutes and try again.",
        });
      }

      let originalVideoUrl = "local_stored_video";
      let originalPublicId = null;
      const sourceType = "upload";
      let jobTitle =
        (title || "").trim() || req.file.originalname || "Uploaded Video";
      localFilePath = req.file.path;

      console.log(
        `[Clip Controller]: Received file upload: ${jobTitle} (${(req.file.size / 1024 / 1024).toFixed(1)} MB, lang: ${targetLanguage}, template: ${targetTemplate})`,
      );

      // Probe video to check duration and stream validity
      let probe;
      try {
        probe = await ffmpegService.probeVideo(localFilePath);
      } catch (probeErr) {
        if (fs.existsSync(localFilePath)) {
          try {
            fs.unlinkSync(localFilePath);
          } catch (_) {}
        }
        console.error("[Clip Controller Probe Error]:", probeErr.message);
        return res.status(400).json({
          success: false,
          message:
            "Invalid or unreadable video file. Please make sure the video is a valid, uncorrupted MP4, MOV, or WebM file.",
        });
      }

      const detectedDuration = Math.round(probe.duration || 0);
      console.log(
        `[Clip Controller]: Probed duration: ${detectedDuration}s (Max: ${MAX_VIDEO_DURATION_SECONDS}s)`,
      );

      if (detectedDuration > MAX_VIDEO_DURATION_SECONDS) {
        // Enforce 1 hour constraint
        try {
          if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        } catch (_) {}

        return res.status(400).json({
          success: false,
          message: `Video duration is ${Math.round(detectedDuration / 60)} minutes. The maximum allowed video length is 1 hour (60 minutes). Please provide a shorter video.`,
          durationSeconds: detectedDuration,
        });
      }

      // Create new ClipJob in MongoDB
      const job = await ClipJob.create({
        userId,
        title: jobTitle,
        originalVideoUrl: originalVideoUrl || "video_source",
        originalPublicId: originalPublicId || null,
        sourceType,
        language: targetLanguage,
        templateId: targetTemplate,
        framingMode: targetFraming,
        durationSeconds: detectedDuration,
        status: "queued",
        currentStep: "Job queued and scheduled for processing...",
        progress: 0,
      });

      console.log(
        `[Clip Controller]: Job created with _id: ${job._id}. Enqueuing...`,
      );

      // Enqueue job for background processing
      clipQueueService.enqueue(job._id.toString(), localFilePath);

      // Deduct credit atomically for the user
      let updatedCredits = null;
      if (req.user && req.user._id) {
        updatedCredits = await deductClipCredit(req.user._id);
      }

      return res.status(201).json({
        success: true,
        message: "Clip generation job queued successfully.",
        jobId: job._id,
        credits: updatedCredits,
        job: {
          _id: job._id,
          title: job.title,
          status: job.status,
          durationSeconds: detectedDuration,
          currentStep: job.currentStep,
          createdAt: job.createdAt,
        },
      });
    } catch (error) {
      console.error("[Clip Controller Upload Error]:", error);
      if (localFilePath && fs.existsSync(localFilePath)) {
        try {
          fs.unlinkSync(localFilePath);
        } catch (_) {}
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to start clip generation job.",
      });
    }
  },

  /**
   * Polls job status and results
   * GET /api/clips/:jobId
   */
  async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      const job = await ClipJob.findById(jobId)
        .select("-transcript.words -transcript.segments")
        .lean();

      if (!job) {
        return res.status(404).json({
          success: false,
          message: `Job ${jobId} not found.`,
        });
      }

      return res.status(200).json({
        success: true,
        job,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch job status.",
      });
    }
  },

  /**
   * Retrieves recent jobs for current user
   * GET /api/clips
   */
  async getUserJobs(req, res) {
    try {
      const userId = req.userId || "guest_user";
      const filter =
        req.userId && req.userId !== "guest_user" ? { userId } : {};

      const jobs = await ClipJob.find(filter)
        .sort({ createdAt: -1 })
        .limit(20)
        .select("-transcript.words -transcript.segments")
        .lean();

      return res.status(200).json({
        success: true,
        jobs,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch jobs.",
      });
    }
  },

  /**
   * Updates a specific clip's captions, template, styles, and language.
   * Also optionally re-burns the subtitles onto the clean video using FFmpeg.
   * PUT /api/clips/:jobId/clips/:clipId
   */
  async updateClipCaptions(req, res) {
    const tempFiles = [];
    try {
      const { jobId, clipId } = req.params;
      const { captions, templateId, customStyles, language, title, reBurn } =
        req.body;

      const job = await ClipJob.findById(jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          message: `Job ${jobId} not found.`,
        });
      }

      const clip = job.clips.id(clipId);
      if (!clip) {
        return res.status(404).json({
          success: false,
          message: `Clip ${clipId} not found in job.`,
        });
      }

      if (captions !== undefined) clip.captions = captions;
      if (templateId !== undefined) clip.templateId = templateId;
      if (customStyles !== undefined) clip.customStyles = customStyles;
      if (language !== undefined) clip.language = language;
      if (title !== undefined) clip.title = title;

      // Re-burn video if cleanUrl is available and reBurn flag or template/caption update is specified
      const shouldReburn =
        reBurn || templateId !== undefined || (captions && captions.length > 0);
      const sourceVideoUrl = clip.cleanUrl || clip.url;

      if (shouldReburn && sourceVideoUrl && sourceVideoUrl.startsWith("http")) {
        try {
          console.log(
            `[Clip Controller]: Re-burning subtitles for clip ${clipId} with template ${clip.templateId}...`,
          );
          const timestamp = Date.now();
          const cleanLocalPath = path.join(
            TEMP_DIR,
            `reburn_${clipId}_clean_${timestamp}.mp4`,
          );
          const burnedLocalPath = path.join(
            TEMP_DIR,
            `reburn_${clipId}_burned_${timestamp}.mp4`,
          );
          const assPath = path.join(
            TEMP_DIR,
            `reburn_${clipId}_${timestamp}.ass`,
          );
          tempFiles.push(cleanLocalPath, burnedLocalPath, assPath);

          // 1. Fetch source clean clip video
          const videoResp = await fetch(sourceVideoUrl);
          if (!videoResp.ok)
            throw new Error(
              `Failed to fetch clean video: ${videoResp.statusText}`,
            );
          const videoBuf = Buffer.from(await videoResp.arrayBuffer());
          fs.writeFileSync(cleanLocalPath, videoBuf);

          // 2. Build word list for ASS generation
          let wordsForAss = [];
          if (clip.captions && clip.captions.length > 0) {
            for (const cap of clip.captions) {
              if (cap.words && cap.words.length > 0) {
                wordsForAss.push(
                  ...cap.words.map((w) => ({
                    word: w.word || w.rawWord,
                    start: Number(w.start),
                    end: Number(w.end),
                  })),
                );
              } else if (cap.text) {
                const splitWords = cap.text.trim().split(/\s+/).filter(Boolean);
                const capDur = Math.max(
                  0.3,
                  Number(cap.end) - Number(cap.start),
                );
                const wordDur = capDur / Math.max(1, splitWords.length);
                splitWords.forEach((word, idx) => {
                  wordsForAss.push({
                    word,
                    start: Number(cap.start) + idx * wordDur,
                    end: Number(cap.start) + (idx + 1) * wordDur,
                  });
                });
              }
            }
          }

          // Fallback to original transcript words if captions array was empty
          if (wordsForAss.length === 0 && job.transcript?.words) {
            wordsForAss = (job.transcript.words || [])
              .filter(
                (w) =>
                  Number(w.end) >= clip.startTime &&
                  Number(w.start) <= clip.endTime,
              )
              .map((w) => ({
                word: (w.word || w.rawWord || "").trim(),
                start: Math.max(0, Number(w.start) - clip.startTime),
                end: Math.max(0.15, Number(w.end) - clip.startTime),
              }));
          }

          // 3. Generate ASS file
          const effectiveTemplate = clip.templateId || "bold_creator_01";
          const assContent = generateAssSubtitles(
            wordsForAss,
            0,
            clip.duration || 60,
            effectiveTemplate,
          );
          fs.writeFileSync(assPath, assContent, "utf8");

          // 4. Burn subtitles
          await ffmpegService.burnSubtitlesOntoCleanClip({
            inputClipPath: cleanLocalPath,
            outputPath: burnedLocalPath,
            assSubtitlePath: assPath,
          });

          // 5. Upload new burned video to Cloudinary
          const uploadRes = await cloudinary.uploader.upload(burnedLocalPath, {
            resource_type: "video",
            folder: "verbatim_clips",
            public_id: `clip_${jobId}_${clipId}_${timestamp}`,
            overwrite: true,
          });

          clip.url = uploadRes.secure_url;
          console.log(
            `[Clip Controller]: Re-burn complete! New URL: ${clip.url}`,
          );
        } catch (burnErr) {
          console.warn(`[Clip Controller Re-burn Warning]: ${burnErr.message}`);
        }
      }

      await job.save();

      return res.status(200).json({
        success: true,
        message: "Clip captions and styles updated successfully.",
        clip,
        job,
      });
    } catch (error) {
      console.error("[Clip Controller Update Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update clip captions.",
      });
    } finally {
      tempFiles.forEach((p) => {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
      });
    }
  },

  /**
   * Merges multiple clips into a single video with full audio and returns Cloudinary URL
   * POST /api/clips/merge
   */
  async mergeClips(req, res) {
    const tempFiles = [];
    try {
      const {
        clips = [],
        quality = "1080p",
        title = "merged_clips",
      } = req.body;

      if (!clips || clips.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please provide at least one clip to merge.",
        });
      }

      console.log(
        `[Clip Controller]: Merging ${clips.length} clips via server-side FFmpeg...`,
      );
      const timestamp = Date.now();
      const clipItems = [];

      // Download each clip to temp
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        const clipUrl = c.url;
        if (!clipUrl) continue;

        const localClipPath = path.join(
          TEMP_DIR,
          `merge_src_${timestamp}_${i}.mp4`,
        );
        tempFiles.push(localClipPath);

        const resp = await fetch(clipUrl);
        if (!resp.ok)
          throw new Error(
            `Failed to download clip ${i + 1}: ${resp.statusText}`,
          );
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(localClipPath, buf);

        clipItems.push({
          filePath: localClipPath,
          startTrim: c.startTrim !== undefined ? Number(c.startTrim) : 0,
          endTrim: c.endTrim !== undefined ? Number(c.endTrim) : 0,
        });
      }

      const mergedOutPath = path.join(TEMP_DIR, `merged_${timestamp}.mp4`);
      tempFiles.push(mergedOutPath);

      // Perform FFmpeg merge with 100% audio preserved
      await ffmpegService.mergeClipsWithFfmpeg({
        clipItems,
        outputPath: mergedOutPath,
      });

      // Upload merged file to Cloudinary
      const uploadRes = await cloudinary.uploader.upload(mergedOutPath, {
        resource_type: "video",
        folder: "verbatim_merged",
        public_id: `merged_${timestamp}`,
        overwrite: true,
      });

      const secureUrl = uploadRes.secure_url;
      const downloadUrl = secureUrl.replace(
        "/upload/",
        "/upload/fl_attachment/",
      );

      return res.status(200).json({
        success: true,
        message: "Clips merged successfully with full audio.",
        url: secureUrl,
        downloadUrl,
        duration: uploadRes.duration || null,
      });
    } catch (error) {
      console.error("[Clip Controller Merge Error]:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to merge video clips.",
      });
    } finally {
      tempFiles.forEach((p) => {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
      });
    }
  },
};
