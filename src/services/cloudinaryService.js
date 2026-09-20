import { Readable } from 'stream';
import cloudinary from '../config/cloudinary.js';

export const cloudinaryService = {
  /**
   * Upload video buffer directly to Cloudinary
   * @param {Buffer} fileBuffer 
   * @param {string} originalName 
   * @returns {Promise<Object>} Cloudinary upload response with secure_url, duration, public_id
   */
  async uploadVideoBuffer(fileBuffer, originalName = 'video.mp4') {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder: 'verbatim_captions',
          public_id: `video_${Date.now()}`,
          overwrite: true
        },
        (error, result) => {
          if (error) {
            console.error('[Cloudinary Upload Error]:', error);
            return reject(error);
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            duration: result.duration || 0,
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height
          });
        }
      );

      // Stream the memory buffer to Cloudinary
      Readable.from(fileBuffer).pipe(uploadStream);
    });
  }
};
