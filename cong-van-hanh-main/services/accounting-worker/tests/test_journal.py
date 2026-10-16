from __future__ import annotations

from decimal import Decimal

from journal import journal_canonical_data, normalize_misa_journal_row


def test_misa_mirrored_rows_become_one_canonical_posting() -> None:
    common = {
        "refid": "voucher-1",
        "posted_date": "2026-01-01T00:00:00+07:00",
        "refno": "BH2026/01/000001",
        "description": "Bán hàng",
        "currency_id": "VND",
        "exchange_rate": 1,
        "branch_id": "branch-1",
        "account_object_code": "KH0001",
    }
    debit = normalize_misa_journal_row(
        {
            **common,
            "detail_id": 1,
            "account_number": "1311",
            "corresponding_account_number": "5111",
            "debit_amount": 12_826_667,
            "credit_amount": 0,
        }
    )
    credit = normalize_misa_journal_row(
        {
            **common,
            "detail_id": 2,
            "account_number": "5111",
            "corresponding_account_number": "1311",
            "debit_amount": 0,
            "credit_amount": 12_826_667,
        }
    )

    assert debit["debit_account"] == credit["debit_account"] == "1311"
    assert debit["credit_account"] == credit["credit_account"] == "5111"
    assert debit["amount"] == credit["amount"] == Decimal("12826667")
    assert debit["posting_hash"] == credit["posting_hash"]
    assert debit["is_canonical_posting"] is True
    assert credit["is_canonical_posting"] is False


def test_journal_canonical_data_exposes_report_engine_fields() -> None:
    raw = {
        "session_id": "transient",
        "detail_id": 12,
        "refid": "voucher-2",
        "posted_date": "2026-01-31T00:00:00+07:00",
        "account_number": "911",
        "corresponding_account_number": "6321",
        "debit_amount": 100,
        "credit_amount": 0,
        "organization_unit_code": "CH004",
        "cash_flow_item_code": "01",
    }
    normalized = normalize_misa_journal_row(raw)
    canonical = journal_canonical_data(raw, normalized)

    assert canonical["debit_account"] == "911"
    assert canonical["credit_account"] == "6321"
    assert canonical["amount"] == "100"
    assert canonical["is_closing_entry"] is True
    assert canonical["organization_unit_code"] == "CH004"
    assert canonical["cash_flow_code"] == "01"
    assert "session_id" not in canonical
    assert "detail_id" not in canonical


def test_negative_adjustment_keeps_its_accounting_sign() -> None:
    debit = normalize_misa_journal_row(
        {
            "refid": "adjustment-1",
            "posted_date": "2026-01-31T00:00:00+07:00",
            "account_number": "6417",
            "corresponding_account_number": "3311",
            "debit_amount": -689_777_721,
            "credit_amount": 0,
        }
    )
    credit = normalize_misa_journal_row(
        {
            "refid": "adjustment-1",
            "posted_date": "2026-01-31T00:00:00+07:00",
            "account_number": "3311",
            "corresponding_account_number": "6417",
            "debit_amount": 0,
            "credit_amount": -689_777_721,
        }
    )

    assert debit["amount"] == credit["amount"] == Decimal("-689777721")
    assert debit["posting_hash"] == credit["posting_hash"]


def test_mirror_hash_ignores_side_specific_dimensions() -> None:
    common = {
        "refid": "object-transfer-1",
        "posted_date": "2026-01-20T00:00:00+07:00",
        "refno": "NVK2026/01/000010",
        "description": "Chuyển công nợ giữa hai đối tượng",
        "account_number": "1311",
        "corresponding_account_number": "1311",
    }
    debit = normalize_misa_journal_row(
        {**common, "debit_amount": 2_000_000, "credit_amount": 0, "account_object_code": "NEW"}
    )
    credit = normalize_misa_journal_row(
        {**common, "debit_amount": 0, "credit_amount": 2_000_000, "account_object_code": "OLD"}
    )

    assert debit["posting_hash"] == credit["posting_hash"]
