DROP INDEX IF EXISTS accounting_portal.config_records_active_identity_uq;

CREATE UNIQUE INDEX config_records_active_identity_uq
  ON accounting_portal.config_records(
    version_id,
    record_type,
    entity_key,
    company_key,
    valid_from
  )
  WHERE deleted_at IS NULL;
