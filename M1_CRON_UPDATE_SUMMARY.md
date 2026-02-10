# M1 Traffic Cron Jobs - Junction-Level Update

## Summary

Updated the M1 traffic monitoring system to check **individual junctions** along the route instead of just start/end points. This provides precise congestion information so you know exactly where problems are.

## What Changed

### Old Approach
- Single query: `GET /traffic?road=M1&country=IE`
- Result: "M1 is congested" (but where?)

### New Approach
- Multiple queries at key junctions:
  - Drogheda (J10-J9 area)
  - Duleek (J8 area)
  - Julianstown (J7 area)
  - Balbriggan (J6-J5 area)
  - Donabate (J4 area)
  - Swords (J3-J1 area)
- Result: "J7-J6 Julianstown-Balbriggan has +8 min delay, rest is clear"

## Files Created

| File | Location | Purpose |
|------|----------|---------|
| `check-m1-traffic.js` | `/traffic-api-mvp/` | Standalone script for local execution |
| `m1-junction-monitor.js` | `/traffic-api-mvp/` | Supabase Edge Function version |
| `m1-traffic-cron-junctions.sql` | `/traffic-api-mvp/supabase/` | SQL cron job setup |
| `M1_JUNCTION_MONITOR.md` | `/traffic-api-mvp/` | Full documentation |

## M1 Junctions Mapped

```
Southbound (Morning: Drogheda → Swords)
J10 Drogheda North ─┐
J9  Drogheda South ─┼── Segment 1: Drogheda area
J8  Duleek ─────────┼── Segment 2: Duleek area
J7  Julianstown ────┼── Segment 3: Julianstown area
J6  Balbriggan N ───┤
J5  Balbriggan ─────┼── Segment 4: Balbriggan area
J4  Donabate ───────┼── Segment 5: Donabate area
J3  Swords ─────────┤
J2  Dublin Airport ─┼── Segment 6: Swords area
J1  M50 Interchange─┘
```

## Quick Test

```bash
# Test morning route (Drogheda → Swords)
cd /home/openclaw/.openclaw/workspace/traffic-api-mvp
node check-m1-traffic.js southbound

# Test evening route (Swords → Drogheda)
node check-m1-traffic.js northbound
```

## Setting Up Cron Jobs

### Option 1: Local Crontab (Recommended for testing)

```bash
# Edit your crontab
crontab -e

# Add these lines for Tue/Wed office days:
# Morning check at 7:45 AM
45 7 * * 2,3 cd /home/openclaw/.openclaw/workspace/traffic-api-mvp && node check-m1-traffic.js southbound

# Evening check at 5:15 PM
15 17 * * 2,3 cd /home/openclaw/.openclaw/workspace/traffic-api-mvp && node check-m1-traffic.js northbound
```

### Option 2: Supabase Cron Jobs

1. Run the SQL in Supabase SQL Editor:
   ```sql
   -- Copy contents of /traffic-api-mvp/supabase/m1-traffic-cron-junctions.sql
   -- Paste into Supabase Dashboard → SQL Editor
   -- Run
   ```

2. Verify jobs are active:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE 'm1-traffic%';
   ```

## Report Format Example

```
🌅 M1 Traffic Report - Drogheda → Swords
_Tuesday, 10 February 2026 at 07:45_

*Segment Breakdown:*
✅ J10-J9 Drogheda: 5 min
✅ J9-J8 Drogheda-Duleek: 8 min
✅ J8-J7 Duleek-Julianstown: 5 min
🟠 J7-J6 Julianstown-Balbriggan: 13 min (+5)
✅ J6-J5 Balbriggan: 3 min
✅ J5-J4 Balbriggan-Donabate: 7 min
✅ J4-J3 Donabate-Swords: 6 min
✅ J3-J1 Swords-M50: 5 min

*Summary:*
• Total: 52 min (normal: 47 min)
• Delay: +5 min
• Worst: J7-J6 Julianstown-Balbriggan (5 min)

*Recommendation:*
🟡 Minor delays. Allow extra 5 minutes, mainly at Julianstown-Balbriggan.
```

## Schedule

| Time | Direction | Days | Route |
|------|-----------|------|-------|
| 07:45 | Southbound | Tue, Wed | Drogheda → Swords |
| 17:15 | Northbound | Tue, Wed | Swords → Drogheda |

**Note**: Update days for March office schedule if needed.

## Telegram Integration (Optional)

Set environment variables to get alerts:

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"

# Script will auto-send Telegram if delays >= 5 minutes
node check-m1-traffic.js southbound
```

## API Key

Using existing key: `argo-traffic-api-key-2026`

Traffic API endpoint: `https://traffic-api-mvp.onrender.com`

## Next Steps

1. **Test the script**: Run `node check-m1-traffic.js southbound` to verify it works
2. **Set up cron**: Choose Option 1 (local) or Option 2 (Supabase)
3. **Add Telegram**: Set TELEGRAM_BOT_TOKEN for notifications
4. **Monitor**: Check first few runs to ensure accuracy

## Troubleshooting

- If API is slow: The script has a 10s timeout per segment
- If no data: Falls back to normal time estimates
- If errors: Check Traffic API status at https://traffic-api-mvp.onrender.com/api

---

**Status**: ✅ Ready for deployment
