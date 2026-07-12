-- ============================================================
-- CamAI Enterprise Platform
-- Migration 0007
-- Safe Removal of app_releases
-- Idempotent Version
-- ============================================================

BEGIN;

-- ============================================================
-- Remove foreign key from downloads (if it exists)
-- ============================================================

ALTER TABLE IF EXISTS public.downloads
DROP CONSTRAINT IF EXISTS downloads_release_id_fkey;

-- ============================================================
-- Only run cleanup if app_releases exists
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'app_releases'
    ) THEN

        -- Disable RLS
        EXECUTE 'ALTER TABLE public.app_releases DISABLE ROW LEVEL SECURITY';

        -- Drop Policies
        EXECUTE 'DROP POLICY IF EXISTS "Users can view releases" ON public.app_releases';
        EXECUTE 'DROP POLICY IF EXISTS "Admins can manage releases" ON public.app_releases';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated read releases" ON public.app_releases';

        -- Drop Trigger
        EXECUTE 'DROP TRIGGER IF EXISTS app_releases_updated_at_trigger ON public.app_releases';

        -- Drop Table
        EXECUTE 'DROP TABLE public.app_releases';

    ELSE

        RAISE NOTICE 'Table public.app_releases already removed.';

    END IF;

END
$$;

-- ============================================================
-- Drop indexes if they still exist
-- ============================================================

DROP INDEX IF EXISTS public.idx_app_releases_version;
DROP INDEX IF EXISTS public.idx_app_releases_created_at;

-- ============================================================
-- Drop update function if it exists
-- ============================================================

DROP FUNCTION IF EXISTS public.update_app_releases_updated_at();

-- ============================================================
-- Keep downloads table
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema='public'
        AND table_name='downloads'
    ) THEN

        COMMENT ON TABLE public.downloads IS
        'Download analytics. Application releases are fetched dynamically from the GitHub Releases API.';

    END IF;

END
$$;

-- ============================================================
-- Verification
-- ============================================================

DO $$
BEGIN

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema='public'
        AND table_name='app_releases'
    ) THEN

        RAISE WARNING 'app_releases still exists.';

    ELSE

        RAISE NOTICE 'Migration completed successfully.';
        RAISE NOTICE 'Downloads now use GitHub Releases API.';
        RAISE NOTICE 'Download analytics table preserved.';

    END IF;

END
$$;

COMMIT;

-- ============================================================
-- After Migration
-- ============================================================
--
-- Downloads page should fetch release metadata from:
--
-- /functions/v1/github-releases/latest
--
-- or
--
-- https://api.github.com/repos/<OWNER>/<REPO>/releases/latest
--
-- Display:
--
-- • Latest Version
-- • Release Notes
-- • Published Date
-- • File Size
-- • Download URL
-- • Checksum (optional)
--
-- Keep the downloads table for:
--
-- • Download Analytics
-- • User Analytics
-- • Organization Analytics
-- • Audit Logs
--
-- app_releases should never be recreated.
--
-- GitHub Releases is now the single source of truth.
-- ============================================================