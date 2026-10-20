import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessOperationsService } from './business-operations.service';

/**
 * The operating endpoints for a business owner: money, people, branches, automation.
 *
 * Everything under `me/` is scoped to the caller's own business, resolved from the JWT —
 * no route here accepts a business id, so one owner can never address another's operation.
 */
@ApiTags('Business operations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('businesses/me')
export class BusinessOperationsController {
  constructor(private readonly operations: BusinessOperationsService) {}

  // ── Money ──────────────────────────────────────────────────────────────────

  @Get('transactions')
  @ApiOperation({ summary: 'Running ledger: completed jobs as credits, payouts as debits' })
  async transactions(@Req() req, @Query() query: any) {
    return this.operations.getTransactions(req.user.userId, query);
  }

  @Get('payouts')
  @ApiOperation({ summary: 'Payout history plus the available balance' })
  async payouts(@Req() req) {
    return this.operations.listPayouts(req.user.userId);
  }

  @Post('payouts')
  @ApiOperation({ summary: 'Request a payout of the available balance' })
  async requestPayout(@Req() req, @Body() body: any) {
    return this.operations.requestPayout(req.user.userId, body);
  }


  // ── Templates & business type ──────────────────────────────────────────────

  @Get('templates')
  @ApiOperation({ summary: 'Page templates, with the one that suits this business recommended' })
  async templates(@Req() req) {
    return this.operations.listTemplates(req.user.userId);
  }

  @Post('page/template')
  @ApiOperation({ summary: 'Apply a template, replacing the current page design' })
  async applyTemplate(@Req() req, @Body() body: any) {
    return this.operations.applyTemplate(req.user.userId, body);
  }

  @Patch('type')
  @ApiOperation({ summary: 'Set what kind of business this is' })
  async setType(@Req() req, @Body() body: any) {
    return this.operations.setBusinessType(req.user.userId, body);
  }

  // ── Products & inventory ───────────────────────────────────────────────────

  @Get('products')
  @ApiOperation({ summary: 'Catalogue with profit, margin and stock value' })
  async products(@Req() req) {
    return this.operations.listProducts(req.user.userId);
  }

  @Post('products')
  @ApiOperation({ summary: 'Add a product' })
  async addProduct(@Req() req, @Body() body: any) {
    return this.operations.addProduct(req.user.userId, body);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  async updateProduct(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.operations.updateProduct(req.user.userId, id, body);
  }

  @Patch('products/:id/stock')
  @ApiOperation({ summary: 'Adjust stock by a delta (+/-)' })
  async adjustStock(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.operations.adjustStock(req.user.userId, id, body);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Remove a product' })
  async removeProduct(@Req() req, @Param('id') id: string) {
    return this.operations.removeProduct(req.user.userId, id);
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  @Get('resources')
  @ApiOperation({ summary: "The owner's resource library" })
  async resources(@Req() req) {
    return this.operations.listResources(req.user.userId);
  }

  @Post('resources')
  @ApiOperation({ summary: 'Add a resource' })
  async addResource(@Req() req, @Body() body: any) {
    return this.operations.addResource(req.user.userId, body);
  }

  @Patch('resources/:id/access')
  @ApiOperation({ summary: 'Grant or revoke one student email' })
  async setResourceAccess(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.operations.setResourceAccess(req.user.userId, id, body);
  }

  @Delete('resources/:id')
  @ApiOperation({ summary: 'Remove a resource' })
  async removeResource(@Req() req, @Param('id') id: string) {
    return this.operations.removeResource(req.user.userId, id);
  }

  // ── Page builder ───────────────────────────────────────────────────────────

  @Get('page')
  @ApiOperation({ summary: "The owner's public page design and the available section types" })
  async getPage(@Req() req) {
    return this.operations.getPage(req.user.userId);
  }

  @Put('page')
  @ApiOperation({ summary: 'Replace the public page design' })
  async updatePage(@Req() req, @Body() body: any) {
    return this.operations.updatePage(req.user.userId, body);
  }

  // ── Automation ─────────────────────────────────────────────────────────────

  @Get('automation')
  @ApiOperation({ summary: "The business's automation settings" })
  async getAutomation(@Req() req) {
    return this.operations.getAutomation(req.user.userId);
  }

  @Patch('automation')
  @ApiOperation({ summary: 'Turn automation on or off and tune its limits' })
  async updateAutomation(@Req() req, @Body() body: any) {
    return this.operations.updateAutomation(req.user.userId, body);
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  @Get('locations')
  @ApiOperation({ summary: 'Branches this business operates from' })
  async listLocations(@Req() req) {
    return this.operations.listLocations(req.user.userId);
  }

  @Post('locations')
  @ApiOperation({ summary: 'Add a branch' })
  async addLocation(@Req() req, @Body() body: any) {
    return this.operations.addLocation(req.user.userId, body);
  }

  @Patch('locations/:id')
  @ApiOperation({ summary: 'Update a branch' })
  async updateLocation(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.operations.updateLocation(req.user.userId, id, body);
  }

  @Delete('locations/:id')
  @ApiOperation({ summary: 'Remove a branch' })
  async removeLocation(@Req() req, @Param('id') id: string) {
    return this.operations.removeLocation(req.user.userId, id);
  }

  // ── Recruitment ────────────────────────────────────────────────────────────

  @Get('applications')
  @ApiOperation({ summary: 'Applications received across every opening' })
  async listApplications(@Req() req, @Query() query: any) {
    return this.operations.listApplications(req.user.userId, query);
  }

  @Patch('applications/:id')
  @ApiOperation({ summary: 'Shortlist, hire or reject a candidate (hiring adds them to crew)' })
  async updateApplication(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.operations.updateApplication(req.user.userId, id, body);
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  @Patch('bookings/:id/assign')
  @ApiOperation({ summary: 'Assign a booking to one of your crew' })
  async assignCrew(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.operations.assignCrew(req.user.userId, id, body);
  }

  // ── Insight ────────────────────────────────────────────────────────────────

  @Get('analytics')
  @ApiOperation({ summary: 'Revenue, volume and service mix over a window' })
  async analytics(@Req() req, @Query() query: any) {
    return this.operations.getAnalytics(req.user.userId, query);
  }

  @Get('customers')
  @ApiOperation({ summary: 'Customers who have booked, most valuable first' })
  async customers(@Req() req) {
    return this.operations.listCustomers(req.user.userId);
  }
}
