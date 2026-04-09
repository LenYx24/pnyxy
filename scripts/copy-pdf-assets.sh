#!/bin/sh
# Copy pdfjs-dist worker and cmaps to public/pdf-assets for serving
PDFJS_DIR="node_modules/pdfjs-dist"
DEST="public/pdf-assets"

mkdir -p "$DEST/cmaps"
cp "$PDFJS_DIR/build/pdf.worker.min.mjs" "$DEST/"
cp "$PDFJS_DIR/cmaps/"* "$DEST/cmaps/"
echo "Copied pdf.js assets to $DEST"
