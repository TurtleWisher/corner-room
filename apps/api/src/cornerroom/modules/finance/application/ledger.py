"""Central ledger posting. Other modules never insert ledger_entries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import DomainEvent
from cornerroom.kernel.money import Money
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.finance.domain.coa import PROVISIONAL_COA
from cornerroom.modules.finance.domain.journal import JournalLineDraft, assert_balanced
from cornerroom.modules.finance.domain.lifecycle import JOURNAL_STATUSES, TRANSACTION_TYPES, journal_transition_action
from cornerroom.modules.finance.domain.models import FinanceTransaction, LedgerAccount, LedgerEntry

JOURNAL_POSTED = "JournalPosted"


@dataclass(frozen=True, slots=True)
class LedgerLineInput:
    account_code: str
    direction: str
    amount_minor: int
    event_id: UUID | None = None
    artist_id: UUID | None = None
    track_id: UUID | None = None
    campaign_id: UUID | None = None
    payee_type: str | None = None
    payee_id: UUID | None = None


class LedgerService:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)

    async def ensure_provisional_coa(self, organization_id: UUID, actor_id: UUID | None) -> dict[str, LedgerAccount]:
        existing = list(
            (
                await self.session.execute(
                    select(LedgerAccount).where(LedgerAccount.organization_id == organization_id)
                )
            ).scalars()
        )
        by_code = {row.code: row for row in existing}
        created = False
        for seed in PROVISIONAL_COA:
            if seed.code in by_code:
                continue
            row = LedgerAccount(
                organization_id=organization_id,
                code=seed.code,
                name=seed.name,
                type=seed.type,
                status="ACTIVE",
                provisional=True,
                created_by=actor_id,
                updated_by=actor_id,
            )
            self.session.add(row)
            by_code[seed.code] = row
            created = True
        if created:
            await self.session.flush()
        return by_code

    async def post(
        self,
        ctx: AuthContext | None,
        *,
        organization_id: UUID,
        journal_type: str,
        source_module: str,
        source_type: str,
        source_id: UUID,
        currency_code: str,
        idempotency_key: str,
        lines: list[LedgerLineInput],
        occurred_at: datetime | None = None,
        reversal_of_id: UUID | None = None,
    ) -> FinanceTransaction:
        if journal_type not in TRANSACTION_TYPES:
            raise AppError("VALIDATION_ERROR", "Unknown journal type", 422)
        existing = (
            await self.session.execute(
                select(FinanceTransaction).where(FinanceTransaction.idempotency_key == idempotency_key)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        money = Money(sum(line.amount_minor for line in lines if line.direction == "DEBIT"), currency_code)
        drafts = [
            JournalLineDraft(
                direction=line.direction,
                amount_minor=line.amount_minor,
                currency_code=currency_code,
                account_code=line.account_code,
            )
            for line in lines
        ]
        assert_balanced(drafts)
        actor_id = ctx.user_id if ctx else None
        accounts = await self.ensure_provisional_coa(organization_id, actor_id)
        header = FinanceTransaction(
            organization_id=organization_id,
            type=journal_type,
            source_module=source_module,
            source_type=source_type,
            source_id=source_id,
            status="DRAFT",
            actor_id=actor_id,
            idempotency_key=idempotency_key,
            occurred_at=occurred_at or self.clock.now(),
            currency_code=money.currency_code,
            reversal_of_id=reversal_of_id,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.session.add(header)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            current = (
                await self.session.execute(
                    select(FinanceTransaction).where(FinanceTransaction.idempotency_key == idempotency_key)
                )
            ).scalar_one_or_none()
            if current is not None:
                return current
            raise ConflictError("Duplicate journal") from exc
        for line in lines:
            account = accounts.get(line.account_code)
            if account is None or account.status != "ACTIVE":
                raise AppError(
                    "LEDGER_ACCOUNT_REQUIRED",
                    "Ledger account is missing from the org chart of accounts",
                    409,
                    f"code={line.account_code} (provisional COA is Q-P1-22, not a statutory chart)",
                )
            self.session.add(
                LedgerEntry(
                    transaction_id=header.id,
                    account_id=account.id,
                    direction=line.direction,
                    amount_minor=line.amount_minor,
                    currency_code=money.currency_code,
                    event_id=line.event_id,
                    artist_id=line.artist_id,
                    track_id=line.track_id,
                    campaign_id=line.campaign_id,
                    organization_id=organization_id,
                    payee_type=line.payee_type,
                    payee_id=line.payee_id,
                )
            )
        journal_transition_action(header.status, "POSTED")
        header.status = "POSTED"
        await self.session.flush()
        if header.status not in JOURNAL_STATUSES:
            raise AppError("INVALID_TRANSITION", "Invalid journal status", 409)
        await self._emit(
            ctx,
            event_type=JOURNAL_POSTED,
            aggregate_id=header.id,
            organization_id=organization_id,
            payload={
                "type": header.type,
                "amount_minor": money.amount_minor,
                "currency_code": header.currency_code,
                "source_type": source_type,
                "source_id": str(source_id),
            },
        )
        await self.audit.record_from_auth(
            ctx,
            action="journal.posted",
            entity_type="Transaction",
            entity_id=header.id,
            new_state={"status": header.status, "type": header.type, "amount_minor": money.amount_minor},
            organization_id=organization_id,
            actor_id=str(actor_id) if actor_id else "system:finance",
            actor_type="user" if ctx else "system",
        )
        return header

    async def get_journal(self, transaction_id: UUID) -> tuple[FinanceTransaction, list[LedgerEntry]]:
        header = await self.session.get(FinanceTransaction, transaction_id)
        if header is None:
            raise NotFoundError("Journal not found")
        lines = list(
            (
                await self.session.execute(
                    select(LedgerEntry).where(LedgerEntry.transaction_id == header.id)
                )
            ).scalars()
        )
        return header, lines

    async def _emit(
        self,
        ctx: AuthContext | None,
        *,
        event_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        organization_id: UUID | None,
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="finance",
            aggregate_type="Transaction",
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id if ctx else None,
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, event)
