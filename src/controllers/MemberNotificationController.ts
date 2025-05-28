import type { Guild, User } from "discord.js";
import type { MemberNotificationService } from "services/MemberNotificationService";
import { getLogger } from "utils/logger";
import type { NotificationType } from "views/MemberNotificationView";

export class MemberNotificationController {
  private logger = getLogger(this.constructor.name);
  private notificationService: MemberNotificationService;

  constructor(notificationService: MemberNotificationService) {
    this.notificationService = notificationService;
  }

  async handleMember(
    action: NotificationType,
    guild: Guild,
    user: User,
    options?: { until?: Date }
  ): Promise<void> {
    this.logger.info("Handling member join notification");
    // Logic to handle member join notification

    await this.notificationService.notify(action, guild, user, options);
  }
}
