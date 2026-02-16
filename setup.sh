#!/bin/bash
# CreditForge - Setup & Install Script
# Installs deps, builds, installs launchd agents, and starts menubar app
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.creditforge/logs"
REPORT_DIR="$HOME/.creditforge/reports"
CLI="$SCRIPT_DIR/apps/cli/dist/index.js"

echo "CreditForge Setup"
echo "================="
echo ""

# 1. Install & Build
echo "[1/4] Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent
echo "  Done."

echo ""
echo "[2/4] Building packages..."
npm run build
echo "  Done."

# 2. Create directories
echo ""
echo "[3/4] Creating directories..."
mkdir -p "$LOG_DIR"
mkdir -p "$REPORT_DIR"

# 3. Install launchd agents
echo ""
echo "[4/4] Installing launchd agents..."

SCANNER_PLIST="com.creditforge.scanner.plist"
NIGHTMODE_PLIST="com.creditforge.nightmode.plist"

# Unload existing agents if they exist
launchctl unload "$LAUNCH_DIR/$SCANNER_PLIST" 2>/dev/null || true
launchctl unload "$LAUNCH_DIR/$NIGHTMODE_PLIST" 2>/dev/null || true

# Copy plists to LaunchAgents
cp "$SCRIPT_DIR/launchd/$SCANNER_PLIST" "$LAUNCH_DIR/$SCANNER_PLIST"
cp "$SCRIPT_DIR/launchd/$NIGHTMODE_PLIST" "$LAUNCH_DIR/$NIGHTMODE_PLIST"

# Load agents
launchctl load "$LAUNCH_DIR/$SCANNER_PLIST"
launchctl load "$LAUNCH_DIR/$NIGHTMODE_PLIST"

echo "  Scanner agent:    LOADED (runs every hour)"
echo "  Night mode agent: LOADED (runs at 11 PM)"

# 4. Verify
echo ""
echo "Verifying agents..."
SCANNER_OK=false
NIGHT_OK=false

if launchctl list | grep -q "creditforge.scanner"; then
  echo "  com.creditforge.scanner   — ACTIVE"
  SCANNER_OK=true
else
  echo "  com.creditforge.scanner   — NOT FOUND"
fi

if launchctl list | grep -q "creditforge.nightmode"; then
  echo "  com.creditforge.nightmode — ACTIVE"
  NIGHT_OK=true
else
  echo "  com.creditforge.nightmode — NOT FOUND"
fi

# 5. Run initial scan
echo ""
echo "Running initial scan..."
node "$CLI" scan 2>&1 | tail -5
echo ""

# 6. Summary
echo "============================="
echo "  CreditForge is installed!"
echo "============================="
echo ""
echo "  Agents:"
echo "    Scanner    — Scans for tasks every hour"
echo "    Night Mode — Executes tasks at 11 PM nightly"
echo ""
echo "  Paths:"
echo "    Database:  ~/.creditforge/creditforge.db"
echo "    Logs:      ~/.creditforge/logs/"
echo "    Reports:   ~/.creditforge/reports/"
echo ""
echo "  CLI Commands:"
echo "    node $CLI scan              — Scan for tasks"
echo "    node $CLI status            — View status dashboard"
echo "    node $CLI run --task <id>   — Execute one task"
echo "    node $CLI report            — Morning report"
echo "    node $CLI app               — Launch menubar app"
echo ""
echo "  Menubar App (run in separate terminal):"
echo "    cd $SCRIPT_DIR/apps/menubar && npx electron dist/main.js"
echo ""
echo "  To uninstall agents:"
echo "    launchctl unload ~/Library/LaunchAgents/com.creditforge.scanner.plist"
echo "    launchctl unload ~/Library/LaunchAgents/com.creditforge.nightmode.plist"
