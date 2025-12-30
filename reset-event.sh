#!/bin/bash
# Delete and recreate the timeline with performances

SHOWCASE_ID="694a7c1fc07c658e9fe61a0b"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTI0NzA3MmI5MjU0NWE2YjMyMWU3OGYiLCJpYXQiOjE3NjY0MTA3ODUsImV4cCI6MTc2NzAxNTU4NX0.GleHOV542T_1LpZ8oqMUPH9LHsF8ukTMS1I_ZzQ6fVY"

echo "Step 1: Deleting old timeline..."
curl -X POST "http://localhost:4000/api/live-showcase/$SHOWCASE_ID/end" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

echo -e "\n\nStep 2: Creating new timeline with performances..."
curl -X POST "http://localhost:4000/api/live-showcase/$SHOWCASE_ID/timeline/initialize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

echo -e "\n\nStep 3: Starting the event..."
curl -X POST "http://localhost:4000/api/live-showcase/$SHOWCASE_ID/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

echo -e "\n\nDone! Refresh the page."
