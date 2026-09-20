import { ContactMessage } from "../models/ContactMessage.js";
import { NewsletterSubscriber } from "../models/NewsletterSubscriber.js";
import mongoose from "mongoose";

export const contactController = {
  /**
   * Handle contact inquiries and persist in MongoDB
   */
  async submitInquiry(req, res) {
    try {
      const { name, email, topic, message } = req.body;

      if (!email || !message) {
        return res.status(400).json({
          success: false,
          message: "Please provide both email and message.",
        });
      }

      console.log(
        `[Contact Submission]: from ${name || "Anonymous"} (${email}) - Topic: ${topic || "General"}`,
      );

      let savedDoc = null;
      if (mongoose.connection.readyState === 1) {
        try {
          savedDoc = await ContactMessage.create({
            name: name || "Anonymous",
            email,
            topic: topic || "general",
            message,
          });
          console.log(`[MongoDB]: Saved ContactMessage _id=${savedDoc._id}`);
        } catch (dbErr) {
          console.warn("[MongoDB Contact Save Warning]:", dbErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message:
          "Your inquiry has been received. Our team will contact you within 4 business hours.",
        inquiryId: savedDoc ? savedDoc._id : null,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to process inquiry.",
      });
    }
  },

  /**
   * Handle newsletter subscriptions and persist in MongoDB
   */
  async subscribeNewsletter(req, res) {
    try {
      const { email } = req.body;

      if (!email || !email.includes("@")) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }

      console.log(`[Newsletter Subscription]: ${email}`);

      if (mongoose.connection.readyState === 1) {
        try {
          await NewsletterSubscriber.findOneAndUpdate(
            { email: email.toLowerCase() },
            { $set: { email: email.toLowerCase(), active: true } },
            { upsert: true, new: true },
          );
          console.log(`[MongoDB]: Upserted NewsletterSubscriber: ${email}`);
        } catch (dbErr) {
          console.warn("[MongoDB Newsletter Save Warning]:", dbErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Successfully subscribed to Verbatim AI release updates.",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to subscribe.",
      });
    }
  },
};
