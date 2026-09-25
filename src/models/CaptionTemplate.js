import mongoose from "mongoose";

const CaptionTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "Admin-created caption style", maxlength: 240 },
    badge: { type: String, default: "CUSTOM", maxlength: 24 },
    collection: { type: String, default: "admin_templates", index: true },
    settings: { type: mongoose.Schema.Types.Mixed, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const CaptionTemplate = mongoose.model("CaptionTemplate", CaptionTemplateSchema);