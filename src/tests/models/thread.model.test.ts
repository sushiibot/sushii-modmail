import { describe, it, expect } from "bun:test";
import { Thread } from "../../models/thread.model";

describe("Thread", () => {
  describe("isOpen", () => {
    it("should return true when closedAt is null", () => {
      const thread = new Thread("123", "789", "456", new Date(), null);
      expect(thread.isOpen()).toBe(true);
    });

    it("should return false when closedAt is not null", () => {
      const thread = new Thread("123", "789", "456", new Date(), new Date());
      expect(thread.isOpen()).toBe(false);
    });
  });
});
