import {
  Client,
  Collection,
  type Snowflake,
  TextChannel,
  User,
  Guild,
} from "discord.js";
import {
  MessageRelayService,
  type Attachment,
} from "../../services/MessageRelayService";
import {
  UserThreadView,
  type UserThreadViewGuild,
  type UserThreadViewUser,
} from "views/UserThreadView";
import {
  StaffThreadView,
  type RelayMessageCreate,
} from "views/StaffThreadView";

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { randomSnowflakeID } from "tests/utils/snowflake";
import type { BotConfig } from "models/botConfig.model";

describe("MessageRelayService", () => {
  let client: Client;
  let service: MessageRelayService;
  let config: BotConfig;
  let messageRepository: any;
  const guildId = "123456789";

  beforeEach(() => {
    client = new Client({ intents: [] });
    messageRepository = {
      saveMessage: mock().mockResolvedValue({}),
      getByThreadMessageId: mock().mockResolvedValue(null),
      getByUserDMMessageId: mock().mockResolvedValue(null),
    };
    config = {
      initialMessage: "Welcome to modmail!",
      guildId,
    } as unknown as BotConfig;
    service = new MessageRelayService(config, client, messageRepository);
  });

  describe("relayUserMessageToStaff", () => {
    it("should relay user message to staff", async () => {
      const channelId = randomSnowflakeID();
      const message: RelayMessageCreate = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: new Collection<string, Attachment>(),
        stickers: new Collection(),
      };

      const threadChannel = {
        send: mock().mockResolvedValue({ id: "relayed-message-id" }),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);
      spyOn(StaffThreadView, "userReplyMessage").mockResolvedValue({
        embeds: [],
        files: [],
      });

      const result = await service.relayUserMessageToStaff(channelId, message);

      expect(client.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(StaffThreadView.userReplyMessage).toHaveBeenCalledWith(message);
      expect(threadChannel.send).toHaveBeenCalledWith({
        embeds: [],
        files: [],
      });
      expect(messageRepository.saveMessage).toHaveBeenCalledWith({
        threadId: channelId,
        messageId: "relayed-message-id",
        isStaff: false,
        authorId: message.author.id,
        userDmMessageId: message.id,
        content: message.content,
        staffRelayedMessageId: null,
        isAnonymous: null,
        isPlainText: null,
        isSnippet: null,
      });
      expect(result).toBe(true);
    });

    it("should relay attachments to staff", async () => {
      const channelId = randomSnowflakeID();

      const message: RelayMessageCreate = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: new Collection<string, Attachment>([
          [
            "attachment1",
            {
              id: "attachment1",
              name: "file1.txt",
              size: 123,
              url: "https://example.com/file1.txt",
            },
          ],
        ]),
        stickers: new Collection(),
      };

      const threadChannel = {
        send: mock().mockResolvedValue({ id: "relayed-message-id" }),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);
      spyOn(StaffThreadView, "userReplyMessage").mockResolvedValue({
        embeds: [],
        files: ["https://example.com/file1.txt"],
      });

      const result = await service.relayUserMessageToStaff(channelId, message);

      expect(client.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(StaffThreadView.userReplyMessage).toHaveBeenCalledWith(message);
      expect(threadChannel.send).toHaveBeenCalledWith({
        embeds: [],
        files: ["https://example.com/file1.txt"],
      });
      expect(messageRepository.saveMessage).toHaveBeenCalledWith({
        threadId: channelId,
        messageId: "relayed-message-id",
        isStaff: false,
        authorId: message.author.id,
        userDmMessageId: message.id,
        content: message.content,
        staffRelayedMessageId: null,
        isAnonymous: null,
        isPlainText: null,
        isSnippet: null,
      });
      expect(result).toBe(true);
    });

    it("should throw an error if channel is not found", async () => {
      const channelId = randomSnowflakeID();
      const message: RelayMessageCreate = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: new Collection<string, Attachment>(),
        stickers: new Collection(),
      };

      spyOn(client.channels, "fetch").mockResolvedValue(null);

      expect(
        service.relayUserMessageToStaff(channelId, message)
      ).rejects.toThrow(`Channel not found: ${channelId}`);
    });

    it("should throw an error if channel is not sendable", async () => {
      const channelId = randomSnowflakeID();
      const message: RelayMessageCreate = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: new Collection<string, Attachment>(),
        stickers: new Collection(),
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
      const userId = randomSnowflakeID();
      const guild = {} as UserThreadViewGuild;
      const content = "Hello, user!";
      const options = { anonymous: true, plainText: false, snippet: false };

      // Create a RelayMessage object instead of separate staffUser and content
      const msg: RelayMessageCreate = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "Staff#1234",
          displayName: "Staff",
          displayAvatarURL: () => "https://example.com/staff-avatar.png",
        },
        content,
        attachments: new Collection<string, Attachment>(),
        stickers: new Collection(),
      };

      const relayedMsg = {
        id: "relayed-message-id",
        channel: {
          id: "dm-channel-id",
        },
      };

      const user = {
        send: mock().mockResolvedValue(relayedMsg),
      } as unknown as User;

      spyOn(client.users, "fetch").mockResolvedValue(user);
      spyOn(UserThreadView, "staffMessage").mockResolvedValue({
        content: "Formatted message",
      });

      const result = await service.relayStaffMessageToUser(
        userId,
        guild,
        msg,
        options
      );

      expect(client.users.fetch, "should fetch user").toHaveBeenCalledWith(
        userId
      );
      expect(UserThreadView.staffMessage).toHaveBeenCalledWith(
        guild,
        msg,
        options
      );
      expect(user.send).toHaveBeenCalledWith({
        content: "Formatted message",
      });
      expect(result).toEqual({
        msgId: "relayed-message-id",
        dmChannelId: "dm-channel-id",
      });
    });
  });

  describe("sendInitialMessageToUser", () => {
    it("should send initial message to user", async () => {
      const userId = randomSnowflakeID();
      const initialMessage = "Welcome to modmail!";

      const user = {
        send: mock(),
      } as unknown as User;

      const guild = {
        id: guildId,
      } as unknown as Guild;

      spyOn(client.users, "fetch").mockResolvedValue(user);
      spyOn(client.guilds.cache, "get").mockReturnValue(guild);
      spyOn(UserThreadView, "initialMessage").mockReturnValue({
        content: initialMessage,
      });

      const result = await service.sendInitialMessageToUser(userId);

      expect(client.users.fetch).toHaveBeenCalledWith(userId);
      expect(client.guilds.cache.get).toHaveBeenCalledWith(guildId);

      expect(UserThreadView.initialMessage).toHaveBeenCalledWith(
        guild,
        initialMessage
      );
      expect(user.send).toHaveBeenCalledWith({
        content: initialMessage,
      });
      expect(result).toBe(initialMessage);
    });

    it("should throw if guild not found", async () => {
      const userId = randomSnowflakeID();

      const user = {
        send: mock(),
      } as unknown as User;

      spyOn(client.users, "fetch").mockResolvedValue(user);
      spyOn(client.guilds.cache, "get").mockReturnValue(undefined);

      expect(service.sendInitialMessageToUser(userId)).rejects.toThrow(
        `Guild not found: ${guildId}`
      );
    });

    it("should throw if error occurs", async () => {
      const userId = randomSnowflakeID();

      spyOn(client.users, "fetch").mockRejectedValue(
        new Error("User not found")
      );

      expect(service.sendInitialMessageToUser(userId)).rejects.toThrow(
        "User not found"
      );
    });
  });
});
