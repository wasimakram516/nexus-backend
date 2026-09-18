import { BadRequestException } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { CurrentUser } from '../../common/interfaces/current-user.interface';

describe('UploadController', () => {
  let controller: UploadController;
  let uploadServiceMock: { uploadFile: jest.Mock };

  const currentUser: CurrentUser = {
    sub: 'user-1',
    email: 'user@nexus.test',
    role: 'ADMIN',
    institutionId: 'institution-1',
  };

  beforeEach(() => {
    uploadServiceMock = { uploadFile: jest.fn() };
    controller = new UploadController(
      uploadServiceMock as unknown as UploadService,
    );
  });

  it('throws BadRequestException when no file is provided', async () => {
    await expect(
      controller.upload(
        undefined as unknown as Express.Multer.File,
        currentUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uploads the file scoped to the caller institution and returns the result', async () => {
    const file = { mimetype: 'image/png' } as Express.Multer.File;
    uploadServiceMock.uploadFile.mockResolvedValue({
      url: 'https://cdn.test/x.png',
      publicId: 'x',
      resourceType: 'image',
      format: 'png',
      folder: 'Nexus/images',
      bytes: 10,
    });

    const result = await controller.upload(file, currentUser, 'avatars');

    expect(uploadServiceMock.uploadFile).toHaveBeenCalledWith(file, {
      subfolder: 'avatars',
      institutionSlug: 'institution-1',
    });
    expect(result.message).toBe('File uploaded successfully.');
    expect(result.data.url).toBe('https://cdn.test/x.png');
  });
});
