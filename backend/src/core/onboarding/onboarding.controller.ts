import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { UpdateOnboardingDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

/** التعريف بالنظام للمستخدم الجديد: الترحيب والجولة وخطوات إطلاق الشركة */
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  state(@CurrentUser() user: AuthUser) {
    return this.onboarding.state(user);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOnboardingDto) {
    return this.onboarding.update(user, dto);
  }

  @Post('replay')
  replay(@CurrentUser() user: AuthUser) {
    return this.onboarding.replay(user);
  }
}
