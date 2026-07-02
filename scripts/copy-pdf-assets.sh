#!/bin/sh
# Copy pdfjs-dist worker and cmaps to public/pdf-assets for serving
PDFJS_DIR="node_modules/pdfjs-dist"
DEST="public/pdf-assets"

mkdir -p "$DEST/cmaps" "$DEST/wasm"
cp "$PDFJS_DIR/build/pdf.worker.min.mjs" "$DEST/"
cp "$PDFJS_DIR/cmaps/"* "$DEST/cmaps/"
# WebAssembly image decoders (openjpeg.wasm for JPEG2000/JPX, qcms for
# ICC colour). Required or JPX-image PDFs render blank. See the .mjs
# script (the live postinstall) for the full rationale.
cp "$PDFJS_DIR/wasm/"* "$DEST/wasm/"
echo "Copied pdf.js assets to $DEST"
