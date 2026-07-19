const EXAMPLES_URL = "./assets/data/examples.json?v=20260719-gallery-4";
const FRAME_INTERVAL_MS = 900;
const VIEWER_DEFINITION_TIMEOUT_MS = 15000;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const demoControllers = {
  result: null,
  comparison: null,
};

const lazyViewerLoads = new WeakMap();
const lazyViewerObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const load = lazyViewerLoads.get(entry.target);
        lazyViewerObserver.unobserve(entry.target);
        if (load) load();
      });
    }, { rootMargin: "240px 0px", threshold: 0.01 })
  : null;

let examplesRequestId = 0;
let streamInstanceId = 0;

function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;

  Object.entries(options.attributes || {}).forEach(([name, value]) => {
    if (value === false || value === null || value === undefined) return;
    element.setAttribute(name, value === true ? "" : String(value));
  });

  return element;
}

function createIcon(name) {
  return createElement("span", {
    className: `media-icon media-icon-${name}`,
    attributes: { "aria-hidden": "true" },
  });
}

function toDomId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function setStatus(status, type, message) {
  status.hidden = false;
  status.className = `demo-status is-${type}`;
  status.textContent = message;
}

function createStateMessage(type, message, retry) {
  const state = createElement("div", {
    className: `demo-state demo-state-${type}`,
    attributes: {
      role: type === "error" ? "alert" : "status",
    },
  });
  state.append(createElement("p", { text: message }));

  if (retry) {
    const retryButton = createElement("button", {
      className: "button button-secondary button-small",
      text: "Retry",
      attributes: { type: "button" },
    });
    retryButton.addEventListener("click", retry);
    state.append(retryButton);
  }

  return state;
}

function setCollectionState(kind, type, message, retry) {
  destroyDemo(kind);

  const tabs = document.querySelector(`#${kind === "result" ? "result-tabs" : "comparison-tabs"}`);
  const status = document.querySelector(`#${kind}-status`);
  const demo = document.querySelector(`#${kind}-demo`);
  if (!tabs || !status || !demo) return;

  tabs.replaceChildren();
  tabs.hidden = true;
  tabs.setAttribute("aria-busy", type === "loading" ? "true" : "false");
  demo.setAttribute("aria-busy", type === "loading" ? "true" : "false");
  demo.removeAttribute("aria-labelledby");
  setStatus(status, type, message);
  demo.replaceChildren(createStateMessage(type, message, retry));
}

function normalizeExamples(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The examples file does not contain an object.");
  }

  return {
    results: normalizeCollection(payload.results, "results"),
    comparisons: normalizeCollection(payload.comparisons, "comparisons"),
  };
}

function normalizeCollection(collection, name) {
  if (collection === undefined) return [];
  if (!Array.isArray(collection)) {
    throw new Error(`The ${name} collection is not an array.`);
  }

  return collection.map((item, index) => {
    if (!item || typeof item !== "object" || !item.id || !item.title) {
      throw new Error(`The ${name} entry at position ${index + 1} is incomplete.`);
    }

    return {
      ...item,
      id: String(item.id),
      title: String(item.title),
      dataset: item.dataset ? String(item.dataset) : "",
      description: item.description ? String(item.description) : "",
      thumbnail: item.thumbnail ? String(item.thumbnail) : "",
      totalFrames: Number.isFinite(Number(item.totalFrames)) ? Number(item.totalFrames) : 0,
      frames: Array.isArray(item.frames)
        ? item.frames.filter((frame) => typeof frame === "string" && frame.length > 0).slice(0, 12)
        : [],
      framePositions: Array.isArray(item.framePositions)
        ? item.framePositions.map(Number).filter(Number.isFinite).slice(0, 12)
        : [],
      models: item.models && typeof item.models === "object" ? item.models : {},
    };
  });
}

async function loadExamples() {
  const requestId = ++examplesRequestId;
  const retry = () => loadExamples();

  setCollectionState("result", "loading", "Loading result examples...");
  setCollectionState("comparison", "loading", "Loading comparison examples...");

  try {
    const response = await fetch(EXAMPLES_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`The examples request returned ${response.status}.`);
    }

    const examples = normalizeExamples(await response.json());
    if (requestId !== examplesRequestId) return;

    setupCollection("result", examples.results, renderResultDemo);
    setupCollection("comparison", examples.comparisons, renderComparisonDemo);
    restoreHashPosition();
  } catch (error) {
    if (requestId !== examplesRequestId) return;

    console.error("Unable to load Stream3D examples.", error);
    const message = "Examples could not be loaded. Check the connection and try again.";
    setCollectionState("result", "error", message, retry);
    setCollectionState("comparison", "error", message, retry);
  }
}

function restoreHashPosition() {
  const targetId = decodeURIComponent(window.location.hash.slice(1));
  if (!targetId) return;

  const target = document.getElementById(targetId);
  if (!target) return;

  const alignTarget = () => {
    if (decodeURIComponent(window.location.hash.slice(1)) !== targetId) return;
    target.scrollIntoView({ block: "start", behavior: "instant" });
  };

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(alignTarget);
  });
  window.setTimeout(alignTarget, 600);
}

function setupCollection(kind, items, renderDemo) {
  const tabs = document.querySelector(`#${kind === "result" ? "result-tabs" : "comparison-tabs"}`);
  const status = document.querySelector(`#${kind}-status`);
  const demo = document.querySelector(`#${kind}-demo`);
  if (!tabs || !status || !demo) return;

  tabs.replaceChildren();
  tabs.hidden = false;
  tabs.setAttribute("aria-busy", "false");
  demo.setAttribute("role", "tabpanel");

  if (items.length === 0) {
    setCollectionState(
      kind,
      "empty",
      kind === "result" ? "No result examples are available." : "No comparison examples are available.",
    );
    return;
  }

  const tabButtons = items.map((item, index) => {
    const tab = createElement("button", {
      className: "case-tab",
      attributes: {
        type: "button",
        role: "tab",
        id: `${kind}-tab-${toDomId(item.id)}`,
        "aria-controls": demo.id,
        "aria-selected": index === 0 ? "true" : "false",
        tabindex: index === 0 ? "0" : "-1",
      },
    });
    const preview = createElement("span", { className: "case-tab-preview" });
    const previewImage = createElement("img", {
      attributes: {
        src: item.thumbnail || item.frames[Math.floor(item.frames.length / 2)] || "",
        alt: "",
        loading: index === 0 ? "eager" : "lazy",
        decoding: "async",
      },
    });
    const copy = createElement("span", { className: "case-tab-copy" });
    copy.append(
      createElement("strong", { className: "case-tab-title", text: item.title }),
      createElement("small", {
        className: "case-tab-dataset",
        text: [item.dataset, item.totalFrames ? `${item.totalFrames} frames` : ""].filter(Boolean).join(" · "),
      }),
    );
    preview.append(previewImage);
    tab.append(preview, copy);
    tabs.append(tab);
    return tab;
  });

  let selectedIndex = -1;

  const select = (index, moveFocus = false) => {
    const nextIndex = (index + items.length) % items.length;
    if (selectedIndex === nextIndex && !moveFocus) return;
    selectedIndex = nextIndex;

    tabButtons.forEach((tab, tabIndex) => {
      const selected = tabIndex === selectedIndex;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
      tab.classList.toggle("is-active", selected);
    });

    const selectedTab = tabButtons[selectedIndex];
    demo.setAttribute("aria-labelledby", selectedTab.id);
    if (moveFocus) selectedTab.focus();

    setStatus(status, "loading", `Loading ${items[selectedIndex].title}...`);
    demo.setAttribute("aria-busy", "true");

    try {
      renderDemo(items[selectedIndex], kind, demo);
      demo.setAttribute("aria-busy", "false");
      setStatus(status, "ready", `${items[selectedIndex].title} selected.`);
    } catch (error) {
      console.error(`Unable to render ${kind} example.`, error);
      destroyDemo(kind);
      demo.setAttribute("aria-busy", "false");
      const message = "This example could not be displayed.";
      setStatus(status, "error", message);
      demo.replaceChildren(createStateMessage("error", message));
    }
  };

  tabButtons.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = index + 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = index - 1;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = items.length - 1;

      if (nextIndex === null) return;
      event.preventDefault();
      select(nextIndex, true);
    });
  });

  select(0);
}

function createDemoHeading(item, kind) {
  const heading = createElement("div", { className: "demo-heading demo-meta" });
  const titleGroup = createElement("div", { className: "demo-title-group" });
  const title = createElement("h3", {
    className: "demo-title",
    text: item.title,
    attributes: { id: `${kind}-demo-title` },
  });
  titleGroup.append(title);

  if (item.description) {
    titleGroup.append(createElement("p", { className: "demo-description", text: item.description }));
  }

  heading.append(titleGroup);
  if (item.dataset) {
    heading.append(createElement("span", { className: "dataset-label", text: item.dataset }));
  }

  return heading;
}

function createStreamPanel(item, label = "Input stream") {
  const frames = item.frames.slice(0, 12);
  const totalFrames = item.totalFrames || frames.length;
  const framePositions = frames.map((_, index) => item.framePositions[index] || index + 1);
  const counterWidth = Math.max(2, String(totalFrames).length);
  const sourceFrameLabel = (index) => String(framePositions[index]).padStart(counterWidth, "0");
  const panel = createElement("section", {
    className: "demo-panel stream-panel",
    attributes: { "aria-label": `${item.title} ${label}` },
  });
  const panelHeader = createElement("div", { className: "demo-panel-header panel-heading" });
  const frameCounter = createElement("span", { className: "frame-counter mono" });
  panelHeader.append(
    createElement("h4", { className: "panel-label", text: label }),
    frameCounter,
  );
  panel.append(panelHeader);

  if (frames.length === 0) {
    panel.append(createStateMessage("empty", "No input frames are available for this example."));
    return {
      element: panel,
      destroy() {},
    };
  }

  const stage = createElement("div", { className: "stream-stage" });
  const frameImage = createElement("img", {
    className: "stream-frame",
    attributes: {
      src: frames[0],
      alt: `${item.title} input stream, source frame ${framePositions[0]} of ${totalFrames}`,
      decoding: "async",
    },
  });
  const imageState = createElement("div", {
    className: "stream-image-state loading-state",
    text: "Loading frame...",
    attributes: { role: "status" },
  });
  stage.append(frameImage, imageState);

  const controls = createElement("div", { className: "stream-controls" });
  const playButton = createElement("button", {
    className: "stream-play-button",
    attributes: { type: "button" },
  });
  const scrubberId = `stream-scrubber-${++streamInstanceId}`;
  const scrubber = createElement("input", {
    className: "stream-scrubber",
    attributes: {
      id: scrubberId,
      type: "range",
      min: "0",
      max: String(frames.length - 1),
      step: "1",
      value: "0",
      "aria-label": `Choose a frame from the ${item.title} input stream`,
    },
  });
  const frameOutput = createElement("output", {
    className: "stream-frame-output stream-index mono",
    attributes: { for: scrubberId },
  });
  controls.append(playButton, scrubber, frameOutput);

  const filmstrip = createElement("div", {
    className: "filmstrip",
    attributes: { "aria-label": `${item.title} input frames` },
  });
  const frameButtons = frames.map((frame, index) => {
    const sourceFrame = framePositions[index];
    const button = createElement("button", {
      className: "filmstrip-button",
      attributes: {
        type: "button",
        "aria-label": `Show ${item.title} source frame ${sourceFrame} of ${totalFrames}`,
        "aria-pressed": index === 0 ? "true" : "false",
        title: `Source frame ${sourceFrame} of ${totalFrames}`,
      },
    });
    const image = createElement("img", {
      attributes: {
        src: frame,
        alt: `${item.title} input, source frame ${sourceFrame} of ${totalFrames}`,
        loading: "lazy",
        decoding: "async",
      },
    });
    image.addEventListener("error", () => {
      button.classList.add("has-error");
      button.setAttribute("title", `Source frame ${sourceFrame} could not be loaded`);
    });
    button.append(image);
    filmstrip.append(button);
    return button;
  });

  const streamShell = createElement("div", { className: "stream-shell stream-player" });
  streamShell.append(stage, controls);
  panel.append(streamShell, filmstrip);

  let selectedFrame = 0;
  let playing = false;
  let playTimer = null;
  let destroyed = false;

  const updatePlayButton = () => {
    const action = playing ? "Pause" : "Play";
    playButton.replaceChildren(createIcon(playing ? "pause" : "play"));
    playButton.setAttribute("aria-label", `${action} ${item.title} input stream`);
    playButton.setAttribute("title", action);
    playButton.classList.toggle("is-playing", playing);
  };

  const showFrame = (index) => {
    if (destroyed) return;
    selectedFrame = (Number(index) + frames.length) % frames.length;
    const frameNumber = framePositions[selectedFrame];

    imageState.hidden = false;
    imageState.classList.remove("is-error");
    imageState.textContent = "Loading frame...";
    frameImage.src = frames[selectedFrame];
    frameImage.alt = `${item.title} input stream, source frame ${frameNumber} of ${totalFrames}`;
    scrubber.value = String(selectedFrame);
    frameCounter.textContent = `${sourceFrameLabel(selectedFrame)} / ${String(totalFrames).padStart(counterWidth, "0")}`;
    frameOutput.value = `${frameNumber} / ${totalFrames}`;
    frameOutput.textContent = `${frameNumber} / ${totalFrames}`;

    frameButtons.forEach((button, buttonIndex) => {
      const active = buttonIndex === selectedFrame;
      button.classList.toggle("is-active", active);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });

    if (frameImage.complete) {
      imageState.hidden = frameImage.naturalWidth > 0;
      if (frameImage.naturalWidth === 0) {
        imageState.textContent = "This frame could not be loaded.";
        imageState.classList.add("is-error");
      }
    }
  };

  const pause = () => {
    playing = false;
    if (playTimer !== null) window.clearInterval(playTimer);
    playTimer = null;
    updatePlayButton();
  };

  const play = () => {
    if (destroyed || playing) return;
    playing = true;
    playTimer = window.setInterval(() => showFrame(selectedFrame + 1), FRAME_INTERVAL_MS);
    updatePlayButton();
  };

  frameImage.addEventListener("load", () => {
    imageState.hidden = true;
    imageState.classList.remove("is-error");
  });
  frameImage.addEventListener("error", () => {
    imageState.hidden = false;
    imageState.textContent = "This frame could not be loaded.";
    imageState.classList.add("is-error");
  });
  playButton.addEventListener("click", () => {
    if (playing) pause();
    else play();
  });
  scrubber.addEventListener("input", () => {
    pause();
    showFrame(Number(scrubber.value));
  });
  frameButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      pause();
      showFrame(index);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + direction + frameButtons.length) % frameButtons.length;
      pause();
      showFrame(nextIndex);
      frameButtons[nextIndex].focus();
    });
  });

  showFrame(0);
  if (!prefersReducedMotion.matches) play();
  else updatePlayButton();

  return {
    element: panel,
    destroy() {
      destroyed = true;
      pause();
      frameImage.removeAttribute("src");
      frameButtons.forEach((button) => {
        button.querySelector("img")?.removeAttribute("src");
      });
    },
  };
}

function createModelPanel(item, label, source, poster) {
  const panel = createElement("section", {
    className: "demo-panel model-panel",
    attributes: { "aria-label": `${item.title} ${label}` },
  });
  const panelHeader = createElement("div", { className: "demo-panel-header panel-heading" });
  panelHeader.append(
    createElement("h4", { className: "panel-label", text: label }),
    createElement("span", { className: "viewer-hint mono", text: "Drag to orbit" }),
  );
  panel.append(panelHeader);

  if (!source || typeof source !== "string") {
    panel.append(createStateMessage("error", `${label} is not available for this example.`));
    return {
      element: panel,
      viewer: null,
      destroy() {},
    };
  }

  const shell = createElement("div", {
    className: "model-viewer-shell viewer-shell",
    attributes: { "aria-busy": "true" },
  });
  const viewer = createElement("model-viewer", {
    className: "demo-model-viewer",
    attributes: {
      alt: `Interactive ${label} 3D model for ${item.title}`,
      "data-model-src": source,
      "data-dynamic-viewer": "",
      "camera-controls": "",
      "touch-action": "pan-y",
      "environment-image": "neutral",
      "shadow-intensity": "0.8",
      exposure: "1.05",
      "camera-orbit": "0deg 75deg auto",
      "camera-target": "auto auto auto",
      "interaction-prompt": "none",
      loading: "lazy",
      reveal: "auto",
      poster: poster || false,
    },
  });
  const progress = createElement("div", {
    className: "viewer-progress",
    attributes: {
      slot: "progress-bar",
      role: "progressbar",
      "aria-label": `Loading ${label} for ${item.title}`,
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
    },
  });
  const progressBar = createElement("span");
  progress.append(progressBar);
  viewer.append(progress);

  const loadingState = createElement("div", {
    className: "viewer-state viewer-loading",
    text: "3D model loads when visible",
    attributes: { role: "status" },
  });
  const errorState = createElement("div", {
    className: "viewer-state viewer-loading viewer-error",
    attributes: { role: "alert", hidden: true },
  });
  const errorMessage = createElement("p", { text: "The 3D model could not be loaded." });
  const retryButton = createElement("button", {
    className: "button button-secondary button-small",
    text: "Retry model",
    attributes: { type: "button" },
  });
  errorState.append(errorMessage, retryButton);
  shell.append(viewer, loadingState, errorState);
  panel.append(shell);

  let destroyed = false;
  let loadAttempt = 0;
  let definitionTimer = null;

  const showLoading = (message = "Loading 3D model...") => {
    viewer.dataset.loadState = "loading";
    shell.setAttribute("aria-busy", "true");
    loadingState.hidden = false;
    loadingState.textContent = message;
    errorState.hidden = true;
    progress.hidden = false;
    progress.setAttribute("aria-valuenow", "0");
    progressBar.style.width = "0%";
  };

  const showError = (message = "The 3D model could not be loaded.") => {
    if (destroyed) return;
    viewer.dataset.loadState = "error";
    shell.setAttribute("aria-busy", "false");
    loadingState.hidden = true;
    progress.hidden = true;
    errorMessage.textContent = message;
    errorState.hidden = false;
  };

  const attachSource = (attempt) => {
    if (destroyed || attempt !== loadAttempt) return;
    if (definitionTimer !== null) window.clearTimeout(definitionTimer);
    definitionTimer = null;
    showLoading();
    viewer.setAttribute("src", source);
  };

  const load = () => {
    if (destroyed || viewer.hasAttribute("src")) return;
    const attempt = ++loadAttempt;
    showLoading("Preparing 3D viewer...");

    if (customElements.get("model-viewer")) {
      attachSource(attempt);
      return;
    }

    definitionTimer = window.setTimeout(() => {
      showError("The 3D viewer is unavailable. Try again after checking the connection.");
    }, VIEWER_DEFINITION_TIMEOUT_MS);

    customElements.whenDefined("model-viewer").then(() => attachSource(attempt));
  };

  const handleProgress = (event) => {
    if (viewer.dataset.loadState !== "loading" || !viewer.hasAttribute("src")) return;
    const totalProgress = Number(event.detail?.totalProgress);
    if (!Number.isFinite(totalProgress)) return;
    const percent = Math.round(Math.min(1, Math.max(0, totalProgress)) * 100);
    progress.setAttribute("aria-valuenow", String(percent));
    progressBar.style.width = `${percent}%`;
    shell.style.setProperty("--viewer-progress", String(percent / 100));
    loadingState.textContent = `Loading 3D model... ${percent}%`;
  };

  const handleLoad = () => {
    if (destroyed) return;
    viewer.dataset.loadState = "loaded";
    shell.setAttribute("aria-busy", "false");
    shell.classList.add("is-loaded");
    loadingState.hidden = true;
    errorState.hidden = true;
    progress.hidden = true;
  };

  const handleError = () => showError();
  const retry = () => {
    viewer.removeAttribute("src");
    shell.classList.remove("is-loaded");
    load();
  };

  viewer.addEventListener("progress", handleProgress);
  viewer.addEventListener("load", handleLoad);
  viewer.addEventListener("error", handleError);
  retryButton.addEventListener("click", retry);

  lazyViewerLoads.set(viewer, load);
  if (lazyViewerObserver) lazyViewerObserver.observe(viewer);
  else load();

  return {
    element: panel,
    viewer,
    destroy() {
      destroyed = true;
      loadAttempt += 1;
      if (definitionTimer !== null) window.clearTimeout(definitionTimer);
      lazyViewerObserver?.unobserve(viewer);
      lazyViewerLoads.delete(viewer);
      viewer.removeEventListener("progress", handleProgress);
      viewer.removeEventListener("load", handleLoad);
      viewer.removeEventListener("error", handleError);
      retryButton.removeEventListener("click", retry);
      viewer.removeAttribute("src");
      viewer.removeAttribute("poster");
      viewer.dataset.loadState = "unloaded";
    },
  };
}

function copyCamera(source, target) {
  if (
    source.dataset.loadState !== "loaded"
    || target.dataset.loadState !== "loaded"
    || typeof source.getCameraOrbit !== "function"
    || typeof source.getCameraTarget !== "function"
  ) return;

  try {
    const orbit = source.getCameraOrbit();
    const cameraTarget = source.getCameraTarget();
    target.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
    target.cameraTarget = `${cameraTarget.x}m ${cameraTarget.y}m ${cameraTarget.z}m`;

    if (typeof source.getFieldOfView === "function") {
      target.fieldOfView = `${source.getFieldOfView()}deg`;
    }

    if (typeof target.jumpCameraToGoal === "function") target.jumpCameraToGoal();
  } catch (error) {
    console.warn("Unable to synchronize model-viewer cameras.", error);
  }
}

function synchronizeCameras(viewers) {
  const availableViewers = viewers.filter(Boolean);
  if (availableViewers.length < 2) return { destroy() {} };

  let syncing = false;
  let releaseFrame = null;
  let initialCameraAligned = false;

  const alignInitialCamera = () => {
    if (
      initialCameraAligned
      || !availableViewers.every((viewer) => viewer.dataset.loadState === "loaded")
    ) return;

    const source = availableViewers[0];
    if (typeof source.getCameraOrbit !== "function") return;

    try {
      const orbit = source.getCameraOrbit();
      availableViewers.slice(1).forEach((target) => {
        target.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad auto`;
        target.cameraTarget = "auto auto auto";
        if (typeof source.getFieldOfView === "function") {
          target.fieldOfView = `${source.getFieldOfView()}deg`;
        }
        if (typeof target.jumpCameraToGoal === "function") target.jumpCameraToGoal();
      });
      initialCameraAligned = true;
    } catch (error) {
      console.warn("Unable to align initial model-viewer cameras.", error);
    }
  };

  const listeners = availableViewers.map((source) => {
    const handleCameraChange = () => {
      if (syncing || source.dataset.loadState !== "loaded") return;
      syncing = true;
      availableViewers.forEach((target) => {
        if (target !== source) copyCamera(source, target);
      });
      if (releaseFrame !== null) window.cancelAnimationFrame(releaseFrame);
      releaseFrame = window.requestAnimationFrame(() => {
        syncing = false;
        releaseFrame = null;
      });
    };

    source.addEventListener("load", alignInitialCamera);
    source.addEventListener("camera-change", handleCameraChange);
    return { source, handleCameraChange };
  });

  return {
    destroy() {
      listeners.forEach(({ source, handleCameraChange }) => {
        source.removeEventListener("load", alignInitialCamera);
        source.removeEventListener("camera-change", handleCameraChange);
      });
      if (releaseFrame !== null) window.cancelAnimationFrame(releaseFrame);
    },
  };
}

function renderResultDemo(item, kind, demo) {
  destroyDemo(kind);
  demo.replaceChildren();

  const controllers = [];
  const viewers = [];
  const poster = item.frames[Math.floor(item.frames.length / 2)] || "";
  const heading = createDemoHeading(item, kind);

  if (item.models.sam3d) {
    const grid = createElement("div", { className: "demo-grid comparison-demo-grid result-demo-grid" });
    const stream = createStreamPanel(item, "Input stream");
    const sam3d = createModelPanel(item, item.leftLabel || "SAM3D", item.models.sam3d, poster);
    const stream3d = createModelPanel(item, item.rightLabel || "Stream3D", item.models.stream3d, poster);

    controllers.push(stream, sam3d, stream3d);
    grid.append(stream.element, sam3d.element, stream3d.element);
    demo.append(heading, grid);

    const cameraSync = synchronizeCameras([sam3d.viewer, stream3d.viewer]);
    demoControllers[kind] = createCompositeController(controllers, cameraSync);
    return;
  }

  const grid = createElement("div", { className: "demo-grid result-demo-grid result-grid" });

  if (item.leftType === "model") {
    const groundTruth = createModelPanel(item, item.leftLabel || "Ground truth", item.models.gt, poster);
    controllers.push(groundTruth);
    if (groundTruth.viewer) viewers.push(groundTruth.viewer);
    grid.append(groundTruth.element);
  } else {
    const stream = createStreamPanel(item, item.leftLabel || "Input stream");
    controllers.push(stream);
    grid.append(stream.element);
  }

  const stream3d = createModelPanel(item, item.rightLabel || "Stream3D", item.models.stream3d, poster);
  controllers.push(stream3d);
  if (stream3d.viewer) viewers.push(stream3d.viewer);
  grid.append(stream3d.element);

  demo.append(heading, grid);
  const cameraSync = synchronizeCameras(viewers);
  demoControllers[kind] = createCompositeController(controllers, cameraSync);
}

function renderComparisonDemo(item, kind, demo) {
  destroyDemo(kind);
  demo.replaceChildren();

  const controllers = [];
  const heading = createDemoHeading(item, kind);
  const hasInputFrames = item.frames.length > 0;
  const grid = createElement("div", {
    className: `demo-grid comparison-demo-grid${hasInputFrames ? "" : " comparison-model-only"}`,
  });
  const poster = item.frames[Math.floor(item.frames.length / 2)] || "";
  const sam3d = createModelPanel(item, "SAM3D", item.models.sam3d, poster);
  const stream3d = createModelPanel(item, "Stream3D", item.models.stream3d, poster);

  if (hasInputFrames) {
    const stream = createStreamPanel(item, "Input stream");
    controllers.push(stream);
    grid.append(stream.element);
  }

  controllers.push(sam3d, stream3d);
  grid.append(sam3d.element, stream3d.element);
  demo.append(heading, grid);

  const cameraSync = synchronizeCameras([sam3d.viewer, stream3d.viewer]);
  demoControllers[kind] = createCompositeController(controllers, cameraSync);
}

function createCompositeController(controllers, cameraSync) {
  return {
    destroy() {
      cameraSync.destroy();
      controllers.forEach((controller) => controller.destroy());
    },
  };
}

function destroyDemo(kind) {
  demoControllers[kind]?.destroy();
  demoControllers[kind] = null;

  const demo = document.querySelector(`#${kind}-demo`);
  demo?.querySelectorAll("model-viewer").forEach((viewer) => {
    lazyViewerObserver?.unobserve(viewer);
    lazyViewerLoads.delete(viewer);
    viewer.removeAttribute("src");
    viewer.removeAttribute("poster");
    viewer.dataset.loadState = "unloaded";
  });
}

function initRevealObserver() {
  const revealElements = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || prefersReducedMotion.matches) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.12 });

  revealElements.forEach((element) => observer.observe(element));
}

function initSectionObserver() {
  const sections = [...document.querySelectorAll("[data-section]")];
  const navLinks = [...document.querySelectorAll("[data-nav] a[href^='#']")];
  if (!("IntersectionObserver" in window) || sections.length === 0) return;

  const visibleSections = new Map();
  const setActiveSection = () => {
    const visible = sections.filter((section) => visibleSections.get(section)?.isIntersecting);
    if (visible.length === 0) return;

    visible.sort((first, second) => {
      const firstEntry = visibleSections.get(first);
      const secondEntry = visibleSections.get(second);
      return Math.abs(firstEntry.boundingClientRect.top) - Math.abs(secondEntry.boundingClientRect.top);
    });

    const activeId = visible[0].id;
    navLinks.forEach((link) => {
      const active = link.getAttribute("href") === `#${activeId}`;
      link.classList.toggle("is-active", active);
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => visibleSections.set(entry.target, entry));
    setActiveSection();
  }, {
    rootMargin: "-18% 0px -62% 0px",
    threshold: [0, 0.01],
  });

  sections.forEach((section) => observer.observe(section));
}

function initNavigation() {
  const header = document.querySelector("[data-header]");
  const nav = document.querySelector("[data-nav]");
  const menuButton = document.querySelector("[data-menu-button]");
  if (!header || !nav || !menuButton) return;

  const desktopQuery = window.matchMedia("(min-width: 981px)");

  const setOpen = (open, restoreFocus = false) => {
    nav.classList.toggle("is-open", open);
    header.classList.toggle("nav-open", open);
    document.body.classList.toggle("nav-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");

    if (open) nav.querySelector("a")?.focus();
    else if (restoreFocus) menuButton.focus();
  };

  menuButton.addEventListener("click", () => {
    setOpen(menuButton.getAttribute("aria-expanded") !== "true");
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  header.querySelectorAll("a[href^='#']").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setOpen(false, true);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (menuButton.getAttribute("aria-expanded") === "true" && !header.contains(event.target)) {
      setOpen(false);
    }
  });

  const closeOnDesktop = (event) => {
    if (event.matches) setOpen(false);
  };
  if (typeof desktopQuery.addEventListener === "function") {
    desktopQuery.addEventListener("change", closeOnDesktop);
  } else {
    desktopQuery.addListener(closeOnDesktop);
  }
}

async function writeToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = createElement("textarea", {
    attributes: { readonly: true, "aria-hidden": "true" },
  });
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  document.body.append(textArea);
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textArea.remove();
  }

  if (!copied) throw new Error("The browser rejected the copy command.");
}

function initCitationCopy() {
  const button = document.querySelector("[data-copy-citation]");
  const status = document.querySelector("[data-copy-status]");
  const bibtex = document.querySelector("#bibtex");
  if (!button || !status || !bibtex) return;

  const idleLabel = button.textContent.trim();
  let resetTimer = null;
  button.addEventListener("click", async () => {
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    button.disabled = true;
    status.textContent = "Copying BibTeX...";

    try {
      await writeToClipboard(bibtex.textContent.trim());
      button.textContent = "Copied";
      status.textContent = "BibTeX copied to the clipboard.";
    } catch (error) {
      console.error("Unable to copy BibTeX.", error);
      button.textContent = idleLabel;
      status.textContent = "Copy failed. Select the BibTeX text and copy it manually.";
    } finally {
      button.disabled = false;
      button.focus();
      resetTimer = window.setTimeout(() => {
        button.textContent = idleLabel;
        status.textContent = "";
        resetTimer = null;
      }, 3000);
    }
  });
}

function enhanceStaticModelViewers() {
  document.querySelectorAll("model-viewer:not([data-dynamic-viewer])").forEach((viewer) => {
    viewer.setAttribute("loading", "lazy");
    const shell = viewer.closest(".hero-viewer-shell, .viewer-shell");
    const progress = viewer.querySelector(".viewer-progress");
    const progressBar = progress?.querySelector("span");
    let availabilityTimer = null;

    if (progress) {
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Loading interactive 3D model");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", "0");
    }

    let errorState = shell?.querySelector(".viewer-error");
    if (shell && !errorState) {
      errorState = createElement("div", {
        className: "viewer-state viewer-loading viewer-error",
        text: "The 3D model could not be loaded.",
        attributes: { role: "alert", hidden: true },
      });
      shell.append(errorState);
    }

    const showError = () => {
      shell?.classList.add("has-error");
      if (errorState) errorState.hidden = false;
      if (progress) progress.hidden = true;
    };

    viewer.addEventListener("progress", (event) => {
      const value = Number(event.detail?.totalProgress);
      if (!Number.isFinite(value)) return;
      const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
      progress?.setAttribute("aria-valuenow", String(percent));
      if (progressBar) progressBar.style.width = `${percent}%`;
    });
    viewer.addEventListener("load", () => {
      if (availabilityTimer !== null) window.clearTimeout(availabilityTimer);
      shell?.classList.add("is-loaded");
      shell?.classList.remove("has-error");
      if (errorState) errorState.hidden = true;
      if (progress) progress.hidden = true;
    });
    viewer.addEventListener("error", showError);

    if (!customElements.get("model-viewer")) {
      availabilityTimer = window.setTimeout(showError, VIEWER_DEFINITION_TIMEOUT_MS);
      customElements.whenDefined("model-viewer").then(() => {
        if (availabilityTimer !== null) window.clearTimeout(availabilityTimer);
      });
    }
  });
}

function init() {
  document.documentElement.classList.add("js");
  initNavigation();
  initCitationCopy();
  initRevealObserver();
  initSectionObserver();
  enhanceStaticModelViewers();
  loadExamples();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
