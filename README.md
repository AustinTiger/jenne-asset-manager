# Jenne Asset Manager

A local-first asset manager and batch importer for Foundry VTT (Version 13+). 

## Features
- **Local-First Asset Scanning**: Scans and indexes local files to make importing fast and efficient.
- **Batch Importer**: Import multiple assets at once into Foundry.
- **Unique Asset Tracking**: Tracks imported assets using custom unique IDs to prevent duplicate uploads and maintain clean references.
- **Beneos Battlemaps Legacy Support**: Maintains support for parsing legacy Beneos Battlemaps assets.

## Installation
Currently installed as a local Foundry VTT module under `Data/modules/jenne-asset-manager`.

## Dependencies
This module relies on the following Jenne Suite and helper modules:
- `jenne-suite` (Core interface enhancements and sidebar tools registration)
- `scene-packer`
- `monks-active-tiles`
