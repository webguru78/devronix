import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

dotenv.config();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "../../temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

// Whisper hard limits
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24 MB safe margin under 25 MB limit
const CHUNK_DURATION_SECONDS = 600; // 10-minute chunks
const WHISPER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per request
const MAX_RETRIES = 3;

/** Sleep helper for retry backoff */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits an MP3 file into N chunks of CHUNK_DURATION_SECONDS each.
 * Returns an array of { filePath, offsetSeconds, duration } objects.
 */
async function splitAudioIntoChunks(audioPath, totalDurationSec) {
  const numChunks = Math.ceil(totalDurationSec / CHUNK_DURATION_SECONDS);
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_DURATION_SECONDS;
    const duration = Math.min(CHUNK_DURATION_SECONDS, totalDurationSec - start);
    const chunkPath = path.join(
      TEMP_DIR,
      `whisper_chunk_${Date.now()}_${i}.mp3`,
    );

    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .setStartTime(start)
        .setDuration(duration)
        .audioCodec("libmp3lame")
        .audioBitrate("32k")
        .audioChannels(1)
        .audioFrequency(16000)
        .output(chunkPath)
        .on("end", resolve)
        .on("error", (err) =>
          reject(new Error(`Audio chunk split error: ${err.message}`)),
        )
        .run();
    });

    chunks.push({ filePath: chunkPath, offsetSeconds: start, duration });
  }

  return chunks;
}

/** Probes an audio file for its duration using ffprobe. */
function probeAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(new Error(`FFprobe audio error: ${err.message}`));
      resolve(Number(metadata.format?.duration) || 0);
    });
  });
}

/**
 * Sends a single audio buffer to Groq Whisper (or OpenAI Whisper as fallback).
 */
async function callWhisperAPI(fileBuffer, filename, language) {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const useGroq = Boolean(groqKey);
  const apiKey = useGroq ? groqKey : openaiKey;
  const apiUrl = useGroq
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : OPENAI_WHISPER_URL;
  const modelName = useGroq ? "whisper-large-v3" : "whisper-1";

  if (!apiKey) {
    throw new Error(
      "Neither OPENAI_API_KEY nor OPENAI_API_KEY is configured in backend/.env",
    );
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Normalize filename to ensure Whisper accepts it
      const ext = path.extname(filename).toLowerCase().replace(".", "");
      const supportedExts = [
        "flac",
        "mp3",
        "mp4",
        "mpeg",
        "mpga",
        "m4a",
        "ogg",
        "opus",
        "wav",
        "webm",
      ];
      const cleanExt = supportedExts.includes(ext) ? ext : "mp4";
      const sanitizedFilename = `audio_${Date.now()}.${cleanExt}`;

      const form = new FormData();
      form.append("file", fileBuffer, {
        filename: sanitizedFilename,
        contentType: getContentType(sanitizedFilename),
      });
      form.append("model", modelName);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      form.append("timestamp_granularities[]", "segment");

      if (language && language !== "auto" && language !== "roman_urdu") {
        form.append("language", language);
      }

      console.log(
        `[Whisper (${useGroq ? "Groq" : "OpenAI"})]: Sending "${filename}" (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB, model: ${modelName})` +
          ` — attempt ${attempt}/${MAX_RETRIES}`,
      );

      const response = await axios.post(apiUrl, form, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: WHISPER_TIMEOUT_MS,
      });

      console.log(
        `[Whisper (${useGroq ? "Groq" : "OpenAI"})]: OK — language: ${response.data.language}, duration: ${response.data.duration}s, words: ${(response.data.words || []).length}, segments: ${(response.data.segments || []).length}`,
      );
      return response.data;
    } catch (err) {
      lastError = err;
      const isRetryable =
        err.code === "ECONNABORTED" ||
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        (err.response && err.response.status >= 500);

      if (isRetryable && attempt < MAX_RETRIES) {
        const backoff = attempt * 15000; // 15s then 30s
        console.warn(
          `[Whisper]: Attempt ${attempt} failed (${err.code || err.message}). Retrying in ${backoff / 1000}s...`,
        );
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  // All retries exhausted — surface a useful error
  if (lastError.response) {
    const errData = lastError.response.data;
    const errMsg = errData?.error?.message || JSON.stringify(errData);
    throw new Error(
      `Whisper API Error (${lastError.response.status}): ${errMsg}`,
    );
  } else {
    throw new Error(
      `Network error connecting to OpenAI after ${MAX_RETRIES} attempts: ` +
        `${lastError.code || lastError.message}. ` +
        `Please check your internet connection or try again in a few minutes.`,
    );
  }
}

export const whisperService = {
  /**
   * Transcribes audio. Automatically splits into 10-min chunks if the file
   * exceeds 24 MB, stitching word-level timestamps back into a single result.
   *
   * @param {Buffer}  fileBuffer  Full audio buffer
   * @param {string}  filename    e.g. "speech.mp3"
   * @param {string}  [language]  ISO-639 code, "auto", or "roman_urdu"
   * @returns {Promise<{ text, language, duration, words, segments }>}
   */
  async transcribe(fileBuffer, filename = "speech.mp3", language = undefined) {
    const fileSizeBytes = fileBuffer.length;
    const fileSizeMB = fileSizeBytes / 1024 / 1024;

    console.log(
      `[Whisper]: Transcribing "${filename}" (${fileSizeMB.toFixed(2)} MB) — language: ${language || "auto"}`,
    );

    // Small file: single direct call
    if (fileSizeBytes <= WHISPER_MAX_BYTES) {
      return callWhisperAPI(fileBuffer, filename, language);
    }

    // Large file: split into 10-min chunks
    console.log(
      `[Whisper]: File is ${fileSizeMB.toFixed(2)} MB — splitting into ${CHUNK_DURATION_SECONDS}s chunks...`,
    );

    // Write buffer to a temp file so ffmpeg can read it
    const tmpSourcePath = path.join(
      TEMP_DIR,
      `whisper_source_${Date.now()}.mp3`,
    );
    fs.writeFileSync(tmpSourcePath, fileBuffer);

    let chunks = [];
    try {
      const totalDuration = await probeAudioDuration(tmpSourcePath);
      console.log(`[Whisper]: Audio duration: ${totalDuration.toFixed(1)}s`);

      chunks = await splitAudioIntoChunks(tmpSourcePath, totalDuration);
      console.log(`[Whisper]: Created ${chunks.length} audio chunks`);

      const allWords = [];
      const allSegments = [];
      let fullText = "";
      let detectedLanguage = "en";

      for (let i = 0; i < chunks.length; i++) {
        const { filePath, offsetSeconds } = chunks[i];
        const chunkBuffer = fs.readFileSync(filePath);
        const chunkName = `chunk_${i + 1}_of_${chunks.length}.mp3`;

        console.log(
          `[Whisper]: Transcribing chunk ${i + 1}/${chunks.length}` +
            ` (offset: ${offsetSeconds}s, ${(chunkBuffer.length / 1024 / 1024).toFixed(2)} MB)...`,
        );

        const result = await callWhisperAPI(chunkBuffer, chunkName, language);

        if (i === 0) detectedLanguage = result.language || "en";
        if (result.text) fullText += (fullText ? " " : "") + result.text.trim();

        // Offset word timestamps by chunk start time
        const offsetWords = (result.words || []).map((w) => ({
          ...w,
          start: parseFloat((Number(w.start) + offsetSeconds).toFixed(3)),
          end: parseFloat((Number(w.end) + offsetSeconds).toFixed(3)),
        }));

        // Offset segment timestamps
        const offsetSegments = (result.segments || []).map((s) => ({
          ...s,
          start: parseFloat((Number(s.start) + offsetSeconds).toFixed(3)),
          end: parseFloat((Number(s.end) + offsetSeconds).toFixed(3)),
        }));

        allWords.push(...offsetWords);
        allSegments.push(...offsetSegments);
      }

      console.log(
        `[Whisper]: Chunked transcription complete — ${allWords.length} words across ${chunks.length} chunks`,
      );

      return {
        text: fullText,
        language: detectedLanguage,
        duration: totalDuration,
        words: allWords,
        segments: allSegments,
      };
    } finally {
      // Clean up temp files
      try {
        fs.unlinkSync(tmpSourcePath);
      } catch (_) {}
      for (const { filePath } of chunks) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
      }
    }
  },
};

/** Returns the MIME content type for a given filename */
function getContentType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const types = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return types[ext] || "application/octet-stream";
}
