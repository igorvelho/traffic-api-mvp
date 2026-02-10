#!/bin/bash

echo "🚦 Traffic API MVP - Demo Script"
echo "================================"
echo ""

BASE_URL="http://localhost:3000"
API_KEY="demo-key-free"

echo "1. Health Check"
echo "---------------"
curl -s "$BASE_URL/" | jq .
echo ""

echo "2. Available Data Sources"
echo "-------------------------"
curl -s "$BASE_URL/sources" | jq .
echo ""

echo "3. Traffic Data - UK M1 (requires API key)"
echo "------------------------------------------"
curl -s -H "x-api-key: $API_KEY" "$BASE_URL/traffic?road=M1&country=UK" | jq .
echo ""

echo "4. Traffic Data - UK M25 (requires API key)"
echo "-------------------------------------------"
curl -s -H "x-api-key: $API_KEY" "$BASE_URL/traffic?road=M25&country=UK" | jq .
echo ""

echo "5. Compare M1 Across Countries"
echo "------------------------------"
curl -s -H "x-api-key: $API_KEY" "$BASE_URL/compare?road=M1" | jq .
echo ""

echo "6. Error - Missing API Key"
echo "--------------------------"
curl -s "$BASE_URL/traffic?road=M1" | jq .
echo ""

echo "✅ Demo complete!"
