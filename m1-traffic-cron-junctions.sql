-- M1 Traffic Alert Cron Jobs with Junction-Level Monitoring
-- This creates two scheduled jobs for monitoring M1 traffic between Drogheda and Swords
-- Now checks multiple junction segments individually for precise congestion reporting

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================
-- CONFIGURATION
-- ============================================
-- Set the Traffic API URL and credentials
-- Note: Replace YOUR_PROJECT_REF with actual Supabase project reference if needed

-- Traffic API endpoint (Render deployment)
ALTER DATABASE postgres SET "app.settings.traffic_api_url" = 'https://traffic-api-mvp.onrender.com';
ALTER DATABASE postgres SET "app.settings.traffic_api_key" = 'argo-traffic-api-key-2026';

-- ============================================
-- REMOVE EXISTING JOBS (for idempotent setup)
-- ============================================
SELECT cron.unschedule('m1-traffic-morning');
SELECT cron.unschedule('m1-traffic-evening');

-- ============================================
-- M1 JUNCTION SEGMENTS (Drogheda to Swords)
-- ============================================
-- Southbound (Morning commute: Drogheda → Swords)
-- J10 Drogheda North → J9 Drogheda South → J8 Duleek → J7 Julianstown
--   → J6 Balbriggan North → J5 Balbriggan → J4 Donabate → J3 Swords
--   → J2 Dublin Airport → J1 M50/M1 Interchange

-- Northbound (Evening commute: Swords → Drogheda)
-- Reverse of above

-- ============================================
-- MORNING CRON JOB: 7:45 AM, Tuesdays & Wednesdays
-- Checks M1 Southbound from Drogheda to Swords
-- ============================================
SELECT cron.schedule(
    'm1-traffic-morning',
    '45 7 * * 2,3',  -- At 07:45 on Tuesday (2) and Wednesday (3)
    $$
    WITH segments AS (
        -- Define the segments to check (from north to south)
        SELECT * FROM (VALUES
            ('J10-J9 Drogheda North-South', 'Drogheda', 'Drogheda', 1),
            ('J8 Duleek area', 'Duleek', 'Duleek', 2),
            ('J7 Julianstown', 'Julianstown', 'Julianstown', 3),
            ('J6-J5 Balbriggan', 'Balbriggan', 'Balbriggan', 4),
            ('J4 Donabate', 'Donabate', 'Donabate', 5),
            ('J3 Swords', 'Swords', 'Swords', 6)
        ) AS t(segment_name, town_query, display_name, sort_order)
    ),
    api_calls AS (
        -- Call Traffic API for each segment
        SELECT 
            s.segment_name,
            s.display_name,
            s.sort_order,
            net.http_get(
                url := concat(
                    current_setting('app.settings.traffic_api_url'),
                    '/traffic?road=M1&country=IE&town=',
                    encode(convert_to(s.town_query, 'UTF8'), 'base64'),
                    '&extract=true'
                ),
                headers := jsonb_build_object(
                    'x-api-key', current_setting('app.settings.traffic_api_key'),
                    'Accept', 'application/json'
                )
            ) AS request_id
        FROM segments s
    )
    SELECT jsonb_build_object(
        'type', 'morning_commute_check',
        'direction', 'Drogheda → Swords (Southbound)',
        'scheduled_time', '07:45',
        'segments_checked', 6,
        'request_ids', array_agg(request_id)
    ) AS status
    FROM api_calls;
    $$
);

-- ============================================
-- EVENING CRON JOB: 5:15 PM, Tuesdays & Wednesdays  
-- Checks M1 Northbound from Swords to Drogheda
-- ============================================
SELECT cron.schedule(
    'm1-traffic-evening',
    '15 17 * * 2,3',  -- At 17:15 (5:15 PM) on Tuesday (2) and Wednesday (3)
    $$
    WITH segments AS (
        -- Define the segments to check (from south to north)
        SELECT * FROM (VALUES
            ('J3 Swords', 'Swords', 'Swords', 1),
            ('J4 Donabate', 'Donabate', 'Donabate', 2),
            ('J6-J5 Balbriggan', 'Balbriggan', 'Balbriggan', 3),
            ('J7 Julianstown', 'Julianstown', 'Julianstown', 4),
            ('J8 Duleek area', 'Duleek', 'Duleek', 5),
            ('J10-J9 Drogheda', 'Drogheda', 'Drogheda', 6)
        ) AS t(segment_name, town_query, display_name, sort_order)
    ),
    api_calls AS (
        -- Call Traffic API for each segment
        SELECT 
            s.segment_name,
            s.display_name,
            s.sort_order,
            net.http_get(
                url := concat(
                    current_setting('app.settings.traffic_api_url'),
                    '/traffic?road=M1&country=IE&town=',
                    encode(convert_to(s.town_query, 'UTF8'), 'base64'),
                    '&extract=true'
                ),
                headers := jsonb_build_object(
                    'x-api-key', current_setting('app.settings.traffic_api_key'),
                    'Accept', 'application/json'
                )
            ) AS request_id
        FROM segments s
    )
    SELECT jsonb_build_object(
        'type', 'evening_commute_check',
        'direction', 'Swords → Drogheda (Northbound)',
        'scheduled_time', '17:15',
        'segments_checked', 6,
        'request_ids', array_agg(request_id)
    ) AS status
    FROM api_calls;
    $$
);

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 
    jobid,
    jobname,
    schedule,
    CASE 
        WHEN active THEN '✅ Active'
        ELSE '❌ Inactive'
    END as status,
    CASE jobname
        WHEN 'm1-traffic-morning' THEN '07:45 Tue/Wed - Drogheda → Swords'
        WHEN 'm1-traffic-evening' THEN '17:15 Tue/Wed - Swords → Drogheda'
    END as description
FROM cron.job 
WHERE jobname IN ('m1-traffic-morning', 'm1-traffic-evening')
ORDER BY jobname;

-- ============================================
-- USAGE NOTES
-- ============================================
-- 
-- These cron jobs will:
-- 1. Query 6 segments along the M1 route for each commute
-- 2. Use the Traffic API with town-based queries for precise junction data
-- 3. Return request IDs that can be used to track the async HTTP calls
--
-- The segments checked are:
-- Morning (Drogheda → Swords): J10→J9→J8→J7→J6→J5→J4→J3
-- Evening (Swords → Drogheda): J3→J4→J5→J6→J7→J8→J9→J10
--
-- To test manually:
-- curl -H "x-api-key: argo-traffic-api-key-2026" \
--   "https://traffic-api-mvp.onrender.com/traffic?road=M1&country=IE&town=Drogheda&extract=true"
--
-- To check job status:
-- SELECT * FROM cron.job WHERE jobname LIKE 'm1-traffic%';
--
-- To unschedule:
-- SELECT cron.unschedule('m1-traffic-morning');
-- SELECT cron.unschedule('m1-traffic-evening');
