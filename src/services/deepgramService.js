import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ffmpegService } from "./ffmpegService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "../../temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES = 3;

/** Sleep helper for retry backoff */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends an audio file to Deepgram for transcription with word-level timestamps.
 * Deepgram supports much larger files than OpenAI Whisper (up to 2 hours easily).
 *
 * @param {string} audioPath - Path to audio file (MP3, WAV, etc.)
 * @param {string} [language] - ISO-639 language code or "auto"
 * @returns {Promise<{ text, language, duration, words, segments }>}
 */
async function callDeepgramAPI(audioPath, language = "en") {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured in backend/.env");
  }

  const audioBuffer = fs.readFileSync(audioPath);
  const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);

  console.log(
    `[Deepgram]: Sending "${path.basename(audioPath)}" (${fileSizeMB} MB, lang: ${language})`,
  );

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Deepgram accepts MP3, WAV, OGG, FLAC, etc.
      const response = await axios.post(DEEPGRAM_API_URL, audioBuffer, {
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": `audio/${path.extname(audioPath).slice(1) || "mp3"}`,
        },
        params: {
          model: "nova-3", // Latest high-accuracy model
          language:
            language === "auto" || language === "roman_urdu"
              ? undefined
              : language,
          // Request word-level timestamps and segments
          words: true,
          segments: true,
          punctuate: true,
          smart_format: true,
          diarize: false,
          // Optimize for speed
          utterances: true,
        },
        timeout: DEEPGRAM_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const data = response.data;

      // Deepgram returns results in data.results
      const results = data.results || {};
      const channels = results.channels || [];
      const channel = channels[0] || {};
      const alternatives = channel.alternatives || [];
      const alternative = alternatives[0] || {};

      const transcript = alternative.transcript || "";
      const words = (alternative.words || []).map((w) => ({
        word: w.word || "",
        rawWord: w.word || "",
        start: parseFloat(w.start) || 0,
        end: parseFloat(w.end) || 0,
        confidence: w.confidence || 1.0,
      }));

      // Convert Deepgram segments to Whisper-compatible format
      const segments = (results.segments || []).map((s) => ({
        text: s.text || "",
        start: parseFloat(s.start) || 0,
        end: parseFloat(s.end) || 0,
      }));

      const detectedLanguage = data.results?.language || language || "en";

      console.log(
        `[Deepgram]: OK — language: ${detectedLanguage}, duration: ${data.metadata?.duration || 0}s, words: ${words.length}, segments: ${segments.length}`,
      );

      return {
        text: transcript,
        language: detectedLanguage,
        duration: data.metadata?.duration || 0,
        words,
        segments,
      };
    } catch (err) {
      lastError = err;
      const isRetryable =
        err.code === "ECONNABORTED" ||
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        (err.response && err.response.status >= 500);

      if (isRetryable && attempt < MAX_RETRIES) {
        const backoff = attempt * 15000;
        console.warn(
          `[Deepgram]: Attempt ${attempt} failed (${err.code || err.message}). Retrying in ${backoff / 1000}s...`,
        );
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  // All retries exhausted
  if (lastError.response) {
    const errData = lastError.response.data;
    const errMsg = errData?.error?.message || JSON.stringify(errData);
    throw new Error(
      `Deepgram API Error (${lastError.response.status}): ${errMsg}`,
    );
  } else {
    throw new Error(
      `Network error connecting to Deepgram after ${MAX_RETRIES} attempts: ` +
        `${lastError.code || lastError.message}`,
    );
  }
}

export const deepgramService = {
  /**
   * Transcribes audio using Deepgram Nova-3.
   * Supports up to 2-hour videos (Deepgram handles large files natively).
   *
   * @param {string} audioPath - Path to extracted MP3 audio file
   * @param {string} [language] - ISO-639 code, "auto", or "roman_urdu"
   * @returns {Promise<{ text, language, duration, words, segments }>}
   */
  async transcribe(audioPath, language = "en") {
    console.log(
      `[Deepgram]: Transcribing "${audioPath}" — language: ${language || "auto"}`,
    );

    // Deepgram can handle the full audio file directly (no chunking needed for 2 hours)
    // Nova-3 supports up to 2 hours in a single request
    return callDeepgramAPI(audioPath, language);
  },
};
