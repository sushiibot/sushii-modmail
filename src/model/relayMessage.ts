import type { MessageSticker } from "../models/message.model";

// User that's being relayed, either staff or user
export interface RelayUser {
  id: string;
  displayName: string;
  username: string;
  displayAvatarURL(): string;
}

// Attachments relayed with a message
export interface RelayAttachment {
  id: string;
  name: string;
  url: string;
}

// Message from user to staff
export interface UserToStaffMessage {
  id: string;
  author: RelayUser;
  content: string;
  attachments: RelayAttachment[];
  stickers: MessageSticker[];
  forwarded?: boolean;
}

// Message from staff to user
export interface StaffToUserMessage {
  id: string;
  author: RelayUser;
  content: string;
  attachments: RelayAttachment[];
  stickers: MessageSticker[];
  forwarded?: boolean;
}

// For edits (can be further split if needed)
export interface RelayMessageEdit {
  id: string;
  author: RelayUser;
  content: string;
  attachments: string[]; // Array of URLs
  stickers: MessageSticker[];
  forwarded?: boolean;
}

// Union type for relayed messages
export type RelayMessage =
  | UserToStaffMessage
  | StaffToUserMessage
  | RelayMessageEdit;
