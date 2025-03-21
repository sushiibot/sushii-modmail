import { Client, Message } from "discord.js";

export class MessageService {
  async relayUserMessageToStaff(
    client: Client,
    channelId: string,
    message: Message
  ): Promise<void> {
    const threadChannel = await client.channels.fetch(channelId);

    if (!threadChannel?.isSendable()) {
      throw new Error(`Cannot send to channel: ${channelId}`);
    }

    let content = `**${message.author.tag}:** ${message.content}`;
    const attachments = [...message.attachments.values()];

    await threadChannel.send({
      content: content,
      files: attachments.map((a) => a.url),
    });
  }
}
