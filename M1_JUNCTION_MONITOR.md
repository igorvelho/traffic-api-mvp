# M1 Traffic Junction Monitor

Per-junction traffic monitoring for the M1 motorway between Drogheda and Swords. Checks multiple segments along the route to pinpoint exactly where congestion occurs.

## Overview

Instead of a single "M1 traffic" check, this system monitors 8 individual segments:

```
Drogheda → Swords (Southbound - Morning Commute)
├── J10-J9 Drogheda (5 min normal)
├── J9-J8 Drogheda-Duleek (8 min normal)
├── J8-J7 Duleek-Julianstown (5 min normal)
├── J7-J6 Julianstown-Balbriggan (8 min normal)
├── J6-J5 Balbriggan (3 min normal)
├── J5-J4 Balbriggan-Donabate (7 min normal)
├── J4-J3 Donabate-Swords (6 min normal)
└── J3-J1 Swords-M50 (5 min normal)

Total normal time: 47 minutes
```

## Files

| File | Purpose |
|------|---------|
| `check-m1-traffic.js` | Standalone script for local/scheduled execution |
| `m1-junction-monitor.js` | Edge Function version for Supabase deployment |
| `supabase/m1-traffic-cron-junctions.sql` | SQL cron job setup for Supabase |

## Quick Start (Local Testing)

```bash
# Check morning commute (Drogheda → Swords)
node check-m1-traffic.js southbound

# Check evening commute (Swords → Drogheda)
node check-m1-traffic.js northbound
```

## Example Output

```
🌅 M1 Traffic Report - Drogheda → Swords
_Tuesday, 10 February 2026 at 07:45_

*Segment Breakdown:*
✅ J10-J9 Drogheda: 5 min
✅ J9-J8 Drogheda-Duleek: 8 min
✅ J8-J7 Duleek-Julianstown: 5 min
🟡 J7-J6 Julianstown-Balbriggan: 11 min (+3)
✅ J6-J5 Balbriggan: 3 min
✅ J5-J4 Balbriggan-Donabate: 7 min
✅ J4-J3 Donabate-Swords: 6 min
✅ J3-J1 Swords-M50: 5 min

*Summary:*
• Total: 50 min (normal: 47 min)
• Delay: +3 min
• Worst: J7-J6 Julianstown-Balbriggan (3 min)

*Recommendation:*
🟡 Minor delays. Allow extra 3 mins.
```

## Cron Job Setup

### Option 1: System Crontab (Linux/Mac)

```bash
# Edit crontab
crontab -e

# Add these lines for Tuesday & Wednesday office days
# Morning check at 7:45 AM (Drogheda → Swords)
45 7 * * 2,3 cd /path/to/traffic-api-mvp && node check-m1-traffic.js southbound

# Evening check at 5:15 PM (Swords → Drogheda)
15 17 * * 2,3 cd /path/to/traffic-api-mvp && node check-m1-traffic.js northbound
```

### Option 2: Supabase Cron Jobs

1. Run the SQL setup in Supabase SQL Editor:
   ```bash
   psql $SUPABASE_DB_URL -f supabase/m1-traffic-cron-junctions.sql
   ```

2. Verify jobs are scheduled:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE 'm1-traffic%';
   ```

3. For advanced monitoring, deploy the Edge Function:
   ```bash
   supabase functions deploy m1-traffic-monitor
   ```

### Option 3: Render.com Scheduled Jobs

Add to `render.yaml`:
```yaml
services:
  - type: cron
    name: m1-morning-check
    runtime: node
    schedule: "45 7 * * 2,3"
    buildCommand: "npm install"
    startCommand: "node check-m1-traffic.js southbound"
    
  - type: cron
    name: m1-evening-check
    runtime: node
    schedule: "15 17 * * 2,3"
    buildCommand: "npm install"
    startCommand: "node check-m1-traffic.js northbound"
```

## Telegram Integration

Set environment variables to receive Telegram alerts:

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"

# Run check - will send Telegram if delays detected
node check-m1-traffic.js southbound
```

To get your chat ID:
1. Message @userinfobot on Telegram
2. Or use @BotFather to create a bot and get the token

## How It Works

1. **Segment Querying**: The script queries the Traffic API for each town along the route:
   - Drogheda (J10-J9)
   - Duleek (J8)
   - Julianstown (J7)
   - Balbriggan (J6-J5)
   - Donabate (J4)
   - Swords (J3-J1)

2. **Data Aggregation**: Combines results to calculate:
   - Current travel time per segment
   - Delay vs normal time
   - Total route time
   - Worst-affected segment

3. **Smart Reporting**: 
   - Shows ✅🟡🟠🔴 status per junction
   - Calculates total delay
   - Provides specific recommendations

## API Endpoints Used

```
GET https://traffic-api-mvp.onrender.com/traffic
  ?road=M1
  &country=IE
  &town={Drogheda|Duleek|Julianstown|Balbriggan|Donabate|Swords}
  &extract=true
```

Headers:
```
x-api-key: argo-traffic-api-key-2026
```

## Troubleshooting

### No data for a segment
- Some segments may not have live data available
- Script falls back to normal time estimates
- Check Traffic API status: https://traffic-api-mvp.onrender.com/api

### API returning errors
- Verify API key is set correctly
- Check API status page
- TII (Ireland) data source sometimes returns 403

### Cron job not running
- Check cron service is running: `sudo service cron status`
- View cron logs: `grep CRON /var/log/syslog`
- Test script manually first: `node check-m1-traffic.js southbound`

## Schedule Reference

| Time | Direction | Days | Purpose |
|------|-----------|------|---------|
| 07:45 | Drogheda → Swords | Tue, Wed | Morning commute check |
| 17:15 | Swords → Drogheda | Tue, Wed | Evening commute check |

**Note**: Schedule aligns with February 2026 office days (Tue/Wed). Update for March schedule change if needed.

## License

MIT - Part of Traffic API MVP
