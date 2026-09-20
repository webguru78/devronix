import mongoose from "mongoose";

const CaptionWordSchema = new mongoose.Schema(
  {
    word: { type: String, default: "" },
    rawWord: { type: String, default: "" },
    start: { type: Number, default: 0 },
    end: { type: Number, default: 0 },
  },
  { _id: false },
);

const CaptionItemSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, default: "" },
    highlightWord: { type: String, default: "" },
    words: [CaptionWordSchema],
  },
  { _id: false },
);

const CaptionStyleSchema = new mongoose.Schema(
  {
    template: { type: String, default: "hormozi" },
    fontFamily: { type: String, default: "anton" },
    fontSize: { type: Number, default: 28 },
    fontWeight: { type: String, default: "900" },
    textTransform: { type: String, default: "uppercase" },
    textColor: { type: String, default: "#FFFFFF" },
    highlightColor: { type: String, default: "#FFE600" },
    boxStyle: { type: String, default: "solid" },
    boxColor: { type: String, default: "#000000" },
    boxOpacity: { type: Number, default: 0.85 },
    strokeWidth: { type: Number, default: 0 },
    strokeColor: { type: String, default: "#000000" },
    position: { type: String, default: "lower" },
    animation: { type: String, default: "highlight" },
  },
  { _id: false },
);

const CaptionProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    videoUrl: { type: String, required: true },
    publicId: { type: String },
    duration: { type: String },
    durationSeconds: { type: Number, default: 0 },
    fileSize: { type: String },
    language: { type: String, default: "en" },
    rawTranscript: { type: String },
    captions: [CaptionItemSchema],
    styles: { type: CaptionStyleSchema, default: () => ({}) },
    seoMetadata: {
      titles: [{ type: String }],
      description: { type: String, default: "" },
      hashtags: [{ type: String }],
      highlight_keywords: [{ type: String }],
      targetLanguage: { type: String, default: "en" },
    },
  },
  {
    timestamps: true,
  },
);

export const CaptionProject = mongoose.model(
  "CaptionProject",
  CaptionProjectSchema,
);
