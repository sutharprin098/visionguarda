-- ============================================================================
-- Migration 0049: Cloud & Local Hybrid Inference Mode Governance
-- ============================================================================

-- 1. Ensure settings table contains appropriate constraints & default keys
-- Keys introduced:
--   - 'ai.inference_mode'      ('local' | 'cloud' | 'auto')
--   - 'ai.cloud_endpoint_url'  (e.g., 'https://api.camai.cloud/v1/infer' or AWS IP)
--   - 'ai.cloud_api_key'       (Encrypted / Cloud token)

-- Seed default 'ai.inference_mode' = 'local' for all existing organizations
INSERT INTO public.settings (org_id, scope, key, value, updated_at)
SELECT id, 'org', 'ai.inference_mode', '"local"'::jsonb, NOW()
FROM public.organizations
ON CONFLICT (org_id, scope, key) DO NOTHING;

-- Seed default 'ai.cloud_endpoint_url' = '' for all existing organizations
INSERT INTO public.settings (org_id, scope, key, value, updated_at)
SELECT id, 'org', 'ai.cloud_endpoint_url', '""'::jsonb, NOW()
FROM public.organizations
ON CONFLICT (org_id, scope, key) DO NOTHING;

-- 2. Verify Supabase Realtime Publication includes settings table
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_rel pr
      JOIN pg_class c ON pr.prrelid = c.oid
      JOIN pg_publication p ON pr.prpubid = p.oid
      WHERE p.pubname = 'supabase_realtime' AND c.relname = 'settings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
    END IF;
  END IF;
END $$;

-- 3. Audit trail logging for AI inference mode changes
CREATE OR REPLACE FUNCTION public.log_inference_mode_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scope = 'org' AND NEW.key = 'ai.inference_mode' AND (OLD.value IS DISTINCT FROM NEW.value) THEN
    INSERT INTO public.audit_logs (
      org_id,
      user_id,
      action,
      entity_type,
      entity_id,
      details,
      created_at
    )
    VALUES (
      NEW.org_id,
      auth.uid(),
      'ai_inference_mode_updated',
      'settings',
      NEW.key,
      jsonb_build_object(
        'previous_mode', OLD.value,
        'new_mode', NEW.value,
        'updated_at', NOW()
      ),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_inference_mode_change ON public.settings;
CREATE TRIGGER trg_log_inference_mode_change
  AFTER UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.log_inference_mode_change();

COMMENT ON FUNCTION public.log_inference_mode_change() IS 
  'Logs audit events whenever an organization changes its AI Inference Mode (Local vs Cloud vs Auto).';
