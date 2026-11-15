import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../core/auth/decorators';
import { PortalLoginDto, PortalProfileDto, PortalRegisterDto, PortalRequestDto, TicketDto } from './portal.dto';
import { CurrentPortalUser, PortalGuard, PortalUser } from './portal.guard';
import { PortalService } from './portal.service';
import { ResubmitDto } from './requests.dto';

const uuid = new ParseUUIDPipe();

/**
 * بوابة المستفيدين (خارج نظام دخول الموظفين):
 * /portal/o/:slug/...  عام لكل جمعية (المعلومات، التسجيل، الدخول)
 * /portal/...          بعد دخول المستفيد
 */
@Public()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('o/:slug')
  info(@Param('slug') slug: string) {
    return this.portal.info(slug);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('o/:slug/register')
  register(@Param('slug') slug: string, @Body() dto: PortalRegisterDto) {
    return this.portal.register(slug, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('o/:slug/login')
  @HttpCode(200)
  login(@Param('slug') slug: string, @Body() dto: PortalLoginDto) {
    return this.portal.login(slug, dto);
  }

  @UseGuards(PortalGuard)
  @Get('me')
  me(@CurrentPortalUser() p: PortalUser) {
    return this.portal.me(p);
  }

  @UseGuards(PortalGuard)
  @Patch('me')
  updateMe(@CurrentPortalUser() p: PortalUser, @Body() dto: PortalProfileDto) {
    return this.portal.updateProfile(p, dto);
  }

  @UseGuards(PortalGuard)
  @Get('projects')
  projects(@CurrentPortalUser() p: PortalUser) {
    return this.portal.projects(p.organizationId);
  }

  @UseGuards(PortalGuard)
  @Get('requests')
  requests(@CurrentPortalUser() p: PortalUser) {
    return this.portal.myRequests(p);
  }

  @UseGuards(PortalGuard)
  @Post('requests')
  submit(@CurrentPortalUser() p: PortalUser, @Body() dto: PortalRequestDto) {
    return this.portal.submitRequest(p, dto);
  }

  @UseGuards(PortalGuard)
  @Get('requests/:id')
  request(@CurrentPortalUser() p: PortalUser, @Param('id', uuid) id: string) {
    return this.portal.request(p, id);
  }

  @UseGuards(PortalGuard)
  @Post('requests/:id/resubmit')
  @HttpCode(200)
  resubmit(@CurrentPortalUser() p: PortalUser, @Param('id', uuid) id: string, @Body() dto: ResubmitDto) {
    return this.portal.resubmit(p, id, dto);
  }

  @UseGuards(PortalGuard)
  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentPortalUser() p: PortalUser, @Param('id', uuid) id: string) {
    return this.portal.cancel(p, id);
  }

  @UseGuards(PortalGuard)
  @Get('tickets')
  tickets(@CurrentPortalUser() p: PortalUser) {
    return this.portal.listTickets(p);
  }

  @UseGuards(PortalGuard)
  @Post('tickets')
  createTicket(@CurrentPortalUser() p: PortalUser, @Body() dto: TicketDto) {
    return this.portal.createTicket(p, dto);
  }
}
