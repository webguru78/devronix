import mongoose from "mongoose";

const ClipItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    cleanUrl: { type: String },
    publicId: { type: String },
    title: { type: String, default: "Highlight Clip" },
    reason: { type: String, default: "" },
    duration: { type: Number, default: 0 },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    thumbnailUrl: { type: String },
    captions: { type: Array, default: [] },
    templateId: { type: String },
    customStyles: { type: Object, default: null },
    language: { type: String },
  },
  { _id: true }
);

const HighlightCandidateSchema = new mongoose.Schema(
  {
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    title: { type: String, required: true },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const EstimatedCostSchema = new mongoose.Schema(
  {
    whisperMinutes: { type: Number, default: 0 },
    whisperCost: { type: Number, default: 0 },
    gptPromptTokens: { type: Number, default: 0 },
    gptCompletionTokens: { type: Number, default: 0 },
    gptCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
  },
  { _id: false }
);

const ClipJobSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "guest_user", index: true },
    title: { type: String, default: "Video Job" },
    originalVideoUrl: { type: String, required: true },
    originalPublicId: { type: String },
    sourceType: { type: String, enum: ["upload", "url"], default: "upload" },
    durationSeconds: { type: Number, default: 0 },
    language: { type: String, default: "roman_urdu" },
    templateId: { type: String, default: "hormozi_gold_impact" },
    framingMode: {
      type: String,
      enum: ["split_screen", "center_crop", "smart_blur", "fit"],
      default: "split_screen",
    },
    status: {
      type: String,
      enum: [
        "queued",
        "extracting_audio",
        "transcribing",
        "detecting_highlights",
        "generating_clips",
        "complete",
        "failed",
      ],
      default: "queued",
      index: true,
    },
    currentStep: {
      type: String,
      default: "Job queued and waiting for worker",
    },
    progress: { type: Number, default: 0 },
    totalClipsTarget: { type: Number, default: 0 },
    completedClipsCount: { type: Number, default: 0 },
    transcript: {
      rawText: { type: String, default: "" },
      language: { type: String, default: "en" },
      duration: { type: Number, default: 0 },
      words: { type: Array, default: [] },
      segments: { type: Array, default: [] },
    },
    highlights: [HighlightCandidateSchema],
    clips: [ClipItemSchema],
    estimatedCost: {
      type: EstimatedCostSchema,
      default: () => ({}),
    },
    error: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

ClipJobSchema.index({ userId: 1, createdAt: -1 });
ClipJobSchema.index({ status: 1, createdAt: 1 });

export const ClipJob = mongoose.model("ClipJob", ClipJobSchema);
