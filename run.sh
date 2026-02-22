#!/bin/bash

# Manifold - Single Run Script
# Starts the Tauri development environment (frontend + Rust backend)

set -e

echo "🚀 Starting Manifold..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run the Tauri development server
# This automatically starts both:
# - Vite dev server for the SvelteKit frontend
# - Tauri/Rust backend in development mode
echo "🔧 Starting Tauri development server..."
npm run tauri dev
