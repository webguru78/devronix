import { spawn, execSync } from "child_process";
import path from "path";
import fs, { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import { Innertube, Log } from "youtubei.js";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// YouTube.js ke internal warnings/logs ko suppress karein
Log.setLevel(Log.Level.NONE);

const FFMPEG_BINARY_PATH = ffmpegInstaller.path;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YT_DLP_PLAYER_CLIENTS = "android,ios";

// Shared Innertube instance (lazy initialized)
let _innertubeInstance = null;
async function getInnertube(retrievePlayer = false) {
  if (!_innertubeInstance) {
    _innertubeInstance = await Innertube.create({
      retrieve_player: retrievePlayer,
    });
  }
  return _innertubeInstance;
}

/**
 * Dynamically resolves yt-dlp binary across Linux / Windows / system PATH
 */
function resolveYtDlpPath() {
  const candidates = [
    process.env.YT_DLP_PATH,
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    path.join(__dirname, "../../bin/yt-dlp"),
    path.join(__dirname, "../../bin/yt-dlp.exe"),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  try {
    const cmd = process.platform === "win32" ? "where yt-dlp" : "which yt-dlp";
    const out = execSync(cmd, {
      stdio: ["pipe", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (out) return out.split("\n")[0].trim();
  } catch (_) {}

  return null;
}

/**
 * Builds anti-detection args for yt-dlp
 */
function buildAntiDetectionArgs() {
  const args = [
    "--extractor-args",
    `youtube:player_client=${YT_DLP_PLAYER_CLIENTS}`,
  ];

  const cookiesPath = process.env.YT_COOKIES_PATH || null;
  if (cookiesPath && fs.existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
    console.log(`[YouTube Service]: Using cookies file: ${cookiesPath}`);
  } else if (cookiesPath) {
    console.warn(
      `[YouTube Service]: YT_COOKIES_PATH is set (${cookiesPath}) but file not found on disk.`,
    );
  } else {
    console.warn(
      `[YouTube Service]: YT_COOKIES_PATH not set — yt-dlp running without cookies.`,
    );
  }
  return args;
}

/**
 * Extracts the YouTube video ID from a URL.
 */
function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("v") ||
      (parsed.hostname === "youtu.be" ? parsed.pathname.slice(1) : null)
    );
  } catch {
    return null;
  }
}

export const youtubeService = {
  /**
   * Fetches video metadata
   */
  async getVideoInfo(url) {
    if (!url || typeof url !== "string") {
      throw new Error("Invalid YouTube URL provided.");
    }

    const videoId = extractVideoId(url);

    // ── Strategy 1: youtubei.js (Innertube) ──
    try {
      const yt = await getInnertube(false);
      const info = await yt.getBasicInfo(videoId || url);
      const basic = info.basic_info || {};

      const thumbnails = basic.thumbnail || [];
      const bestThumb =
        thumbnails.length > 0
          ? thumbnails[0]?.url
          : videoId
            ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            : "";

      const duration = Math.round(Number(basic.duration) || 0);
      const title = basic.title || "YouTube Video";
      const channel = basic.author || basic.channel?.name || "YouTube Creator";

      console.log(
        `[YouTube Service]: Innertube success — "${title}", duration: ${duration}s`,
      );

      return {
        id: videoId || basic.id || "",
        title,
        duration,
        thumbnail: bestThumb,
        channel,
      };
    } catch (innertubeErr) {
      console.warn(
        `[YouTube Service]: Innertube getVideoInfo failed (${innertubeErr.message}), trying yt-dlp...`,
      );
    }

    // ── Strategy 2: yt-dlp binary ──
    const ytDlpPath = resolveYtDlpPath();
    if (ytDlpPath) {
      try {
        return await new Promise((resolve, reject) => {
          const child = spawn(ytDlpPath, [
            "--dump-json",
            "--no-playlist",
            "--no-warnings",
            "--socket-timeout",
            "20",
            ...buildAntiDetectionArgs(),
            url,
          ]);
          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
          child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

          child.on("close", (code) => {
            if (code !== 0) {
              return reject(
                new Error(
                  `yt-dlp failed (${code}): ${stderr.trim() || "Metadata fetch error"}`,
                ),
              );
            }
            try {
              const info = JSON.parse(stdout);
              resolve({
                id: info.id,
                title: info.title || "YouTube Video",
                duration: Math.round(Number(info.duration) || 0),
                thumbnail:
                  info.thumbnail ||
                  (info.thumbnails && info.thumbnails[0]?.url) ||
                  (videoId
                    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
                    : ""),
                channel: info.uploader || info.channel || "YouTube Creator",
              });
            } catch (jsonErr) {
              reject(jsonErr);
            }
          });

          child.on("error", (err) => reject(err));
          setTimeout(() => {
            try {
              child.kill();
            } catch (_) {}
            reject(new Error("yt-dlp timeout"));
          }, 30000);
        });
      } catch (ytDlpErr) {
        console.warn(
          `[YouTube Service]: yt-dlp failed (${ytDlpErr.message}), trying oEmbed...`,
        );
      }
    }

    // ── Strategy 3: oEmbed ──
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const resp = await fetch(oembedUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const thumbnail = videoId
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : data.thumbnail_url || "";

        console.log(
          `[YouTube Service]: oEmbed fallback — "${data.title}" (duration unknown)`,
        );

        return {
          id: videoId || "",
          title: data.title || "YouTube Video",
          duration: 0,
          thumbnail,
          channel: data.author_name || "YouTube Creator",
        };
      }
    } catch (oembedErr) {
      console.warn(
        `[YouTube Service]: oEmbed also failed (${oembedErr.message})`,
      );
    }

    throw new Error(
      "Failed to fetch YouTube video information. Make sure the video is public and accessible.",
    );
  },

  /**
   * Downloads a YouTube video
   */
  async downloadVideo(url, outputPath) {
    const videoId = extractVideoId(url);

    // ── Strategy 1: yt-dlp binary with FFmpeg ──
    const ytDlpPath = resolveYtDlpPath();
    if (ytDlpPath) {
      try {
        console.log(
          `[YouTube Service]: Downloading with yt-dlp (${ytDlpPath}) -> ${outputPath}`,
        );
        await new Promise((resolve, reject) => {
          const formatSelection =
            "bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720][ext=mp4]/b[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";

          const args = [
            "--ffmpeg-location",
            FFMPEG_BINARY_PATH,
            "-f",
            formatSelection,
            "--merge-output-format",
            "mp4",
            "--no-playlist",
            "--no-warnings",
            "--socket-timeout",
            "30",
            "--retries",
            "3",
            "--fragment-retries",
            "3",
            "--extractor-retries",
            "3",
            ...buildAntiDetectionArgs(),
            "-o",
            outputPath,
            url,
          ];

          const child = spawn(ytDlpPath, args);
          let stderr = "";
          let stdout = "";

          child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            const line = chunk.toString().trim();
            if (line) console.log(`[yt-dlp]: ${line}`);
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });

          child.on("close", (code) => {
            if (
              code === 0 &&
              fs.existsSync(outputPath) &&
              fs.statSync(outputPath).size > 1024
            ) {
              console.log(
                `[YouTube Service]: yt-dlp download complete: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB`,
              );
              resolve(outputPath);
            } else {
              reject(
                new Error(
                  `yt-dlp exited with code ${code}: ${stderr.trim() || stdout.trim() || "Unknown error"}`,
                ),
              );
            }
          });

          child.on("error", (err) => reject(err));
        });

        return outputPath;
      } catch (ytDlpErr) {
        console.warn(
          `[YouTube Service]: yt-dlp download failed (${ytDlpErr.message}). Trying Innertube fallback...`,
        );
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (_) {}
      }
    }

    // ── Strategy 2: youtubei.js muxed MP4 ──
    try {
      console.log(
        `[YouTube Service]: Attempting Innertube muxed download for ${videoId || url}...`,
      );

      const yt = await getInnertube(true);
      const info = await yt.getBasicInfo(videoId || url);

      const streamingData = info.streaming_data;
      if (!streamingData) {
        throw new Error("No streaming data returned from Innertube");
      }

      const muxedFormats = (streamingData.formats || []).filter(
        (f) => f.mime_type?.includes("video/mp4") && f.url,
      );

      if (muxedFormats.length > 0) {
        const best = muxedFormats.reduce((prev, cur) =>
          (cur.height || 0) > (prev.height || 0) ? cur : prev,
        );

        console.log(
          `[YouTube Service]: Downloading muxed mp4 (${best.quality_label || best.quality}, ${best.width}x${best.height})...`,
        );

        await this._downloadUrl(best.url, outputPath);

        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
          console.log(
            `[YouTube Service]: Innertube muxed download complete: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB`,
          );
          return outputPath;
        }
        throw new Error("Downloaded file is empty or too small");
      }

      throw new Error("No muxed mp4 formats with direct URL found");
    } catch (innertubeErr) {
      console.warn(
        `[YouTube Service]: Innertube fallback also failed (${innertubeErr.message}).`,
      );
    }

    throw new Error(
      "Failed to download YouTube video. The video may be private, age-restricted, or unavailable. Make sure the video is public and accessible.",
    );
  },

  /**
   * Safe stream downloader
   */
  async _downloadUrl(directUrl, outputPath) {
    const resp = await fetch(directUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.youtube.com/",
      },
      signal: AbortSignal.timeout(300000), // 5 mins
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }

    const nodeStream = Readable.fromWeb(resp.body);
    const fileStream = createWriteStream(outputPath);
    await pipeline(nodeStream, fileStream);
  },
};
