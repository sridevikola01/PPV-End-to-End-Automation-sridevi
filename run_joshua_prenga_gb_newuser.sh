#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Run all surfacing points × plans for aj_joshua_prenga PPV in GB region
# for new user flows, with max 5 parallel workers
# ─────────────────────────────────────────────────────────────────────────────

REGION="GB"
ENV="prod"
EVENT="aj_joshua_prenga"
SPEC="tests/new_user/newuser.ppv.spec.ts"
MAX_WORKERS=5

echo "🚀 Running all surfacing points × plans for: $EVENT"
echo "🌍 Region: $REGION"
echo "🌐 Env:    $ENV"
echo "👤 User:   New User"
echo "🔢 Max parallel workers: $MAX_WORKERS"
echo ""

# All surfacing points from config/surfacingpoint.json
SOURCES=(
  "home-page-get-started"
  "landing-page-banner"
  "landing-page-dont-miss-live"
  "boxing-page-banner"
  "boxing-page-bundle"
  "boxing-upcoming-fights"
  "home-boxing-banner"
  "home-boxing-tile"
  "home-boxing-upcoming"
  "search"
  "schedule"
  "home-kickboxing-tile"
  "home-page-banner"
  "home-page-dont-miss"
  "home-page-live-tv-rail"
  "home-page-live-event-rail"
  "home-biggest-fights"
  "home-page-dazntile"
)

# All plans from config/DaznPlan.json that have GB region support
PLANS=(
  "standard_monthly"
  "standard_apm"
  "ultimate_apm"
  "ultimate_upfront"
)

echo "📋 Surfacing points (${#SOURCES[@]}):"
for src in "${SOURCES[@]}"; do
  echo "   • $src"
done
echo ""
echo "📋 Plans (${#PLANS[@]}):"
for plan in "${PLANS[@]}"; do
  echo "   • $plan"
done
echo ""

# Calculate total combinations
TOTAL=$(( ${#SOURCES[@]} * ${#PLANS[@]} ))
echo "📊 Total test combinations: $TOTAL"
echo ""

# Track running PIDs
pids=()
running=0
completed=0
failed=0

# Function to wait for any child to finish
wait_for_slot() {
  while [ $running -ge $MAX_WORKERS ]; do
    # Check if any pid has finished
    for i in "${!pids[@]}"; do
      if ! kill -0 "${pids[$i]}" 2>/dev/null; then
        wait "${pids[$i]}" || ((failed++))
        unset 'pids[i]'
        ((running--))
        ((completed++))
      fi
    done
    if [ $running -ge $MAX_WORKERS ]; then
      sleep 1
    fi
  done
}

# Run all combinations
for plan in "${PLANS[@]}"; do
  for source in "${SOURCES[@]}"; do
    wait_for_slot
    
    echo "▶️  [$((completed + running + 1))/$TOTAL] SOURCE=$source | PLAN=$plan"
    DAZN_ENV=$ENV DAZN_REGION=$REGION PPV_EVENT=$EVENT PLAN=$plan SOURCE=$source \
      npx playwright test "$SPEC" --workers=1 &
    pids+=($!)
    ((running++))
  done
done

echo ""
echo "⏳ Waiting for remaining $running tests to complete..."

# Wait for all remaining
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    ((failed++))
  fi
  ((completed++))
done

echo ""
echo "═══════════════════════════════════════"
echo "📊 Results:"
echo "   Total:  $TOTAL"
echo "   Passed: $((TOTAL - failed))"
if [ $failed -gt 0 ]; then
  echo "   Failed: $failed"
fi
echo "═══════════════════════════════════════"

if [ $failed -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "❌ $failed test(s) failed"
  exit 1
fi