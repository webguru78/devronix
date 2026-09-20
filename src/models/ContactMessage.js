import mongoose from "mongoose";

const ContactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "Anonymous" },
    email: { type: String, required: true, trim: true, lowercase: true },
    topic: { type: String, default: "general" },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ["new", "in_progress", "resolved"],
      default: "new",
    },
  },
  {
    timestamps: true,
  },
);

export const ContactMessage = mongoose.model(
  "ContactMessage",
  ContactMessageSchema,
);
