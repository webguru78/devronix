import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ClipJob } from "../models/ClipJob.js";
import { deepgramService } from "./deepgramService.js";
import { gptHighlightService } from "./gptHighlightService.js";
import { ffmpegService } from "./ffmpegService.js";
import { faceDetectService } from "./faceDetectService.js";
import { translationService } from "./translationService.js";
import { generateAssSubtitles } from "../utils/assSubtitleGenerator.js";
import cloudinary from "../config/cloudinary.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "../../temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

class ClipQueueService {
  constructor() {
    this.queue = [];
    this.activeCount = 0;
    this.maxConcurrent = Math.max(1, Number(process.env.CLIP_CONCURRENCY) || 2);
  }

  /**
   * Adds a job to the queue and starts processing if a worker slot is free.
   * Concurrent workers let 1k–5k users queue jobs without a single-file bottleneck.
   */
  enqueue(jobId, localVideoPath) {
    console.log(
      `[Clip Queue]: Enqueuing job ${jobId} (active ${this.activeCount}/${this.maxConcurrent}, waiting ${this.queue.length})`,
    );
    this.queue.push({ jobId, localVideoPath });
    this.processNext();
  }

  processNext() {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const { jobId, localVideoPath } = this.queue.shift();
      this.activeCount += 1;
      this.runJob(jobId, localVideoPath)
        .catch(async (err) => {
          console.error(`[Clip Queue]: Critical error on job ${jobId}:`, err);
          try {
            await ClipJob.findByIdAndUpdate(jobId, {
              status: "failed",
              error: err.message || "Failed to process auto clips job.",
              currentStep: "Job failed during video processing.",
            });
          } catch (dbErr) {
            console.error(
              "[Clip Queue]: Failed to update error status in DB:",
              dbErr,
            );
          }
        })
        .finally(() => {
          this.activeCount = Math.max(0, this.activeCount - 1);
          setImmediate(() => this.processNext());
        });
    }
  }

  /**
   * Executes the full end-to-end clip generation pipeline
   */
  async runJob(jobId, localVideoPath) {
    console.log(`[Clip Pipeline]: Starting execution for Job ID ${jobId}`);
    const job = await ClipJob.findById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in database`);
    }

    const tempFilesToClean = [];
    const baseName = `job_${jobId}_${Date.now()}`;
    const audioPath = path.join(TEMP_DIR, `${baseName}.mp3`);
    tempFilesToClean.push(audioPath);

    try {
      // 1. Probe source video duration & dimensions
      await ClipJob.findByIdAndUpdate(jobId, {
        status: "extracting_audio",
        currentStep:
          "Analyzing video & extracting high-fidelity audio stream...",
        progress: 10,
      });

      const probeInfo = await ffmpegService.probeVideo(localVideoPath);
      const totalDuration = probeInfo.duration || job.durationSeconds || 60;
      const srcWidth = probeInfo.width || 1920; // used for face-aware crop
      const srcHeight = probeInfo.height || 1080;
      console.log(
        `[Clip Pipeline]: Video probed. Duration: ${totalDuration.toFixed(1)}s, Resolution: ${srcWidth}x${srcHeight}`,
      );

      // 2. Extract speech-grade mono MP3 audio
      await ffmpegService.extractAudio(localVideoPath, audioPath);

      // 3. Transcribe audio with Deepgram Nova-3 (word-level timestamps)
      await ClipJob.findByIdAndUpdate(jobId, {
        status: "transcribing",
        currentStep:
          "Transcribing audio with Deepgram Nova-3 (word-level timestamps)...",
        progress: 25,
        durationSeconds: totalDuration,
      });

      const targetLanguage = job.language || "roman_urdu";
      const whisperResult = await deepgramService.transcribe(
        audioPath,
        targetLanguage,
      );

      let rawText = whisperResult.text || "";
      let words = whisperResult.words || [];
      const segments = whisperResult.segments || [];

      // If words array is empty but segments exist, construct words from segments
      if ((!words || words.length === 0) && segments && segments.length > 0) {
        console.log(
          "[Clip Pipeline]: Deriving word-level timestamps from segments...",
        );
        words = [];
        for (const seg of segments) {
          const segWords = (seg.text || "").trim().split(/\s+/).filter(Boolean);
          const segDur = Math.max(0.4, Number(seg.end) - Number(seg.start));
          const wDur = segDur / Math.max(1, segWords.length);
          segWords.forEach((sw, idx) => {
            words.push({
              word: sw.replace(/[.,!?:;"]/g, ""),
              rawWord: sw,
              start: parseFloat((Number(seg.start) + idx * wDur).toFixed(2)),
              end: parseFloat(
                (Number(seg.start) + (idx + 1) * wDur).toFixed(2),
              ),
            });
          });
        }
      }

      if (targetLanguage === "roman_urdu") {
        try {
          const romanWords =
            await translationService.ensureRomanUrduWords(words);
          if (romanWords && romanWords.length > 0) {
            words = romanWords;
            rawText = words.map((w) => w.rawWord || w.word).join(" ");
          }
        } catch (transErr) {
          console.warn(
            "[Translation Warning]: ensureRomanUrduWords failed, retaining original words:",
            transErr.message,
          );
        }
      }

      // Deepgram cost: Nova-3 pricing (~$0.0116/minute)
      const deepgramMinutes = parseFloat((totalDuration / 60).toFixed(2));
      const deepgramCost = parseFloat((totalDuration * 0.000193).toFixed(4)); // ~$0.0116/min

      await ClipJob.findByIdAndUpdate(jobId, {
        transcript: {
          rawText,
          language: targetLanguage,
          duration: totalDuration,
          words,
          segments,
        },
        progress: 45,
      });

      // 4. Highlight detection with AI
      await ClipJob.findByIdAndUpdate(jobId, {
        status: "detecting_highlights",
        currentStep: `AI analyzing transcript to select 3-8 viral highlights...`,
        progress: 50,
      });

      const { highlights, costMetrics } =
        await gptHighlightService.detectHighlights({
          rawText,
          segments,
          totalDuration,
        });

      const totalCost = parseFloat(
        (deepgramCost + (costMetrics.gptCost || 0)).toFixed(4),
      );

      await ClipJob.findByIdAndUpdate(jobId, {
        highlights,
        totalClipsTarget: highlights.length,
        estimatedCost: {
          whisperMinutes: deepgramMinutes,
          whisperCost: deepgramCost,
          gptPromptTokens: costMetrics.gptPromptTokens || 0,
          gptCompletionTokens: costMetrics.gptCompletionTokens || 0,
          gptCost: costMetrics.gptCost || 0,
          totalCost,
        },
        status: "generating_clips",
        currentStep: `Preparing ${highlights.length} clips with vertical 9:16 crop & burned-in captions...`,
        progress: 60,
      });

      // 5. Sequential clip cutting, vertical 9:16 reformatting, and ASS caption burning
      const completedClips = [];

      for (let i = 0; i < highlights.length; i++) {
        const highlight = highlights[i];
        const clipNumber = i + 1;
        const clipDuration = highlight.endTime - highlight.startTime;

        console.log(
          `[Clip Pipeline]: Rendering Clip ${clipNumber}/${highlights.length}: "${highlight.title}" (${clipDuration.toFixed(1)}s)`,
        );

        const clipBase = `${baseName}_clip_${clipNumber}`;
        const assPath = path.join(TEMP_DIR, `${clipBase}.ass`);
        const cleanClipOutPath = path.join(TEMP_DIR, `${clipBase}_clean.mp4`);
        const clipOutPath = path.join(TEMP_DIR, `${clipBase}.mp4`);
        tempFilesToClean.push(assPath, cleanClipOutPath, clipOutPath);

        // Update progress dynamically across clips
        const clipProgress = Math.round(60 + (i / highlights.length) * 35);
        await ClipJob.findByIdAndUpdate(jobId, {
          currentStep: `Rendering Clip ${clipNumber}/${highlights.length}: "${highlight.title}"...`,
          progress: clipProgress,
        });

        // 1) Framing & Face/Subject Detection
        const framingMode = job.framingMode || "center_crop";
        let effectiveFramingMode = framingMode;
        let clipCropX = null;
        let clipCropX1 = null;
        let clipCropX2 = null;

        if (framingMode === "split_screen") {
          // Podcast Dual Stacked Panels (Speaker A top, Speaker B bottom)
          try {
            const subjectInfo =
              await faceDetectService.detectMultipleSubjectRegions(
                localVideoPath,
                highlight.startTime,
                clipDuration,
                srcWidth,
                srcHeight,
                6,
              );

            // Verify if two distinct separated subjects were truly found
            const minSeparation = Math.round((srcWidth || 1920) * 0.08); // at least ~150px
            const isSeparated =
              typeof subjectInfo.cropX1 === "number" &&
              typeof subjectInfo.cropX2 === "number" &&
              Math.abs(subjectInfo.cropX1 - subjectInfo.cropX2) >=
                minSeparation;

            if (
              subjectInfo.isSplit &&
              subjectInfo.subjectsCount >= 2 &&
              isSeparated
            ) {
              clipCropX1 = subjectInfo.cropX1;
              clipCropX2 = subjectInfo.cropX2;
              console.log(
                `[Clip Pipeline]: Clip ${clipNumber} — dual distinct subjects detected: cropX1=${clipCropX1}, cropX2=${clipCropX2}. Rendering split-screen.`,
              );
            } else {
              // ONLY 1 SPEAKER in this camera shot (solo cut, monologue, or slide).
              // Auto-switch to full vertical 9:16 center_crop to prevent repeating the same face/frame twice!
              effectiveFramingMode = "center_crop";
              clipCropX =
                subjectInfo.singleCropX ??
                Math.round(
                  Math.max(
                    0,
                    Math.round(srcWidth * (1920 / (srcHeight || 1080))) - 1080,
                  ) / 2,
                );
              console.log(
                `[Clip Pipeline]: Clip ${clipNumber} — single speaker/subject detected. Auto-switching to center_crop (cropX=${clipCropX}) to prevent duplicate identical stacked frames.`,
              );
            }
          } catch (faceErr) {
            console.warn(
              `[Clip Pipeline]: Dual-subject detection fallback for clip ${clipNumber}: ${faceErr.message}`,
            );
            effectiveFramingMode = "center_crop";
            const scaledWidth1920 = Math.round(
              srcWidth * (1920 / (srcHeight || 1080)),
            );
            clipCropX = Math.round(Math.max(0, scaledWidth1920 - 1080) / 2);
          }
        } else if (framingMode === "center_crop") {
          // Proper 9:16 TikTok / Reels full vertical frame with AI speaker centering
          try {
            clipCropX = await faceDetectService.getCropX(
              localVideoPath,
              highlight.startTime,
              clipDuration,
              srcWidth,
              srcHeight,
              4,
            );
            console.log(
              `[Clip Pipeline]: Clip ${clipNumber} — 9:16 TikTok smart cropX=${clipCropX}`,
            );
          } catch (faceErr) {
            console.warn(
              `[Clip Pipeline]: 9:16 smart crop fallback for clip ${clipNumber}: ${faceErr.message}`,
            );
            const scaledWidth1920 = Math.round(
              srcWidth * (1920 / (srcHeight || 1080)),
            );
            clipCropX = Math.round(Math.max(0, scaledWidth1920 - 1080) / 2);
          }
        }

        // 2) Render clean 9:16 vertical crop WITHOUT subtitles
        await ffmpegService.cutAndReformatClip({
          inputPath: localVideoPath,
          outputPath: cleanClipOutPath,
          startTime: highlight.startTime,
          duration: clipDuration,
          assSubtitlePath: null,
          framingMode: effectiveFramingMode,
          cropX: clipCropX,
          cropX1: clipCropX1,
          cropX2: clipCropX2,
        });

        // 2) Generate ASS subtitle script with chosen template
        const templateId = job.templateId || "hormozi_gold_impact";
        const assContent = generateAssSubtitles(
          words,
          highlight.startTime,
          highlight.endTime,
          templateId,
        );
        fs.writeFileSync(assPath, assContent, "utf8");

        // 3) Rapidly burn subtitles onto the clean 9:16 clip (takes 1-2s)
        await ffmpegService.burnSubtitlesOntoCleanClip({
          inputClipPath: cleanClipOutPath,
          outputPath: clipOutPath,
          assSubtitlePath: assPath,
        });

        // Upload both clean and burned clips to Cloudinary
        console.log(
          `[Clip Pipeline]: Uploading Clip ${clipNumber} (clean & burned) to Cloudinary...`,
        );
        const [cleanUploadRes, uploadRes] = await Promise.all([
          cloudinary.uploader.upload(cleanClipOutPath, {
            resource_type: "video",
            folder: "verbatim_clips_clean",
            public_id: `clip_clean_${jobId}_${clipNumber}_${Date.now()}`,
            overwrite: true,
          }),
          cloudinary.uploader.upload(clipOutPath, {
            resource_type: "video",
            folder: "verbatim_clips",
            public_id: `clip_${jobId}_${clipNumber}_${Date.now()}`,
            overwrite: true,
          }),
        ]);

        // Compute word chunk captions for this specific clip
        const clipCaptions = formatClipCaptions(
          words,
          highlight.startTime,
          highlight.endTime,
          templateId,
        );

        completedClips.push({
          url: uploadRes.secure_url,
          cleanUrl: cleanUploadRes.secure_url,
          publicId: uploadRes.public_id,
          title: highlight.title,
          reason: highlight.reason,
          duration: Math.round(clipDuration),
          startTime: highlight.startTime,
          endTime: highlight.endTime,
          thumbnailUrl: uploadRes.secure_url.replace(/\.[^/.]+$/, ".jpg"),
          captions: clipCaptions,
        });

        await ClipJob.findByIdAndUpdate(jobId, {
          clips: completedClips,
          completedClipsCount: completedClips.length,
        });
      }

      // 6. Complete job
      console.log(
        `[Clip Pipeline]: Successfully generated ${completedClips.length} clips for Job ${jobId}`,
      );
      await ClipJob.findByIdAndUpdate(jobId, {
        status: "complete",
        currentStep: "All clips generated and ready to download!",
        progress: 100,
        clips: completedClips,
      });
    } catch (err) {
      console.error(`[Clip Pipeline Error] on Job ${jobId}:`, err);
      await ClipJob.findByIdAndUpdate(jobId, {
        status: "failed",
        error: err.message || "Clip generation pipeline encountered an error.",
        currentStep: "Failed to generate clips.",
      });
      throw err;
    } finally {
      // 7. Cleanup temp files safely
      for (const tempPath of tempFilesToClean) {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch (_) {}
      }
      // Also clean up local source video if stored in temp dir
      if (localVideoPath.includes(TEMP_DIR)) {
        try {
          if (fs.existsSync(localVideoPath)) {
            fs.unlinkSync(localVideoPath);
          }
        } catch (_) {}
      }
    }
  }
}

export const clipQueueService = new ClipQueueService();

/**
 * Groups word timestamps for a specific clip into punchy 2-3 word chunks
 */
function formatClipCaptions(
  allWords = [],
  clipStartTime = 0,
  clipEndTime = 60,
  templateId = "hormozi_gold_impact",
) {
  const clipWords = (allWords || [])
    .filter((w) => {
      const s = Number(w.start);
      const e = Number(w.end);
      return !isNaN(s) && !isNaN(e) && e >= clipStartTime && s <= clipEndTime;
    })
    .map((w) => {
      const cleanWord = (w.word || w.rawWord || "")
        .trim()
        .replace(/[.,!?:;"]/g, "");
      const rawWord = (w.word || w.rawWord || "").trim();
      return {
        word: cleanWord,
        rawWord: rawWord,
        start: parseFloat(
          Math.max(0, Number(w.start) - clipStartTime).toFixed(2),
        ),
        end: parseFloat(
          Math.max(0.1, Number(w.end) - clipStartTime).toFixed(2),
        ),
      };
    })
    .filter((w) => w.word.length > 0);

  const isSingle =
    typeof templateId === "string" && templateId.includes("single");
  const isSentence =
    typeof templateId === "string" && templateId.includes("sentence");
  const CHUNK_SIZE = isSingle ? 1 : isSentence ? 8 : 3;
  const result = [];

  for (let i = 0; i < clipWords.length; i += CHUNK_SIZE) {
    const chunk = clipWords.slice(i, i + CHUNK_SIZE);
    const chunkText = chunk.map((w) => w.rawWord || w.word).join(" ");
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    const cleanList = chunk.map((w) => w.word).filter(Boolean);
    const longest =
      cleanList.length > 0
        ? cleanList.reduce((a, b) => (a.length >= b.length ? a : b))
        : chunk[0].word;

    result.push({
      id: result.length + 1,
      start: start,
      end: Math.max(end, start + 0.35),
      text: chunkText,
      highlightWord: longest,
      words: chunk,
    });
  }

  return result;
}
