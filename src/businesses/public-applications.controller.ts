import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessOperationsService } from './business-operations.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

/**
 * Public job application.
 *
 * Deliberately unauthenticated: a candidate should not need a marketplace account to
 * apply for a job, and requiring one would quietly kill recruitment. It is also
 * deliberately narrow — it can only append an application to an open role, never read
 * anything back.
 */
@ApiTags('Businesses')
@Controller('businesses')
export class PublicApplicationsController {
  constructor(private readonly operations: BusinessOperationsService) {}

  @Post(':slug/openings/:openingId/apply')
  @ApiOperation({ summary: 'Apply for an open role at a business (public)' })
  async apply(
    @Param('slug') slug: string,
    @Param('openingId') openingId: string,
    @Body() body: any,
  ) {
    return this.operations.applyToOpening(slug, openingId, body);
  }

  /**
   * What a signed-in student may open from this business's library.
   *
   * The guard is optional: without a token the response is empty rather than a 401, so
   * the page can still show the public profile before anyone signs in.
   */
  @Get(':slug/resources')
  @UseGuards(OptionalJwtAuthGuard)
  async resources(@Param('slug') slug: string, @Req() req) {
    return this.operations.listResourcesForStudent(slug, req.user?.email);
  }
}
