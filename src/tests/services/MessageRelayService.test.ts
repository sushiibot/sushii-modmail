import {
  Client,
  Collection,
  type Snowflake,
  TextChannel,
  User,
  Guild,
  MessageFlags,
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
import { StaffThreadView } from "views/StaffThreadView";
import type {
  UserToStaffMessage,
  StaffToUserMessage,
} from "../../models/relayMessage";

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { randomSnowflakeID } from "tests/utils/snowflake";
import type { BotConfig } from "models/botConfig.model";
import * as util from "views/util";

describe("MessageRelayService", () => {
  let client: Client;
  let service: MessageRelayService;
  let config: BotConfig;
  let configRepository: any;
  let messageRepository: any;
  let emojiRepository: any;
  let emojiMap: Map<any, any>;
  const guildId = "123456789";

  beforeEach(() => {
    client = new Client({ intents: [] });

    configRepository = {
      getConfig: mock().mockResolvedValue({
        guildId,
        forumChannelId: randomSnowflakeID(),
        openTagId: randomSnowflakeID(),
        initialMessage: "Welcome to modmail!",
      }),
    } as unknown as {
      getConfig: () => Promise<BotConfig>;
    };

    messageRepository = {
      saveMessage: mock().mockResolvedValue({}),
      getByThreadMessageId: mock().mockResolvedValue(null),
      getByUserDMMessageId: mock().mockResolvedValue(null),
    };

    emojiMap = new Map();
    emojiRepository = {
      getEmojiMap: mock().mockResolvedValue(emojiMap),
    };

    config = {
      guildId,
    } as unknown as BotConfig;
    service = new MessageRelayService(
      config,
      client,
      configRepository,
      messageRepository,
      emojiRepository
    );
  });

  describe("relayUserMessageToStaff", () => {
    it("should relay user message to staff", async () => {
      const channelId = randomSnowflakeID();
      const message: UserToStaffMessage = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: [],
        stickers: [],
        createdTimestamp: Date.now(),
      };

      const threadChannel = {
        send: mock().mockResolvedValue({ id: "relayed-message-id" }),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);
      spyOn(StaffThreadView, "userInitialReplyMessage").mockResolvedValue({
        components: [],
      });

      const result = await service.relayUserMessageToStaff(channelId, message);

      expect(client.channels.fetch).toHaveBeenCalledWith(channelId);
      expect(StaffThreadView.userInitialReplyMessage).toHaveBeenCalledWith(
        message,
        emojiMap
      );
      expect(threadChannel.send).lastCalledWith({
        components: [],
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
        attachmentUrls: [],
        stickers: [],
      });
      expect(result).toBe(true);
    });

    it("should relay attachments to staff", async () => {
      const channelId = randomSnowflakeID();

      const message: UserToStaffMessage = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: [
          {
            id: "attachment1",
            name: "file1.txt",
            url: "https://example.com/file1.txt",
          },
        ],
        stickers: [],
        createdTimestamp: Date.now(),
      };

      const threadChannel = {
        send: mock().mockResolvedValue({ id: "relayed-message-id" }),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);
      spyOn(StaffThreadView, "userInitialReplyMessage").mockResolvedValue({
        embeds: [],
        files: ["https://example.com/file1.txt"],
      });

      const result = await service.relayUserMessageToStaff(channelId, message);

      expect(client.channels.fetch).lastCalledWith(channelId);
      expect(StaffThreadView.userInitialReplyMessage).lastCalledWith(
        message,
        emojiMap
      );
      expect(threadChannel.send).lastCalledWith({
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
        attachmentUrls: ["https://example.com/file1.txt"],
        stickers: [],
      });
      expect(result).toBe(true);
    });

    it("should throw an error if channel is not found", async () => {
      const channelId = randomSnowflakeID();
      const message: UserToStaffMessage = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: [],
        stickers: [],
        createdTimestamp: Date.now(),
      };

      spyOn(client.channels, "fetch").mockResolvedValue(null);

      expect(
        service.relayUserMessageToStaff(channelId, message)
      ).rejects.toThrow(`Channel not found: ${channelId}`);
    });

    it("should throw an error if channel is not sendable", async () => {
      const channelId = randomSnowflakeID();
      const message: UserToStaffMessage = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "User#1234",
          displayName: "User",
          displayAvatarURL: () => "https://example.com/avatar.png",
        },
        content: "Hello, staff!",
        attachments: [],
        stickers: [],
        createdTimestamp: Date.now(),
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
      const threadId = randomSnowflakeID();
      const userId = randomSnowflakeID();
      const guild = {} as UserThreadViewGuild;
      const content = "Hello, user!";
      const options = { anonymous: true, plainText: false, snippet: false };

      // Create a RelayMessage object instead of separate staffUser and content
      const msg: StaffToUserMessage = {
        id: randomSnowflakeID(),
        author: {
          id: randomSnowflakeID(),
          username: "Staff#1234",
          displayName: "Staff",
          displayAvatarURL: () => "https://example.com/staff-avatar.png",
        },
        content,
        attachments: [],
        stickers: [],
        createdTimestamp: Date.now(),
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

      // --- Additional mocks for staff thread ---
      const staffThreadChannel = {
        send: mock().mockResolvedValue({
          id: "staff-thread-message-id",
          // Simulate Discord.js message object for extractComponentImages
          attachments: { values: () => [] },
          stickers: [],
        }),
        isSendable: mock().mockReturnValue(true),
      } as unknown as TextChannel;

      spyOn(client.channels, "fetch").mockResolvedValue(staffThreadChannel);
      spyOn(client.users, "fetch").mockResolvedValue(user);

      // Mock StaffThreadView.staffReplyComponents
      spyOn(StaffThreadView, "staffReplyComponents").mockReturnValue([]);
      // Mock downloadAttachments and extractComponentImages utilities
      spyOn(util, "downloadAttachments").mockResolvedValue([]);
      spyOn(util, "extractComponentImages").mockReturnValue({
        attachmentUrls: [],
        stickers: [],
      });

      spyOn(UserThreadView, "staffMessage").mockResolvedValue({
        content: "Formatted message",
      });

      await service.relayStaffMessageToUser(
        threadId,
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
      expect(client.channels.fetch).toHaveBeenCalledWith(threadId);
      expect(staffThreadChannel.send).toHaveBeenCalled();
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

      expect(UserThreadView.initialMessage).lastCalledWith(
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
