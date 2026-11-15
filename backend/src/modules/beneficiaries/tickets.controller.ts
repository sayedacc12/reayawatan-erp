import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';
import { TicketReplyDto } from './portal.dto';
import { TicketsService } from './tickets.service';

@Controller('beneficiaries/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @RequirePermissions(P.tickets)
  list(@CurrentOrgUser() actor: OrgUser, @Query('type') type?: string, @Query('status') status?: string) {
    return this.tickets.list(actor, { type, status });
  }

  @Post(':id/reply')
  @RequirePermissions(P.tickets)
  reply(@CurrentOrgUser() actor: OrgUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TicketReplyDto) {
    return this.tickets.reply(actor, id, dto.reply, !!dto.close);
  }
}
