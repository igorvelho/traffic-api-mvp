/** TII Adapter - Transport Infrastructure Ireland
 *  Real-time traffic data for Irish national roads
 *  API: https://data.tii.ie/
 */

const axios = require('axios');

const TII_BASE_URL = 'https://data.tii.ie';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache
const cache = new Map();

function getCacheKey(road) {
  return `tii:${road.toUpperCase()}`;
}

function isCacheValid(cachedItem) {
  return cachedItem && (Date.now() - cachedItem.timestamp) < CACHE_TTL_MS;
}

/**
 * Convert TII DATEX II format to normalized format
 */
function normalizeTIIRecord(record) {
  const situation = record.situation || {};
  const header = situation.header || {};
  const situationRecord = (situation.situationRecord || [])[0] || {};
  
  const road = situationRecord.roadName || record.road || 'Unknown';
  const direction = situationRecord.directionBound || 'Unknown';
  const travelTime = situationRecord.travelTime || 0;
  const freeFlowTime = situationRecord.freeFlowTravelTime || travelTime;
  const delay = Math.max(0, travelTime - freeFlowTime);
  
  // Calculate congestion level
  let congestionLevel = 'none';
  if (delay > 10) congestionLevel = 'heavy';
  else if (delay > 5) congestionLevel = 'moderate';
  else if (delay > 2) congestionLevel = 'light';
  
  return {
    source: 'TII-Ireland',
    road: road.replace(/^R/i, ''), // Remove R prefix if present
    direction: direction,
    travelTimeMinutes: Math.round(travelTime / 60),
    freeFlowTimeMinutes: Math.round(freeFlowTime / 60),
    delayMinutes: Math.round(delay / 60),
    congestionLevel,
    location: {
      lat: record.lat || situationRecord.lat,
      lon: record.lon || situationRecord.lon,
      from: situationRecord.startLocation,
      to: situationRecord.endLocation
    },
    timestamp: record.publicationTime || new Date().toISOString(),
    rawId: header.id || record.id
  };
}

/**
 * Fetch real-time traffic data from TII API
 */
async function fetchTIITraffic(road) {
  const cacheKey = getCacheKey(road);
  const cached = cache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return {
      data: cached.data,
      fromCache: true,
      source: 'TII-Ireland',
      timestamp: cached.timestamp
    };
  }
  
  try {
    // TII publishes traffic data via DATEX II JSON feed
    // Multiple endpoints available:
    // 1. /traffic - Current traffic conditions
    // 2. /events - Roadworks and incidents
    
    const response = await axios.get(`${TII_BASE_URL}/traffic`, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Parse DATEX II format
    const situations = response.data?.situation || [];
    
    // Filter by road if specified
    const filteredData = road 
      ? situations.filter(s => {
          const rec = (s.situationRecord || [])[0] || {};
          const roadName = (rec.roadName || '').toUpperCase();
          return roadName.includes(road.toUpperCase());
        })
      : situations;
    
    // Normalize records
    const normalizedData = filteredData.map(normalizeTIIRecord);
    
    // Cache the result
    cache.set(cacheKey, {
      data: normalizedData,
      timestamp: Date.now()
    });
    
    return {
      data: normalizedData,
      fromCache: false,
      source: 'TII-Ireland',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('TII API Error:', error.message);
    
    // Return empty data on error - will trigger fallback
    return {
      data: [],
      error: error.message,
      source: 'TII-Ireland',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Check if road is likely in Ireland
 */
function isIrishRoad(road) {
  const irishPatterns = [
    /^M[0-9]+$/i,        // Motorways: M1, M2, etc.
    /^N[0-9]+$/i,        // National roads: N1, N2, etc.
    /^R[0-9]+$/i,        // Regional roads: R101, R132, etc.
    /^L[0-9]+$/i,        // Local roads
    /Dublin/i,           // Dublin roads
    /Cork/i,             // Cork roads
    /Galway/i,           // Galway roads
    /Limerick/i,         // Limerick roads
    /Waterford/i,        // Waterford roads
    /Drogheda/i,         // Drogheda roads (for George's Street example)
    /Swords/i,
    /Dundalk/i
  ];
  
  return irishPatterns.some(pattern => pattern.test(road));
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys())
  };
}

/**
 * Clear cache
 */
function clearCache() {
  cache.clear();
}

module.exports = {
  fetchTIITraffic,
  isIrishRoad,
  getCacheStats,
  clearCache
};
