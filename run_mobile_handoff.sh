#!/bin/bash

# Mobile → Web PPV Handoff Test
# Runs Appium test to capture URL, then Playwright test to complete web flow

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════╗"
echo "║  Mobile → Web PPV Handoff Test                     ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Step 1: Run Android Appium test to capture checkout URL
echo "📱 Step 1: Running Android Appium test..."
echo "   This will navigate to PPV and capture the checkout URL"
echo ""

cd appium

SOURCE="schedule" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
npx wdio run config/wdio.android.conf.ts --spec ./tests/android/ppv.handoff.spec.ts

if [ $? -ne 0 ]; then
  echo "❌ Appium test failed"
  exit 1
fi

echo ""
echo "✅ Appium test completed - URL captured"
echo ""

# Step 2: Run Playwright web test to complete purchase
echo "🌐 Step 2: Running Playwright web test..."
echo "   This will open browser and complete the purchase flow"
echo ""

cd ..

npx playwright test tests/mobile/mobile.ppv.spec.ts

if [ $? -ne 0 ]; then
  echo "❌ Playwright test failed"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ Mobile → Web handoff flow completed successfully!"
echo "═══════════════════════════════════════════════════════"