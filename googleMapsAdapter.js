/** Google Maps Adapter - Fallback Traffic Data Source
 *  Uses Google Maps Directions API for traffic data
 *  Cost-optimized: Only called when free sources return no data
 */

const axios = require('axios');

const GOOGLE_MAPS_API_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache
const cache = new Map();

// API usage tracking for monitoring
let apiCallCount = 0;
let apiCallHistory = [];

function getCacheKey(origin, destination) {
  return `googlemaps:${origin.toLowerCase()}:${destination.toLowerCase()}`;
}

function isCacheValid(cachedItem) {
  return cachedItem && (Date.now() - cachedItem.timestamp) < CACHE_TTL_MS;
}

/**
 * Track API call for monitoring
 */
function trackAPICall(origin, destination, success) {
  apiCallCount++;
  apiCallHistory.push({
    timestamp: new Date().toISOString(),
    origin,
    destination,
    success
  });
  
  // Keep only last 100 calls
  if (apiCallHistory.length > 100) {
    apiCallHistory = apiCallHistory.slice(-100);
  }
}

/**
 * Calculate congestion level from delay and travel time
 */
function calculateCongestion(durationInTraffic, duration) {
  if (!duration || duration === 0) return 'unknown';
  
  const ratio = durationInTraffic / duration;
  const delayMinutes = (durationInTraffic - duration) / 60;
  
  if (delayMinutes > 15 || ratio > 2.0) return 'heavy';
  if (delayMinutes > 5 || ratio > 1.5) return 'moderate';
  if (delayMinutes > 2 || ratio > 1.2) return 'light';
  return 'none';
}

/**
 * Normalize Google Maps response to standard format
 */
function normalizeGoogleMapsData(route, origin, destination, road) {
  const leg = route.legs[0];
  
  const distanceMeters = leg.distance?.value || 0;
  const distanceKm = distanceMeters / 1000;
  
  const durationSeconds = leg.duration?.value || 0;
  const durationInTrafficSeconds = leg.duration_in_traffic?.value || durationSeconds;
  
  const durationMinutes = Math.round(durationSeconds / 60);
  const durationInTrafficMinutes = Math.round(durationInTrafficSeconds / 60);
  const delayMinutes = Math.max(0, durationInTrafficMinutes - durationMinutes);
  
  const congestionLevel = calculateCongestion(durationInTrafficSeconds, durationSeconds);
  
  // Extract route info
  const startLocation = leg.start_location || {};
  const endLocation = leg.end_location || {};
  
  // Build human-readable description
  const steps = leg.steps || [];
  const mainRoads = [];
  for (const step of steps) {
    const instruction = step.html_instructions || '';
    const roadMatch = instruction.match(/(?:onto|on)\s+([^<]+)/i);
    if (roadMatch && !mainRoads.includes(roadMatch[1].trim())) {
      mainRoads.push(roadMatch[1].trim());
    }
  }
  
  return {
    source: 'GoogleMaps',
    road: road || mainRoads[0] || 'Unknown',
    origin: leg.start_address || origin,
    destination: leg.end_address || destination,
    location: {
      startLat: startLocation.lat,
      startLon: startLocation.lng,
      endLat: endLocation.lat,
      endLon: endLocation.lng,
      via: mainRoads.slice(0, 3) // Top 3 roads used
    },
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMinutes,
    durationInTrafficMinutes,
    delayMinutes,
    congestionLevel,
    routeSummary: route.summary || '',
    warnings: route.warnings || [],
    timestamp: new Date().toISOString()
  };
}

/**
 * Fetch traffic data from Google Maps Directions API
 */
async function fetchGoogleMapsTraffic(origin, destination, road = null) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    console.error('Google Maps API Key not configured');
    return {
      data: [],
      error: 'Google Maps API Key not configured',
      source: 'GoogleMaps'
    };
  }
  
  const cacheKey = getCacheKey(origin, destination);
  const cached = cache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return {
      data: cached.data,
      fromCache: true,
      source: 'GoogleMaps',
      timestamp: cached.timestamp
    };
  }
  
  try {
    const params = {
      origin,
      destination,
      departure_time: 'now', // Get current traffic conditions
      mode: 'driving',
      key: apiKey
    };
    
    const response = await axios.get(GOOGLE_MAPS_API_URL, {
      params,
      timeout: 10000
    });
    
    if (response.data.status !== 'OK') {
      trackAPICall(origin, destination, false);
      return {
        data: [],
        error: `Google Maps API Error: ${response.data.status}`,
        source: 'GoogleMaps',
        timestamp: new Date().toISOString()
      };
    }
    
    const routes = response.data.routes || [];
    
    if (routes.length === 0) {
      trackAPICall(origin, destination, false);
      return {
        data: [],
        source: 'GoogleMaps',
        timestamp: new Date().toISOString()
      };
    }
    
    // Use the first (best) route
    const normalizedData = normalizeGoogleMapsData(routes[0], origin, destination, road);
    
    // Cache the result
    cache.set(cacheKey, {
      data: [normalizedData],
      timestamp: Date.now()
    });
    
    trackAPICall(origin, destination, true);
    
    return {
      data: [normalizedData],
      fromCache: false,
      source: 'GoogleMaps',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Google Maps API Error:', error.message);
    trackAPICall(origin, destination, false);
    
    return {
      data: [],
      error: error.message,
      source: 'GoogleMaps',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Build origin/destination query from road and location
 * Example: "George's Street, Drogheda, Ireland"
 */
function buildLocationQuery(road, town, country) {
  const parts = [road];
  if (town) parts.push(town);
  if (country) parts.push(country);
  return parts.join(', ');
}

/**
 * Fetch traffic for a specific road segment
 * Creates origin/destination points along the road
 */
async function fetchRoadTraffic(road, town, country) {
  // Build queries for road segments
  // For a complete solution, you'd geocode to get precise coordinates
  // Here we construct logical segments
  
  const location = buildLocationQuery(road, town, country);
  
  // Create a segment by querying from one end of town to another
  // This is a simplified approach - in production use proper geocoding
  const origin = town 
    ? `${town} ${country || ''}`
    : location;
  const destination = location;
  
  // For local streets, query from a nearby major road
  let result = await fetchGoogleMapsTraffic(origin, destination, road);
  
  // If no data, try alternative approach
  if (result.data.length === 0 && town) {
    const altOrigin = `Near ${road}, ${town}`;
    const altDest = `End of ${road}, ${town}`;
    result = await fetchGoogleMapsTraffic(altOrigin, altDest, road);
  }
  
  return result;
}

/**
 * Check if this is a road type that Google Maps is good for
 * (Local streets, non-major highways, unknown roads)
 */
function isGoogleMapsPreferred(road, town, country) {
  // Local streets with town names (e.g., "George's Street, Drogheda")
  if (town && !road.match(/^(M|N|A)[0-9]+/i)) {
    return true;
  }
  
  // Non-IE and non-UK countries
  const nonCoveredCountries = ['US', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'PT'];
  if (country && nonCoveredCountries.includes(country.toUpperCase())) {
    return true;
  }
  
  // Streets without number designations
  if (road.match(/street|road|avenue|lane|drive|way|boulevard/i)) {
    return true;
  }
  
  return false;
}

/**
 * Get API usage statistics
 */
function getAPIStats() {
  return {
    totalCalls: apiCallCount,
    recentCalls: apiCallHistory.slice(-20),
    cacheSize: cache.size,
    cacheKeys: Array.from(cache.keys())
  };
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
  fetchGoogleMapsTraffic,
  fetchRoadTraffic,
  isGoogleMapsPreferred,
  getAPIStats,
  getCacheStats,
  clearCache
};
