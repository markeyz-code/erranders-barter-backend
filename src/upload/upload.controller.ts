import { Controller, Post, Query, UseInterceptors, UploadedFile, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { UploadService } from './upload.service';

@ApiTags('Upload')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  @Post('image')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.uploadFile(file, 'image');
  }

  @Post('video')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a video' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.uploadFile(file, 'video');
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file with ?resourceType=image|video|raw|audio' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadByResourceType(
    @UploadedFile() file: Express.Multer.File,
    @Query('resourceType') resourceType?: string,
  ) {
    const requested = (resourceType || 'image').toLowerCase();

    switch (requested) {
      case 'image':
        return this.uploadService.uploadFile(file, 'image');
      case 'video':
        return this.uploadService.uploadFile(file, 'video');
      case 'raw':
        return this.uploadService.uploadFile(file, 'raw');
      // Cloudinary has no audio resource type, so voice notes are uploaded as video assets.
      case 'audio':
        return this.uploadService.uploadFile(file, 'video', 'barter/audio');
      default:
        throw new BadRequestException(`Invalid resourceType "${resourceType}". Allowed: image, video, raw, audio`);
    }
  }
}
