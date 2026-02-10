const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use(limiter);

const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !['demo-key-free', 'demo-key-pro', 'demo-key-enterprise'].includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid or missing API key', message: 'Use x-api-key: demo-key-free' });
  }
  next();
};

// Mock traffic data
const mockTrafficData = {
  IE: [
    {
      source: 'TII-Ireland',
      road: 'M1',
      direction: 'Northbound',
      travelTimeMinutes: 28,
      freeFlowTimeMinutes: 22,
      delayMinutes: 6,
      congestionLevel: 'moderate',
      timestamp: new Date().toISOString()
    },
    {
      source: 'TII-Ireland',
      road: 'M1',
      direction: 'Southbound',
      travelTimeMinutes: 26,
      freeFlowTimeMinutes: 22,
      delayMinutes: 4,
      congestionLevel: 'light',
      timestamp: new Date().toISOString()
    }
  ],
  UK: [
    {
      source: 'WebTRIS-UK',
      siteId: '19446',
      road: 'M1',
      direction: 'Southbound',
      location: { lat: 52.198, lon: -0.915 },
      vehicleFlow: 2450,
      averageSpeed: 65,
      congestionLevel: 'light',
      timestamp: new Date().toISOString()
    },
    {
      source: 'WebTRIS-UK',
      siteId: '19450',
      road: 'M1',
      direction: 'Northbound',
      location: { lat: 52.187, lon: -0.898 },
      vehicleFlow: 2180,
      averageSpeed: 72,
      congestionLevel: 'none',
      timestamp: new Date().toISOString()
    },
    {
      source: 'WebTRIS-UK',
      siteId: '19478',
      road: 'M1',
      direction: 'Northbound',
      location: { lat: 52.195, lon: -0.911 },
      vehicleFlow: 2890,
      averageSpeed: 48,
      congestionLevel: 'moderate',
      timestamp: new Date().toISOString()
    }
  ]
};

app.get('/', (req, res) => {
  res.json({
    service: 'Traffic API MVP',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      traffic: '/traffic?road=M1&country=IE (or UK)',
      compare: '/compare?road=M1',
      sources: '/sources'
    }
  });
});

app.get('/sources', (req, res) => {
  res.json({
    sources: [
      { id: 'tii-ireland', name: 'Transport Infrastructure Ireland', country: 'IE', coverage: 'National Roads', updateFrequency: '5 minutes', cost: 'Free' },
      { id: 'webtris-uk', name: 'National Highways WebTRIS', country: 'UK', coverage: 'England Motorways', updateFrequency: '1-15 minutes', cost: 'Free' }
    ]
  });
});

app.get('/traffic', apiKeyAuth, (req, res) => {
  const { road, country = 'ALL' } = req.query;
  
  if (!road) {
    return res.status(400).json({ error: 'Road parameter required', example: '/traffic?road=M1&country=UK' });
  }

  const startTime = Date.now();
  const data = [];

  if ((country === 'ALL' || country === 'IE') && road.toUpperCase() === 'M1') {
    data.push(...mockTrafficData.IE);
  }
  
  if ((country === 'ALL' || country === 'UK') && road.toUpperCase() === 'M1') {
    data.push(...mockTrafficData.UK);
  }

  const summary = {
    totalRecords: data.length,
    sources: [...new Set(data.map(d => d.source))],
    countries: country === 'ALL' ? ['IE', 'UK'] : [country],
    congestionBreakdown: {
      heavy: data.filter(d => d.congestionLevel === 'heavy').length,
      moderate: data.filter(d => d.congestionLevel === 'moderate').length,
      light: data.filter(d => d.congestionLevel === 'light').length,
      none: data.filter(d => d.congestionLevel === 'none').length
    }
  };

  res.json({
    query: { road, country },
    timestamp: new Date().toISOString(),
    data,
    summary,
    responseTimeMs: Date.now() - startTime
  });
});

app.get('/compare', apiKeyAuth, (req, res) => {
  const { road } = req.query;
  
  if (!road || road.toUpperCase() !== 'M1') {
    return res.status(400).json({ error: 'Only M1 supported in demo', example: '/compare?road=M1' });
  }

  const irelandData = mockTrafficData.IE;
  const ukData = mockTrafficData.UK;

  res.json({
    road: 'M1',
    timestamp: new Date().toISOString(),
    comparison: {
      ireland: {
        recordCount: irelandData.length,
        averageDelayMinutes: 5,
        congestion: 'light to moderate',
        sample: irelandData
      },
      uk: {
        recordCount: ukData.length,
        averageSpeed: 62,
        congestion: 'light',
        sample: ukData
      }
    },
    insight: 'UK M1 showing better flow than IE M1 at this time'
  });
});

app.listen(PORT, () => {
  console.log(`🚦 Traffic API MVP running on port ${PORT}`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/`);
  console.log(`🔑 Demo API Key: demo-key-free`);
});
