#!/bin/bash

set -ex

# Verify prereq
if ! command -v composite &> /dev/null; then
    echo "Error: 'composite' (ImageMagick) is not installed."
    exit 1
fi

mkdir -p ./composites

# Create for all icons
for file in ./icons_stroke/*.png; do
    if [ ! -e "$file" ]; then
        continue
    fi

    filename=$(basename "$file")

    # Overlay stroke onto the background with (hopefully) deterministic output
    composite -gravity center \
        -strip \
        -define png:compression-level=9 \
        -define png:compression-filter=0 \
        -define png:compression-strategy=0 \
        "$file" \
        ./background.png "./composites/$filename"
done
