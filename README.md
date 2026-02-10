# Traffic API MVP 🚦

A global traffic data aggregator API that normalizes traffic data from multiple free sources into a clean, AI-friendly format.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with auto-reload (Node 18+)
npm run dev
```

## API Endpoints

### 1. Health Check
```bash
curl http://localhost:3000/
```

### 2. Get Traffic Data
```bash
# Ireland M1 traffic
curl -H "x-api-key: demo-key-free" "http://localhost:3000/traffic?road=M1&country=IE"

# UK M1 traffic
curl -H "x-api-key: demo-key-free" "http://localhost:3000/traffic?road=M1&country=UK"

# All countries
curl -H "x-api-key: demo-key-free" "http://localhost:3000/traffic?road=M1"
```

### 3. Compare Across Countries
```bash
curl -H "x-api-key: demo-key-free" "http://localhost:3000/compare?road=M1"
```

### 4. List Data Sources
```bash
curl http://localhost:3000/sources
```

## Demo API Keys

- `demo-key-free` - Basic access (100 req/15min)
- `demo-key-pro` - Pro tier
- `demo-key-enterprise` - Enterprise tier

## Example Response

```json
{
  "query": { "road": "M1", "country": "ALL" },
  "timestamp": "2026-02-10T17:50:00.000Z",
  "data": [
    {
      "source": "TII-Ireland",
      "road": "M1",
      "direction": "Northbound",
      "travelTimeMinutes": 28,
      "freeFlowTimeMinutes": 22,
      "delayMinutes": 6,
      "congestionLevel": "moderate",
      "timestamp": "2026-02-10T17:45:00.000Z"
    },
    {
      "source": "WebTRIS-UK",
      "road": "M1",
      "direction": "North",
      "averageSpeed": 65,
      "congestionLevel": "light",
      "timestamp": "2026-02-10T17:45:00.000Z"
    }
  ],
  "summary": {
    "totalRecords": 2,
    "sources": ["TII-Ireland", "WebTRIS-UK"],
    "countries": ["IE", "UK"],
    "congestionBreakdown": {
      "heavy": 0,
      "moderate": 1,
      "light": 1,
      "none": 0,
      "unknown": 0
    }
  },
  "responseTimeMs": 450
}
```

## Data Sources

### 1. TII (Ireland) 🇮🇪
- **URL**: https://data.tii.ie
- **Format**: DATEX II JSON
- **Update**: Every 5 minutes
- **Coverage**: All Irish national roads
- **Cost**: Free (CC BY 4.0)

### 2. WebTRIS (UK) 🇬🇧
- **URL**: https://webtris.nationalhighways.co.uk/api
- **Format**: REST JSON
- **Update**: Variable (up to 1 minute)
- **Coverage**: England motorways and A-roads
- **Cost**: Free

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Client App    │────▶│  Traffic API    │────▶│  Data Adapters  │
│  (AI Agent/App) │◀────│   (Express)     │◀────│  (Normalizers)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                           │
                              ▼                           ▼
                        ┌──────────┐              ┌──────────────┐
                        │ Rate Limiter            │ TII (IE)     │
                        │ API Key Auth            │ WebTRIS (UK) │
                        └──────────┘              └──────────────┘
```

## Value Proposition

### The Problem
- Traffic data is scattered across hundreds of sources
- Each source uses different formats (DATEX II, XML, JSON, CSV)
- Existing APIs (Google, TomTom) are expensive for high volume
- No API optimized for AI/LLM consumption

### The Solution
- Single endpoint for global traffic data
- Normalized, clean JSON format
- AI-friendly structure (easy to parse, clear field names)
- Aggregated from free sources (high margin potential)

## Business Model Options

### Tiered Pricing
1. **Free** - 1,000 req/day, IE+UK only, 1hr cache
2. **Developer** ($49/mo) - 10,000 req/day, EU coverage, 15min cache
3. **Business** ($199/mo) - 100,000 req/day, Global, 5min cache, webhooks
4. **Enterprise** (custom) - Unlimited, real-time, SLA, dedicated support

### Cost Structure
- **Data sources**: Free (using open data)
- **Infrastructure**: ~$200/mo (handles 10M+ requests)
- **Margin**: 85%+ at scale

## Roadmap

### Phase 1 (MVP) ✅
- [x] IE + UK data sources
- [x] Basic API with auth
- [x] Rate limiting

### Phase 2 (Expansion)
- [ ] Scotland (Traffic Scotland)
- [ ] Wales (Traffic Wales)
- [ ] France (Bison Futé)
- [ ] Germany (Autobahn)
- [ ] US (511 APIs)

### Phase 3 (Premium)
- [ ] Real-time alerts/webhooks
- [ ] Route optimization
- [ ] Historical data
- [ ] Predictive analytics

## License

MIT - This is a demo/prototype.

## Data Attribution

- Ireland data: © Transport Infrastructure Ireland (CC BY 4.0)
- UK data: © National Highways
