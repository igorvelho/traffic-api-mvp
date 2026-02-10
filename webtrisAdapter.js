/** WebTRIS Adapter - UK National Highways Traffic Data
 *  Real-time traffic data for UK motorways and A-roads
 *  API: https://webtris.nationalhighways.co.uk/api
 */

const axios = require('axios');

const WEBTRIS_BASE_URL = 'https://webtris.nationalhighways.co.uk/api/v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache
const cache = new Map();

function getCacheKey(road) {
  return `webtris:${road.toUpperCase()}`;
}

function isCacheValid(cachedItem) {
  return cachedItem && (Date.now() - cachedItem.timestamp) < CACHE_TTL_MS;
}

/**
 * Convert WebTRIS format to normalized format
 */
function normalizeWebTRISRecord(site, report) {
  const road = site.name || 'Unknown';
  const direction = site.direction || 'Unknown';
  const speed = report.speed || report.averageSpeed || 0;
  const flow = report.vehicleFlow || report.volume || 0;
  
  // Calculate congestion level based on speed vs typical speed
  const typicalSpeed = site.typicalSpeed || 70; // Default motorway speed
  const speedRatio = speed / typicalSpeed;
  
  let congestionLevel = 'none';
  if (speedRatio < 0.3 || speed < 20) congestionLevel = 'heavy';
  else if (speedRatio < 0.6 || speed < 40) congestionLevel = 'moderate';
  else if (speedRatio < 0.8 || speed < 55) congestionLevel = 'light';
  
  // Calculate estimated travel time and delay
  const distanceKm = site.length || 1; // Default 1km if unknown
  const travelTimeMinutes = speed > 0 ? (distanceKm / speed) * 60 : 0;
  const freeFlowTimeMinutes = distanceKm / typicalSpeed * 60;
  const delayMinutes = Math.max(0, travelTimeMinutes - freeFlowTimeMinutes);
  
  return {
    source: 'WebTRIS-UK',
    siteId: site.id,
    road: road.replace(/^M/i, 'M'), // Normalize M roads
    direction,
    location: {
      lat: site.latitude,
      lon: site.longitude,
      area: site.area,
      description: site.description
    },
    vehicleFlow: flow,
    averageSpeed: Math.round(speed),
    congestionLevel,
    travelTimeMinutes: Math.round(travelTimeMinutes * 10) / 10,
    freeFlowTimeMinutes: Math.round(freeFlowTimeMinutes * 10) / 10,
    delayMinutes: Math.round(delayMinutes * 10) / 10,
    timestamp: report.timestamp || new Date().toISOString()
  };
}

/**
 * Fetch sites (traffic monitoring locations)
 */
async function fetchSites(road) {
  try {
    const response = await axios.get(`${WEBTRIS_BASE_URL}/sites`, {
      params: {
        road: road.toUpperCase(),
        format: 'json'
      },
      timeout: 10000
    });
    
    return response.data?.sites || [];
  } catch (error) {
    console.error('WebTRIS Sites API Error:', error.message);
    return [];
  }
}

/**
 * Fetch current traffic reports for sites
 */
async function fetchReports(siteIds) {
  if (!siteIds || siteIds.length === 0) return [];
  
  try {
    const response = await axios.get(`${WEBTRIS_BASE_URL}/reports/current`, {
      params: {
        sites: siteIds.join(','),
        format: 'json'
      },
      timeout: 10000
    });
    
    return response.data?.reports || [];
  } catch (error) {
    console.error('WebTRIS Reports API Error:', error.message);
    return [];
  }
}

/**
 * Fetch real-time traffic data from WebTRIS API
 */
async function fetchWebTRISTraffic(road) {
  const cacheKey = getCacheKey(road);
  const cached = cache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return {
      data: cached.data,
      fromCache: true,
      source: 'WebTRIS-UK',
      timestamp: cached.timestamp
    };
  }
  
  try {
    // Step 1: Get sites for the road
    const sites = await fetchSites(road);
    
    if (sites.length === 0) {
      return {
        data: [],
        source: 'WebTRIS-UK',
        timestamp: new Date().toISOString()
      };
    }
    
    // Step 2: Get current traffic reports for those sites
    const siteIds = sites.map(s => s.id);
    const reports = await fetchReports(siteIds);
    
    // Step 3: Merge sites with reports
    const data = [];
    for (const site of sites) {
      const report = reports.find(r => r.siteId === site.id) || {};
      data.push(normalizeWebTRISRecord(site, report));
    }
    
    // Cache the result
    cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    return {
      data,
      fromCache: false,
      source: 'WebTRIS-UK',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('WebTRIS API Error:', error.message);
    
    return {
      data: [],
      error: error.message,
      source: 'WebTRIS-UK',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Check if road is likely in UK
 */
function isUKRoad(road) {
  const ukPatterns = [
    /^M[0-9]+[A-Z]?$/i,     // Motorways: M1, M6, M25, etc.
    /^A[0-9]+[A-Z]?$/i,     // A roads: A1, A40, etc.
    /^B[0-9]+$/i,           // B roads
    /Motorway/i,
    /Milton Keynes/i,
    /Birmingham/i,
    /Manchester/i,
    /London/i,
    /Leeds/i,
    /Glasgow/i,
    /Edinburgh/i
  ];
  
  // Also check if it's NOT an Irish road (M1 exists in both countries)
  // This is a heuristic - in production you'd use geocoding
  const isLikelyIrish = /^M(1|2|3|4|5|6|7|8|9|11|17|18|20|50|54|55|56|57|61|62|63|64|65|66|67|68|69|70|71|72|73|74|75|76|77|78|79|80|81|82|83|84|85|86|87|88|89)$/i.test(road);
  
  return ukPatterns.some(pattern => pattern.test(road)) && !isLikelyIrish;
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
  fetchWebTRISTraffic,
  isUKRoad,
  getCacheStats,
  clearCache
};
