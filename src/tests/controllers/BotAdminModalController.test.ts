import { describe, it, expect } from "bun:test";
import { BotAdminModalController } from "../../controllers/BotAdminModalController";
import { botAdminCustomID } from "../../views/BotAdmin";

const OWNER_ID = "owner-user-id";

function fakeBotManager() {
  return {
    addBot: async () => ({
      client: {},
      entry: { name: "lisa", applicationId: "100000000000000001" },
    }),
    rotateToken: async () => ({ client: {}, entry: { name: "lisa" } }),
    getSummaries: () => [],
  } as any;
}

function fakeInteraction(customId: string, userId: string) {
  const calls: string[] = [];
  return {
    interaction: {
      customId,
      user: { id: userId },
      deferReply: async () => {
        calls.push("deferReply");
      },
      editReply: async () => {
        calls.push("editReply");
      },
      followUp: async () => {
        calls.push("followUp");
      },
      fields: {
        getTextInputValue: () => "value",
      },
    } as any,
    calls,
  };
}

describe("BotAdminModalController -- fall-through contract (customId check before deferReply)", () => {
  it("does not call deferReply for a customId it doesn't own (settings modal)", async () => {
    const controller = new BotAdminModalController(fakeBotManager(), OWNER_ID);
    const { interaction, calls } = fakeInteraction(
      "modal.settings.prefix",
      OWNER_ID
    );

    await controller.handleModal(interaction);

    expect(calls).toEqual([]);
  });

  it("does not call deferReply for a customId it doesn't own (say modal)", async () => {
    const controller = new BotAdminModalController(fakeBotManager(), OWNER_ID);
    const { interaction, calls } = fakeInteraction("modal.say.embed", OWNER_ID);

    await controller.handleModal(interaction);

    expect(calls).toEqual([]);
  });

  it("does not defer for a non-owner submitting the add-bot modal", async () => {
    const controller = new BotAdminModalController(fakeBotManager(), OWNER_ID);
    const { interaction, calls } = fakeInteraction(
      botAdminCustomID.addModal,
      "not-the-owner"
    );

    await controller.handleModal(interaction);

    expect(calls).toEqual([]);
  });

  it("defers then edits for the owner submitting the add-bot modal", async () => {
    const controller = new BotAdminModalController(fakeBotManager(), OWNER_ID);
    const { interaction, calls } = fakeInteraction(
      botAdminCustomID.addModal,
      OWNER_ID
    );

    await controller.handleModal(interaction);

    expect(calls).toEqual(["deferReply", "editReply", "followUp"]);
  });

  it("defers then edits for the owner submitting a rotate modal", async () => {
    const controller = new BotAdminModalController(fakeBotManager(), OWNER_ID);
    const { interaction, calls } = fakeInteraction(
      `${botAdminCustomID.rotateModalPrefix}100000000000000001`,
      OWNER_ID
    );

    await controller.handleModal(interaction);

    expect(calls).toEqual(["deferReply", "editReply"]);
  });
});
