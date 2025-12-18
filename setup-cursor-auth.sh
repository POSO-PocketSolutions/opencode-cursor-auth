#!/bin/bash
set -e

echo "=== opencode-cursor-auth Setup ==="

# 1. Check for cursor-agent
if ! command -v cursor-agent &> /dev/null; then
  echo "Installing Cursor CLI/Agent..."
  # Official install command
  curl https://cursor.com/install -fsS | bash
  
  # Ensure it's in PATH (installer usually adds it to ~/.local/bin)
  export PATH="$HOME/.local/bin:$PATH"
else
  echo "Cursor Agent already installed."
fi

echo "Please authenticate with Cursor (this will open your browser)..."
cursor-agent login

echo " Authentication successful!"

echo "Verifying token extraction..."
npm install
npm run build
node dist/cli.js
