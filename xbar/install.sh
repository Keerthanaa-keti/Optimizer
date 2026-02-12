#!/bin/bash
# Install CreditForge xbar plugin
# Prerequisites: brew install --cask xbar

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_SRC="$SCRIPT_DIR/creditforge.5m.js"
XBAR_PLUGINS_DIR="$HOME/Library/Application Support/xbar/plugins"

if [ ! -d "$XBAR_PLUGINS_DIR" ]; then
  echo "xbar plugins directory not found: $XBAR_PLUGINS_DIR"
  echo "Install xbar first: brew install --cask xbar"
  exit 1
fi

chmod +x "$PLUGIN_SRC"

LINK="$XBAR_PLUGINS_DIR/creditforge.5m.js"
if [ -L "$LINK" ] || [ -f "$LINK" ]; then
  echo "Removing existing plugin..."
  rm "$LINK"
fi

ln -s "$PLUGIN_SRC" "$LINK"
echo "Installed: $LINK -> $PLUGIN_SRC"
echo "Restart xbar to load the plugin."
