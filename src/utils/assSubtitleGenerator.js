/**
 * Generates ASS subtitle files for FFmpeg burn-in.
 * Supports multiple unique viral CapCut-style templates,
 * plus per-line style rotation (different template every caption chunk).
 */

export const TEMPLATE_STYLES = {
  // ── VIRAL CAPCUT STYLE SUITE (LINE_WAVE, POP, BOUNCE, SHAKE, FIRE_HEAT) ──
  line_wave_gold: {
    id: "line_wave_gold",
    name: "Line Wave Gold",
    tag: "LINE_WAVE",
    fontName: "Arial Black",
    fontSize: 60,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000E6FF", // Gold (#FFE600)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 310,
    chunkSize: 3,
  },
  line_wave_cyan: {
    id: "line_wave_cyan",
    name: "Line Wave Cyber",
    tag: "LINE_WAVE",
    fontName: "Arial Black",
    fontSize: 60,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FFF000", // Cyan (#00F0FF)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 310,
    chunkSize: 3,
  },
  line_wave_neon_green: {
    id: "line_wave_neon_green",
    name: "Line Wave Toxic",
    tag: "LINE_WAVE",
    fontName: "Arial Black",
    fontSize: 60,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0066FF00", // Neon Green (#00FF66)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 310,
    chunkSize: 3,
  },
  line_wave_crimson: {
    id: "line_wave_crimson",
    name: "Line Wave Crimson",
    tag: "LINE_WAVE",
    fontName: "Arial Black",
    fontSize: 60,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00351AFF", // Crimson Red (#FF1A35)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 310,
    chunkSize: 3,
  },
  pop_unstoppable_yellow: {
    id: "pop_unstoppable_yellow",
    name: "Pop Unstoppable",
    tag: "POP",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000E6FF", // Yellow (#FFE600)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 4,
    marginV: 300,
    chunkSize: 3,
    isStacked: true,
  },
  pop_million_green: {
    id: "pop_million_green",
    name: "Pop Million Dollar",
    tag: "POP",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0066FF00", // Toxic Green (#00FF66)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 4,
    marginV: 300,
    chunkSize: 3,
    isStacked: true,
  },
  pop_discipline_cyan: {
    id: "pop_discipline_cyan",
    name: "Pop Discipline Free",
    tag: "POP",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FFF000", // Cyan (#00F0FF)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 4,
    marginV: 300,
    chunkSize: 3,
    isStacked: true,
  },
  pop_danger_red: {
    id: "pop_danger_red",
    name: "Pop Danger Red",
    tag: "POP",
    fontName: "Arial Black",
    fontSize: 72,
    baseColor: "&H001A1AFF",
    highlightColor: "&H001A1AFF", // Red (#FF1A1A)
    outlineColor: "&H00000000",
    outline: 6,
    shadow: 4,
    marginV: 340,
    chunkSize: 1,
  },
  bounce_secret_power: {
    id: "bounce_secret_power",
    name: "Bounce Secret Power",
    tag: "BOUNCE",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00F8BD38", // Sky Cyan (#38BDF8)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 310,
    chunkSize: 3,
  },
  bounce_true_potential: {
    id: "bounce_true_potential",
    name: "Bounce True Potential",
    tag: "BOUNCE",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FB40E0", // Magenta Pink (#E040FB)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 310,
    chunkSize: 3,
  },
  bounce_electric_blue: {
    id: "bounce_electric_blue",
    name: "Bounce Electric Blue",
    tag: "BOUNCE",
    fontName: "Arial Black",
    fontSize: 68,
    baseColor: "&H00FFF000",
    highlightColor: "&H00FFF000", // Electric Cyan
    outlineColor: "&H00000000",
    outline: 6,
    shadow: 4,
    marginV: 340,
    chunkSize: 1,
  },
  shake_never_mistake: {
    id: "shake_never_mistake",
    name: "Shake Never Mistake",
    tag: "SHAKE",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H005500FF", // Crimson Pink (#FF0055)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 4,
    marginV: 310,
    chunkSize: 3,
  },
  shake_going_viral: {
    id: "shake_going_viral",
    name: "Shake Going Viral",
    tag: "SHAKE",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000E6FF", // Yellow (#FFE600)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 4,
    marginV: 310,
    chunkSize: 3,
  },
  fire_heat_massive_action: {
    id: "fire_heat_massive_action",
    name: "Fire Heat Massive Action",
    tag: "FIRE_HEAT",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H000045FF", // Fire Orange (#FF4500)
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 4,
    marginV: 310,
    chunkSize: 3,
  },
  fire_heat_flame_punch: {
    id: "fire_heat_flame_punch",
    name: "Fire Heat Blaze",
    tag: "FIRE_HEAT",
    fontName: "Arial Black",
    fontSize: 70,
    baseColor: "&H000055FF",
    highlightColor: "&H000055FF", // Fiery Amber (#FF5500)
    outlineColor: "&H00000000",
    outline: 6,
    shadow: 4,
    marginV: 340,
    chunkSize: 1,
  },
  zoom_cyber_punch: {
    id: "zoom_cyber_punch",
    name: "Zoom Cyber Punch",
    tag: "ZOOM",
    fontName: "Arial Black",
    fontSize: 72,
    baseColor: "&H00FFF000",
    highlightColor: "&H00FFF000", // Cyan (#00F0FF)
    outlineColor: "&H00000000",
    outline: 6,
    shadow: 4,
    marginV: 340,
    chunkSize: 1,
  },
  clean_minimal_white: {
    id: "clean_minimal_white",
    name: "Clean Minimal Pure",
    tag: "MINIMAL",
    fontName: "Arial Black",
    fontSize: 52,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00E0E0E0",
    outlineColor: "&H00000000",
    outline: 3,
    shadow: 2,
    marginV: 310,
    chunkSize: 3,
  },
  comic_verse_cyan_glow: {
    id: "comic_verse_cyan_glow",
    name: "Comic Verse Cyan Glow",
    tag: "⚡ Superhero",
    fontName: "Impact",
    fontSize: 64,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FFFF00", // Electric Cyan
    outlineColor: "&H00000000",
    outline: 6,
    shadow: 4,
    marginV: 310,
    chunkSize: 3,
  },
  comic_verse_blood_red: {
    id: "comic_verse_blood_red",
    name: "Comic Verse Villain Red",
    tag: "🚨 Villain",
    fontName: "Impact",
    fontSize: 64,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H000000FF", // Blood Red
    outlineColor: "&H00000000",
    outline: 6,
    shadow: 4,
    marginV: 310,
    chunkSize: 3,
  },
  speed_racing_yellow_red: {
    id: "speed_racing_yellow_red",
    name: "Speed Racing Yellow / Red",
    tag: "🏎️ High Speed",
    fontName: "Arial Black",
    fontSize: 62,
    baseColor: "&H0000D7FF", // Vibrant Yellow
    highlightColor: "&H000000FF", // Crimson Red Outline Glow
    outlineColor: "&H000000CC", // Strong Red-Black Outline
    outline: 5,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  speed_racing_pure_yellow: {
    id: "speed_racing_pure_yellow",
    name: "Agsy Speed Yellow",
    tag: "⚡ High Energy",
    fontName: "Arial Black",
    fontSize: 62,
    baseColor: "&H0000FFFF", // Pure Yellow
    highlightColor: "&H000033FF", // Neon Red-Orange
    outlineColor: "&H00000088", // Dark Red outline
    outline: 5,
    shadow: 3,
    marginV: 320,
    chunkSize: 2,
  },
  // ── 3-LAYER MIXED TYPOGRAPHY STACK ───────────────────────────
  stacked_mixed_typography: {
    id: "stacked_mixed_typography",
    name: "Stacked Mixed Typography",
    tag: "3 Layers",
    fontName: "Arial Black",
    fontSize: 56,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000E6FF", // Bright Yellow
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 3,
    marginV: 300,
    chunkSize: 3,
    isStacked: true,
  },
  // ── ORIGINAL SET ──────────────────────────────────────────────
  hormozi_gold_impact: {
    id: "hormozi_gold_impact",
    name: "Alex Hormozi Gold",
    tag: "Most Viral",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000D7FF", // Rich Gold
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  pro_single_word_bomb: {
    id: "pro_single_word_bomb",
    name: "Word Bomb",
    tag: "Trending",
    fontName: "Arial Black",
    fontSize: 70,
    baseColor: "&H0000E6FF",
    highlightColor: "&H0000E6FF",
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 340,
    chunkSize: 1,
  },
  pro_three_mrbeast_impact: {
    id: "pro_three_mrbeast_impact",
    name: "MrBeast Impact",
    tag: "High Energy",
    fontName: "Arial Black",
    fontSize: 56,
    baseColor: "&H0000FFFF",
    highlightColor: "&H000020FF",
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  pro_three_tiktok_bounce: {
    id: "pro_three_tiktok_bounce",
    name: "TikTok Bounce",
    tag: "Influencer",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000FFCC",
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  pro_sentence_netflix: {
    id: "pro_sentence_netflix",
    name: "Netflix Cinematic",
    tag: "Cinema",
    fontName: "Arial",
    fontSize: 44,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0015CCFA",
    outlineColor: "&H00000000",
    outline: 3,
    shadow: 1,
    marginV: 280,
    chunkSize: 7,
  },
  pro_single_neon_drop: {
    id: "pro_single_neon_drop",
    name: "Neon Drop",
    tag: "Cyber",
    fontName: "Arial Black",
    fontSize: 68,
    baseColor: "&H00FFFF00",
    highlightColor: "&H00FFFF00",
    outlineColor: "&H00201000",
    outline: 4,
    shadow: 3,
    marginV: 340,
    chunkSize: 1,
  },
  pro_sentence_podcast_dark: {
    id: "pro_sentence_podcast_dark",
    name: "Podcast Dark Glass",
    tag: "Podcast",
    fontName: "Arial",
    fontSize: 42,
    baseColor: "&H00E0E0E0",
    highlightColor: "&H00F8BD38",
    outlineColor: "&H00000000",
    outline: 3,
    shadow: 1,
    marginV: 280,
    chunkSize: 7,
  },
  pro_three_cyber_slide: {
    id: "pro_three_cyber_slide",
    name: "Cyber Slide",
    tag: "Tech",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00F0F0F0",
    highlightColor: "&H00FFFF00",
    outlineColor: "&H00201000",
    outline: 4,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  cyberpunk_neon: {
    id: "cyberpunk_neon",
    name: "Cyberpunk Cyan",
    tag: "Tech",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00F0F0F0",
    highlightColor: "&H00FFFF00",
    outlineColor: "&H00201000",
    outline: 4,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  mrbeast_bold: {
    id: "mrbeast_bold",
    name: "MrBeast Punch",
    tag: "High Energy",
    fontName: "Arial Black",
    fontSize: 56,
    baseColor: "&H0000FFFF",
    highlightColor: "&H000020FF",
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  tiktok_lime: {
    id: "tiktok_lime",
    name: "TikTok Viral Lime",
    tag: "Trending",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0020FF00",
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  aesthetic_magenta: {
    id: "aesthetic_magenta",
    name: "Aesthetic Magenta",
    tag: "Aesthetic",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00D020FF",
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  clean_minimal: {
    id: "clean_minimal",
    name: "Clean Minimal",
    tag: "Minimal",
    fontName: "Arial Black",
    fontSize: 52,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00E0E0E0",
    outlineColor: "&H00000000",
    outline: 3,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },

  // ── NEW: PROFESSIONAL / TRENDING SET ─────────────────────────
  bold_karaoke_red: {
    id: "bold_karaoke_red",
    name: "Bold Karaoke Red",
    tag: "High Energy",
    fontName: "Arial Black",
    fontSize: 56,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H003131FF", // Fire Red
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  gaming_neon_purple: {
    id: "gaming_neon_purple",
    name: "Gaming Neon Purple",
    tag: "Gaming",
    fontName: "Arial Black",
    fontSize: 56,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FF26B0", // Electric Purple
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  luxury_gold_serif: {
    id: "luxury_gold_serif",
    name: "Luxury Gold Serif",
    tag: "Luxury",
    fontName: "Georgia",
    fontSize: 46,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000D7FF", // Gold
    outlineColor: "&H00000000",
    outline: 2,
    shadow: 1,
    marginV: 300,
    chunkSize: 5,
  },
  finance_green_ticker: {
    id: "finance_green_ticker",
    name: "Finance Green Ticker",
    tag: "Finance",
    fontName: "Arial Black",
    fontSize: 52,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H007FFF00", // Stock Green
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  beauty_pastel_pink: {
    id: "beauty_pastel_pink",
    name: "Beauty Pastel Pink",
    tag: "Beauty",
    fontName: "Arial",
    fontSize: 46,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00C1B6FF", // Pastel Pink
    outlineColor: "&H00000000",
    outline: 3,
    shadow: 1,
    marginV: 300,
    chunkSize: 3,
  },
  fitness_orange_burst: {
    id: "fitness_orange_burst",
    name: "Fitness Orange Burst",
    tag: "Fitness",
    fontName: "Arial Black",
    fontSize: 58,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00006BFF", // Vivid Orange
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 320,
    chunkSize: 3,
  },
  news_flash_banner: {
    id: "news_flash_banner",
    name: "News Flash Banner",
    tag: "News",
    fontName: "Arial",
    fontSize: 44,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H000000FF", // Alert Red
    outlineColor: "&H00000000",
    outline: 3,
    shadow: 1,
    marginV: 300,
    chunkSize: 5,
  },
  comedy_bounce_yellow: {
    id: "comedy_bounce_yellow",
    name: "Comedy Bounce Yellow",
    tag: "Comedy",
    fontName: "Arial Black",
    fontSize: 60,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H0000FFFF", // Bright Yellow
    outlineColor: "&H00000000",
    outline: 5,
    shadow: 3,
    marginV: 330,
    chunkSize: 2,
  },
  motivational_sunrise: {
    id: "motivational_sunrise",
    name: "Motivational Sunrise",
    tag: "Motivational",
    fontName: "Arial Black",
    fontSize: 50,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H000045FF", // Sunset Orange-Red
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 300,
    chunkSize: 4,
  },
  aesthetic_lavender: {
    id: "aesthetic_lavender",
    name: "Aesthetic Lavender",
    tag: "Aesthetic",
    fontName: "Arial",
    fontSize: 40,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FFA2C8", // Lavender
    outlineColor: "&H00000000",
    outline: 2,
    shadow: 1,
    marginV: 280,
    chunkSize: 5,
  },
  turquoise_wave: {
    id: "turquoise_wave",
    name: "Turquoise Wave",
    tag: "Travel",
    fontName: "Arial Black",
    fontSize: 54,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00D0E040", // Turquoise
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
  electric_blue_bold: {
    id: "electric_blue_bold",
    name: "Electric Blue Bold",
    tag: "Tech",
    fontName: "Arial Black",
    fontSize: 56,
    baseColor: "&H00FFFFFF",
    highlightColor: "&H00FFA300", // Electric Blue
    outlineColor: "&H00000000",
    outline: 4,
    shadow: 2,
    marginV: 320,
    chunkSize: 3,
  },
};

// Curated rotation sets — commonly paired combos for the "change style every
// line" feature. Pass the set's id array (or your own array) as
// styleOrTemplateId to generateAssSubtitles.
export const ROTATION_SETS = {
  capcut_trending_mix: ["line_wave_cyan", "pop_unstoppable_yellow", "fire_heat_massive_action"],
  high_voltage_stomp: ["pop_million_green", "shake_never_mistake", "bounce_secret_power"],
  cyber_flame_flow: ["line_wave_cyan", "bounce_true_potential", "fire_heat_massive_action"],
  hormozi_unstoppable_mix: ["hormozi_gold_impact", "pop_unstoppable_yellow", "line_wave_neon_green"],
  viral_mix: ["hormozi_gold_impact", "pop_unstoppable_yellow", "line_wave_neon_green"],
  high_energy: [
    "bold_karaoke_red",
    "pro_three_mrbeast_impact",
    "comedy_bounce_yellow",
  ],
  premium_cinematic: [
    "pro_sentence_netflix",
    "luxury_gold_serif",
    "pro_sentence_podcast_dark",
  ],
  aesthetic_soft: [
    "aesthetic_lavender",
    "beauty_pastel_pink",
    "pro_sentence_netflix",
  ],
  cyber_gaming: ["cyberpunk_neon", "gaming_neon_purple", "electric_blue_bold"],
};

const DEFAULT_STYLE = TEMPLATE_STYLES.hormozi_gold_impact;

export function getWordsLabel(chunkSize) {
  if (chunkSize === 1) return "1 Word";
  if (chunkSize >= 6) return "Full Line";
  return `${chunkSize} Words`;
}

function toAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(sec)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function groupWordsIntoChunks(words, chunkSize = 3) {
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize));
  }
  return chunks;
}

function resolveStyle(item) {
  if (typeof item === "string" && TEMPLATE_STYLES[item]) {
    return TEMPLATE_STYLES[item];
  }
  if (typeof item === "object" && item !== null) {
    return { ...DEFAULT_STYLE, ...item };
  }
  return DEFAULT_STYLE;
}

// Accepts: a single template id string, a single custom style object,
// a rotation-set id (string key of ROTATION_SETS), or an array of any mix
// of the above — enabling the "different template every line" feature.
function resolveStyleList(styleOrTemplateId) {
  if (
    typeof styleOrTemplateId === "string" &&
    ROTATION_SETS[styleOrTemplateId]
  ) {
    return ROTATION_SETS[styleOrTemplateId].map(resolveStyle);
  }
  if (Array.isArray(styleOrTemplateId)) {
    const list = styleOrTemplateId.map(resolveStyle).filter(Boolean);
    return list.length ? list : [DEFAULT_STYLE];
  }
  return [resolveStyle(styleOrTemplateId)];
}

/**
 * @param {Array} allWords - Whisper words with start/end (absolute video time)
 * @param {number} clipStartTime
 * @param {number} clipEndTime
 * @param {Object|string|Array} [styleOrTemplateId] - Template ID, rotation-set
 *   id (e.g. 'viral_mix'), custom style object, or an array of any of these
 *   to cycle through — a different template is used for every caption line.
 *   NOTE: when rotating, the chunkSize of the FIRST style in the list is
 *   used for word-grouping, so all lines stay the same length; only the
 *   visual style (font, colors, outline, position) changes per line.
 */
export function generateAssSubtitles(
  allWords = [],
  clipStartTime = 0,
  clipEndTime = 60,
  styleOrTemplateId = "hormozi_gold_impact",
) {
  const styleList = resolveStyleList(styleOrTemplateId);
  const baseStyle = styleList[0];

  const clipWords = (allWords || [])
    .filter((w) => {
      const s = Number(w.start);
      const e = Number(w.end);
      return !isNaN(s) && !isNaN(e) && e >= clipStartTime && s <= clipEndTime;
    })
    .map((w) => ({
      word: (w.rawWord || w.word || "").trim(),
      start: Math.max(0, Number(w.start) - clipStartTime),
      end: Math.max(0.15, Number(w.end) - clipStartTime),
    }))
    .filter((w) => w.word.length > 0);

  const header = `[Script Info]
Title: Verbatim AI Captions
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralDefault,${baseStyle.fontName},${baseStyle.fontSize},${baseStyle.baseColor},${baseStyle.highlightColor},${baseStyle.outlineColor},&H80000000,-1,0,0,0,100,100,0,0,1,${baseStyle.outline},${baseStyle.shadow},2,40,40,${baseStyle.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (clipWords.length === 0) {
    return (
      header +
      `Dialogue: 0,0:00:00.50,0:00:03.00,ViralDefault,,0,0,0,,${escapeAssText("VIRAL HIGHLIGHT")}\n`
    );
  }

  const chunkSize = baseStyle.chunkSize || 3;
  const chunks = groupWordsIntoChunks(clipWords, chunkSize);
  const dialogues = [];

  chunks.forEach((chunk, chunkIndex) => {
    const chunkStyle = styleList[chunkIndex % styleList.length];

    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end;
    const cleanWords = chunk.map((w) => w.word.replace(/[.,!?:;"]/g, ""));
    const highlight =
      cleanWords.reduce(
        (a, b) => (a.length >= b.length ? a : b),
        cleanWords[0],
      ) || cleanWords[0];

    const parts = chunk.map((w) => {
      const clean = w.word.replace(/[.,!?:;"]/g, "");
      const isHighlight =
        clean.toLowerCase() === highlight.toLowerCase() ||
        w.word.toLowerCase() === highlight.toLowerCase();
      const colorTag = isHighlight
        ? `{\\c${chunkStyle.highlightColor}&}`
        : `{\\c${chunkStyle.baseColor}&}`;
      return `${colorTag}${escapeAssText(w.word.toUpperCase())}{\\c${chunkStyle.baseColor}&}`;
    });

    // Per-line override tags so font/size/outline/shadow can change even
    // though every dialogue line shares the single "ViralDefault" Style.
    const overridePrefix = `{\\fn${chunkStyle.fontName}\\fs${chunkStyle.fontSize}\\bord${chunkStyle.outline}\\shad${chunkStyle.shadow}\\3c${chunkStyle.outlineColor}&}`;
    const text = overridePrefix + parts.join(" ");

    dialogues.push(
      `Dialogue: 0,${toAssTime(chunkStart)},${toAssTime(Math.max(chunkEnd, chunkStart + 0.35))},ViralDefault,,0,0,${chunkStyle.marginV},,${text}`,
    );
  });

  return header + dialogues.join("\n") + "\n";
}
