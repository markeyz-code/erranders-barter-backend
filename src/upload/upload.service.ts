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
  ): Promise<{ url: string; publicId: string; thumbnailUrl?: string }> {
    if (!file) throw new BadRequestException('No file provided');

    return new Promise((resolve, reject) => {
      const isVideo = type === 'video';
      const uploadOptions: any = {
        resource_type: type,
        folder: folder || FOLDER_BY_TYPE[type],
      };

      if (isVideo) {
        uploadOptions.chunk_size = 6000000; // 6MB chunks for resilience
        uploadOptions.eager = [
          { quality: 'auto:eco', fetch_format: 'auto', width: 720, crop: 'limit' },
          { format: 'jpg', start_offset: '0', width: 600, crop: 'limit' }
        ];
        uploadOptions.eager_async = true;
      } else if (type === 'image') {
        uploadOptions.transformation = [
          { width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
        ];
      }

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) return reject(new BadRequestException(error.message));
          
          let optimizedUrl = result.secure_url;
          let thumbnailUrl: string | undefined = undefined;

          if (isVideo && optimizedUrl) {
            // Aggressive Cloudinary delivery optimization for Reels & UI
            if (!optimizedUrl.includes('/q_auto')) {
              optimizedUrl = optimizedUrl.replace(
                '/video/upload/',
                '/video/upload/q_auto:eco,f_auto,w_720,c_limit,vc_auto/'
              );
            }
            // Poster frame at second 0 for instant image rendering on search cards
            thumbnailUrl = result.secure_url
              .replace('/video/upload/', '/video/upload/so_0,q_auto,f_auto,w_600,c_limit/')
              .replace(/\.[^.]+$/, '.jpg');
          }

          resolve({
            url: optimizedUrl,
            publicId: result.public_id,
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
          });
        },
      );
      uploadStream.end(file.buffer);
    });
  }
}
