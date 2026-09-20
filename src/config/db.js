import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { webcrypto } from "crypto";

// Polyfill for Node.js 18.x where globalThis.crypto isn't defined by default
// (MongoDB driver needs it internally). Safe to keep even after upgrading Node.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is resolved relative to backend root even if process.cwd() differs in cPanel
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

let lastDbError = null;

export const getLastDbError = () => lastDbError;

export async function connectDB() {
  const envUri = process.env.MONGODB_URI;

  if (!envUri) {
    console.error(
      "[MongoDB Error]: MONGODB_URI not found in environment variables! Please check your .env file or cPanel Environment Variables.",
    );
    lastDbError = "MONGODB_URI not found in environment variables";
    return;
  }

  // If we are on cPanel and the user forgot to change +srv to standard, we provide an automatic fallback
  const fallbackUri =
    "mongodb://devronixagency_db_user:BxkpBxobUmLawq3P@ac-t1te92h-shard-00-00.nqxscxi.mongodb.net:27017,ac-t1te92h-shard-00-01.nqxscxi.mongodb.net:27017,ac-t1te92h-shard-00-02.nqxscxi.mongodb.net:27017/verbatim_ai?ssl=true&replicaSet=atlas-szs9mn-shard-0&authSource=admin&retryWrites=true&w=majority";

  try {
    console.log("[MongoDB]: Connecting to MongoDB Atlas...");
    const conn = await mongoose.connect(envUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`🍃 MongoDB Atlas Connected: ${conn.connection.host}`);
    console.log(`📁 Database Name: ${conn.connection.name}`);
    lastDbError = null;
  } catch (error) {
    console.error(
      "[MongoDB Connection Error with Primary URI]:",
      error.message,
    );

    // Automatic fallback for cPanel DNS SRV issues
    console.log(
      "[MongoDB]: Attempting automatic fallback to standard Direct Node URI...",
    );
    try {
      const conn = await mongoose.connect(fallbackUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(
        `🍃 MongoDB Atlas Connected (via Fallback): ${conn.connection.host}`,
      );
      lastDbError = null;
    } catch (fallbackError) {
      console.error(
        "[MongoDB Fallback Connection Error]:",
        fallbackError.message,
      );
      lastDbError = fallbackError.message;
    }
  }
}

mongoose.connection.on("disconnected", () => {
  console.log("[MongoDB]: Connection disconnected.");
});

mongoose.connection.on("error", (err) => {
  console.error("[MongoDB Runtime Error]:", err);
  lastDbError = err.message;
});
