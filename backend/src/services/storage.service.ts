import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env.js';

export interface UploadResult {
  fileKey: string;
  fileUrl: string;
  fileSize: number;
}

export interface FileDownloadStream {
  stream: Readable;
  contentType: string;
  contentLength?: number;
}

class StorageService {
  private s3Client: S3Client | null = null;

  constructor() {
    if (config.storage.driver === 's3') {
      const { endpoint, region, accessKeyId, secretAccessKey } = config.storage.s3;

      if (accessKeyId && secretAccessKey) {
        this.s3Client = new S3Client({
          region,
          endpoint: endpoint || undefined,
          forcePathStyle: true, // Needed for Supabase Storage and MinIO
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        });
      } else {
        console.warn('⚠️ S3 driver selected but S3 credentials missing. Falling back to local storage.');
      }
    }

    // Ensure local directory exists for fallback or local driver
    if (!fs.existsSync(config.storage.localUploadDir)) {
      fs.mkdirSync(config.storage.localUploadDir, { recursive: true });
    }
  }

  /**
   * Uploads a file buffer to S3 or local disk
   */
  async uploadFile(file: Express.Multer.File, subfolder = 'notes'): Promise<UploadResult> {
    const timestamp = Date.now();
    const cleanFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `${subfolder}/${timestamp}-${cleanFileName}`;

    if (this.s3Client && config.storage.driver === 's3') {
      // 1. S3 / Supabase Storage Upload
      const command = new PutObjectCommand({
        Bucket: config.storage.s3.bucket,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/pdf',
        Metadata: {
          originalName: cleanFileName,
        },
      });

      await this.s3Client.send(command);

      const publicBase = config.storage.s3.publicUrl;
      const fileUrl = publicBase
        ? `${publicBase}/${fileKey}`
        : `/api/notes/files/${fileKey}`;

      return {
        fileKey,
        fileUrl,
        fileSize: file.size,
      };
    } else {
      // 2. Local Disk Storage
      const targetDir = path.join(config.storage.localUploadDir, subfolder);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const filePath = path.join(config.storage.localUploadDir, fileKey);
      await fs.promises.writeFile(filePath, file.buffer);

      const fileUrl = `/api/notes/files/${fileKey}`;

      return {
        fileKey,
        fileUrl,
        fileSize: file.size,
      };
    }
  }

  /**
   * Fetches a file readable stream from S3 or local disk
   */
  async getFileStream(fileKey: string): Promise<FileDownloadStream> {
    if (this.s3Client && config.storage.driver === 's3') {
      const command = new GetObjectCommand({
        Bucket: config.storage.s3.bucket,
        Key: fileKey,
      });

      const response = await this.s3Client.send(command);
      return {
        stream: response.Body as Readable,
        contentType: response.ContentType || 'application/pdf',
        contentLength: response.ContentLength,
      };
    } else {
      const filePath = path.join(config.storage.localUploadDir, fileKey);
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found on disk');
      }

      const stat = await fs.promises.stat(filePath);
      const stream = fs.createReadStream(filePath);

      return {
        stream,
        contentType: 'application/pdf',
        contentLength: stat.size,
      };
    }
  }

  /**
   * Deletes a file from S3 or local disk
   */
  async deleteFile(fileKey: string): Promise<void> {
    if (this.s3Client && config.storage.driver === 's3') {
      try {
        const command = new DeleteObjectCommand({
          Bucket: config.storage.s3.bucket,
          Key: fileKey,
        });
        await this.s3Client.send(command);
      } catch (err) {
        console.warn(`Failed to delete S3 file ${fileKey}:`, err);
      }
    } else {
      const filePath = path.join(config.storage.localUploadDir, fileKey);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath).catch(() => {});
      }
    }
  }
}

export const storageService = new StorageService();
