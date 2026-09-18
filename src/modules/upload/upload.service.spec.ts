import { InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { UploadService } from './upload.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

describe('UploadService', () => {
  let service: UploadService;
  type UploadStreamCallback = (
    error: { message: string } | undefined,
    result: Record<string, unknown> | undefined,
  ) => void;
  const uploadStreamMock = cloudinary.uploader
    .upload_stream as unknown as jest.Mock<
    { end: jest.Mock },
    [unknown, UploadStreamCallback]
  >;
  const destroyMock = cloudinary.uploader.destroy as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadService();
  });

  const buildFile = (mimetype: string): Express.Multer.File =>
    ({
      mimetype,
      buffer: Buffer.from('data'),
      originalname: 'file.bin',
    }) as Express.Multer.File;

  it('uploads an image into the images subfolder and maps the response', async () => {
    uploadStreamMock.mockImplementation((_opts, callback) => {
      callback(undefined, {
        secure_url: 'https://cdn.test/image.png',
        public_id: 'Nexus/images/image',
        resource_type: 'image',
        format: 'png',
        folder: 'Nexus/images',
        bytes: 1024,
      });
      return { end: jest.fn() };
    });

    const result = await service.uploadFile(buildFile('image/png'));

    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'Nexus/images',
        resource_type: 'image',
      }),
      expect.any(Function),
    );
    expect(result).toEqual({
      url: 'https://cdn.test/image.png',
      publicId: 'Nexus/images/image',
      resourceType: 'image',
      format: 'png',
      folder: 'Nexus/images',
      bytes: 1024,
    });
  });

  it('routes an unmapped mimetype into the misc folder as a raw resource', async () => {
    uploadStreamMock.mockImplementation((_opts, callback) => {
      callback(undefined, {
        secure_url: 'https://cdn.test/file.bin',
        public_id: 'Nexus/misc/file',
        resource_type: 'raw',
        format: 'bin',
        folder: 'Nexus/misc',
        bytes: 10,
      });
      return { end: jest.fn() };
    });

    await service.uploadFile(buildFile('application/octet-stream'));

    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'Nexus/misc', resource_type: 'raw' }),
      expect.any(Function),
    );
  });

  it('scopes the folder under the institution slug when provided', async () => {
    uploadStreamMock.mockImplementation((_opts, callback) => {
      callback(undefined, {
        secure_url: 'https://cdn.test/x',
        public_id: 'x',
        resource_type: 'image',
        format: 'png',
        folder: 'x',
        bytes: 1,
      });
      return { end: jest.fn() };
    });

    await service.uploadFile(buildFile('image/png'), {
      institutionSlug: 'nexus-academy',
    });

    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'Nexus/nexus-academy/images' }),
      expect.any(Function),
    );
  });

  it('rejects with InternalServerErrorException when Cloudinary returns an error', async () => {
    uploadStreamMock.mockImplementation((_opts, callback) => {
      callback({ message: 'boom' }, undefined);
      return { end: jest.fn() };
    });

    await expect(service.uploadFile(buildFile('image/png'))).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('deletes a file by public id', async () => {
    destroyMock.mockResolvedValue({ result: 'ok' });

    await service.deleteFile('Nexus/images/image');

    expect(destroyMock).toHaveBeenCalledWith('Nexus/images/image');
  });
});
