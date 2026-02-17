#!/bin/bash
# CreditForge — Uninstaller
set -e

INSTALL_DIR="$HOME/.creditforge/app"
CONFIG_DIR="$HOME/.creditforge"
CLI_BIN="$HOME/.local/bin/creditforge"
LAUNCH_DIR="$HOME/Library/LaunchAgents"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "\033[0;34m[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }

echo ""
echo -e "${RED}  CreditForge Uninstaller${NC}"
echo ""

# ─── 1. Unload launchd agents ───────────────────────────
info "Removing launchd agents..."
for plist in com.creditforge.scanner.plist com.creditforge.nightmode.plist; do
  if [ -f "$LAUNCH_DIR/$plist" ]; then
    launchctl unload "$LAUNCH_DIR/$plist" 2>/dev/null || true
    rm -f "$LAUNCH_DIR/$plist"
    ok "Removed $plist"
  fi
done

# ─── 2. Remove CLI wrapper ──────────────────────────────
if [ -f "$CLI_BIN" ]; then
  rm -f "$CLI_BIN"
  ok "Removed CLI at $CLI_BIN"
fi

# ─── 3. Remove app directory ────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  ok "Removed app at $INSTALL_DIR"
fi

# ─── 4. User data (prompt) ──────────────────────────────
echo ""
echo "The following user data still exists:"
echo "  Config:   $CONFIG_DIR/config.toml"
echo "  Database: $CONFIG_DIR/creditforge.db"
echo "  Logs:     $CONFIG_DIR/logs/"
echo "  Reports:  $CONFIG_DIR/reports/"
echo ""
read -p "Delete user data too? (y/N) " -n 1 -r < /dev/tty
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -rf "$CONFIG_DIR"
  ok "Removed all user data at $CONFIG_DIR"
else
  ok "User data preserved at $CONFIG_DIR"
fi

echo ""
echo -e "${GREEN}CreditForge uninstalled.${NC}"
echo ""
echo "Note: PATH entries in ~/.zshrc or ~/.bashrc were not removed."
echo "You can manually remove the '# CreditForge CLI' line if desired."
echo ""
