#!/bin/bash
# CreditForge - Setup Script
# Run this to install dependencies and build the project

set -e

echo "CreditForge Setup"
echo "================="

# Install dependencies
echo "Installing dependencies..."
npm install

# Build all packages
echo "Building packages..."
npm run build

# Create data directories
echo "Creating data directories..."
mkdir -p ~/.creditforge/logs
mkdir -p ~/.creditforge/reports

# Make CLI executable
echo "Setting up CLI..."
chmod +x apps/cli/dist/index.js 2>/dev/null || true

echo ""
echo "Setup complete! Try:"
echo "  node apps/cli/dist/index.js scan"
echo "  node apps/cli/dist/index.js status"
echo ""
echo "To install launchd agents:"
echo "  cp launchd/com.creditforge.scanner.plist ~/Library/LaunchAgents/"
echo "  cp launchd/com.creditforge.nightmode.plist ~/Library/LaunchAgents/"
echo "  launchctl load ~/Library/LaunchAgents/com.creditforge.scanner.plist"
echo "  launchctl load ~/Library/LaunchAgents/com.creditforge.nightmode.plist"
