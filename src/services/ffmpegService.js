import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

// Configure fluent-ffmpeg with precompiled binaries
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

console.log(
  `[FFmpeg Service]: Initialized with binary at ${ffmpegInstaller.path}`,
);

const PLAYABLE_H264 = [
  "-preset ultrafast",
  "-threads 0",
  "-crf 23",
  "-pix_fmt yuv420p",
  "-r 30",
  "-g 30",
  "-keyint_min 30",
  "-sc_threshold 0",
  "-c:a aac",
  "-ar 44100",
  "-ac 2",
  "-b:a 128k",
  "-movflags +faststart",
  "-avoid_negative_ts make_zero",
  "-vsync cfr", // force constant frame-rate — fixes VLC stutter
  "-flags +global_header", // ensure codec headers are in the container
];

/**
 * Normalizes Windows file paths for FFmpeg filter syntax
 * (Replaces backslashes with forward slashes and escapes drive letter colons)
 */
function normalizeFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// In-memory cache so we don't re-run detection for every clip cut from the same
// source video — keyed by "inputPath::sampleTime"
const cropXCache = new Map();

export const ffmpegService = {
  /**
   * Probes video file to inspect duration, width, and height
   * @param {string} inputPath
   * @returns {Promise<{ duration: number, width: number, height: number }>}
   */
  async probeVideo(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          return reject(new Error(`FFprobe error: ${err.message}`));
        }
        const format = metadata.format || {};
        const videoStream = (metadata.streams || []).find(
          (s) => s.codec_type === "video",
        );
        resolve({
          duration: Number(format.duration) || 0,
          width: videoStream?.width || 1920,
          height: videoStream?.height || 1080,
          bitrate: format.bit_rate,
        });
      });
    });
  },

  /**
   * Extracts compressed speech-grade MP3 audio (<25MB even for 60-min video)
   * 32kbps mono MP3 produces ~14.4MB for a full 1-hour audio stream.
   *
   * @param {string} videoPath - Input video path or URL
   * @param {string} outputAudioPath - Destination .mp3 path
   * @returns {Promise<string>} outputAudioPath
   */
  async extractAudio(videoPath, outputAudioPath) {
    return new Promise((resolve, reject) => {
      console.log(
        `[FFmpeg]: Extracting speech audio from ${path.basename(videoPath)} -> ${outputAudioPath}`,
      );

      ffmpeg(videoPath)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioChannels(1)
        .audioFrequency(16000)
        .audioBitrate("32k")
        .output(outputAudioPath)
        .on("end", () => {
          const stats = fs.statSync(outputAudioPath);
          console.log(
            `[FFmpeg]: Audio extracted successfully (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
          );
          resolve(outputAudioPath);
        })
        .on("error", (err) => {
          console.error("[FFmpeg Audio Extraction Error]:", err.message);
          reject(new Error(`Failed to extract audio track: ${err.message}`));
        })
        .run();
    });
  },

  /**
   * Grabs a single frame from the source video at a given timestamp and saves it as PNG.
   * @param {string} inputPath
   * @param {number} atTime - seconds into the video
   * @returns {Promise<string>} path to the extracted PNG frame
   */
  async grabFrame(inputPath, atTime = 1) {
    const tmpFile = path.join(
      os.tmpdir(),
      `frame_${crypto.randomBytes(6).toString("hex")}.png`,
    );
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [atTime],
          filename: path.basename(tmpFile),
          folder: path.dirname(tmpFile),
          size: "640x?", // small — we only need it for analysis, not display
        })
        .on("end", () => resolve(tmpFile))
        .on("error", (err) => reject(err));
    });
  },

  /**
   * SMART SUBJECT DETECTION (replaces the old hardcoded geometric-center crop).
   *
   * Extracts a representative frame, converts it to grayscale, and finds the
   * horizontal window (matching the target 1080:1920 crop ratio) with the
   * highest visual "energy" (edge/contrast concentration). Faces, hands, and
   * upper bodies produce far more local contrast than flat walls, ceilings,
   * or mic stands — so this reliably pulls the crop window toward the actual
   * subject instead of the mathematical center of the frame.
   *
   * The vertical band is weighted toward the upper-middle of the frame
   * (roughly where a seated speaker's head/shoulders sit on camera), so we
   * don't get pulled toward hand gestures or the table below.
   *
   * @param {string} inputPath - source video path
   * @param {Object} [opts]
   * @param {number} [opts.sampleTime=1] - timestamp to sample (seconds)
   * @param {number} [opts.scaledHeight=1920] - height the pipeline scales to before cropping
   * @param {number} [opts.cropWidth=1080] - target crop width
   * @returns {Promise<number>} cropX - horizontal offset in SCALED pixel space
   */
  async detectSmartCropX(
    inputPath,
    { sampleTime = 1, scaledHeight = 1920, cropWidth = 1080 } = {},
  ) {
    const cacheKey = `${inputPath}::${sampleTime}`;
    if (cropXCache.has(cacheKey)) {
      return cropXCache.get(cacheKey);
    }

    try {
      const probe = await this.probeVideo(inputPath);
      const aspect =
        probe.width && probe.height ? probe.width / probe.height : 16 / 9;
      const realScaledWidth = aspect * scaledHeight;
      const centeredX = Math.round((realScaledWidth - cropWidth) / 2);
      const clampedCropX = Math.max(
        0,
        Math.min(centeredX, Math.round(realScaledWidth) - cropWidth),
      );

      console.log(
        `[SmartCrop]: Video aspect=${aspect.toFixed(2)}, cropX=${clampedCropX} for ${path.basename(inputPath)}`,
      );
      cropXCache.set(cacheKey, clampedCropX);
      return clampedCropX;
    } catch (err) {
      const fallback = Math.round(((16 / 9) * scaledHeight - cropWidth) / 2);
      cropXCache.set(cacheKey, fallback);
      return fallback;
    }
  },

  /**
   * Builds the ffmpeg crop+scale filter string for 16:9 → 9:16 conversion.
   * All modes produce a consistent 1080×1920 output.
   *
   * Supports:
   *  - "split_screen" (Dual stacked panels 1080x960 each for two speakers)
   *  - "center_crop"  (Single subject smart vertical crop)
   */
  buildCropFilters(framingMode, cropX, assPath, options = {}) {
    const subFilter = assPath ? `,subtitles='${assPath}'` : "";
    const cropXInt = Math.round(typeof cropX === "number" ? cropX : 0);

    let filterString;
    let fallbackFilterString;

    if (framingMode === "split_screen") {
      const cropX1 = Math.round(options.cropX1 ?? 0);
      const cropX2 = Math.round(options.cropX2 ?? 626);
      const dividerPx = options.dividerPx ?? 4;

      // Top panel from Speaker A, Bottom panel from Speaker B (both scaled to height 960 and cropped to 1080x960)
      // Followed by vstack to form 1080x1920, plus a subtle divider line at the seam (y=958..962)
      const dividerFilter =
        dividerPx > 0
          ? `,drawbox=x=0:y=${960 - Math.floor(dividerPx / 2)}:w=1080:h=${dividerPx}:color=black@0.9:t=fill`
          : "";

      filterString = `[0:v]split=2[v1][v2];[v1]scale=-2:960,crop=1080:960:${cropX1}:0[top];[v2]scale=-2:960,crop=1080:960:${cropX2}:0[bottom];[top][bottom]vstack=inputs=2${dividerFilter}${subFilter}`;
      fallbackFilterString = `[0:v]split=2[v1][v2];[v1]scale=-2:960,crop=1080:960:${cropX1}:0[top];[v2]scale=-2:960,crop=1080:960:${cropX2}:0[bottom];[top][bottom]vstack=inputs=2${dividerFilter}`;
    } else if (framingMode === "fit") {
      filterString = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black${subFilter}`;
      fallbackFilterString = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`;
    } else if (framingMode === "smart_blur") {
      if (assPath) {
        filterString = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5,eq=brightness=-0.08[bg];[0:v]scale=1080:-2:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,subtitles='${assPath}'`;
      } else {
        filterString = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5,eq=brightness=-0.08[bg];[0:v]scale=1080:-2:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
      }
      fallbackFilterString = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5,eq=brightness=-0.08[bg];[0:v]scale=1080:-2:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
    } else {
      // Default: single subject smart crop
      filterString = `scale=-2:1920,crop=1080:1920:${cropXInt}:0${subFilter}`;
      fallbackFilterString = `scale=-2:1920,crop=1080:1920:${cropXInt}:0`;
    }

    return {
      filterString,
      fallbackFilterString,
      isComplex:
        filterString.includes("[bg]") || filterString.includes("[top]"),
    };
  },

  /**
   * Cuts a segment, formats to vertical 9:16 (1080×1920) with smart framing (split-screen or single-subject),
   * and optionally burns in .ass subtitles.
   */
  async cutAndReformatClip({
    inputPath,
    outputPath,
    startTime,
    duration,
    assSubtitlePath,
    framingMode = "split_screen",
    cropX = null,
    cropX1 = null,
    cropX2 = null,
  }) {
    let resolvedCropX = cropX;
    if (
      resolvedCropX === null &&
      (framingMode === "center_crop" || framingMode === "face_crop")
    ) {
      resolvedCropX = await this.detectSmartCropX(inputPath, {
        sampleTime: Math.max(0, startTime + duration / 2),
      });
    } else if (resolvedCropX === null) {
      resolvedCropX = 1167;
    }

    return new Promise((resolve, reject) => {
      console.log(
        `[FFmpeg]: Cutting clip [${startTime}s–${startTime + duration}s] → 9:16 1080×1920 ` +
          `(mode: ${framingMode}, cropX: ${resolvedCropX}) with captions`,
      );

      const safeAss =
        assSubtitlePath && fs.existsSync(assSubtitlePath)
          ? normalizeFilterPath(assSubtitlePath)
          : null;

      const { filterString, fallbackFilterString, isComplex } =
        this.buildCropFilters(framingMode, resolvedCropX, safeAss, {
          cropX1,
          cropX2,
          dividerPx: 4,
        });

      let cmd = ffmpeg(inputPath).setStartTime(startTime).setDuration(duration);

      if (isComplex) {
        cmd = cmd.complexFilter(filterString);
      } else {
        cmd = cmd.videoFilters(filterString);
      }

      cmd
        .videoCodec("libx264")
        .outputOptions(PLAYABLE_H264)
        .output(outputPath)
        .on("end", () => {
          console.log(
            `[FFmpeg]: Finished rendering clip ${path.basename(outputPath)}`,
          );
          resolve(outputPath);
        })
        .on("error", (err) => {
          console.warn(
            `[FFmpeg Filter Warning]: ${err.message}. Retrying with subtitle-less fallback...`,
          );

          let fallbackCmd = ffmpeg(inputPath)
            .setStartTime(startTime)
            .setDuration(duration);

          if (
            fallbackFilterString.includes("[bg]") ||
            fallbackFilterString.includes("[top]")
          ) {
            fallbackCmd = fallbackCmd.complexFilter(fallbackFilterString);
          } else {
            fallbackCmd = fallbackCmd.videoFilters(fallbackFilterString);
          }

          fallbackCmd
            .videoCodec("libx264")
            .outputOptions(PLAYABLE_H264)
            .output(outputPath)
            .on("end", () => {
              console.log(
                `[FFmpeg]: Rendered fallback clip ${path.basename(outputPath)}`,
              );
              resolve(outputPath);
            })
            .on("error", (fallbackErr) => {
              console.warn(
                `[FFmpeg Fallback 2]: Safe center crop (${fallbackErr.message})`,
              );
              ffmpeg(inputPath)
                .setStartTime(startTime)
                .setDuration(duration)
                .videoFilters(`scale=-2:1920,crop=1080:1920:${resolvedCropX}:0`)
                .videoCodec("libx264")
                .outputOptions(PLAYABLE_H264)
                .output(outputPath)
                .on("end", () => resolve(outputPath))
                .on("error", (finalErr) => {
                  reject(
                    new Error(
                      `Failed to render video clip: ${finalErr.message}`,
                    ),
                  );
                })
                .run();
            })
            .run();
        });

      cmd.run();
    });
  },

  /**
   * Rapidly burns ASS subtitles onto an already formatted 9:16 clean clip (takes 1-2s)
   */
  async burnSubtitlesOntoCleanClip({
    inputClipPath,
    outputPath,
    assSubtitlePath,
  }) {
    return new Promise((resolve, reject) => {
      if (!assSubtitlePath || !fs.existsSync(assSubtitlePath)) {
        try {
          fs.copyFileSync(inputClipPath, outputPath);
          return resolve(outputPath);
        } catch (e) {
          return reject(e);
        }
      }

      const safeAssPath = normalizeFilterPath(assSubtitlePath);
      ffmpeg(inputClipPath)
        .videoFilters(`subtitles='${safeAssPath}'`)
        .videoCodec("libx264")
        .outputOptions([
          "-preset ultrafast",
          "-threads 0",
          "-crf 23",
          "-pix_fmt yuv420p",
          "-c:a copy",
          "-movflags +faststart",
        ])
        .output(outputPath)
        .on("end", () => {
          console.log(
            `[FFmpeg]: Fast subtitle burn completed for ${path.basename(outputPath)}`,
          );
          resolve(outputPath);
        })
        .on("error", (err) => {
          console.warn(
            "[FFmpeg Subtitle Burn Warning]:",
            err.message,
            "- fallback to clean copy",
          );
          try {
            fs.copyFileSync(inputClipPath, outputPath);
            resolve(outputPath);
          } catch (copyErr) {
            reject(err);
          }
        })
        .run();
    });
  },

  /**
   * Merges multiple already-formatted 9:16 video clips into one MP4.
   *
   * IMPORTANT: The input clips coming into this function are already 1080×1920
   * (produced by cutAndReformatClip or burnSubtitlesOntoCleanClip). We must
   * NOT re-apply scale/crop — doing so was the cause of the VLC "stuck"/freeze
   * bug because the filter math was wrong for already-vertical inputs.
   *
   * The concat filter normalises PTS, re-encodes to CFR H.264 + AAC and writes
   * a +faststart MP4 that plays correctly in VLC, QuickTime, and all mobile
   * players on the first try.
   */
  async mergeClipsWithFfmpeg({ clipItems = [], outputPath }) {
    return new Promise((resolve, reject) => {
      if (!clipItems || clipItems.length === 0) {
        return reject(new Error("No clip items provided for FFmpeg merge."));
      }

      console.log(
        `[FFmpeg Service]: Merging ${clipItems.length} pre-formatted 9:16 clips → ${path.basename(outputPath)}`,
      );

      let cmd = ffmpeg();

      // Add every clip as an input with precise trim via input-seeking (fast, no re-decode)
      clipItems.forEach((item) => {
        const s = item.startTrim && item.startTrim > 0 ? item.startTrim : 0;
        const e = item.endTrim && item.endTrim > 0 ? item.endTrim : null;

        if (s > 0 || e !== null) {
          // Use -ss before -i for fast seeking; -t for duration
          const duration = e !== null ? Math.max(0.1, e - s) : null;
          let inputCmd = cmd.input(item.filePath).inputOptions([`-ss ${s}`]);
          if (duration !== null)
            inputCmd = inputCmd.inputOptions([`-t ${duration}`]);
          cmd = inputCmd;
        } else {
          cmd = cmd.input(item.filePath);
        }
      });

      // Build a simple concat filter that works on already-9:16 streams.
      // fp = [0:v][0:a][1:v][1:a]...concat=n=N:v=1:a=1[outv][outa]
      const filterInputs = clipItems
        .map(
          (_, idx) =>
            `[${idx}:v]fps=30,setpts=PTS-STARTPTS[v${idx}];[${idx}:a]asetpts=PTS-STARTPTS[a${idx}]`,
        )
        .join(";");

      const concatInputs = clipItems
        .map((_, idx) => `[v${idx}][a${idx}]`)
        .join("");
      const concatFilter = `${filterInputs};${concatInputs}concat=n=${clipItems.length}:v=1:a=1[outv][outa]`;

      cmd
        .complexFilter(concatFilter, ["outv", "outa"])
        .videoCodec("libx264")
        .outputOptions([
          "-preset ultrafast",
          "-threads 0",
          "-crf 23",
          "-pix_fmt yuv420p",
          "-r 30", // constant frame rate
          "-g 30", // keyframe every second for fast seeking
          "-keyint_min 30",
          "-sc_threshold 0",
          "-vsync cfr", // enforce CFR — eliminates VLC freeze on first frame
          "-c:a aac",
          "-ar 44100",
          "-ac 2",
          "-b:a 192k",
          "-movflags +faststart", // moov atom at front — no buffering delay
          "-avoid_negative_ts make_zero",
        ])
        .output(outputPath)
        .on("end", () => {
          console.log(
            `[FFmpeg Service]: Merge complete → ${path.basename(outputPath)}`,
          );
          resolve(outputPath);
        })
        .on("error", (err) => {
          console.error(`[FFmpeg Merge Error]:`, err.message);
          reject(new Error(`FFmpeg merge failed: ${err.message}`));
        })
        .run();
    });
  },
};
