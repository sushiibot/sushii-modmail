import { beforeEach, describe, expect, it, mock } from "bun:test";
import { PermissionsBitField } from "discord.js";
import { ToolbarController } from "../../controllers/ToolbarController";
import { toolbarCustomID } from "../../views/Toolbar";

function mockThread(overrides: Partial<{ isClosed: boolean; toolbarMessageId: string | null }> = {}) {
  return {
    userId: "user-1",
    channelId: "channel-1",
    guildId: "guild-1",
    isClosed: overrides.isClosed ?? false,
    toolbarMessageId: overrides.toolbarMessageId ?? "toolbar-msg-id",
  };
}

function mockSnippet(name = "welcome", content = "Hello!") {
  return { guildId: "guild-1", name, content, pinnedPosition: null };
}

function mockMember(permitted: boolean) {
  return {
    permissions: {
      has: (flag: bigint) =>
        permitted && flag === PermissionsBitField.Flags.ManageGuild,
    },
    roles: { cache: new Map() },
  } as any;
}

describe("ToolbarController", () => {
  let threadService: any;
  let messageService: any;
  let snippetService: any;
  let toolbarService: any;
  let configRepository: any;
  let controller: ToolbarController;

  beforeEach(() => {
    threadService = {
      getThreadByChannelId: mock(),
      closeThread: mock().mockResolvedValue(undefined),
    };
    messageService = {
      relayStaffMessageToUser: mock().mockResolvedValue(undefined),
    };
    snippetService = {
      getSnippet: mock(),
      getAllSnippets: mock().mockResolvedValue([]),
      setPinnedPosition: mock().mockResolvedValue(undefined),
      clearPinnedPosition: mock().mockResolvedValue(undefined),
    };
    toolbarService = {
      send: mock().mockResolvedValue(undefined),
      refresh: mock().mockResolvedValue(undefined),
    };
    configRepository = {
      getConfig: mock().mockResolvedValue({
        anonymousSnippets: true,
        requiredRoleIds: [],
      }),
    };

    controller = new ToolbarController(
      threadService,
      messageService,
      snippetService,
      toolbarService,
      configRepository
    );
  });

  describe("isReplyToToolbar", () => {
    it("is true when the message replies to the stored toolbar message", () => {
      const thread = mockThread({ toolbarMessageId: "abc" });
      const message = { reference: { messageId: "abc" } } as any;

      expect(controller.isReplyToToolbar(message, thread)).toBe(true);
    });

    it("is false when the message replies to a different message", () => {
      const thread = mockThread({ toolbarMessageId: "abc" });
      const message = { reference: { messageId: "some-other-message" } } as any;

      expect(controller.isReplyToToolbar(message, thread)).toBe(false);
    });

    it("is false when the message isn't a reply at all", () => {
      const thread = mockThread({ toolbarMessageId: "abc" });
      const message = { reference: null } as any;

      expect(controller.isReplyToToolbar(message, thread)).toBe(false);
    });

    it("is false once the thread's toolbar has been cleared (e.g. after close)", () => {
      const thread = mockThread({ toolbarMessageId: null });
      const message = { reference: { messageId: "abc" } } as any;

      expect(controller.isReplyToToolbar(message, thread)).toBe(false);
    });
  });

  describe("handleButton", () => {
    function mockButtonInteraction(customId: string, permitted = true) {
      return {
        customId,
        channelId: "channel-1",
        guildId: "guild-1",
        member: mockMember(permitted),
        guild: { id: "guild-1", name: "Guild", iconURL: () => null },
        user: { id: "staff-1", username: "staffer" },
        createdTimestamp: 123,
        id: "interaction-1",
        showModal: mock().mockResolvedValue(undefined),
        deferUpdate: mock().mockResolvedValue(undefined),
        reply: mock().mockResolvedValue(undefined),
        update: mock().mockResolvedValue(undefined),
        editReply: mock().mockResolvedValue(undefined),
        deleteReply: mock().mockResolvedValue(undefined),
      } as any;
    }

    it("shows the plain reply modal", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.reply);
      await controller.handleButton(interaction);
      expect(interaction.showModal).toHaveBeenCalledTimes(1);
    });

    it("shows the anon reply modal", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.anonReply);
      await controller.handleButton(interaction);
      expect(interaction.showModal).toHaveBeenCalledTimes(1);
    });

    it("asks for confirmation instead of closing immediately", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.close);

      await controller.handleButton(interaction);

      expect(threadService.closeThread).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("sure"),
          flags: expect.anything(),
        })
      );
    });

    it("closes the thread once confirmed", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.confirmClose);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());

      await controller.handleButton(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(threadService.closeThread).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: "channel-1" }),
        "staff-1"
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Thread closed." })
      );
    });

    it("does not close an already-closed thread even if confirmed", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.confirmClose);
      threadService.getThreadByChannelId.mockResolvedValue(
        mockThread({ isClosed: true })
      );

      await controller.handleButton(interaction);

      expect(threadService.closeThread).not.toHaveBeenCalled();
    });

    it("does nothing but dismiss the prompt when cancelled", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.cancelClose);

      await controller.handleButton(interaction);

      expect(threadService.closeThread).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(interaction.deleteReply).toHaveBeenCalled();
    });

    it("replies with the pins editor for editPins", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.editPins);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getAllSnippets.mockResolvedValue([mockSnippet()]);

      await controller.handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const replyArg = interaction.reply.mock.calls[0][0];
      expect(replyArg.flags).toBeDefined();
    });

    it("sends a pinned snippet instantly using the guild's anonymous setting", async () => {
      const snippet = mockSnippet("faq", "Frequently asked question answer");
      const interaction = mockButtonInteraction(
        toolbarCustomID.pinnedSnippet("faq")
      );
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getSnippet.mockResolvedValue(snippet);
      configRepository.getConfig.mockResolvedValue({
        anonymousSnippets: false,
        requiredRoleIds: [],
      });

      await controller.handleButton(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(messageService.relayStaffMessageToUser).toHaveBeenCalledWith(
        "channel-1",
        "user-1",
        interaction.guild,
        expect.objectContaining({ content: "Frequently asked question answer" }),
        expect.objectContaining({
          anonymous: false,
          snippet: true,
          snippetName: "faq",
        })
      );
    });

    it("does nothing for a pinned snippet that no longer exists", async () => {
      const interaction = mockButtonInteraction(
        toolbarCustomID.pinnedSnippet("gone")
      );
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getSnippet.mockResolvedValue(null);

      await controller.handleButton(interaction);

      expect(messageService.relayStaffMessageToUser).not.toHaveBeenCalled();
    });

    it("does not send a pinned snippet in a closed thread", async () => {
      const interaction = mockButtonInteraction(
        toolbarCustomID.pinnedSnippet("faq")
      );
      threadService.getThreadByChannelId.mockResolvedValue(
        mockThread({ isClosed: true })
      );

      await controller.handleButton(interaction);

      expect(messageService.relayStaffMessageToUser).not.toHaveBeenCalled();
    });

    it("denies a button click from a member without staff permission", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.close, false);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());

      await controller.handleButton(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("don't have permission"),
          ephemeral: true,
        })
      );
      expect(threadService.closeThread).not.toHaveBeenCalled();
    });

    it("denies Reply/Anon Reply for a member without staff permission", async () => {
      const interaction = mockButtonInteraction(toolbarCustomID.reply, false);

      await controller.handleButton(interaction);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true })
      );
    });
  });

  describe("handleSelectMenu", () => {
    function mockSelectInteraction(
      customId: string,
      values: string[],
      permitted = true
    ) {
      return {
        customId,
        values,
        channelId: "channel-1",
        guildId: "guild-1",
        member: mockMember(permitted),
        showModal: mock().mockResolvedValue(undefined),
        reply: mock().mockResolvedValue(undefined),
        update: mock().mockResolvedValue(undefined),
        deferReply: mock().mockResolvedValue(undefined),
        editReply: mock().mockResolvedValue(undefined),
        id: "interaction-1",
        user: { id: "staff-1", username: "staffer" },
        guild: { id: "guild-1", name: "Guild", iconURL: () => null },
        createdTimestamp: 123,
      } as any;
    }

    it("opens a pre-filled modal for a selected snippet", async () => {
      const snippet = mockSnippet("scam-warning", "Careful, that's a scam.");
      const interaction = mockSelectInteraction(toolbarCustomID.snippetSelect, [
        "scam-warning",
      ]);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getSnippet.mockResolvedValue(snippet);

      await controller.handleSelectMenu(interaction);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
    });

    it("replies ephemerally if the selected snippet was deleted meanwhile", async () => {
      const interaction = mockSelectInteraction(toolbarCustomID.snippetSelect, [
        "gone",
      ]);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getSnippet.mockResolvedValue(null);

      await controller.handleSelectMenu(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true })
      );
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it("sends an oversized snippet directly instead of showing a truncating modal", async () => {
      const hugeContent = "x".repeat(4001);
      const snippet = mockSnippet("huge", hugeContent);
      const interaction = mockSelectInteraction(toolbarCustomID.snippetSelect, [
        "huge",
      ]);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getSnippet.mockResolvedValue(snippet);

      await controller.handleSelectMenu(interaction);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(messageService.relayStaffMessageToUser).toHaveBeenCalledWith(
        "channel-1",
        "user-1",
        interaction.guild,
        expect.objectContaining({ content: hugeContent }),
        expect.objectContaining({ snippet: true, snippetName: "huge" })
      );
    });

    it("pins a snippet to the selected slot and refreshes the toolbar", async () => {
      const interaction = mockSelectInteraction(toolbarCustomID.pinSlot(2), [
        "welcome",
      ]);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getAllSnippets.mockResolvedValue([mockSnippet("welcome")]);

      await controller.handleSelectMenu(interaction);

      expect(snippetService.setPinnedPosition).toHaveBeenCalledWith(
        "guild-1",
        "welcome",
        2
      );
      expect(interaction.update).toHaveBeenCalledTimes(1);
      expect(toolbarService.refresh).toHaveBeenCalledWith("channel-1");
    });

    it("clears the slot's current pin when deselected", async () => {
      const currentlyPinned = { ...mockSnippet("welcome"), pinnedPosition: 3 };
      const interaction = mockSelectInteraction(toolbarCustomID.pinSlot(3), []);
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      snippetService.getAllSnippets.mockResolvedValue([currentlyPinned]);

      await controller.handleSelectMenu(interaction);

      expect(snippetService.clearPinnedPosition).toHaveBeenCalledWith(
        "guild-1",
        "welcome"
      );
      expect(snippetService.setPinnedPosition).not.toHaveBeenCalled();
    });

    it("denies a select menu interaction from a member without staff permission", async () => {
      const interaction = mockSelectInteraction(
        toolbarCustomID.pinSlot(1),
        ["welcome"],
        false
      );

      await controller.handleSelectMenu(interaction);

      expect(snippetService.setPinnedPosition).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true })
      );
    });
  });

  describe("handleModalSubmit", () => {
    function mockModalInteraction(
      customId: string,
      inputValue: string,
      permitted = true
    ) {
      return {
        customId,
        channelId: "channel-1",
        guildId: "guild-1",
        member: mockMember(permitted),
        guild: { id: "guild-1", name: "Guild", iconURL: () => null },
        user: { id: "staff-1", username: "staffer" },
        createdTimestamp: 123,
        id: "interaction-1",
        reply: mock().mockResolvedValue(undefined),
        deferReply: mock().mockResolvedValue(undefined),
        editReply: mock().mockResolvedValue(undefined),
        fields: {
          getTextInputValue: mock().mockReturnValue(inputValue),
        },
      } as any;
    }

    it("ignores a modal submission it doesn't own", async () => {
      const interaction = mockModalInteraction("modal.settings.prefix", "!");

      await controller.handleModalSubmit(interaction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(messageService.relayStaffMessageToUser).not.toHaveBeenCalled();
    });

    it("relays a plain reply modal submission", async () => {
      const interaction = mockModalInteraction(
        toolbarCustomID.modalReply,
        "hello from the modal"
      );
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());

      await controller.handleModalSubmit(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(messageService.relayStaffMessageToUser).toHaveBeenCalledWith(
        "channel-1",
        "user-1",
        interaction.guild,
        expect.objectContaining({ content: "hello from the modal" }),
        expect.objectContaining({ anonymous: false, snippet: false })
      );
      expect(interaction.editReply).toHaveBeenCalledWith("Reply sent.");
    });

    it("relays an anon reply modal submission", async () => {
      const interaction = mockModalInteraction(
        toolbarCustomID.modalAnonReply,
        "anon text"
      );
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());

      await controller.handleModalSubmit(interaction);

      expect(messageService.relayStaffMessageToUser).toHaveBeenCalledWith(
        "channel-1",
        "user-1",
        interaction.guild,
        expect.objectContaining({ content: "anon text" }),
        expect.objectContaining({ anonymous: true })
      );
    });

    it("does not relay a reply modal for a closed thread, and tells the staff member", async () => {
      const interaction = mockModalInteraction(toolbarCustomID.modalReply, "hi");
      threadService.getThreadByChannelId.mockResolvedValue(
        mockThread({ isClosed: true })
      );

      await controller.handleModalSubmit(interaction);

      expect(messageService.relayStaffMessageToUser).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining("closed")
      );
    });

    it("relays a snippet modal submission using the guild's anonymous setting", async () => {
      const interaction = mockModalInteraction(
        toolbarCustomID.modalSnippet("faq"),
        "edited snippet content"
      );
      threadService.getThreadByChannelId.mockResolvedValue(mockThread());
      configRepository.getConfig.mockResolvedValue({
        anonymousSnippets: true,
        requiredRoleIds: [],
      });

      await controller.handleModalSubmit(interaction);

      expect(messageService.relayStaffMessageToUser).toHaveBeenCalledWith(
        "channel-1",
        "user-1",
        interaction.guild,
        expect.objectContaining({ content: "edited snippet content" }),
        expect.objectContaining({
          anonymous: true,
          snippet: true,
          snippetName: "faq",
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith("Reply sent.");
    });

    it("denies a modal submission from a member without staff permission", async () => {
      const interaction = mockModalInteraction(
        toolbarCustomID.modalReply,
        "sneaky",
        false
      );

      await controller.handleModalSubmit(interaction);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(messageService.relayStaffMessageToUser).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true })
      );
    });
  });
});
