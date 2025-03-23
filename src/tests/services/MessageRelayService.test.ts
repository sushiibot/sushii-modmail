import {
  Client,
  Collection,
  type Snowflake,
  TextChannel,
  User,
} from "discord.js";
import {
  MessageRelayService,
  type Attachment,
  type MessageRelayServiceMessage,
} from "../../services/MessageRelayService";
import {
  UserThreadView,
  type UserThreadViewGuild,
  type UserThreadViewUser,
} from "views/UserThreadView";

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

describe("MessageRelayService", () => {
  let client: Client;
  let service: MessageRelayService;

  beforeEach(() => {
    client = new Client({ intents: [] });
    service = new MessageRelayService(client);
  });

  describe("relayUserMessageToStaff", () => {
    it("should relay user message to staff", async () => {
      const channelId = "123456789";
      const message: MessageRelayServiceMessage = {
        author: { tag: "User#1234" },
        content: "Hello, staff!",
        attachments: new Collection<Snowflake, Attachment>(),
      };

      const threadChannel = {
        send: mock(),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);

      const result = await service.relayUserMessageToStaff(channelId, message);

      expect(client.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(threadChannel.send).toHaveBeenCalledWith({
        content: `**User#1234:** Hello, staff!`,
        files: [],
      });
      expect(result).toBe(true);
    });

    it("should relay attachments to staff", async () => {
      const channelId = "123456789";

      const message: MessageRelayServiceMessage = {
        author: { tag: "User#1234" },
        content: "Hello, staff!",
        attachments: new Collection<Snowflake, Attachment>([
          [
            "attachment1",
            {
              id: "attachment1",
              filename: "file1.txt",
              size: 123,
              url: "https://example.com/file1.txt",
            },
          ],
        ]),
      };

      const threadChannel = {
        send: mock(),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);

      const result = await service.relayUserMessageToStaff(channelId, message);

      expect(client.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(threadChannel.send).toHaveBeenCalledWith({
        content: `**User#1234:** Hello, staff!`,
        files: ["https://example.com/file1.txt"],
      });
      expect(result).toBe(true);
    });

    it("should throw an error if channel is not found", async () => {
      const channelId = "123456789";
      const message: MessageRelayServiceMessage = {
        author: { tag: "User#1234" },
        content: "Hello, staff!",
        attachments: new Collection<Snowflake, Attachment>(),
      };

      spyOn(client.channels, "fetch").mockResolvedValue(null);

      expect(
        service.relayUserMessageToStaff(channelId, message)
      ).rejects.toThrow(`Channel not found: ${channelId}`);
    });

    it("should throw an error if channel is not sendable", async () => {
      const channelId = "123456789";
      const message: MessageRelayServiceMessage = {
        author: { tag: "User#1234" },
        content: "Hello, staff!",
        attachments: new Collection<Snowflake, Attachment>(),
      };

      const threadChannel = {
        isSendable: mock().mockReturnValue(false),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);

      expect(
        service.relayUserMessageToStaff(channelId, message)
      ).rejects.toThrow(`Cannot send to channel: ${channelId}`);
    });
  });

  describe("relayStaffMessageToUser", () => {
    it("should relay staff message to user", async () => {
      const userId = "987654321";
      const guild = {} as UserThreadViewGuild;
      const staffUser = {} as UserThreadViewUser;
      const content = "Hello, user!";
      const options = { anonymous: true };

      const user = {
        send: mock(),
      } as unknown as User;

      spyOn(client.users, "fetch").mockResolvedValue(user);
      spyOn(UserThreadView, "staffMessage").mockReturnValue({
        content: "Formatted message",
      });

      await service.relayStaffMessageToUser(
        userId,
        guild,
        staffUser,
        content,
        options
      );

      expect(client.users.fetch, "should fetch user").toHaveBeenCalledWith(
        userId
      );
      expect(UserThreadView.staffMessage).toHaveBeenCalledWith(
        guild,
        staffUser,
        content,
        options
      );
      expect(user.send).toHaveBeenCalledWith({
        content: "Formatted message",
      });
    });
  });
});
