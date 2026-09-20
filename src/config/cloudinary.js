import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'kfxg7rog',
  api_key: process.env.CLOUDINARY_API_KEY || '987529668931193',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'zu3Rs52aGF5r5-ebXaPetv7dA2w',
  secure: true
});

export default cloudinary;
