#!/bin/bash

# ─────────────────────────────────────────────────────────────────────────────
# DAZN Android Automation — Run All Combinations Script
# ─────────────────────────────────────────────────────────────────────────────
# This script loops through all surfacing points, plans, user statuses, and
# login_first combinations, and executes them on the connected Android device.
# ─────────────────────────────────────────────────────────────────────────────

# Default configurations
export DAZN_ENV="${DAZN_ENV:-prod}"
export DAZN_REGION="${DAZN_REGION:-GB}"
export PPV_NAME="${PPV_NAME:-Joshua}"
export PPV_CONFIG="${PPV_CONFIG:-aj_joshua_prenga.json}"

# Define combinations
SOURCES=(
  "schedule"
  "search"
  "landing-page-banner"
  "home-page-banner"
  "home-page-dont-miss"
  "home-boxing-banner"
  "home-boxing-upcoming"
  "home-boxing-tile"
)

PLANS=(
  "standard_monthly"
  "standard_apm"
  "ultimate_apm"
  "ultimate_upfront"
)

USER_STATES=(
  "freemium"
  "frozen"
  "active_standard_monthly"
  "active_standard_apm"
  "active_ultimate_apm"
  "active_ultimate_upfront"
)

LOGIN_FIRST_OPTS=(
  "true"
  "false"
)

# Total runs count
TOTAL_RUNS=$(( ${#SOURCES[@]} * ${#PLANS[@]} * ${#USER_STATES[@]} * ${#LOGIN_FIRST_OPTS[@]} ))
CURRENT_RUN=0
PASSED=0
FAILED=0

echo "======================================================================="
echo "🚀 Starting Automated Execution of All Combinations ($TOTAL_RUNS Total Runs)"
echo "🌍 Region: $DAZN_REGION | 🌐 Env: $DAZN_ENV"
echo "🥊 Event: $PPV_NAME ($PPV_CONFIG)"
echo "======================================================================="

for SOURCE in "${SOURCES[@]}"; do
  for PLAN in "${PLANS[@]}"; do
    for USER_STATE in "${USER_STATES[@]}"; do
      for LOGIN_FIRST in "${LOGIN_FIRST_OPTS[@]}"; do
        CURRENT_RUN=$((CURRENT_RUN + 1))
        
        echo ""
        echo "-----------------------------------------------------------------------"
        echo "▶️ [Run $CURRENT_RUN/$TOTAL_RUNS] SOURCE=$SOURCE | PLAN=$PLAN | USER_STATE=$USER_STATE | LOGIN_FIRST=$LOGIN_FIRST"
        echo "-----------------------------------------------------------------------"
        
        # Execute the test command
        DAZN_ENV="$DAZN_ENV" \
        DAZN_REGION="$DAZN_REGION" \
        SOURCE="$SOURCE" \
        PLAN="$PLAN" \
        USER_STATE="$USER_STATE" \
        LOGIN_FIRST="$LOGIN_FIRST" \
        PPV_NAME="$PPV_NAME" \
        PPV_CONFIG="$PPV_CONFIG" \
        npx --prefix appium wdio run appium/config/wdio.android.conf.ts --spec appium/tests/android/existingusermobile.ppv.spec.ts
        
        STATUS=$?
        if [ $STATUS -eq 0 ]; then
          echo "✅ [Run $CURRENT_RUN] Passed!"
          PASSED=$((PASSED + 1))
        else
          echo "❌ [Run $CURRENT_RUN] Failed with exit code $STATUS"
          FAILED=$((FAILED + 1))
        fi
        
        # Give a short pause between runs for device stabilization
        sleep 2
      done
    done
  done
done

echo "======================================================================="
echo "📊 EXECUTION COMPLETE SUMMARY"
echo "======================================================================="
echo "✅ Passed: $PASSED"
echo "❌ Failed: $FAILED"
echo "📈 Total:  $CURRENT_RUN / $TOTAL_RUNS"
echo "======================================================================="
