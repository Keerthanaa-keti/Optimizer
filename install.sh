#!/bin/bash
# CreditForge — One-Liner Installer
# Usage: curl -sL https://raw.githubusercontent.com/Keerthanaa-keti/Optimizer/main/install.sh | bash
set -e

REPO_URL="https://github.com/Keerthanaa-keti/Optimizer.git"
INSTALL_DIR="$HOME/.creditforge/app"
CONFIG_DIR="$HOME/.creditforge"
CONFIG_FILE="$CONFIG_DIR/config.toml"
LOG_DIR="$CONFIG_DIR/logs"
REPORT_DIR="$CONFIG_DIR/reports"
CLI_BIN="$HOME/.local/bin/creditforge"
LAUNCH_DIR="$HOME/Library/LaunchAgents"

# ─── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

echo ""
echo -e "${GREEN}  CreditForge Installer${NC}"
echo -e "  Maximize your Claude subscription"
echo ""

# ─── 1. Prerequisite Checks ─────────────────────────────
info "Checking prerequisites..."

# macOS check
if [[ "$(uname)" != "Darwin" ]]; then
  fail "CreditForge currently supports macOS only"
fi

# Node.js 20+
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it: https://nodejs.org/"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if (( NODE_VER < 20 )); then
  fail "Node.js 20+ required (found v$NODE_VER). Update: https://nodejs.org/"
fi
ok "Node.js v$(node -v | sed 's/v//')"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm not found. It should come with Node.js."
fi
ok "npm $(npm -v)"

# git
if ! command -v git &>/dev/null; then
  fail "git not found. Install: xcode-select --install"
fi
ok "git $(git --version | awk '{print $3}')"

# Claude CLI (warn only)
if command -v claude &>/dev/null; then
  ok "Claude CLI found"
else
  warn "Claude CLI not found — Night Mode execution requires it"
  warn "Install: https://docs.anthropic.com/en/docs/claude-cli"
fi

echo ""

# ─── 2. Clone or Update ─────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only origin main 2>/dev/null || {
    warn "git pull failed — doing fresh clone"
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  }
else
  info "Cloning CreditForge..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
ok "Source at $INSTALL_DIR"

# ─── 3. Build ───────────────────────────────────────────
info "Installing dependencies & building..."
cd "$INSTALL_DIR"
npm install --silent 2>&1 | tail -1
npm run build 2>&1 | tail -1
ok "Build complete"

# ─── 4. Config ──────────────────────────────────────────
mkdir -p "$LOG_DIR" "$REPORT_DIR"

if [ -f "$CONFIG_FILE" ]; then
  ok "Config exists at $CONFIG_FILE (preserved)"
else
  info "Creating config..."

  # ─── Interactive: Ask for project folders ────────────
  echo ""
  echo -e "${BLUE}  Where are your Claude projects?${NC}"
  echo "  Enter folder paths to scan (one per line)."
  echo "  Press Enter on an empty line when done."
  echo ""

  SCAN_ROOTS=()
  while true; do
    read -p "  Project folder (or Enter to finish): " folder < /dev/tty
    if [ -z "$folder" ]; then
      break
    fi
    # Expand ~ to $HOME
    expanded="${folder/#\~/$HOME}"
    if [ -d "$expanded" ]; then
      SCAN_ROOTS+=("$folder")
      ok "Added: $folder"
    else
      warn "Directory not found: $expanded (added anyway — you can fix later)"
      SCAN_ROOTS+=("$folder")
    fi
  done

  # Build scan_roots TOML array
  if [ ${#SCAN_ROOTS[@]} -eq 0 ]; then
    SCAN_ROOTS_TOML='scan_roots = []'
    warn "No project folders added. Edit $CONFIG_FILE later to add them."
  else
    SCAN_ROOTS_TOML="scan_roots = ["
    for i in "${!SCAN_ROOTS[@]}"; do
      if [ $i -gt 0 ]; then
        SCAN_ROOTS_TOML+=","
      fi
      SCAN_ROOTS_TOML+=$'\n'"  \"${SCAN_ROOTS[$i]}\""
    done
    SCAN_ROOTS_TOML+=$'\n'"]"
  fi

  # ─── Interactive: Ask for subscription tier ──────────
  echo ""
  echo -e "${BLUE}  What Claude plan are you on?${NC}"
  echo "    1) Pro ($20/month)"
  echo "    2) Max 5x ($100/month)  [default]"
  echo "    3) Max 20x ($200/month)"
  read -p "  Choice [2]: " tier_choice < /dev/tty
  case "$tier_choice" in
    1) TIER="pro" ;;
    3) TIER="max20" ;;
    *) TIER="max5" ;;
  esac
  ok "Tier: $TIER"

  cat > "$CONFIG_FILE" << TOML
# CreditForge Configuration

[night_mode]
enabled = false
start_hour = 23
end_hour = 6
credit_cap_percent = 75
model_preference = "sonnet"
max_budget_per_task_usd = 0.50
exclude_paths = []

[scanner]
${SCAN_ROOTS_TOML}
exclude_patterns = ["**/node_modules/**"]
skip_npm_audit = false
max_todos_per_project = 50

[subscription]
tier = "${TIER}"

[credits]
window_reset_hour = 0
hard_stop_minutes_before = 30
estimated_balance_usd_cents = 5000
TOML
  ok "Config created at $CONFIG_FILE"
fi

# ─── 5. Launchd Agents ──────────────────────────────────
info "Installing launchd agents..."
mkdir -p "$LAUNCH_DIR"

NODE_PATH=$(which node)

# Scanner agent (hourly)
cat > "$LAUNCH_DIR/com.creditforge.scanner.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.creditforge.scanner</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>$INSTALL_DIR/apps/cli/dist/index.js</string>
    <string>scan</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CREDITFORGE_ROOT</key>
    <string>$INSTALL_DIR</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/scanner.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/scanner-error.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
EOF

# Night mode agent (11 PM daily)
cat > "$LAUNCH_DIR/com.creditforge.nightmode.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.creditforge.nightmode</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>$INSTALL_DIR/apps/cli/dist/index.js</string>
    <string>run</string>
    <string>--mode</string>
    <string>night</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CREDITFORGE_ROOT</key>
    <string>$INSTALL_DIR</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>23</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/nightmode.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/nightmode-error.log</string>
</dict>
</plist>
EOF

# Load agents (unload first to avoid errors)
launchctl unload "$LAUNCH_DIR/com.creditforge.scanner.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_DIR/com.creditforge.nightmode.plist" 2>/dev/null || true
launchctl load "$LAUNCH_DIR/com.creditforge.scanner.plist"
launchctl load "$LAUNCH_DIR/com.creditforge.nightmode.plist"
ok "Scanner (hourly) and Night Mode (11 PM) agents installed"

# ─── 6. CLI Wrapper ─────────────────────────────────────
info "Installing CLI..."
mkdir -p "$(dirname "$CLI_BIN")"
cat > "$CLI_BIN" << WRAPPER
#!/bin/bash
export CREDITFORGE_ROOT="$INSTALL_DIR"
exec "$NODE_PATH" "$INSTALL_DIR/apps/cli/dist/index.js" "\$@"
WRAPPER
chmod +x "$CLI_BIN"
ok "CLI installed at $CLI_BIN"

# ─── 7. PATH ────────────────────────────────────────────
BIN_DIR="$HOME/.local/bin"
PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""

add_to_rc() {
  local rc="$1"
  if [ -f "$rc" ] && grep -q "$BIN_DIR" "$rc" 2>/dev/null; then
    return  # already there
  fi
  echo "" >> "$rc"
  echo "# CreditForge CLI" >> "$rc"
  echo "$PATH_LINE" >> "$rc"
  ok "Added $BIN_DIR to $rc"
}

if [[ "$SHELL" == *"zsh"* ]]; then
  add_to_rc "$HOME/.zshrc"
elif [[ "$SHELL" == *"bash"* ]]; then
  add_to_rc "$HOME/.bashrc"
  [ -f "$HOME/.bash_profile" ] && add_to_rc "$HOME/.bash_profile"
fi

# ─── 8. Summary ─────────────────────────────────────────
echo ""
echo -e "${GREEN}  =================================${NC}"
echo -e "${GREEN}   CreditForge installed!${NC}"
echo -e "${GREEN}  =================================${NC}"
echo ""
echo "  Paths:"
echo "    App:     $INSTALL_DIR"
echo "    Config:  $CONFIG_FILE"
echo "    Logs:    $LOG_DIR"
echo "    Reports: $REPORT_DIR"
echo ""
echo "  CLI Commands (restart shell or run: source ~/.zshrc):"
echo "    creditforge scan              — Discover tasks"
echo "    creditforge status            — Dashboard"
echo "    creditforge run --task <id>   — Execute a task"
echo "    creditforge run --mode night --dry-run  — Preview tonight"
echo ""
echo "  Next steps:"
echo "    1. Edit $CONFIG_FILE"
echo "       Add your project paths to scan_roots"
echo "    2. Run: creditforge scan"
echo "    3. Set enabled = true in [night_mode] when ready"
echo ""
echo "  Dashboard: http://localhost:3141 (when menubar app is running)"
echo "  Uninstall: bash $INSTALL_DIR/uninstall.sh"
echo ""
