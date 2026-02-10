# Traffic API MVP 🚦

A global traffic data aggregator API that normalizes traffic data from multiple free sources into a clean, AI-friendly format.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment (optional - for LLM features)
cp .env.example .env
# Edit .env and add your LLM_API_KEY for segment extraction

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

# With LLM segment extraction (adds human-readable location info)
curl -H "x-api-key: demo-key-free" "http://localhost:3000/traffic?road=M1&extract=true"
```

### 2a. Extract Segments from Raw Text (LLM Demo)
```bash
# Extract structured location data from raw traffic descriptions
curl -X POST -H "x-api-key: demo-key-free" \
  -H "Content-Type: text/plain" \
  -d "Site 19446, M1, lat: 52.198, lon: -0.915, speed: 48, congestion: moderate" \
  "http://localhost:3000/extract"
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

### Standard Response
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

### With Segment Extraction (`?extract=true`)
```json
{
  "query": { "road": "M1", "country": "ALL", "extract": true },
  "timestamp": "2026-02-10T17:50:00.000Z",
  "data": [
    {
      "source": "WebTRIS-UK",
      "siteId": "19446",
      "road": "M1",
      "direction": "Northbound",
      "location": { "lat": 52.198, "lon": -0.915 },
      "vehicleFlow": 2450,
      "averageSpeed": 65,
      "congestionLevel": "light",
      "timestamp": "2026-02-10T17:45:00.000Z",
      "segment": {
        "road": "M1",
        "direction": "Northbound",
        "segment": "Near Junction 14",
        "landmark": "Milton Keynes area",
        "congestion": "light",
        "speed": "65 km/h",
        "incidentType": null,
        "humanReadable": "M1 Northbound - Near Junction 14 (Milton Keynes area) [light congestion] at 65 km/h",
        "rawExtracted": true,
        "cached": false
      },
      "humanReadable": "M1 Northbound - Near Junction 14 (Milton Keynes area) [light congestion] at 65 km/h"
    }
  ],
  "summary": {
    "totalRecords": 1,
    "sources": ["WebTRIS-UK"],
    "countries": ["UK"],
    "congestionBreakdown": {
      "heavy": 0,
      "moderate": 0,
      "light": 1,
      "none": 0
    }
  },
  "extraction": {
    "processed": 1,
    "extractionTimeMs": 850,
    "cached": 0
  },
  "responseTimeMs": 1250
}
```

### Segment Extraction Demo Response
```json
{
  "input": "Site 19446, M1, lat: 52.198, lon: -0.915, speed: 48, congestion: moderate",
  "extracted": {
    "road": "M1",
    "direction": "Northbound",
    "segment": "Junction 14 area",
    "landmark": "Near Milton Keynes",
    "congestion": "moderate",
    "speed": "48 km/h",
    "incidentType": null,
    "humanReadable": "M1 Northbound - Junction 14 area (Near Milton Keynes) [moderate congestion] at 48 km/h",
    "rawExtracted": true,
    "cached": false
  },
  "processingTimeMs": 920,
  "timestamp": "2026-02-10T17:50:00.000Z"
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

## 🧠 LLM Segment Extraction

The Traffic API includes AI-powered segment extraction using LLMs (Gemini, OpenAI, or Kimi) to transform raw traffic data into human-readable location descriptions. No hardcoded coordinates needed - the LLM uses its geographic knowledge to identify locations from coordinates.

### Features
- **Automatic Location Parsing**: Extracts road names, junction numbers, landmarks from coordinates
- **Direction Detection**: Identifies Northbound/Southbound/Eastbound/Westbound
- **Congestion Context**: Adds human-readable descriptions of traffic conditions
- **Smart Caching**: 5-minute TTL cache prevents redundant LLM calls
- **Graceful Fallback**: Returns raw data with pattern matching if LLM unavailable
- **Multi-Provider Support**: Works with Gemini (free), OpenAI, or Kimi

### How It Works
1. Raw traffic data is received from TII or WebTRIS
2. Data is sent to configured LLM API with a structured extraction prompt
3. LLM uses its geographic knowledge to identify locations from coordinates
4. Returns structured JSON with location details (road, junction, landmarks)
5. Results are cached and added to the response

### Configuration

Create a `.env` file to enable LLM extraction:

```bash
cp .env.example .env
```

Edit `.env` and add your API key:

```bash
# Option 1: Gemini (recommended, free tier: 60 req/min)
LLM_PROVIDER=gemini
LLM_API_KEY=your_gemini_api_key

# Option 2: OpenAI
# LLM_PROVIDER=openai
# LLM_API_KEY=sk-...

# Option 3: Kimi (Moonshot)
# LLM_PROVIDER=kimi
# LLM_API_KEY=sk-...
```

**Get your free Gemini API key**: https://makersuite.google.com/app/apikey

### Cache Management
```bash
# Check cache statistics
curl -H "x-api-key: demo-key-free" "http://localhost:3000/cache/stats"

# Clear the cache
curl -X POST -H "x-api-key: demo-key-free" "http://localhost:3000/cache/clear"
```

### LLM Status
```bash
# Check LLM configuration status
curl -H "x-api-key: demo-key-free" "http://localhost:3000/llm/status"
```

### Performance
- First request: ~1-2 seconds (LLM processing)
- Cached requests: ~50ms (instant)
- Batch processing: Parallel LLM calls for multiple records

## Roadmap

### Phase 1 (MVP) ✅
- [x] IE + UK data sources
- [x] Basic API with auth
- [x] Rate limiting
- [x] **LLM-powered segment extraction** 🆕
- [x] **Human-readable location descriptions** 🆕

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
