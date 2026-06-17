#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Sort report directories by timestamp (latest to oldest)
# ─────────────────────────────────────────────────────────────────────────────

# Color definitions
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

REPORTS_DIR="reports"

if [ ! -d "$REPORTS_DIR" ]; then
  echo -e "${RED}❌ Reports directory not found: $REPORTS_DIR${NC}"
  exit 1
fi

echo -e "${BOLD}📊 PPV Test Reports (Latest to Oldest):${NC}"
echo ""

# Create a temporary file to hold data before sorting
temp_file=$(mktemp)

# Find all report directories matching region/source/plan/timestamp
find "$REPORTS_DIR" -maxdepth 1 -type d -name "*_*_*" | while read -r dir_path; do
  folder=$(basename "$dir_path")
  
  # Extract timestamp using regex matching YYYY-MM-DDTHH-MM-SS at the end
  if [[ "$folder" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2})$ ]]; then
    timestamp="${BASH_REMATCH[1]}"
    name="${folder%_${timestamp}}"
  else
    # Fallback to splitting by last underscore
    timestamp=$(echo "$folder" | awk -F'_' '{print $NF}')
    name=$(echo "$folder" | awk -F'_' '{n=split($0,p,"_"); out=""; for(i=1;i<n;i++) {if(i>1)out=out"_"; out=out p[i]} print out}')
  fi

  # Determine status by parsing the HTML report if it exists
  html_report="$dir_path/PPV_Report.html"
  status="INCOMPLETE"
  if [ -f "$html_report" ]; then
    if grep -q "pill-pass" "$html_report"; then
      status="PASS"
    elif grep -q "pill-fail" "$html_report"; then
      status="FAIL"
    else
      status="DONE"
    fi
  fi
  
  # Write delimited values for sorting
  echo "${timestamp}|${status}|${name}" >> "$temp_file"
done

# If no report folders were found
if [ ! -s "$temp_file" ]; then
  echo -e "${YELLOW}  No reports found under $REPORTS_DIR.${NC}"
  rm -f "$temp_file"
  exit 0
fi

# Print table headers
printf "   ${BOLD}%-19s   %-12s   %s${NC}\n" "DATE & TIME" "STATUS" "REPORT NAME"
echo -e "   ${BLUE}───────────────────   ────────────   ──────────────────────────────────────────────────────${NC}"

# Sort descending by timestamp and print
sort -r "$temp_file" | while IFS='|' read -r timestamp status name; do
  # Format timestamp 2026-06-17T11-58-40 to 2026-06-17 11:58:40
  formatted_time=$(echo "$timestamp" | sed -E 's/T/ /; s/([0-9]{2})-([0-9]{2})-([0-9]{2})$/\1:\2:\3/')
  
  # Choose color and label based on status
  if [ "$status" = "PASS" ]; then
    status_color="${GREEN}"
    status_label="● PASS"
  elif [ "$status" = "FAIL" ]; then
    status_color="${RED}"
    status_label="● FAIL"
  elif [ "$status" = "DONE" ]; then
    status_color="${BLUE}"
    status_label="● DONE"
  else
    status_color="${YELLOW}"
    status_label="○ INCOMPLETE"
  fi
  
  printf "   %-19s   %b%-12s%b   %s\n" "$formatted_time" "$status_color" "$status_label" "${NC}" "$name"
done

echo ""
echo -e "════════════════════════════════════════════════════════════════════════════════"
echo -e "Total report directories: $(wc -l < "$temp_file" | xargs)"
echo -e "════════════════════════════════════════════════════════════════════════════════"

# Clean up temp file
rm -f "$temp_file"