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
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${BLUE}[*]${NC} $1"; }
ok()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}${GREEN}  CreditForge Installer${NC}"
echo -e "  ${DIM}Maximize your Claude subscription value${NC}"
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
  warn "Claude CLI not found — Night Mode needs it to run tasks"
  warn "Install later: https://docs.anthropic.com/en/docs/claude-cli"
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
  info "Downloading CreditForge..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
ok "Source ready"

# ─── 3. Build ───────────────────────────────────────────
info "Installing dependencies (this takes ~60 seconds)..."
cd "$INSTALL_DIR"
npm install --silent 2>&1 | tail -1
info "Building..."
npm run build 2>&1 | tail -1
ok "Build complete"

# ─── 4. Config ──────────────────────────────────────────
mkdir -p "$LOG_DIR" "$REPORT_DIR"

if [ -f "$CONFIG_FILE" ]; then
  ok "Config exists at $CONFIG_FILE (preserved)"
else
  echo ""
  echo -e "${BOLD}  Quick Setup${NC}"
  echo ""

  # ─── Auto-detect git projects ──────────────────────
  info "Looking for code projects on your machine..."
  DETECTED=()

  # Common locations to search for git repos
  SEARCH_DIRS=(
    "$HOME/Documents"
    "$HOME/Projects"
    "$HOME/Developer"
    "$HOME/Code"
    "$HOME/repos"
    "$HOME/dev"
    "$HOME/src"
    "$HOME/Desktop"
  )

  for search_dir in "${SEARCH_DIRS[@]}"; do
    if [ -d "$search_dir" ]; then
      # Find git repos (max depth 2 to avoid going too deep)
      while IFS= read -r gitdir; do
        repo_dir="$(dirname "$gitdir")"
        # Skip node_modules, hidden dirs, and the creditforge install itself
        case "$repo_dir" in
          */node_modules/*|*/.*|*/.creditforge/*) continue ;;
        esac
        DETECTED+=("$repo_dir")
      done < <(find "$search_dir" -maxdepth 3 -name ".git" -type d 2>/dev/null)
    fi
  done

  if [ ${#DETECTED[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${BOLD}Found ${#DETECTED[@]} code projects on your machine:${NC}"
    echo ""

    # Show numbered list (max 20)
    SHOW_COUNT=${#DETECTED[@]}
    if (( SHOW_COUNT > 20 )); then
      SHOW_COUNT=20
    fi

    for i in $(seq 0 $((SHOW_COUNT - 1))); do
      # Show shortened path
      short=$(echo "${DETECTED[$i]}" | sed "s|$HOME|~|")
      echo -e "    ${DIM}$((i + 1)))${NC} $short"
    done

    if (( ${#DETECTED[@]} > 20 )); then
      echo -e "    ${DIM}... and $((${#DETECTED[@]} - 20)) more${NC}"
    fi

    echo ""
    echo -e "  ${BOLD}Which ones should CreditForge monitor?${NC}"
    echo -e "  ${DIM}CreditForge will scan these for TODOs, bugs, and tasks to automate.${NC}"
    echo ""
    echo "  Enter numbers separated by spaces (e.g. 1 3 5)"
    echo "  Type 'all' to select everything, or Enter to skip"
    echo ""
    read -p "  Your choice: " selection < /dev/tty

    SCAN_ROOTS=()
    if [[ "$selection" == "all" ]]; then
      for d in "${DETECTED[@]}"; do
        short=$(echo "$d" | sed "s|$HOME|~|")
        SCAN_ROOTS+=("$short")
      done
      ok "Selected all ${#DETECTED[@]} projects"
    elif [ -n "$selection" ]; then
      for num in $selection; do
        idx=$((num - 1))
        if (( idx >= 0 && idx < ${#DETECTED[@]} )); then
          short=$(echo "${DETECTED[$idx]}" | sed "s|$HOME|~|")
          SCAN_ROOTS+=("$short")
          ok "Selected: $short"
        fi
      done
    fi
  else
    echo ""
    echo -e "  ${DIM}No git projects found in common locations.${NC}"
    SCAN_ROOTS=()
  fi

  # Offer to add custom paths too
  echo ""
  echo -e "  ${DIM}Want to add more folders manually? (Enter path or press Enter to skip)${NC}"
  while true; do
    read -p "  Add folder: " folder < /dev/tty
    if [ -z "$folder" ]; then
      break
    fi
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
    warn "No projects selected. You can add them later: creditforge setup"
  else
    SCAN_ROOTS_TOML="scan_roots = ["
    for i in "${!SCAN_ROOTS[@]}"; do
      if [ $i -gt 0 ]; then
        SCAN_ROOTS_TOML+=","
      fi
      SCAN_ROOTS_TOML+=$'\n'"  \"${SCAN_ROOTS[$i]}\""
    done
    SCAN_ROOTS_TOML+=$'\n'"]"
    ok "${#SCAN_ROOTS[@]} projects configured"
  fi

  # ─── Ask for subscription tier ─────────────────────
  echo ""
  echo -e "  ${BOLD}What Claude plan are you on?${NC}"
  echo ""
  echo "    1) Pro        \$20/month"
  echo "    2) Max 5x    \$100/month  ${DIM}(most common)${NC}"
  echo "    3) Max 20x   \$200/month"
  echo ""
  read -p "  Choice [2]: " tier_choice < /dev/tty
  case "$tier_choice" in
    1) TIER="pro" ;;
    3) TIER="max20" ;;
    *) TIER="max5" ;;
  esac
  ok "Tier: $TIER"

  cat > "$CONFIG_FILE" << TOML
# CreditForge Configuration
# Edit with: nano ~/.creditforge/config.toml

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
  ok "Config saved to $CONFIG_FILE"
fi

# ─── 5. Launchd Agents ──────────────────────────────────
info "Installing background agents..."
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
ok "Background scanner (hourly) + night mode (11 PM) active"

# ─── 6. CLI Wrapper ─────────────────────────────────────
info "Installing CLI..."
mkdir -p "$(dirname "$CLI_BIN")"
cat > "$CLI_BIN" << WRAPPER
#!/bin/bash
export CREDITFORGE_ROOT="$INSTALL_DIR"
exec "$NODE_PATH" "$INSTALL_DIR/apps/cli/dist/index.js" "\$@"
WRAPPER
chmod +x "$CLI_BIN"

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
}

if [[ "$SHELL" == *"zsh"* ]]; then
  add_to_rc "$HOME/.zshrc"
elif [[ "$SHELL" == *"bash"* ]]; then
  add_to_rc "$HOME/.bashrc"
  [ -f "$HOME/.bash_profile" ] && add_to_rc "$HOME/.bash_profile"
fi

ok "CLI ready"

# ─── 8. Run initial scan if projects configured ─────────
HAVE_PROJECTS=false
if [ -f "$CONFIG_FILE" ] && grep -q '"~/' "$CONFIG_FILE" 2>/dev/null; then
  HAVE_PROJECTS=true
fi

if $HAVE_PROJECTS; then
  echo ""
  info "Running first scan..."
  export CREDITFORGE_ROOT="$INSTALL_DIR"
  "$CLI_BIN" scan 2>&1 | tail -3
fi

# ─── 9. Summary ─────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}  =================================${NC}"
echo -e "${BOLD}${GREEN}   CreditForge is ready!${NC}"
echo -e "${BOLD}${GREEN}  =================================${NC}"
echo ""

if $HAVE_PROJECTS; then
  echo -e "  ${BOLD}Get started:${NC}"
  echo ""
  echo "    source ~/.zshrc              # load the CLI"
  echo "    creditforge scan             # see discovered tasks"
  echo "    creditforge status           # view dashboard"
  echo ""
  echo -e "  ${BOLD}When you're ready for automation:${NC}"
  echo ""
  echo "    Edit ~/.creditforge/config.toml"
  echo "    Set enabled = true under [night_mode]"
  echo "    CreditForge will work overnight while you sleep"
else
  echo -e "  ${BOLD}Get started:${NC}"
  echo ""
  echo "    source ~/.zshrc              # load the CLI"
  echo "    nano ~/.creditforge/config.toml"
  echo "    # Add your project paths to scan_roots, then:"
  echo "    creditforge scan             # discover tasks"
fi
echo ""
echo -e "  ${DIM}Config: ~/.creditforge/config.toml${NC}"
echo -e "  ${DIM}Uninstall: bash ~/.creditforge/app/uninstall.sh${NC}"
echo ""
