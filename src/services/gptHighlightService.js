import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

function getAIClient() {
  return {
    client: new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    }),
    model: "gpt-4o-mini",
    provider: "OpenAI",
  };
}

/**
 * How many viral clips to extract based on source video length.
 * Short videos stay conservative; 10–20 min videos get 7–12; hour-long gets up to 20.
 */
export function getTargetClipCount(totalDuration = 60) {
  const seconds = Number(totalDuration) || 0;
  if (seconds < 50) return 1;
  if (seconds < 90) return 2;
  if (seconds < 150) return 4;
  if (seconds < 240) return 6;
  if (seconds < 360) return 7;
  if (seconds < 600) return 9;
  if (seconds < 900) return 11;
  if (seconds < 1200) return 13;
  if (seconds < 1800) return 16;
  if (seconds < 2700) return 18;
  return 20;
}

export const gptHighlightService = {
  async detectHighlights({ rawText, segments = [], totalDuration = 60 }) {
    const { client, model, provider } = getAIClient();
    const targetCount = getTargetClipCount(totalDuration);

    console.log(
      `[AI Highlights (${provider} / ${model})]: Analyzing transcript (${(rawText || "").length} chars, ${segments.length} segments, ${totalDuration.toFixed(1)}s) → target ${targetCount} clips...`,
    );

    let timestampedTranscript = "";
    if (segments && segments.length > 0) {
      timestampedTranscript = segments
        .map(
          (s) =>
            `[${Math.round(s.start)}s - ${Math.round(s.end)}s] ${(s.text || "").trim()}`,
        )
        .join("\n");
    } else {
      timestampedTranscript = rawText;
    }

    const maxChars = 36000;
    if (timestampedTranscript.length > maxChars) {
      timestampedTranscript =
        timestampedTranscript.slice(0, maxChars) +
        "\n...[transcript truncated]";
    }

    const systemPrompt = `You are an elite viral video editor for TikTok, YouTube Shorts, and Instagram Reels.
Extract exactly ${targetCount} highlight-worthy standalone clips from a timestamped transcript.

CRITICAL GUIDELINES:
1. ALL TIMESTAMPS IN SECONDS. Output startTime and endTime as numbers in seconds.
2. DISTRIBUTE clips across the FULL video (beginning, middle, and end). Do not cluster them.
3. ZERO or minimal overlap between clips.
4. Clip duration: 25–55 seconds (8–20s only if the source video is under 90s).
5. Each clip must start on a hook and end on a punchline / insight.
6. Catchy title under 50 characters.
7. Return STRICT JSON only.

JSON schema:
{
  "highlights": [
    {
      "startTime": 280,
      "endTime": 325,
      "title": "THE HARDEST LESSON IN BUSINESS",
      "reason": "High-intensity story with a clear revelation."
    }
  ]
}`;

    const userPrompt = `Video Total Duration: ${Math.round(totalDuration)} seconds.
You MUST return ${targetCount} unique clips from DIFFERENT sections of this ${Math.round(totalDuration)}s video.

Transcript with timestamps in SECONDS [Xs - Ys]:
${timestampedTranscript}`;

    let attempts = 0;
    const maxAttempts = 2;
    let lastError = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
            ...(attempts > 1
              ? [
                  {
                    role: "assistant",
                    content: "Invalid JSON or constraints not met.",
                  },
                  {
                    role: "user",
                    content: `Return valid JSON with ${targetCount} highlights. startTime/endTime in SECONDS, 25-55s duration. Previous error: ${lastError}`,
                  },
                ]
              : []),
          ],
        });

        const rawContent = completion.choices[0]?.message?.content?.trim();
        const usage = completion.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
        };

        const parsed = JSON.parse(rawContent);
        const rawHighlights = parsed.highlights || parsed.clips || [];
        const validatedHighlights = [];
        const minClip = totalDuration < 45 ? 8 : 20;
        const maxClip = Math.min(60, totalDuration);

        for (const item of rawHighlights) {
          const rawStart =
            item.startTime !== undefined ? item.startTime : item.start;
          const rawEnd = item.endTime !== undefined ? item.endTime : item.end;
          const start = Number(rawStart);
          const end = Number(rawEnd);

          if (isNaN(start) || isNaN(end) || start < 0 || end <= start) {
            continue;
          }

          const safeStart = Math.min(start, Math.max(0, totalDuration - minClip));
          let safeEnd = Math.min(end, totalDuration);
          let duration = safeEnd - safeStart;

          if (duration < minClip) {
            safeEnd = Math.min(safeStart + Math.min(35, maxClip), totalDuration);
            duration = safeEnd - safeStart;
          }
          if (duration > maxClip) {
            safeEnd = safeStart + maxClip;
          }

          const parsedStart = parseFloat(safeStart.toFixed(2));
          const parsedEnd = parseFloat(safeEnd.toFixed(2));

          const isOverlapping = validatedHighlights.some((existing) => {
            const overlapStart = Math.max(existing.startTime, parsedStart);
            const overlapEnd = Math.min(existing.endTime, parsedEnd);
            const overlapDuration = Math.max(0, overlapEnd - overlapStart);
            const minLen = Math.min(
              existing.endTime - existing.startTime,
              parsedEnd - parsedStart,
            );
            return (
              overlapDuration > minLen * 0.4 ||
              Math.abs(existing.startTime - parsedStart) < 8
            );
          });

          if (isOverlapping && totalDuration > 90) {
            continue;
          }

          validatedHighlights.push({
            startTime: parsedStart,
            endTime: parsedEnd,
            title: (item.title || "Viral Highlight").slice(0, 80),
            reason: (item.reason || "Engaging moment").slice(0, 200),
          });

          if (validatedHighlights.length >= targetCount) break;
        }

        if (validatedHighlights.length < targetCount && totalDuration >= 90) {
          const autoClips = generateAlgorithmicHighlights(totalDuration, targetCount);
          for (const auto of autoClips) {
            if (validatedHighlights.length >= targetCount) break;
            const overlaps = validatedHighlights.some(
              (v) =>
                Math.max(
                  0,
                  Math.min(v.endTime, auto.endTime) -
                    Math.max(v.startTime, auto.startTime),
                ) > 8,
            );
            if (!overlaps) validatedHighlights.push(auto);
          }
        }

        if (validatedHighlights.length === 0) {
          throw new Error("GPT returned 0 valid highlight candidates");
        }

        const gptPromptCost = (usage.prompt_tokens || 0) * 0.0000025;
        const gptCompCost = (usage.completion_tokens || 0) * 0.00001;
        const gptCost = parseFloat((gptPromptCost + gptCompCost).toFixed(4));

        console.log(
          `[AI Highlights]: Extracted ${validatedHighlights.length}/${targetCount} highlights. Tokens: ${usage.total_tokens} (~$${gptCost})`,
        );

        return {
          highlights: validatedHighlights.slice(0, targetCount),
          costMetrics: {
            gptPromptTokens: usage.prompt_tokens || 0,
            gptCompletionTokens: usage.completion_tokens || 0,
            gptCost,
          },
        };
      } catch (err) {
        lastError = err.message;
        console.warn(`[AI Highlights Attempt ${attempts} Failed]: ${err.message}`);
      }
    }

    console.warn(
      `[AI Highlights Fallback]: Generating ${targetCount} algorithmic highlight segments...`,
    );
    return {
      highlights: generateAlgorithmicHighlights(totalDuration, targetCount),
      costMetrics: {
        gptPromptTokens: 0,
        gptCompletionTokens: 0,
        gptCost: 0,
      },
    };
  },
};

function generateAlgorithmicHighlights(totalDuration = 120, targetCount = 5) {
  const clips = [];
  const count = Math.max(1, targetCount || getTargetClipCount(totalDuration));

  if (totalDuration <= 65) {
    const segLen = Math.max(10, totalDuration - 1);
    const piece = segLen / count;
    for (let i = 0; i < count; i++) {
      const start = parseFloat((i * piece).toFixed(2));
      const end = parseFloat(Math.min(start + piece, totalDuration).toFixed(2));
      if (end - start < 8) continue;
      clips.push({
        startTime: start,
        endTime: end,
        title: `VIRAL MOMENT #${i + 1}`,
        reason: "Auto-selected highlight from your video.",
      });
    }
    return clips.length
      ? clips
      : [
          {
            startTime: 0,
            endTime: parseFloat(Math.min(totalDuration, 45).toFixed(2)),
            title: "VIRAL HIGHLIGHT",
            reason: "Best engaging segment from your short video.",
          },
        ];
  }

  const CLIP_DUR = Math.min(45, Math.max(25, Math.floor(totalDuration / (count + 2))));
  const usable = Math.max(1, totalDuration - CLIP_DUR);
  const gap = count === 1 ? 0 : usable / (count - 1);

  for (let i = 0; i < count; i++) {
    const start = parseFloat(Math.min(i * gap, totalDuration - CLIP_DUR).toFixed(2));
    const end = parseFloat(Math.min(start + CLIP_DUR, totalDuration).toFixed(2));
    if (end - start < 12) continue;
    clips.push({
      startTime: start,
      endTime: end,
      title: `VIRAL MOMENT #${i + 1}`,
      reason: `High energy segment from ${formatTime(start)}.`,
    });
  }

  return clips.length
    ? clips
    : [
        {
          startTime: 0,
          endTime: parseFloat(Math.min(totalDuration, 45).toFixed(2)),
          title: "VIRAL HIGHLIGHT",
          reason: "Auto-selected best segment from your video.",
        },
      ];
}

function formatTime(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}
