-- ═══════════════════════════════════════════════════════════════
-- 0265 — Goods receipt numbers become a per-tenant range.
--
-- 0248 gave goods_receipts a document number from a single global
-- sequence, because a receipt is a numbered document and two clients
-- receiving at once must not mint the same one. That was right for one
-- tenant and wrong for many:
--
--   • Tenants share one counter, so tenant B's receipt numbers advance
--     when tenant A books goods. Not a data leak — but it leaks VOLUME,
--     and a customer who receipts twice a week watching their numbers
--     jump by forty has learned something about your other customers.
--   • It breaks the convention every ERP expects. SAP number ranges are
--     per company code, and an integration that hands SAP a number from a
--     shared pool is handing it something meaningless.
--
-- And a sharper one that would have bitten first: `grn_number` is UNIQUE
-- across the whole table. The moment two tenants each mint their own
-- GRN-2026-000001, the second receipt is rejected as a duplicate of a row
-- it cannot see — the same failure the 0262 keys were widened to avoid,
-- and the reason this could not simply be "give each tenant a counter".
--
-- REUSES THE MACHINERY THAT EXISTS. numbering_config_overrides is already
-- keyed (company_id, object_class) with prefix/pad/next_number and is
-- already the per-tenant override for equipment and functional-location
-- numbering. Its object_class CHECK is widened rather than a second
-- numbering table being invented — two numbering mechanisms would be the
-- same drift this codebase keeps paying for. ers_next_document_number is
-- deliberately generic, so the next numbered document costs one line.
--
-- A TABLE COUNTER, NOT A SEQUENCE, and the difference is a feature. A
-- sequence never rolls back, so an aborted transaction burns a number and
-- leaves a gap; a counter row rolls back with its transaction. Finance
-- teams and auditors read a gap in a document series as something to
-- investigate. The cost is that concurrent receipts on ONE tenant
-- serialise briefly on that row, which at goods-receipt volumes is free.
--
-- The old sequence stays as the fallback for a row with no tenant, so no
-- insert can fail while company_id is still nullable.
--
-- Rollback:
--   restore the 0248 DEFAULT on grn_number, drop the trigger and both
--   functions, restore UNIQUE (grn_number), narrow the object_class CHECK.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. The shared object_class allow-list gains a member ────────
ALTER TABLE public.numbering_config_overrides
    DROP CONSTRAINT IF EXISTS numbering_config_overrides_object_class_check;
ALTER TABLE public.numbering_config_overrides
    ADD CONSTRAINT numbering_config_overrides_object_class_check
    CHECK (object_class IN ('EQUIPMENT', 'FLOC', 'GOODS_RECEIPT'));

-- ── 2. A generic per-tenant document number allocator ───────────
CREATE OR REPLACE FUNCTION public.ers_next_document_number(
    p_company      UUID,
    p_object_class TEXT,
    p_prefix       TEXT DEFAULT '',
    p_pad          INT  DEFAULT 6
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_allocated BIGINT;
    v_prefix    TEXT;
    v_pad       INT;
BEGIN
    -- No tenant, no range. The caller decides what to do about that.
    IF p_company IS NULL THEN RETURN NULL; END IF;

    -- next_number means "the next one to hand out", so the row starts at 2
    -- having just handed out 1, and RETURNING next_number - 1 is the number
    -- allocated on both the insert and the conflict path. One statement, so
    -- two concurrent receipts cannot take the same number.
    INSERT INTO public.numbering_config_overrides
        (company_id, object_class, prefix, pad, next_number)
    VALUES (p_company, p_object_class, COALESCE(p_prefix, ''), COALESCE(p_pad, 6), 2)
    ON CONFLICT (company_id, object_class) DO UPDATE
        SET next_number = public.numbering_config_overrides.next_number + 1,
            updated_at  = NOW()
    RETURNING next_number - 1, prefix, pad
    INTO v_allocated, v_prefix, v_pad;

    RETURN v_prefix
        || to_char(CURRENT_DATE, 'YYYY') || '-'
        || lpad(v_allocated::TEXT, GREATEST(COALESCE(v_pad, 6), 1), '0');
END;
$$;

COMMENT ON FUNCTION public.ers_next_document_number(UUID, TEXT, TEXT, INT) IS
    'Allocate the next document number in a tenant''s range (numbering_config_overrides). Atomic; rolls back with its transaction so a failed insert leaves no gap. Returns NULL when the tenant is unknown.';

-- ── 3. The receipt number is assigned, not defaulted ────────────
-- A column DEFAULT cannot read another column of the same row, and the
-- number depends on company_id — so this has to be a BEFORE trigger.
-- Column defaults are applied first, so NEW.company_id is populated here.
ALTER TABLE public.goods_receipts ALTER COLUMN grn_number DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.ers_goods_receipt_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.grn_number IS NULL OR btrim(NEW.grn_number) = '' THEN
        NEW.grn_number := COALESCE(
            public.ers_next_document_number(NEW.company_id, 'GOODS_RECEIPT', 'GRN-', 6),
            -- No tenant yet: the pre-0265 global sequence, so an insert
            -- during the tenancy transition still gets a number.
            'GRN-' || to_char(CURRENT_DATE, 'YYYY') || '-'
                   || lpad(nextval('public.goods_receipt_seq')::TEXT, 6, '0')
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_goods_receipt_number ON public.goods_receipts;
CREATE TRIGGER trg_goods_receipt_number
    BEFORE INSERT ON public.goods_receipts
    FOR EACH ROW EXECUTE FUNCTION public.ers_goods_receipt_number();

-- ── 4. Uniqueness follows the range ─────────────────────────────
-- Per-tenant ranges mean two tenants legitimately hold GRN-2026-000001.
-- NULLS NOT DISTINCT so rows with no tenant still collide with each other
-- rather than silently losing the constraint (0262 has the same note).
ALTER TABLE public.goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_grn_number_key;
ALTER TABLE public.goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_tenant_grn_uq;
ALTER TABLE public.goods_receipts
    ADD CONSTRAINT goods_receipts_tenant_grn_uq
    UNIQUE NULLS NOT DISTINCT (company_id, grn_number);

COMMENT ON CONSTRAINT goods_receipts_tenant_grn_uq ON public.goods_receipts IS
    'One receipt number per tenant. Ranges are per company (0265), so two customers may both hold GRN-2026-000001.';

COMMIT;
