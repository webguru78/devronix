import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YT_DLP_PATH = path.join(__dirname, "../../bin/yt-dlp.exe");
const FFMPEG_PATH = ffmpegInstaller.path;

export const youtubeService = {
  /**
   * Fetches video metadata (title, duration, etc.) using yt-dlp.
   * @param {string} url - Valid YouTube URL
   * @returns {Promise<{ title: string, duration: number, id: string }>}
   */
  async getVideoInfo(url) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(YT_DLP_PATH)) {
        return reject(new Error("yt-dlp binary not found on server"));
      }

      const args = [
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        url,
      ];

      const child = spawn(YT_DLP_PATH, args);
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          return reject(
            new Error(`yt-dlp exited with code ${code}: ${stderr.trim() || "Failed to fetch video info"}`)
          );
        }

        try {
          const info = JSON.parse(stdout);
          resolve({
            id: info.id,
            title: info.title || "YouTube Video",
            duration: Math.round(Number(info.duration) || 0),
            thumbnail: info.thumbnail,
            channel: info.uploader || info.channel,
          });
        } catch (err) {
          reject(new Error(`Failed to parse yt-dlp metadata JSON: ${err.message}`));
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
      });
    });
  },

  /**
   * Downloads a YouTube video in 720p/1080p MP4 format with audio merged.
   * @param {string} url - YouTube URL
   * @param {string} outputPath - Local file path where .mp4 will be saved
   * @returns {Promise<void>}
   */
  async downloadVideo(url, outputPath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(YT_DLP_PATH)) {
        return reject(new Error("yt-dlp binary not found on server"));
      }

      // Select best video up to 720p/1080p and best audio, cleanly merged into MP4
      const formatSelection =
        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720][ext=mp4]/b[ext=mp4]/best";

      const args = [
        "--ffmpeg-location",
        FFMPEG_PATH,
        "-f",
        formatSelection,
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "--no-warnings",
        "-o",
        outputPath,
        url,
      ];

      console.log(`[YouTube Service]: Downloading via yt-dlp -> ${outputPath}`);
      const child = spawn(YT_DLP_PATH, args);

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          console.log(`[YouTube Service]: Download complete: ${outputPath}`);
          resolve();
        } else {
          reject(
            new Error(`yt-dlp download failed with code ${code}: ${stderr.trim() || "Unknown download error"}`)
          );
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
      });
    });
  },
};
