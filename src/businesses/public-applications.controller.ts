import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessOperationsService } from './business-operations.service';

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
}
