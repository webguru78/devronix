import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

/**
 * Returns OpenAI client instance configured with GPT-4o
 */
function getAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in backend environment.");
  }

  return {
    client: new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    }),
    model: "gpt-4o",
    fallbackModel: "gpt-4o-mini",
  };
}

/**
 * Supported Language specifications with culturally nuanced prompting instructions
 */
export const SUPPORTED_SEO_LANGUAGES = {
  en: {
    name: "English",
    instruction: "Generate titles, description, hashtags, and highlight keywords in natural, high-converting modern English.",
  },
  roman_urdu: {
    name: "Roman Urdu / Roman Hindi",
    instruction: "Generate titles, description, hashtags, and keywords in Roman Urdu / Roman Hindi (Urdu/Hindi written in English Latin alphabet, e.g. 'Aise banayein viral reels har roz', 'Yeh secret kisi ko nahi pata'). Keep hashtags relevant in both Roman Urdu and English.",
  },
  ur: {
    name: "Urdu (اردو)",
    instruction: "Generate titles, description, and keywords in proper Urdu script (Nastaliq/Arabic characters). Hashtags can include both Urdu script and Roman Urdu/English.",
  },
  hi: {
    name: "Hindi (हिंदी)",
    instruction: "Generate titles, description, and keywords in clean Hindi Devanagari script. Hashtags can include Hindi and trending English tags.",
  },
  ar: {
    name: "Arabic (العربية)",
    instruction: "Generate titles, description, keywords, and hashtags in standard engaging Arabic (فصحى or popular Gulf/Levantine viral style).",
  },
};

/**
 * Heuristic fallback metadata if AI service encounters rate limits or errors
 */
function generateFallbackMetadata(rawText = "", language = "en") {
  const cleanWords = (rawText || "")
    .replace(/[^\w\s\u0600-\u06FF\u0900-\u097F]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const keywords = [...new Set(cleanWords)].slice(0, 6);
  const sampleKeyword = keywords[0] || "Viral Clip";

  let titles = [
    `Watch This: ${sampleKeyword} Will Shock You`,
    `The Ultimate Truth About ${sampleKeyword}`,
    `Why Nobody Talks About This! 🔥`,
  ];

  let description = "Watch until the very end to see the full breakdown! Don't forget to like, share, and follow for more daily insights.";
  let hashtags = ["#viral", "#trending", "#fyp", "#shorts", "#reels", "#explore"];

  if (language === "roman_urdu") {
    titles = [
      `Yeh Baat Kisi Ko Nahi Pata! 😱`,
      `${sampleKeyword} Ka Asal Raaz Samjhein`,
      `End Tak Lazmi Dekhein! 🔥`,
    ];
    description = "Yeh video end tak zaroor dekhein aur agar pasand aye to like aur follow karna mat bhooliye ga!";
    hashtags = ["#viralreels", "#trending", "#romanurdu", "#fyp", "#shortsvideo", "#foryou"];
  } else if (language === "ur") {
    titles = [
      "یہ راز کوئی نہیں بتائے گا! 😱",
      "ویڈیو آخر تک لازمی دیکھیں 🔥",
      "سب سے بڑا انکشاف",
    ];
    description = "مکمل معلومات کے لیے ویڈیو آخر تک دیکھیں۔ چینل کو فالو کریں اور دوستوں کے ساتھ شیئر کریں۔";
    hashtags = ["#اردو", "#پاکستان", "#viral", "#trending", "#foryou"];
  } else if (language === "hi") {
    titles = [
      "यह सच जानकर आप हैरान रह जाएंगे! 😱",
      "वीडियो अंत तक जरूर देखें 🔥",
      "वायरल होने का सबसे बड़ा सीक्रेट",
    ];
    description = "पूरी जानकारी के लिए वीडियो को अंत तक देखें। ऐसे और वीडियो के लिए हमें फॉलो और सब्सक्राइब करना न भूलें!";
    hashtags = ["#हिंदी", "#viralvideo", "#trending", "#shorts", "#foryou"];
  } else if (language === "ar") {
    titles = [
      "سر لن يخبرك به أحد! 😱",
      "شاهد الفيديو حتى النهاية 🔥",
      "الحقيقة الكاملة التي يبحث عنها الجميع",
    ];
    description = "شاهد المقطع كاملاً للحصول على الفائدة كاملة، ولا تنسَ متابعتنا والإعجاب بالمقطع للمزيد يومياً!";
    hashtags = ["#اكسبلور", "#ترند", "#فيديو", "#viral", "#shorts"];
  }

  return {
    titles,
    description,
    hashtags,
    highlight_keywords: keywords.slice(0, 5),
    targetLanguage: language,
  };
}

export const seoMetadataService = {
  /**
   * Generates SEO metadata (Titles, Description, Hashtags, Keyword Highlights) from transcript
   *
   * @param {Object} params
   * @param {string} params.rawText - The full transcript text
   * @param {Array} [params.words] - Word-level timestamps (optional context)
   * @param {string} [params.targetLanguage='en'] - en | roman_urdu | ur | hi | ar
   * @param {string} [params.tone='viral'] - viral | professional | educational | clickbait
   * @returns {Promise<{ titles: string[], description: string, hashtags: string[], highlight_keywords: string[], targetLanguage: string }>}
   */
  async generateMetadata({ rawText = "", words = [], targetLanguage = "en", tone = "viral" }) {
    const trimmedText = (rawText || "").trim();

    if (!trimmedText) {
      console.warn("[seoMetadataService]: Empty transcript received, returning standard template.");
      return generateFallbackMetadata("Verbatim Video", targetLanguage);
    }

    const langConfig =
      SUPPORTED_SEO_LANGUAGES[targetLanguage] ||
      SUPPORTED_SEO_LANGUAGES["en"];

    // Trim text to token safety limits (approx 12,000 characters)
    const contextText = trimmedText.length > 12000 ? `${trimmedText.slice(0, 12000)}...` : trimmedText;

    const systemPrompt = `You are a World-Class Short-Form Video SEO Strategist and Viral Growth Consultant for TikTok, YouTube Shorts, and Instagram Reels.

Your task is to analyze the audio transcription of a video and generate high-converting SEO and social media metadata.

Language Requirement:
${langConfig.instruction}

Target Tone: ${tone}

You MUST respond strictly with a valid JSON object matching this schema exactly:
{
  "titles": [
    "Catchy / Curious Title 1 (Punchy, under 60 chars)",
    "Clickbait / High-Hook Title 2 (High CTR, emoji)",
    "Search & SEO Optimized Title 3 (Keyword-focused)"
  ],
  "description": "A concise 2-3 sentence video summary that clearly explains the value proposition and ends with a strong, actionable Call-To-Action (e.g., follow, comment, save, share).",
  "hashtags": [
    "#tag1",
    "#tag2",
    "#tag3",
    "#tag4",
    "#tag5",
    "#tag6",
    "#tag7",
    "#tag8"
  ],
  "highlight_keywords": [
    "keyword1",
    "keyword2",
    "keyword3",
    "keyword4",
    "keyword5"
  ]
}

Guidelines:
1. "titles": Exactly 3 to 5 titles. Make them magnetic, scroll-stopping, and appropriate for short-form retention.
2. "description": Exactly 2 to 3 sentences in length. Must include a clear Call-To-Action (CTA).
3. "hashtags": 6 to 12 hashtags including a mix of viral tags (e.g. #fyp, #shorts) and niche topic-specific tags. Always prefix each with "#".
4. "highlight_keywords": 4 to 8 punchy words/phrases extracted directly from or central to the transcript suitable for kinetic subtitle highlighting.
5. Return ONLY valid JSON. Do not include markdown code block backticks, notes, or explanations.`;

    const userPrompt = `Target Language: ${langConfig.name} (${targetLanguage})
Tone: ${tone}

Audio Transcription:
"""
${contextText}
"""

Generate the JSON metadata now.`;

    const { client, model, fallbackModel } = getAIClient();
    let currentModel = model;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `[seoMetadataService]: Requesting SEO metadata (${currentModel}, lang: ${targetLanguage}, tone: ${tone}, attempt ${attempt})...`
        );

        const completion = await client.chat.completions.create({
          model: currentModel,
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });

        const rawContent = completion.choices[0]?.message?.content?.trim();
        if (!rawContent) {
          throw new Error("Received empty response from OpenAI.");
        }

        const parsed = JSON.parse(rawContent);

        // Sanitize and validate fields
        const titles = Array.isArray(parsed.titles) && parsed.titles.length > 0
          ? parsed.titles.map((t) => String(t).trim()).filter(Boolean)
          : generateFallbackMetadata(trimmedText, targetLanguage).titles;

        const description = typeof parsed.description === "string" && parsed.description.trim()
          ? parsed.description.trim()
          : generateFallbackMetadata(trimmedText, targetLanguage).description;

        const hashtags = Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0
          ? parsed.hashtags
              .map((h) => {
                const tag = String(h).trim();
                return tag.startsWith("#") ? tag : `#${tag}`;
              })
              .filter(Boolean)
          : generateFallbackMetadata(trimmedText, targetLanguage).hashtags;

        const highlight_keywords = Array.isArray(parsed.highlight_keywords) && parsed.highlight_keywords.length > 0
          ? parsed.highlight_keywords.map((k) => String(k).trim()).filter(Boolean)
          : generateFallbackMetadata(trimmedText, targetLanguage).highlight_keywords;

        console.log(
          `[seoMetadataService]: Successfully generated ${titles.length} titles, ${hashtags.length} hashtags, ${highlight_keywords.length} keywords.`
        );

        return {
          titles,
          description,
          hashtags,
          highlight_keywords,
          targetLanguage,
        };
      } catch (err) {
        console.warn(`[seoMetadataService Warning - Attempt ${attempt}]:`, err.message);
        // Switch to fallback model (gpt-4o-mini) if gpt-4o encounters rate limit or server error
        currentModel = fallbackModel;
        if (attempt === 2) {
          console.error("[seoMetadataService]: All attempts failed, using fallback heuristic metadata.");
          return generateFallbackMetadata(trimmedText, targetLanguage);
        }
      }
    }

    return generateFallbackMetadata(trimmedText, targetLanguage);
  },
};
