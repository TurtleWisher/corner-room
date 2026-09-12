"""Notification send policy. Fail-closed. Q-P13-01–10 remain OPEN.

Marketing is never sent (Q-P13-04 / Q-P12-12). Quiet hours NULL = off.
If quiet hours are set, TRANSACTIONAL and SECURITY are not suppressed.
No product clock (no invented 22:00–08:00 delay). SMS/push are not sent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from cornerroom.kernel.events import (
    ACCOUNT_LOCKED,
    CAMPAIGN_TASK_ASSIGNED,
    CAMPAIGN_TASK_COMPLETED,
    ENTITLEMENT_GRANTED,
    ORDER_PAID,
    ORGANIZATION_INVITATION_ISSUED,
    PASSWORD_CHANGED,
    PAYMENT_FAILED,
    PAYOUT_COMPLETED,
    PAYOUT_FAILED,
    REFRESH_TOKEN_REPLAY_DETECTED,
    ROYALTY_STATEMENT_ADJUSTED,
    ROYALTY_STATEMENT_ISSUED,
    SETTLEMENT_COMPLETED,
    SUBSCRIPTION_CANCELLED,
    SUBSCRIPTION_PAST_DUE,
    SUBSCRIPTION_STARTED,
    TRACK_APPROVED,
    TRACK_RELEASED,
    USER_REGISTERED,
)

# Emitted by ticketing (local constants; names match producers).
TICKET_ISSUED = "TicketIssued"

CATEGORY_TRANSACTIONAL = "TRANSACTIONAL"
CATEGORY_MARKETING = "MARKETING"
CATEGORY_SECURITY = "SECURITY"

CHANNEL_IN_APP = "in_app"
CHANNEL_EMAIL = "email"
CHANNEL_SMS = "sms"
CHANNEL_PUSH = "push"

# Honesty for preference APIs. Not a vendor decision (Q-P13-02/06/07/10 OPEN).
CHANNEL_STATUS_AVAILABLE = "AVAILABLE"
CHANNEL_STATUS_STUB = "STUB"
CHANNEL_STATUS_NOT_AVAILABLE = "NOT_AVAILABLE"
CHANNEL_AVAILABILITY = {
    CHANNEL_IN_APP: CHANNEL_STATUS_AVAILABLE,
    CHANNEL_EMAIL: CHANNEL_STATUS_STUB,
    CHANNEL_SMS: CHANNEL_STATUS_NOT_AVAILABLE,
    CHANNEL_PUSH: CHANNEL_STATUS_NOT_AVAILABLE,
}

DECISION_SEND = "SEND"
DECISION_SUPPRESS = "SUPPRESS"

REASON_MARKETING = "marketing_not_sent"
REASON_QUIET_HOURS = "quiet_hours"
REASON_CHANNEL_UNAVAILABLE = "channel_unavailable"
REASON_NO_RECIPIENT = "recipient_unresolved"
REASON_UNKNOWN_EVENT = "event_not_wired"

# Wired existing events only. Recipients must resolve from payload/aggregate identity.
# EventCancelled / EventPostponed / CampaignStarted / CampaignCompleted are skipped:
# payload has no single recipient and fan-out is not authorized (Q-P13-04).
EVENT_CATEGORY: dict[str, str] = {
    USER_REGISTERED: CATEGORY_TRANSACTIONAL,
    ORGANIZATION_INVITATION_ISSUED: CATEGORY_TRANSACTIONAL,
    TICKET_ISSUED: CATEGORY_TRANSACTIONAL,
    ORDER_PAID: CATEGORY_TRANSACTIONAL,
    PAYMENT_FAILED: CATEGORY_TRANSACTIONAL,
    TRACK_APPROVED: CATEGORY_TRANSACTIONAL,
    TRACK_RELEASED: CATEGORY_TRANSACTIONAL,
    CAMPAIGN_TASK_ASSIGNED: CATEGORY_TRANSACTIONAL,
    CAMPAIGN_TASK_COMPLETED: CATEGORY_TRANSACTIONAL,
    ROYALTY_STATEMENT_ISSUED: CATEGORY_TRANSACTIONAL,
    ROYALTY_STATEMENT_ADJUSTED: CATEGORY_TRANSACTIONAL,
    SETTLEMENT_COMPLETED: CATEGORY_TRANSACTIONAL,
    PAYOUT_COMPLETED: CATEGORY_TRANSACTIONAL,
    PAYOUT_FAILED: CATEGORY_TRANSACTIONAL,
    SUBSCRIPTION_STARTED: CATEGORY_TRANSACTIONAL,
    SUBSCRIPTION_PAST_DUE: CATEGORY_TRANSACTIONAL,
    SUBSCRIPTION_CANCELLED: CATEGORY_TRANSACTIONAL,
    ENTITLEMENT_GRANTED: CATEGORY_TRANSACTIONAL,
    PASSWORD_CHANGED: CATEGORY_SECURITY,
    ACCOUNT_LOCKED: CATEGORY_SECURITY,
    REFRESH_TOKEN_REPLAY_DETECTED: CATEGORY_SECURITY,
}

EVENT_NOTIFICATION_TYPE: dict[str, str] = {
    USER_REGISTERED: "user.registered",
    ORGANIZATION_INVITATION_ISSUED: "organization.invitation_issued",
    TICKET_ISSUED: "ticket.issued",
    ORDER_PAID: "order.paid",
    PAYMENT_FAILED: "payment.failed",
    TRACK_APPROVED: "track.approved",
    TRACK_RELEASED: "track.released",
    CAMPAIGN_TASK_ASSIGNED: "campaign.task_assigned",
    CAMPAIGN_TASK_COMPLETED: "campaign.task_completed",
    ROYALTY_STATEMENT_ISSUED: "royalty.statement_issued",
    ROYALTY_STATEMENT_ADJUSTED: "royalty.statement_adjusted",
    SETTLEMENT_COMPLETED: "settlement.completed",
    PAYOUT_COMPLETED: "payout.completed",
    PAYOUT_FAILED: "payout.failed",
    SUBSCRIPTION_STARTED: "subscription.started",
    SUBSCRIPTION_PAST_DUE: "subscription.past_due",
    SUBSCRIPTION_CANCELLED: "subscription.cancelled",
    ENTITLEMENT_GRANTED: "entitlement.granted",
    PASSWORD_CHANGED: "password.changed",
    ACCOUNT_LOCKED: "account.locked",
    REFRESH_TOKEN_REPLAY_DETECTED: "refresh_token.replay_detected",
}

EVENT_TITLE: dict[str, str] = {
    USER_REGISTERED: "Welcome to Corner Room",
    ORGANIZATION_INVITATION_ISSUED: "Organization invitation",
    TICKET_ISSUED: "Ticket issued",
    ORDER_PAID: "Order paid",
    PAYMENT_FAILED: "Payment failed",
    TRACK_APPROVED: "Track approved",
    TRACK_RELEASED: "Track released",
    CAMPAIGN_TASK_ASSIGNED: "Campaign task assigned",
    CAMPAIGN_TASK_COMPLETED: "Campaign task completed",
    ROYALTY_STATEMENT_ISSUED: "Royalty statement available",
    ROYALTY_STATEMENT_ADJUSTED: "Royalty statement adjusted",
    SETTLEMENT_COMPLETED: "Settlement completed",
    PAYOUT_COMPLETED: "Payout completed",
    PAYOUT_FAILED: "Payout failed",
    SUBSCRIPTION_STARTED: "Subscription started",
    SUBSCRIPTION_PAST_DUE: "Subscription past due",
    SUBSCRIPTION_CANCELLED: "Subscription cancelled",
    ENTITLEMENT_GRANTED: "Entitlement granted",
    PASSWORD_CHANGED: "Password changed",
    ACCOUNT_LOCKED: "Account locked",
    REFRESH_TOKEN_REPLAY_DETECTED: "Sign-in alert",
}

CONSUMER_NOTIFICATIONS = "notifications"


@dataclass(frozen=True, slots=True)
class QuietHours:
    start: time | None
    end: time | None
    timezone: str | None

    def is_configured(self) -> bool:
        return self.start is not None and self.end is not None and self.timezone is not None


@dataclass(frozen=True, slots=True)
class ChannelDecision:
    action: str
    reason: str | None = None


def category_for_event(event_type: str) -> str | None:
    return EVENT_CATEGORY.get(event_type)


def notification_type_for_event(event_type: str) -> str | None:
    return EVENT_NOTIFICATION_TYPE.get(event_type)


def title_for_event(event_type: str) -> str:
    return EVENT_TITLE.get(event_type, event_type)


def evaluate_channel(
    *,
    category: str | None,
    channel: str,
    quiet_hours: QuietHours | None = None,
) -> ChannelDecision:
    """Decide whether a delivery may be attempted. Does not send."""
    if category == CATEGORY_MARKETING:
        return ChannelDecision(DECISION_SUPPRESS, REASON_MARKETING)
    if channel in {CHANNEL_SMS, CHANNEL_PUSH}:
        return ChannelDecision(DECISION_SUPPRESS, REASON_CHANNEL_UNAVAILABLE)
    if channel not in {CHANNEL_IN_APP, CHANNEL_EMAIL}:
        return ChannelDecision(DECISION_SUPPRESS, REASON_CHANNEL_UNAVAILABLE)
    if category in {CATEGORY_TRANSACTIONAL, CATEGORY_SECURITY}:
        return ChannelDecision(DECISION_SEND)
    # Uncategorized: marketing-mute does not apply as a product rule (OPEN).
    # Quiet hours, if set, suppress non-transactional/non-security (no delay clock).
    if quiet_hours is not None and quiet_hours.is_configured():
        return ChannelDecision(DECISION_SUPPRESS, REASON_QUIET_HOURS)
    if channel == CHANNEL_IN_APP:
        return ChannelDecision(DECISION_SEND)
    return ChannelDecision(DECISION_SEND)


def render_template(body: str, values: dict[str, str]) -> str | None:
    """Replace {placeholders}. Missing keys fail the delivery (no malformed send)."""
    class _Map(dict):
        def __missing__(self, key: str) -> str:
            raise KeyError(key)

    try:
        return body.format_map(_Map(values))
    except (KeyError, ValueError, IndexError):
        return None
