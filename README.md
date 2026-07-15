# Stream3D Project Page

Public project website for **Stream3D: Sequential Multi-View 3D Generation via Evidential Memory**.

## Structure

- `index.html`: semantic page structure and paper content.
- `assets/css/site.css`: responsive visual system.
- `assets/js/site.js`: result selectors, frame playback, 3D loading, and camera synchronization.
- `assets/data/examples.json`: website-safe manifest derived from curated selections.
- `assets/media/`: optimized input frames, paper figures, and selected GLB assets.
- `paper.pdf`: public preprint.

## Local Preview

Run a static server from this directory:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.

The page loads the pinned Google `<model-viewer>` web component from its official CDN. Selected GLBs are local and load only when their demo enters the viewport.

## Publishing Workflow

1. Update and verify this public repository first.
2. Preview desktop and mobile layouts locally.
3. Commit the public repository after QA passes.
4. Publish only when the public build is approved.
5. Do not synchronize the anonymous repository unless explicitly requested.
