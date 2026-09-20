import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

function getAIClient() {
  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
      model: "gpt-4o-mini",
      provider: "OpenAI",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: "llama-3.3-70b-versatile",
      provider: "Groq",
    };
  }

  throw new Error(
    "No OpenAI or Groq API key configured for translation service.",
  );
}

export const translationService = {
  /**
   * Translates or transliterates structured captions (or chunks) into the target language.
   * Preserves exact chunk count, timestamps (start/end), and structure.
   *
   * @param {Array} captions - Array of { id, start, end, text, words }
   * @param {string} targetLanguage - e.g. 'roman_urdu', 'en', 'ur', 'hi', 'es', 'ar'
   * @returns {Promise<Array>} Translated captions array
   */
  async translateCaptions(captions = [], targetLanguage = "roman_urdu") {
    if (!captions || captions.length === 0) return [];

    const LANGUAGE_DESCRIPTIONS = {
      roman_urdu:
        "Roman Urdu (Urdu/Hindi written in English Latin alphabet, e.g., 'yeh video bohot achi hai')",
      en: "English",
      ur: "Urdu in Nastaliq / Urdu script (اردو)",
      hi: "Hindi in Devanagari script (हिंदी)",
      es: "Spanish (Español)",
      ar: "Arabic (العربية)",
      pa: "Punjabi",
      bn: "Bengali (বাংলা)",
      fr: "French (Français)",
      de: "German (Deutsch)",
      pt: "Portuguese (Português)",
      zh: "Simplified Chinese (中文)",
      ja: "Japanese (日本語)",
      ko: "Korean (한국어)",
      tr: "Turkish (Türkçe)",
      fa: "Persian / Farsi (فارسی)",
      auto: "the same language as the source (preserve meaning, fix script if needed)",
    };

    let targetDesc =
      LANGUAGE_DESCRIPTIONS[targetLanguage] ||
      `the language with ISO code "${targetLanguage}" (use native script where appropriate)`;

    // Prepare text items
    const inputItems = captions.map((c, i) => ({
      index: i,
      text:
        c.text ||
        (c.words ? c.words.map((w) => w.rawWord || w.word).join(" ") : ""),
    }));

    const prompt = `You are an expert multilingual video caption translator and transliterator for TikTok, YouTube Shorts, and Instagram Reels.
Translate / transliterate the following numbered caption segments into ${targetDesc}.

CRITICAL RULES:
1. Return ONLY a valid JSON array of objects: [{"index": 0, "text": "..."}, ...].
2. Keep the translation concise, viral, punchy, and short (matching the length of original spoken speech chunks).
3. If target is Roman Urdu: write spoken Hindi/Urdu in Latin/English alphabets (no Devanagari, no Arabic characters). Keep common English business/tech words in English (e.g. AI, video, dropshipping, store, sales, tools).
4. Preserve the exact number of items and matching indices.
5. Do NOT add markdown blocks or commentary outside the JSON.

Input items:
${JSON.stringify(inputItems)}`;

    try {
      const { client, model } = getAIClient();
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = completion.choices[0]?.message?.content?.trim() || "[]";
      const cleanJson = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      const translatedItems = JSON.parse(cleanJson);

      const translationMap = new Map();
      for (const item of translatedItems) {
        translationMap.set(item.index, item.text);
      }

      // Reconstruct captions with updated words and highlights
      return captions.map((c, i) => {
        const newText = translationMap.get(i) || c.text;
        const splitWords = newText.split(/\s+/).filter(Boolean);

        // Map timing across the new words proportional to duration
        const duration = Math.max(0.3, (c.end || 0) - (c.start || 0));
        const wordDur = duration / Math.max(1, splitWords.length);

        const newWords = splitWords.map((w, idx) => {
          const wStart = parseFloat(
            ((c.start || 0) + idx * wordDur).toFixed(2),
          );
          const wEnd = parseFloat(
            ((c.start || 0) + (idx + 1) * wordDur).toFixed(2),
          );
          return {
            word: w.replace(/[.,!?:;"]/g, ""),
            rawWord: w,
            start: wStart,
            end: Math.min(c.end, wEnd),
          };
        });

        const longest = splitWords.reduce(
          (a, b) => (a.length >= b.length ? a : b),
          splitWords[0] || "",
        );

        return {
          ...c,
          text: newText,
          highlightWord: longest.replace(/[.,!?:;"]/g, ""),
          words: newWords,
        };
      });
    } catch (err) {
      console.error("[Translation Service Error]:", err.message);
      return captions; // Return original if error
    }
  },

  /**
   * Checks if words contain non-Latin script (Hindi Devanagari or Arabic/Urdu).
   */
  hasNonLatinCharacters(text = "") {
    // Unicode ranges: Devanagari [\u0900-\u097F], Arabic/Urdu [\u0600-\u06FF]
    return /[\u0900-\u097F\u0600-\u06FF]/.test(text);
  },

  /**
   * Transliterates raw Whisper words into Roman Urdu if they contain Devanagari or Arabic script.
   */
  async ensureRomanUrduWords(words = []) {
    if (!words || words.length === 0) return words;

    const fullSample = words
      .slice(0, 100)
      .map((w) => w.word)
      .join(" ");
    if (!this.hasNonLatinCharacters(fullSample)) {
      return words; // Already Latin / English script
    }

    console.log(
      "[Translation Service]: Detected non-Latin characters in Whisper transcript. Transliterating to Roman Urdu...",
    );

    // Batch convert words in groups of 80 to retain timestamps
    const BATCH_SIZE = 80;
    const processedWords = [...words];

    for (let b = 0; b < words.length; b += BATCH_SIZE) {
      const slice = words.slice(b, b + BATCH_SIZE);
      const textChunk = slice.map((w, i) => `${i}:${w.word}`).join(" ");

      const prompt = `Transliterate the following indexed Hindi/Urdu words into Roman Urdu (Latin English alphabet).
Keep the exact index format "index:transliterated_word".
Do NOT translate, just transliterate phonetically into Roman Urdu.
Example: "0:सरिफ 1:एए 2:टूल्स" -> "0:sirf 1:AI 2:tools"

Input:
${textChunk}`;

      try {
        const { client, model } = getAIClient();
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }],
        });

        const output = completion.choices[0]?.message?.content?.trim() || "";
        const pairs = output.split(/\s+/);
        for (const pair of pairs) {
          const colonIdx = pair.indexOf(":");
          if (colonIdx > 0) {
            const idx = parseInt(pair.substring(0, colonIdx), 10);
            const val = pair.substring(colonIdx + 1).trim();
            if (!isNaN(idx) && slice[idx] && val) {
              const targetIdx = b + idx;
              processedWords[targetIdx] = {
                ...processedWords[targetIdx],
                word: val.replace(/[.,!?:;"]/g, ""),
                rawWord: val,
              };
            }
          }
        }
      } catch (err) {
        console.error(
          "[Translation Service Word Transliteration Error]:",
          err.message,
        );
      }
    }

    return processedWords;
  },
};
