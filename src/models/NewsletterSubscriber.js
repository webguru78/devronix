import mongoose from "mongoose";

const NewsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  },
);

export const NewsletterSubscriber = mongoose.model(
  "NewsletterSubscriber",
  NewsletterSubscriberSchema,
);
