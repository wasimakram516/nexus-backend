import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

// ─── File type → subfolder mapping ───────────────────────────────────────────
const MIME_FOLDER_MAP: Record<string, string> = {
  'image/jpeg':    'images',
  'image/jpg':     'images',
  'image/png':     'images',
  'image/webp':    'images',
  'image/gif':     'images',
  'image/svg+xml': 'images',
  'image/heic':    'images',
  'image/tiff':    'images',
  'video/mp4':     'videos',
  'video/webm':    'videos',
  'video/quicktime': 'videos',
  'video/mpeg':    'videos',
  'application/pdf': 'documents',
  'application/msword': 'documents',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'documents',
  'text/csv':      'documents',
};

export interface UploadResult {
  url: string;
  publicId: string;
  resourceType: string;
  format: string;
  folder: string;
  bytes: number;
}

@Injectable()
export class UploadService {
  private readonly baseFolder: string;

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    this.baseFolder = process.env.CLOUDINARY_FOLDER ?? 'Nexus';
  }

  async uploadFile(
    file: Express.Multer.File,
    options?: { subfolder?: string; institutionSlug?: string },
  ): Promise<UploadResult> {
    const typeFolder = options?.subfolder ?? MIME_FOLDER_MAP[file.mimetype] ?? 'misc';
    const institutionSegment = options?.institutionSlug ? `${options.institutionSlug}/` : '';
    const folder = `${this.baseFolder}/${institutionSegment}${typeFolder}`;

    const resourceType =
      file.mimetype.startsWith('video/') ? 'video' :
      file.mimetype.startsWith('image/') ? 'image' : 'raw';

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            reject(new InternalServerErrorException('Cloudinary upload failed: ' + error?.message));
            return;
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            resourceType: result.resource_type,
            format: result.format,
            folder: result.folder,
            bytes: result.bytes,
          });
        },
      );
      stream.end(file.buffer);
    });
  }

  async deleteFile(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}

// ─── S3 utility (ready for future migration) ─────────────────────────────────
// When switching to AWS S3, implement the same UploadResult interface here:
//
// import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
// export class S3UploadService {
//   async uploadFile(file, options): Promise<UploadResult> { ... }
// }
