-- M1 Traffic Alert Cron Jobs with Junction-Level Monitoring
-- Updated: 2026-02-10
-- 
-- This creates two scheduled jobs for monitoring M1 traffic between Drogheda and Swords
-- Now checks multiple junction segments individually for precise congestion reporting
--
-- TWO OPTIONS:
-- Option A: Direct API calls from SQL (simpler, limited formatting)
-- Option B: Edge Function approach (better formatting, aggregation logic)

-- ============================================
-- SETUP: Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================
-- CONFIGURATION
-- ============================================
-- Set these values before running the cron job setup

-- Traffic API endpoint (Render deployment)
ALTER DATABASE postgres SET "app.settings.traffic_api_url" = 'https://traffic-api-mvp.onrender.com';
ALTER DATABASE postgres SET "app.settings.traffic_api_key" = 'argo-traffic-api-key-2026';

-- Telegram Bot Configuration (for sending alerts)
-- Get from @BotFather on Telegram
ALTER DATABASE postgres SET "app.settings.telegram_bot_token" = 'YOUR_BOT_TOKEN_HERE';
ALTER DATABASE postgres SET "app.settings.telegram_chat_id" = 'YOUR_CHAT_ID_HERE';

-- ============================================
-- CLEANUP: Remove existing jobs
-- ============================================
SELECT cron.unschedule('m1-traffic-morning');
SELECT cron.unschedule('m1-traffic-evening');
SELECT cron.unschedule('m1-traffic-morning-v2');
SELECT cron.unschedule('m1-traffic-evening-v2');

-- ============================================
-- OPTION A: Direct API Call Approach
-- Simple but limited - makes individual API calls per segment
-- ============================================

-- Morning Job: 7:45 AM, Tuesdays & Wednesdays (Drogheda → Swords)
SELECT cron.schedule(
    'm1-traffic-morning',
    '45 7 * * 2,3',  -- At 07:45 on Tuesday (2) and Wednesday (3)
    $$
    SELECT net.http_get(
        url := 'https://traffic-api-mvp.onrender.com/traffic?road=M1&country=IE&town=Drogheda&extract=true',
        headers := jsonb_build_object(
            'x-api-key', 'argo-traffic-api-key-2026',
            'Accept', 'application/json'
        )
    ) AS request_id
    $$
);

-- Evening Job: 5:15 PM, Tuesdays & Wednesdays (Swords → Drogheda)
SELECT cron.schedule(
    'm1-traffic-evening',
    '15 17 * * 2,3',  -- At 17:15 on Tuesday (2) and Wednesday (3)
    $$
    SELECT net.http_get(
        url := 'https://traffic-api-mvp.onrender.com/traffic?road=M1&country=IE&town=Swords&extract=true',
        headers := jsonb_build_object(
            'x-api-key', 'argo-traffic-api-key-2026',
            'Accept', 'application/json'
        )
    ) AS request_id
    $$
);

-- ============================================
-- OPTION B: Edge Function Approach (RECOMMENDED)
-- Calls an Edge Function that aggregates multiple junctions and formats report
-- 
-- Requires deploying the m1-junction-monitor.js as a Supabase Edge Function first
-- See: /traffic-api-mvp/m1-junction-monitor.js
-- ============================================

-- Deploy Edge Function first with:
-- supabase functions deploy m1-traffic-monitor
--
-- Then uncomment and use these jobs:

/*
SELECT cron.schedule(
    'm1-traffic-morning-v2',
    '45 7 * * 2,3',
    $$
    SELECT net.http_post(
        url := concat(current_setting('app.settings.supabase_url'), '/functions/v1/m1-traffic-monitor'),
        headers := jsonb_build_object(
            'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key')),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('direction', 'southbound')
    ) AS request_id;
    $$
);

SELECT cron.schedule(
    'm1-traffic-evening-v2',
    '15 17 * * 2,3',
    $$
    SELECT net.http_post(
        url := concat(current_setting('app.settings.supabase_url'), '/functions/v1/m1-traffic-monitor'),
        headers := jsonb_build_object(
            'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key')),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('direction', 'northbound')
    ) AS request_id;
    $$
);
*/

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
        WHEN 'm1-traffic-morning' THEN '🌅 07:45 Tue/Wed - Drogheda → Swords (Basic)'
        WHEN 'm1-traffic-evening' THEN '🌆 17:15 Tue/Wed - Swords → Drogheda (Basic)'
        WHEN 'm1-traffic-morning-v2' THEN '🌅 07:45 Tue/Wed - Drogheda → Swords (Advanced)'
        WHEN 'm1-traffic-evening-v2' THEN '🌆 17:15 Tue/Wed - Swords → Drogheda (Advanced)'
    END as description
FROM cron.job 
WHERE jobname LIKE 'm1-traffic%'
ORDER BY jobname;

-- ============================================
-- MANUAL TEST QUERIES
-- ============================================

-- Test morning route (Drogheda → Swords)
-- SELECT net.http_get(
--     url := 'https://traffic-api-mvp.onrender.com/traffic?road=M1&country=IE&town=Drogheda&extract=true',
--     headers := jsonb_build_object(
--         'x-api-key', 'argo-traffic-api-key-2026',
--         'Accept', 'application/json'
--     )
-- );

-- Test evening route (Swords → Drogheda)
-- SELECT net.http_get(
--     url := 'https://traffic-api-mvp.onrender.com/traffic?road=M1&country=IE&town=Swords&extract=true',
--     headers := jsonb_build_object(
--         'x-api-key', 'argo-traffic-api-key-2026',
--         'Accept', 'application/json'
--     )
-- );

-- Test Balbriggan segment
-- SELECT net.http_get(
--     url := 'https://traffic-api-mvp.onrender.com/traffic?road=M1&country=IE&town=Balbriggan&extract=true',
--     headers := jsonb_build_object(
--         'x-api-key', 'argo-traffic-api-key-2026',
--         'Accept', 'application/json'
--     )
-- );

-- ============================================
-- M1 JUNCTION REFERENCE
-- ============================================
/*
Southbound (Drogheda → Swords):
  J10 Drogheda North
  J9  Drogheda South
  J8  Duleek
  J7  Julianstown
  J6  Balbriggan North
  J5  Balbriggan
  J4  Donabate
  J3  Swords
  J2  Dublin Airport
  J1  M50/M1 Interchange

Northbound (Swords → Drogheda):
  Same junctions in reverse

Query Points (town parameter):
  - Drogheda    → Covers J10-J9 area
  - Duleek      → Covers J8 area
  - Julianstown → Covers J7 area
  - Balbriggan  → Covers J6-J5 area
  - Donabate    → Covers J4 area
  - Swords      → Covers J3-J1 area
*/

-- ============================================
-- MAINTENANCE COMMANDS
-- ============================================

-- View all traffic-related jobs:
-- SELECT * FROM cron.job WHERE jobname LIKE 'm1-traffic%';

-- View job execution history:
-- SELECT * FROM cron.job_run_details WHERE jobname LIKE 'm1-traffic%' ORDER BY start_time DESC LIMIT 10;

-- Unschedule specific job:
-- SELECT cron.unschedule('m1-traffic-morning');
-- SELECT cron.unschedule('m1-traffic-evening');

-- Unschedule all traffic jobs:
-- SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'm1-traffic%';

-- ============================================
-- DEPLOYMENT CHECKLIST
-- ============================================
--
-- [ ] Update TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in config above
-- [ ] Run this SQL in Supabase SQL Editor
-- [ ] Verify jobs created: SELECT * FROM cron.job;
-- [ ] Test manual execution (see test queries above)
-- [ ] For advanced version: Deploy m1-junction-monitor.js as Edge Function
-- [ ] Monitor first few runs: SELECT * FROM cron.job_run_details;
--
