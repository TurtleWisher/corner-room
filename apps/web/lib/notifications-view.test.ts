import { describe, expect, it } from "vitest";

import {
  NOTIFICATIONS_EMPTY,
  applyOptimisticRead,
  channelActivateAllowed,
  channelCanToggle,
  channelHonestyLabel,
  channelStatus,
  isUnread,
  parseNotificationList,
  unreadAriaLabel,
  unreadCount,
} from "./notifications-view";

describe("notification list", () => {
  it("treats the Gate 4 payload as a JSON array", () => {
    const rows = parseNotificationList([{ id: "1", status: "UNREAD" }]);
    expect(rows).toHaveLength(1);
    expect(() => parseNotificationList({ items: [], next_cursor: null })).toThrow(
      /JSON array/,
    );
  });

  it("uses UNREAD/READ only and counts unread without color", () => {
    expect(isUnread({ status: "UNREAD", read_at: null })).toBe(true);
    expect(isUnread({ status: "READ", read_at: "2026-09-11T00:00:00Z" })).toBe(false);
    expect(unreadCount([{ status: "UNREAD" }, { status: "READ" }])).toBe(1);
    expect(unreadAriaLabel(2)).toBe("Notifications, 2 unread");
  });

  it("applies optimistic read and can revert to the previous rows", () => {
    const previous = [{ id: "n1", status: "UNREAD", read_at: null }];
    const optimistic = applyOptimisticRead(previous, "n1", "2026-09-11T12:00:00Z");
    expect(optimistic[0]).toEqual({ id: "n1", status: "READ", read_at: "2026-09-11T12:00:00Z" });
    expect(previous[0].status).toBe("UNREAD");
  });

  it("uses the honest empty copy", () => {
    expect(NOTIFICATIONS_EMPTY).toBe("No notifications yet.");
  });
});

describe("notification channels", () => {
  const availability = {
    in_app: "AVAILABLE",
    email: "STUB",
    sms: "NOT_AVAILABLE",
    push: "NOT_AVAILABLE",
  };

  it("labels IN_APP available, EMAIL stub, SMS/PUSH not available", () => {
    expect(channelHonestyLabel(channelStatus("in_app", availability))).toBe("Available");
    expect(channelHonestyLabel(channelStatus("email", availability))).toBe("Stub / not connected");
    expect(channelHonestyLabel(channelStatus("sms", availability))).toBe("Not available");
    expect(channelHonestyLabel(channelStatus("push", availability))).toBe("Not available");
  });

  it("does not offer SMS or push activate actions", () => {
    expect(channelCanToggle("NOT_AVAILABLE")).toBe(false);
    expect(channelActivateAllowed("NOT_AVAILABLE")).toBe(false);
    expect(channelCanToggle("STUB")).toBe(true);
  });
});
