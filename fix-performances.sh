#!/bin/bash
# Fix missing performances by rescheduling

SHOWCASE_ID="694a7c1fc07c658e9fe61a0b"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTI0NzA3MmI5MjU0NWE2YjMyMWU3OGYiLCJpYXQiOjE3NjY0MTA3ODUsImV4cCI6MTc2NzAxNTU4NX0.GleHOV542T_1LpZ8oqMUPH9LHsF8ukTMS1I_ZzQ6fVY"

echo "Rescheduling performances..."
curl -X POST "http://localhost:4000/api/live-showcase/$SHOWCASE_ID/timeline/reschedule" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

echo -e "\n\nDone! Refresh the page."
