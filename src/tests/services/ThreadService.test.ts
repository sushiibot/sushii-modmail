import {
  Client,
  ChannelType,
  TextChannel,
  ThreadChannel,
  SnowflakeUtil,
  ForumChannel,
  type ForumThreadChannel,
  Guild,
  User,
  type GuildForumTag,
  Collection,
  DiscordAPIError,
  RESTJSONErrorCodes,
} from "discord.js";
import { ThreadService } from "../../services/ThreadService";
import { ThreadRepository } from "../../repositories/thread.repository";
import { Thread } from "../../models/thread.model";
import { StaffThreadView } from "../../views/StaffThreadView";
import { getLogger } from "utils/logger";

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { getDb } from "database/db";
import { randomSnowflakeID } from "tests/utils/snowflake";
import { mockThread } from "tests/models/thread.model.mock.test";
import type { BotConfig } from "models/botConfig.model";
import type { RuntimeConfig } from "models/runtimeConfig.model";

// Mock dependencies
const mockThreadRepository = {
  getOpenThreadByUserID: mock(),
  getThreadByChannelId: mock(),
  getAllThreadsByUserId: mock(),
  createThread: mock(),
  closeThread: mock(),
};

const mockRuntimeConfigRepository = {
  getConfig: mock(),
  setOpenTagId: mock(),
};

describe("ThreadService", () => {
  let client: Client;
  let threadService: ThreadService;
  let config: BotConfig;

  let guildMock: Guild;

  beforeEach(() => {
    config = {
      guildId: randomSnowflakeID(),
      forumChannelId: randomSnowflakeID(),
    } as unknown as BotConfig;

    client = {
      channels: {
        fetch: mock(),
      },
      guilds: {
        cache: {
          get: mock(),
          values: mock(() => []),
        },
      },
      users: {
        fetch: mock(),
      },
    } as unknown as Client;

    guildMock = {
      members: {
        fetch: mock(() => Promise.resolve(123)),
      },
    } as unknown as Guild;

    threadService = new ThreadService(
      config,
      client,
      mockThreadRepository,
      mockRuntimeConfigRepository
    );
  });

  describe("getOpenTagId", () => {
    it("should return the open tag ID from runtime config", async () => {
      const runtimeConfig = {
        openTagId: "openTagId123",
      } as RuntimeConfig;

      mockRuntimeConfigRepository.getConfig.mockResolvedValue(runtimeConfig);

      const result = await threadService.getOpenTagId();

      expect(result).toBe("openTagId123");
      expect(mockRuntimeConfigRepository.getConfig).toHaveBeenCalledWith(
        config.guildId
      );
    });

    it("should return null if runtime config is not found", async () => {
      mockRuntimeConfigRepository.getConfig.mockResolvedValue(null);

      const result = await threadService.getOpenTagId();

      expect(result).toBeNull();
      expect(mockRuntimeConfigRepository.getConfig).toHaveBeenCalledWith(
        config.guildId
      );
    });
  });

  describe("createOpenTag", () => {
    it("should create an open tag and save it to the runtime config", async () => {
      const tagId = randomSnowflakeID();

      const forumChannel = {
        availableTags: [],
        setAvailableTags: mock((tags: GuildForumTag[]) => {
          forumChannel.availableTags = tags.map((tag) => {
            // For the "Open" tag, use our known tagId
            if (tag.name === "Open" && !tag.id) {
              return { ...tag, id: tagId };
            }

            return tag;
          });

          return Promise.resolve(forumChannel);
        }),
      } as unknown as ForumChannel;

      mockRuntimeConfigRepository.setOpenTagId.mockResolvedValue(
        {} as RuntimeConfig
      );

      const result = await threadService.createOpenTag(forumChannel);

      expect(result).toBe(tagId);
      expect(forumChannel.setAvailableTags).toHaveBeenCalled();
      expect(mockRuntimeConfigRepository.setOpenTagId).toHaveBeenCalledWith(
        config.guildId,
        tagId
      );
    });
  });

  describe("getOrCreateThread", () => {
    it("should return an existing thread if found", async () => {
      const username = "testuser";
      const existingThread = mockThread();
      const userId = existingThread.userId;

      mockThreadRepository.getOpenThreadByUserID.mockResolvedValue(
        existingThread
      );

      const { thread, isNew } = await threadService.getOrCreateThread(
        userId,
        username
      );

      expect(isNew).toBe(false);
      expect(thread).toBe(existingThread);
      expect(mockThreadRepository.getOpenThreadByUserID).toHaveBeenCalledWith(
        userId
      );
    });

    it("should create a new thread if none exists", async () => {
      const username = "testuser";
      const newThread = mockThread();
      const userId = newThread.userId;

      mockThreadRepository.getOpenThreadByUserID.mockResolvedValue(null);
      spyOn(threadService as any, "createNewThread").mockResolvedValue(
        newThread
      );

      const { thread, isNew } = await threadService.getOrCreateThread(
        userId,
        username
      );

      expect(isNew).toBe(true);
      expect(thread).toBe(newThread);
      expect(mockThreadRepository.getOpenThreadByUserID).toHaveBeenCalledWith(
        userId
      );
      expect(threadService["createNewThread"]).toHaveBeenCalledWith(
        userId,
        username
      );
    });
  });

  describe("createNewThread", () => {
    it("should throw an error if modmail forum channel is not found", async () => {
      const userId = randomSnowflakeID();
      const username = "testuser";

      spyOn(client.guilds.cache, "get").mockReturnValue(guildMock);
      spyOn(client.channels, "fetch").mockResolvedValue(null);

      expect(
        threadService["createNewThread"](userId, username)
      ).rejects.toThrow(
        `Modmail forum channel not found: ${config.forumChannelId}`
      );
    });

    it("should throw an error if guild is not found", async () => {
      const userId = randomSnowflakeID();
      const username = "testuser";

      spyOn(client.guilds.cache, "get").mockReturnValue(undefined);

      expect(
        threadService["createNewThread"](userId, username)
      ).rejects.toThrow(`Guild not found: ${config.guildId}`);
    });

    it("should throw an error if modmail forum channel is not a GuildForum", async () => {
      const userId = randomSnowflakeID();
      const username = "testuser";
      const invalidChannel = { type: ChannelType.GuildText } as TextChannel;

      spyOn(client.guilds.cache, "get").mockReturnValue(guildMock);
      spyOn(client.channels, "fetch").mockResolvedValue(invalidChannel);

      expect(
        threadService["createNewThread"](userId, username)
      ).rejects.toThrow(
        `Invalid modmail forum channel: ${config.forumChannelId}`
      );
    });

    it("should create a new thread and return it", async () => {
      const userId = randomSnowflakeID();
      const username = "testuser";
      const openTagId = randomSnowflakeID();

      const modmailForumChannel = {
        type: ChannelType.GuildForum,
        threads: {
          create: mock().mockResolvedValue({
            id: "threadId",
            guildId: "guildId",
          }),
        },
      } as unknown as ForumChannel;

      const mockUser = {
        id: "123",
      } as unknown as User;

      spyOn(client.guilds.cache, "get").mockReturnValue(guildMock);
      spyOn(client.users, "fetch").mockResolvedValue(mockUser);
      spyOn(client.channels, "fetch").mockResolvedValue(modmailForumChannel);
      spyOn(threadService, "getOpenTagId").mockResolvedValue(openTagId);
      spyOn(threadService, "getMutualServers").mockResolvedValue([]);

      spyOn(StaffThreadView, "newThreadMetadata").mockReturnValue({
        name: "threadName",
        reason: "reason",
      });
      spyOn(StaffThreadView, "initialThreadMessage").mockReturnValue({
        content: "initialMessage",
      });

      const thread = mockThread();
      mockThreadRepository.createThread.mockResolvedValue(thread);
      mockThreadRepository.getAllThreadsByUserId.mockResolvedValue([]);

      const result = await threadService["createNewThread"](userId, username);

      expect(result).toBeInstanceOf(Thread);
      expect(threadService.getMutualServers).toHaveBeenCalledWith(userId);
      expect(modmailForumChannel.threads.create).toHaveBeenCalledWith({
        name: "threadName",
        reason: "reason",
        message: {
          content: "initialMessage",
        },
        appliedTags: [openTagId],
      });
      expect(mockThreadRepository.createThread).toHaveBeenCalledWith(
        "guildId",
        userId,
        "threadId"
      );
    });

    it("should create a new open tag if none exists", async () => {
      const userId = randomSnowflakeID();
      const username = "testuser";
      const newOpenTagId = randomSnowflakeID();

      const modmailForumChannel = {
        type: ChannelType.GuildForum,
        threads: {
          create: mock().mockResolvedValue({
            id: "threadId",
            guildId: "guildId",
          }),
        },
      } as unknown as ForumChannel;

      const mockUser = {
        id: "123",
      } as unknown as User;

      spyOn(client.guilds.cache, "get").mockReturnValue(guildMock);
      spyOn(client.users, "fetch").mockResolvedValue(mockUser);
      spyOn(client.channels, "fetch").mockResolvedValue(modmailForumChannel);
      spyOn(threadService, "getOpenTagId").mockResolvedValue(null);
      spyOn(threadService, "createOpenTag").mockResolvedValue(newOpenTagId);
      spyOn(threadService, "getMutualServers").mockResolvedValue([]);

      spyOn(StaffThreadView, "newThreadMetadata").mockReturnValue({
        name: "threadName",
        reason: "reason",
      });
      spyOn(StaffThreadView, "initialThreadMessage").mockReturnValue({
        content: "initialMessage",
      });

      const thread = mockThread();
      mockThreadRepository.createThread.mockResolvedValue(thread);
      mockThreadRepository.getAllThreadsByUserId.mockResolvedValue([]);

      const result = await threadService["createNewThread"](userId, username);

      expect(result).toBeInstanceOf(Thread);
      expect(threadService.createOpenTag).toHaveBeenCalledWith(
        modmailForumChannel
      );
      expect(modmailForumChannel.threads.create).toHaveBeenCalledWith({
        name: "threadName",
        reason: "reason",
        message: {
          content: "initialMessage",
        },
        appliedTags: [newOpenTagId],
      });
    });
  });

  describe("closeThread", () => {
    it("should throw an error if thread channel is not found", async () => {
      const thread = { channelId: "channelId" } as Thread;
      spyOn(client.channels, "fetch").mockResolvedValue(null);

      expect(threadService.closeThread(thread, "userId")).rejects.toThrow(
        `Thread channel not found: ${thread.channelId}`
      );
    });

    it("should throw an error if channel is not a thread", async () => {
      const thread = { channelId: "channelId" } as Thread;
      const invalidChannel = { isThread: () => false } as ForumChannel;
      spyOn(client.channels, "fetch").mockResolvedValue(invalidChannel);

      expect(threadService.closeThread(thread, "userId")).rejects.toThrow(
        `Not thread: ${thread.channelId}`
      );
    });

    it("should close the thread and mark it as closed in the repository", async () => {
      const thread = { channelId: "channelId" } as Thread;
      const threadChannel = {
        isThread: () => true,
        send: mock(),
        edit: mock(),
      } as unknown as ForumThreadChannel;
      spyOn(client.channels, "fetch").mockResolvedValue(threadChannel);

      await threadService.closeThread(thread, "userId");

      expect(threadChannel.send).toHaveBeenCalledWith("Thread closed.");
      expect(threadChannel.edit).toHaveBeenCalledWith({
        archived: true,
        locked: true,
        appliedTags: [],
      });
      expect(mockThreadRepository.closeThread).toHaveBeenCalledWith(
        thread.channelId,
        "userId"
      );
    });
  });

  describe("getThreadByChannelId", () => {
    it("should return the thread by channel ID", async () => {
      const thread = mockThread();
      const channelId = thread.channelId;

      mockThreadRepository.getThreadByChannelId.mockResolvedValue(thread);

      const result = await threadService.getThreadByChannelId(channelId);

      expect(result).toBe(thread);
      expect(mockThreadRepository.getThreadByChannelId).toHaveBeenCalledWith(
        channelId
      );
    });
  });

  describe("getAllThreadsByUserId", () => {
    it("should return all threads by user ID", async () => {
      const userId = randomSnowflakeID();
      const threadOpts = {
        userId: userId,
      };

      const threadClosedOpts = {
        userId: userId,
      };

      const threads = [
        mockThread(threadOpts),
        mockThread(threadClosedOpts),
        mockThread(threadClosedOpts),
      ];

      mockThreadRepository.getAllThreadsByUserId.mockResolvedValue(threads);

      const result = await threadService.getAllThreadsByUserId(userId);

      expect(result).toBe(threads);
      expect(mockThreadRepository.getAllThreadsByUserId).toHaveBeenCalledWith(
        userId
      );
    });
  });

  describe("getMutualServers", () => {
    it("should return mutual servers", async () => {
      const userId = randomSnowflakeID();
      const guildId1 = randomSnowflakeID();
      const guildId2 = randomSnowflakeID();

      const guildsMock = [
        { id: guildId1, name: "Server 1", members: { fetch: mock() } },
        { id: guildId2, name: "Server 2", members: { fetch: mock() } },
      ];

      // Setup the successful fetch for guild1
      guildsMock[0].members.fetch.mockResolvedValue(123);

      // Setup the error for guild2
      const unknownMemberError = new DiscordAPIError(
        { code: RESTJSONErrorCodes.UnknownMember, message: "Unknown Member" },
        RESTJSONErrorCodes.UnknownMember,
        404,
        "GET",
        "",
        {}
      );
      guildsMock[1].members.fetch.mockRejectedValue(unknownMemberError);

      const guilds = guildsMock as unknown as MapIterator<Guild>;

      // Mock the guilds cache values to return our guilds
      spyOn(client.guilds.cache, "values").mockReturnValue(guilds);

      const result = await threadService.getMutualServers(userId);

      expect(result).toEqual([{ id: guildId1, name: "Server 1" }]);
      expect(guildsMock[0].members.fetch).toHaveBeenCalledWith(userId);
      expect(guildsMock[1].members.fetch).toHaveBeenCalledWith(userId);
    });
  });
});
