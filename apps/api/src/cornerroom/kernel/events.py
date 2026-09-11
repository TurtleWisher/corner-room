"""In-process domain event envelope. Persist via outbox in the same transaction."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from cornerroom.kernel.ids import new_uuid


@dataclass(slots=True)
class DomainEvent:
    event_type: str
    producer: str
    aggregate_type: str
    aggregate_id: UUID
    payload: dict[str, Any]
    occurred_at: datetime
    actor_id: UUID | None = None
    on_behalf_of_user_id: UUID | None = None
    organization_id: UUID | None = None
    correlation_id: str | None = None
    causation_id: str | None = None
    event_id: UUID = field(default_factory=new_uuid)
    schema_version: int = 1

    def to_payload(self) -> dict[str, Any]:
        return {
            "event_id": str(self.event_id),
            "event_type": self.event_type,
            "occurred_at": self.occurred_at.isoformat(),
            "producer": self.producer,
            "actor_id": str(self.actor_id) if self.actor_id else None,
            "on_behalf_of_user_id": (
                str(self.on_behalf_of_user_id) if self.on_behalf_of_user_id else None
            ),
            "aggregate_type": self.aggregate_type,
            "aggregate_id": str(self.aggregate_id),
            "organization_id": str(self.organization_id) if self.organization_id else None,
            "correlation_id": self.correlation_id,
            "causation_id": self.causation_id,
            "schema_version": self.schema_version,
            "payload": self.payload,
        }


# Infrastructure probe used by foundation tests. Identity names below exist because
# apps/ already scaffolded those handlers — Phase 02 owns completing that domain.
FOUNDATION_PROBE = "FoundationProbe"

USER_REGISTERED = "UserRegistered"
USER_ACTIVATED = "UserActivated"
USER_SUSPENDED = "UserSuspended"
USER_CLOSED = "UserClosed"
USER_VERIFIED = "UserVerified"
USER_LOGGED_IN = "UserLoggedIn"
USER_LOGGED_OUT = "UserLoggedOut"
PASSWORD_CHANGED = "PasswordChanged"
PASSWORD_RESET = "PasswordReset"
SESSION_CREATED = "SessionCreated"
SESSION_REVOKED = "SessionRevoked"
REFRESH_TOKEN_ROTATED = "RefreshTokenRotated"
REFRESH_TOKEN_REPLAY_DETECTED = "RefreshTokenReplayDetected"
ACCOUNT_LOCKED = "AccountLocked"
ACCOUNT_UNLOCKED = "AccountUnlocked"
MEMBERSHIP_CHANGED = "MembershipChanged"
ORGANIZATION_ACTIVATED = "OrganizationActivated"
ORGANIZATION_SUSPENDED = "OrganizationSuspended"
ORGANIZATION_ARCHIVED = "OrganizationArchived"
ORGANIZATION_INVITATION_ISSUED = "OrganizationInvitationIssued"
ORGANIZATION_INVITATION_ACCEPTED = "OrganizationInvitationAccepted"
ORGANIZATION_INVITATION_REVOKED = "OrganizationInvitationRevoked"
RESOURCE_GRANT_CHANGED = "ResourceGrantChanged"
ROLE_ASSIGNMENT_CHANGED = "RoleAssignmentChanged"
ROLE_REVOKED = "RoleRevoked"
EVENT_PLANNED = "EventPlanned"
EVENT_PUBLISHED = "EventPublished"
EVENT_WENT_LIVE = "EventWentLive"
EVENT_COMPLETED = "EventCompleted"
EVENT_CANCELLED = "EventCancelled"
EVENT_POSTPONED = "EventPostponed"
VENUE_BOOKING_CHANGED = "VenueBookingChanged"
TICKETING_OPENED = "TicketingOpened"
TICKETING_CLOSED = "TicketingClosed"
ARTIST_APPLICATION_SUBMITTED = "ArtistApplicationSubmitted"
ARTIST_ACTIVATED = "ArtistActivated"
ARTIST_SUSPENDED = "ArtistSuspended"
BAND_MEMBER_CHANGED = "BandMemberChanged"
ARTIST_FOLLOWED = "ArtistFollowed"
ARTIST_UNFOLLOWED = "ArtistUnfollowed"
LINEUP_CONFIRMED = "LineupConfirmed"
ARTIST_WITHDRAWN_FROM_EVENT = "ArtistWithdrawnFromEvent"
TRACK_CREATED = "TrackCreated"
TRACK_UPLOADED = "TrackUploaded"
TRACK_APPROVED = "TrackApproved"
TRACK_RELEASED = "TrackReleased"
TRACK_TAKEN_DOWN = "TrackTakenDown"
RELEASE_STAGE_CHANGED = "ReleaseStageChanged"
RELEASE_RELEASED = "ReleaseReleased"
METADATA_CORRECTED = "MetadataCorrected"
TRACK_PLAYED = "TrackPlayed"
TRACK_LIKED = "TrackLiked"
ORDER_PLACED = "OrderPlaced"
ORDER_PAID = "OrderPaid"
ORDER_CANCELLED = "OrderCancelled"
TRACK_PURCHASED = "TrackPurchased"
PRODUCT_ACTIVATED = "ProductActivated"
OFFER_ACTIVATED = "OfferActivated"
ENTITLEMENT_GRANTED = "EntitlementGranted"
ENTITLEMENT_REVOKED = "EntitlementRevoked"
SUBSCRIPTION_STARTED = "SubscriptionStarted"
SUBSCRIPTION_RENEWED = "SubscriptionRenewed"
SUBSCRIPTION_PAST_DUE = "SubscriptionPastDue"
SUBSCRIPTION_CANCELLED = "SubscriptionCancelled"
REFUND_REQUESTED = "RefundRequested"
REFUND_COMPLETED = "RefundCompleted"
PAYMENT_CAPTURED = "PaymentCaptured"
PAYMENT_FAILED = "PaymentFailed"
RIGHT_CREATED = "RightCreated"
RIGHT_SHARE_ASSIGNED = "RightShareAssigned"
ROYALTY_RULE_CREATED = "RoyaltyRuleCreated"
ROYALTY_RULE_ACTIVATED = "RoyaltyRuleActivated"
REVENUE_RECOGNIZED = "RevenueRecognized"
REVENUE_POOL_CREATED = "RevenuePoolCreated"
REVENUE_POOL_FROZEN = "RevenuePoolFrozen"
ROYALTY_CALCULATION_STARTED = "RoyaltyCalculationStarted"
ROYALTY_CALCULATION_COMPLETED = "RoyaltyCalculationCompleted"
ROYALTY_APPROVED = "RoyaltyApproved"
ROYALTY_POSTED = "RoyaltyPosted"
ROYALTY_GENERATED = "RoyaltyGenerated"
ROYALTY_STATEMENT_ISSUED = "RoyaltyStatementIssued"
ROYALTY_STATEMENT_ADJUSTED = "RoyaltyStatementAdjusted"
SETTLEMENT_APPROVED = "SettlementApproved"
JOURNAL_POSTED = "JournalPosted"
EXPENSE_RECOGNIZED = "ExpenseRecognized"
ADJUSTMENT_POSTED = "AdjustmentPosted"
INVOICE_ISSUED = "InvoiceIssued"
PAYOUT_COMPLETED = "PayoutCompleted"
PAYOUT_FAILED = "PayoutFailed"
SETTLEMENT_COMPLETED = "SettlementCompleted"
CAMPAIGN_STARTED = "CampaignStarted"
CAMPAIGN_COMPLETED = "CampaignCompleted"
CAMPAIGN_TASK_ASSIGNED = "CampaignTaskAssigned"
CAMPAIGN_TASK_COMPLETED = "CampaignTaskCompleted"
