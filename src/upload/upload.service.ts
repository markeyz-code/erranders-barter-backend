import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

// Cloudinary only supports image | video | raw. Audio (voice notes) is stored as a video asset.
export type UploadResourceType = 'image' | 'video' | 'raw';

const FOLDER_BY_TYPE: Record<UploadResourceType, string> = {
  image: 'barter/images',
  video: 'barter/videos',
  raw: 'barter/files',
};

@Injectable()
export class UploadService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    type: UploadResourceType = 'image',
    folder?: string,
  ): Promise<{ url: string; publicId: string }> {
    if (!file) throw new BadRequestException('No file provided');

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: type,
          folder: folder || FOLDER_BY_TYPE[type],
          transformation: type === 'image' ? [{ width: 1200, crop: 'limit', quality: 'auto' }] : undefined,
        },
        (error, result) => {
          if (error) return reject(new BadRequestException(error.message));
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      uploadStream.end(file.buffer);
    });
  }
}
