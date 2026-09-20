import { translationService } from "../services/translationService.js";

export async function formatWhisperToCaptions(whisperResult, language = "auto") {
  const rawWords = whisperResult.words || [];
  const segments = whisperResult.segments || [];
  let formattedCaptions = [];

  if (rawWords.length > 0) {
    const CHUNK_SIZE = 3;
    for (let i = 0; i < rawWords.length; i += CHUNK_SIZE) {
      const chunk = rawWords.slice(i, i + CHUNK_SIZE);
      const chunkText = chunk.map((w) => (w.word || "").trim()).filter(Boolean).join(" ");
      if (!chunkText) continue;

      const start = parseFloat(chunk[0].start.toFixed(2));
      const end = parseFloat(chunk[chunk.length - 1].end.toFixed(2));

      const chunkWords = chunk.map((w) => ({
        word: (w.word || "").trim().replace(/[.,!?:;"]/g, ""),
        rawWord: (w.word || "").trim(),
        start: parseFloat(w.start.toFixed(2)),
        end: parseFloat(w.end.toFixed(2)),
      }));

      const cleanWords = chunkWords.map((cw) => cw.word).filter(Boolean);
      const longest = cleanWords.length > 0
        ? cleanWords.reduce((a, b) => (a.length >= b.length ? a : b))
        : "";

      formattedCaptions.push({
        id: formattedCaptions.length + 1,
        start,
        end: Math.max(end, start + 0.35),
        text: chunkText,
        highlightWord: longest,
        words: chunkWords,
      });
    }
  } else if (segments.length > 0) {
    for (const seg of segments) {
      const rawText = (seg.text || "").trim();
      if (!rawText) continue;
      const splitWords = rawText.split(/\s+/).filter(Boolean);
      if (splitWords.length === 0) continue;

      const segStart = parseFloat((seg.start || 0).toFixed(2));
      const segEnd = parseFloat((seg.end || segStart + 2).toFixed(2));
      const segDur = Math.max(0.4, segEnd - segStart);
      const wordDur = segDur / splitWords.length;

      const CHUNK_SIZE = 3;
      for (let i = 0; i < splitWords.length; i += CHUNK_SIZE) {
        const chunkSlice = splitWords.slice(i, i + CHUNK_SIZE);
        const chunkText = chunkSlice.join(" ");
        const chunkStart = parseFloat((segStart + (i * wordDur)).toFixed(2));
        const chunkEnd = parseFloat((segStart + ((i + chunkSlice.length) * wordDur)).toFixed(2));

        const chunkWords = chunkSlice.map((w, idx) => ({
          word: w.replace(/[.,!?:;"]/g, ""),
          rawWord: w,
          start: parseFloat((chunkStart + (idx * wordDur)).toFixed(2)),
          end: parseFloat((chunkStart + ((idx + 1) * wordDur)).toFixed(2)),
        }));

        const cleanWords = chunkWords.map((cw) => cw.word).filter(Boolean);
        const longest = cleanWords.length > 0
          ? cleanWords.reduce((a, b) => (a.length >= b.length ? a : b))
          : "";

        formattedCaptions.push({
          id: formattedCaptions.length + 1,
          start: chunkStart,
          end: Math.max(chunkEnd, chunkStart + 0.35),
          text: chunkText,
          highlightWord: longest,
          words: chunkWords,
        });
      }
    }
  } else {
    formattedCaptions = [
      {
        id: 1,
        start: 0.0,
        end: parseFloat((whisperResult.duration || 10).toFixed(2)),
        text: whisperResult.text || "Transcription complete.",
        highlightWord: (whisperResult.text || "").split(" ")[0] || "",
        words: (whisperResult.text || "Transcription complete.").split(" ").map((w, i, arr) => ({
          word: w.replace(/[.,!?:;"]/g, ""),
          rawWord: w,
          start: parseFloat((i * ((whisperResult.duration || 10) / arr.length)).toFixed(2)),
          end: parseFloat(((i + 1) * ((whisperResult.duration || 10) / arr.length)).toFixed(2)),
        })),
      },
    ];
  }

  if (language === "roman_urdu") {
    formattedCaptions = await translationService.translateCaptions(formattedCaptions, "roman_urdu");
  }

  return formattedCaptions;
}
