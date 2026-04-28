(function () {
  "use strict";

  const API_BASE = "https://api.mtd.dev";
  const GTFS_CORE_DATA_URL = "./data/gtfs-map.json";
  const GTFS_TRIP_STOPS_URL = "./data/gtfs-trip-stops.json";
  const CONFIG_URL = "./data/runtime-config.json";
  const GTFS_RT_PROTO_URL = "./gtfs-realtime-vehicle.proto";
  const GTFS_RT_VEHICLE_POSITIONS_URL = "https://gtfs-rt.mtd.org/vehicle-positions";
  const DEFAULT_REFRESH_INTERVAL_MS = 120000;
  const LIVE_STALE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
  const NETWORK_PAD_RATIO = 0.2;
  const ROUTE_CORRIDOR_MAX_METERS = 1100;
  const ZOOM_SLIDER_STEPS = 100;
  const EXTRA_MAX_ZOOM = 5.4;
  const BUTTON_ZOOM_STEP = 0.75;
  const ALL_STOPS_MIN_ZOOM = 14.8;
  const FOCUSED_ROUTE_STOPS_MIN_ZOOM = 17.2;
  const PLANNER_ROUTE_STOPS_MIN_ZOOM = 17.6;
  const OVERVIEW_SIMPLIFY_TOLERANCE_METERS = 135;
  const OVERVIEW_SMOOTHING_PASSES = 2;
  const OVERVIEW_MIN_POINT_SPACING_METERS = 85;
  const ROUTE_BASE_SOURCE_ID = "routes-base";
  const ROUTE_FOCUS_SOURCE_ID = "routes-focus";
  const ROUTE_BASE_UNDERLAY_LAYER_ID = "routes-base-underlay";
  const ROUTE_BASE_LINE_LAYER_ID = "routes-base-line";
  const ROUTE_BASE_HITBOX_LAYER_ID = "routes-base-hitbox";
  const ROUTE_FOCUS_UNDERLAY_LAYER_ID = "routes-focus-underlay";
  const ROUTE_FOCUS_LINE_LAYER_ID = "routes-focus-line";
  const ROUTE_FOCUS_HITBOX_LAYER_ID = "routes-focus-hitbox";
  const ALL_STOPS_SOURCE_ID = "stops-all";
  const ALL_STOPS_LAYER_ID = "stops-all-layer";
  const SELECTED_STOPS_SOURCE_ID = "stops-selected";
  const SELECTED_STOPS_LAYER_ID = "stops-selected-layer";
  const PLANNER_REGIONS_SOURCE_ID = "planner-regions";
  const PLANNER_REGIONS_FILL_LAYER_ID = "planner-regions-fill";
  const PLANNER_REGIONS_LINE_LAYER_ID = "planner-regions-line";
  const PLANNER_REGION_STOPS_SOURCE_ID = "planner-region-stops";
  const PLANNER_REGION_STOPS_LAYER_ID = "planner-region-stops-layer";
  const OCCUPANCY_HEAT_SOURCE_ID = "occupancy-heat";
  const OCCUPANCY_HEAT_PINK_LAYER_ID = "occupancy-heat-pink";
  const OCCUPANCY_HEAT_GREEN_LAYER_ID = "occupancy-heat-green";
  const UPCOMING_STOP_COUNT = 5;
  const PLANNER_MAX_RIDES = 4;
  const PLANNER_MIN_SELECTION_PX = 22;
  const PLANNER_APPROACH_DISTANCE_METERS = 2600;
  const OCCUPANCY_HEAT_DECAY_MS = 36 * 60 * 1000;
  const OCCUPANCY_HEAT_EVENT_GAIN = 1.3;
  const OCCUPANCY_HEAT_MIN_VISIBLE_SCORE = 0.12;
  const OCCUPANCY_HEAT_MAX_ABS_SCORE = 8;
  const DEFAULT_CONFIG = {
    apiKey: "",
    apiMode: "proxy",
    apiBase: "/api",
    refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    tileMaxZoom: 19,
    initialTheme: "light",
  };

  const STORAGE_KEYS = {
    apiKey: "cumtd-dashboard-api-key",
    theme: "cumtd-dashboard-theme",
    showHeat: "cumtd-dashboard-show-heat",
    showBusBorders: "cumtd-dashboard-show-bus-borders",
    showRouteBorders: "cumtd-dashboard-show-route-borders",
  };
  const SESSION_KEYS = {
    analytics: "cumtd-dashboard-analytics-cache",
  };

  const state = {
    config: null,
    gtfs: null,
    gtfsTripStopsLoading: null,
    map: null,
    routeTemplates: [],
    routeOverviewTemplates: [],
    routeTemplatesByRouteId: new Map(),
    routeLegendEntries: [],
    routeStops: new Map(),
    stopFeaturesById: new Map(),
    stopRouteIdsByStopId: new Map(),
    allStopFeatures: [],
    busMarkers: new Map(),
    liveVehicles: [],
    gtfsRtFeedType: null,
    vehiclePositionsById: new Map(),
    vehicleMetaById: new Map(),
    vehicleMetaLoaded: false,
    previousOccupancyByVehicleId: new Map(),
    previousTelemetryByVehicleId: new Map(),
    occupancyHeatByKey: new Map(),
    routeAnalyticsHistory: new Map(),
    showOccupancyHeat: true,
    showBusBorders: false,
    showRouteBorders: false,
    selectedBusId: "",
    selectedStopId: "",
    selectedBusDeparture: null,
    selectedBusTrip: null,
    selectedBusStop: null,
    selectedBusLoading: false,
    plannerSelectionMode: "",
    plannerSelectionDrag: null,
    plannerSuppressMapClickUntil: 0,
    plannerModel: null,
    plannerLoading: false,
    plannerComputationSeq: 0,
    plannerResults: null,
    plannerPreference: "sitting",
    plannerRegions: {
      from: { stopIds: [], bounds: null },
      to: { stopIds: [], bounds: null },
    },
    shapeMeasureCache: new Map(),
    tripProjectionCache: new Map(),
    mapRestoreView: null,
    animationFrame: null,
    refreshTimer: null,
    refreshing: false,
    queuedRefresh: false,
    selectedRouteId: "",
    selectedRouteLegendKey: "",
    selectedRouteLegendRouteIds: [],
    activeRouteCount: 0,
    networkBounds: null,
    refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
    runtimeApiKey: "",
    lastUpdatedLabel: "",
    initialZoom: 13,
  };

  const dom = {
    body: document.body,
    map: document.getElementById("map"),
    overlay: document.getElementById("overlay"),
    overlayPrimary: document.getElementById("overlay-primary"),
    overlaySecondary: document.getElementById("overlay-secondary"),
    statusPrimary: document.getElementById("status-primary"),
    statusSecondary: document.getElementById("status-secondary"),
    heatToggleButton: document.getElementById("heat-toggle-button"),
    refreshButton: document.getElementById("refresh-button"),
    themeToggle: document.getElementById("theme-toggle"),
    zoomInButton: document.getElementById("zoom-in-button"),
    zoomOutButton: document.getElementById("zoom-out-button"),
    zoomSlider: document.getElementById("zoom-slider"),
    plannerFromButton: document.getElementById("planner-from-button"),
    plannerToButton: document.getElementById("planner-to-button"),
    plannerClearButton: document.getElementById("planner-clear-button"),
    plannerModeSitting: document.getElementById("planner-mode-sitting"),
    plannerModeStanding: document.getElementById("planner-mode-standing"),
    plannerHint: document.getElementById("planner-hint"),
    plannerSelectionBox: document.getElementById("planner-selection-box"),
    infoToggle: document.getElementById("info-toggle"),
    infoPanel: document.getElementById("info-panel"),
    busBorderToggle: document.getElementById("bus-border-toggle"),
    routeBorderToggle: document.getElementById("route-border-toggle"),
    routeLegendToggle: document.getElementById("route-legend-toggle"),
    routeLegendPanel: document.getElementById("route-legend-panel"),
    routeLegendList: document.getElementById("route-legend-list"),
    keyPanel: document.getElementById("key-panel"),
    apiKeyInput: document.getElementById("api-key-input"),
    saveKey: document.getElementById("save-key"),
    clearKey: document.getElementById("clear-key"),
    closeKeyPanel: document.getElementById("toggle-key-panel"),
    busPanel: document.getElementById("bus-panel"),
    busPanelKicker: document.getElementById("bus-panel-kicker"),
    busPanelTitle: document.getElementById("bus-panel-title"),
    busPanelMetaCard: document.getElementById("bus-panel-meta-card"),
    busPanelMetaLabel: document.getElementById("bus-panel-meta-label"),
    busPanelMeta: document.getElementById("bus-panel-meta"),
    busPanelMetaExtra: document.getElementById("bus-panel-meta-extra"),
    busPanelSpotlightLeft: document.getElementById("bus-panel-spotlight-left"),
    busPanelSpotlightRight: document.getElementById("bus-panel-spotlight-right"),
    busPanelGridLeft: document.getElementById("bus-panel-grid-left"),
    busPanelListLabel: document.getElementById("bus-panel-list-label"),
    busStopList: document.getElementById("bus-stop-list"),
    themeMeta: document.querySelector('meta[name="theme-color"]'),
  };

  init();

  async function init() {
    bindEvents();
    showOverlay("Loading map", "Preparing basemap and route cache.");
    updateStatus("Loading map", "Static cache");

    try {
      const [config, gtfs] = await Promise.all([loadRuntimeConfig(), loadGtfsCoreData()]);
      state.config = config;
      state.gtfs = gtfs;
      state.refreshIntervalMs = Math.max(30000, Number(config.refreshIntervalMs) || DEFAULT_REFRESH_INTERVAL_MS);
      state.runtimeApiKey = usesDirectApi()
        ? config.apiKey || window.localStorage.getItem(STORAGE_KEYS.apiKey) || ""
        : "";
      state.showOccupancyHeat = window.localStorage.getItem(STORAGE_KEYS.showHeat) !== "0";
      state.showBusBorders = window.localStorage.getItem(STORAGE_KEYS.showBusBorders) === "1";
      state.showRouteBorders = window.localStorage.getItem(STORAGE_KEYS.showRouteBorders) === "1";
      hydrateAnalyticsCache();
      applyTheme(config.initialTheme || window.localStorage.getItem(STORAGE_KEYS.theme) || "light");
      syncHeatToggle();
      syncInfoToggles();
      prepareStaticData();
      renderRouteLegend();
      await loadGtfsRealtimeProto();
      dom.apiKeyInput.value = state.runtimeApiKey;
      await initializeMap();
      hideOverlay();
      updateStatus("Map ready", "Click a route to isolate");
      window.setTimeout(() => {
        ensureTripStopsData().catch(() => { });
      }, 250);

      if (canUseLiveRestApi()) {
        startPolling(true);
      } else {
        showOverlay("Awaiting API key", "Set API_KEY in .env or enter it here.");
        updateStatus("Awaiting API key", "Live feed disabled");
        openKeyPanel(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to initialize app.";
      showOverlay("Startup failed", message);
      updateStatus("Startup failed", "Check local assets");
    }
  }

  function bindEvents() {
    dom.refreshButton.addEventListener("click", () => refreshVehicles(true));
    dom.themeToggle.addEventListener("click", () => applyTheme(dom.body.dataset.theme === "dark" ? "light" : "dark"));
    dom.heatToggleButton.addEventListener("click", toggleOccupancyHeat);
    dom.zoomInButton.addEventListener("click", () => zoomBy(BUTTON_ZOOM_STEP));
    dom.zoomOutButton.addEventListener("click", () => zoomBy(-BUTTON_ZOOM_STEP));
    dom.zoomSlider.addEventListener("input", onZoomSliderInput);
    dom.zoomSlider.addEventListener("change", onZoomSliderCommit);
    dom.plannerFromButton.addEventListener("click", () => activatePlannerSelection("from"));
    dom.plannerToButton.addEventListener("click", () => activatePlannerSelection("to"));
    dom.plannerClearButton.addEventListener("click", clearPlannerSelections);
    dom.plannerModeSitting.addEventListener("click", () => setPlannerPreference("sitting"));
    dom.plannerModeStanding.addEventListener("click", () => setPlannerPreference("standing"));
    dom.infoToggle.addEventListener("click", () => toggleInfoPanel());
    dom.busBorderToggle.addEventListener("click", toggleBusBorders);
    dom.routeBorderToggle.addEventListener("click", toggleRouteBorders);
    dom.routeLegendToggle.addEventListener("click", () => toggleRouteLegendPanel());
    dom.saveKey.addEventListener("click", saveApiKey);
    dom.clearKey.addEventListener("click", clearApiKey);
    dom.closeKeyPanel.addEventListener("click", () => openKeyPanel(false));
    dom.apiKeyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        saveApiKey();
      }
      if (event.key === "Escape") {
        openKeyPanel(false);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.runtimeApiKey) {
        startPolling(true);
      } else {
        stopPolling();
      }
    });
    window.addEventListener("mousemove", onPlannerPointerMove);
    window.addEventListener("mouseup", onPlannerPointerUp);
    window.addEventListener("keydown", onGlobalKeyDown);
    dom.busStopList.addEventListener("click", onFocusListClick);
    dom.routeLegendList.addEventListener("click", onRouteLegendClick);
    syncPlannerHud();
  }

  async function loadRuntimeConfig() {
    const response = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!response.ok) {
      return { ...DEFAULT_CONFIG };
    }
    return { ...DEFAULT_CONFIG, ...(await response.json()) };
  }

  async function loadGtfsCoreData() {
    const response = await fetch(GTFS_CORE_DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Run `python3 scripts/build_gtfs_cache.py` first.");
    }
    return response.json();
  }

  async function ensureTripStopsData() {
    if (state.gtfs?.tripStopsByTripId) {
      return state.gtfs.tripStopsByTripId;
    }
    if (state.gtfsTripStopsLoading) {
      return state.gtfsTripStopsLoading;
    }
    state.gtfsTripStopsLoading = fetch(GTFS_TRIP_STOPS_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Trip stop cache unavailable.");
        }
        return response.json();
      })
      .then((payload) => {
        state.gtfs.tripStopsByTripId = payload?.tripStopsByTripId || {};
        return state.gtfs.tripStopsByTripId;
      })
      .finally(() => {
        state.gtfsTripStopsLoading = null;
      });
    return state.gtfsTripStopsLoading;
  }

  async function loadGtfsRealtimeProto() {
    if (typeof protobuf === "undefined") {
      return;
    }
    const response = await fetch(GTFS_RT_PROTO_URL, { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const protoText = await response.text();
    const parsed = protobuf.parse(protoText);
    state.gtfsRtFeedType = parsed.root.lookupType("transit_realtime.FeedMessage");
  }

  function prepareStaticData() {
    const routeTemplates = [];
    const routeTemplatesByRouteId = new Map();
    const routeStops = new Map();
    const stopRouteIdsByStopId = new Map();
    const routeOverviewMap = new Map();
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let featureId = 1;

    for (const [shapeId, points] of Object.entries(state.gtfs.shapes || {})) {
      const routeId = state.gtfs.shapeRouteIndex?.[shapeId];
      const route = state.gtfs.routesByGtfsRouteId?.[routeId];
      if (!route || !points || points.length < 2) {
        continue;
      }

      const coordinates = [];
      for (const point of points) {
        const lat = Number(point[0]);
        const lon = Number(point[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          continue;
        }
        coordinates.push([lon, lat]);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
      }
      if (coordinates.length < 2) {
        continue;
      }

      const width = routeStrokeWidth(route.shortName || route.longName);
      const template = {
        id: featureId,
        type: "Feature",
        properties: {
          featureId,
          shapeId,
          routeId,
          routeShortName: route.shortName || "",
          routeLongName: route.longName || "",
          routeColor: route.color || "#d9d1c3",
          baseWidth: width,
          pathLength: pathLengthMeters(coordinates),
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      };
      routeTemplates.push(template);
      const routeKey = String(route.shortName || route.gtfsRouteId || "").trim() || String(route.gtfsRouteId || "").trim();
      const overviewCoordinates = stylizeOverviewCoordinates(coordinates);
      const overviewCandidate = {
        ...template,
        id: `overview-${featureId}`,
        properties: {
          ...template.properties,
          routeKey,
          overviewOverlapCoordinates: coordinates,
        },
        geometry: {
          type: "LineString",
          coordinates: overviewCoordinates,
        },
      };
      const existingOverview = routeOverviewMap.get(routeKey);
      if (!existingOverview || overviewTemplateScore(overviewCandidate) > overviewTemplateScore(existingOverview)) {
        routeOverviewMap.set(routeKey, overviewCandidate);
      }
      if (!routeTemplatesByRouteId.has(routeId)) {
        routeTemplatesByRouteId.set(routeId, []);
      }
      routeTemplatesByRouteId.get(routeId).push(template);
      featureId += 1;
    }

    for (const [stopId, routeIds] of Object.entries(state.gtfs.stopRouteIdsByStopId || {})) {
      const stopMeta = state.gtfs.stopsById?.[stopId];
      if (!stopMeta || !Array.isArray(routeIds) || !routeIds.length) {
        continue;
      }
      stopRouteIdsByStopId.set(stopId, new Set(routeIds));
      const feature = makeStopFeature(stopId, stopMeta, routeIds);
      for (const routeId of routeIds) {
        if (!routeStops.has(routeId)) {
          routeStops.set(routeId, new Map());
        }
        routeStops.get(routeId).set(stopId, feature);
      }
    }

    if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) {
      throw new Error("GTFS shape cache is empty.");
    }

    const overviewTemplatesWithOffsets = assignOverviewOffsets([...routeOverviewMap.values()]);
    state.routeTemplates = routeTemplates;
    state.routeOverviewTemplates = overviewTemplatesWithOffsets;
    state.routeTemplatesByRouteId = routeTemplatesByRouteId;
    state.routeStops = new Map(
      [...routeStops.entries()].map(([routeId, stops]) => [routeId, [...stops.values()]])
    );
    state.stopRouteIdsByStopId = new Map(
      [...stopRouteIdsByStopId.entries()].map(([stopId, routeIds]) => [stopId, [...routeIds].sort()])
    );
    state.stopFeaturesById = new Map(
      [...state.stopRouteIdsByStopId.keys()].map((stopId) => [
        stopId,
        makeStopFeature(stopId, state.gtfs.stopsById?.[stopId], state.stopRouteIdsByStopId.get(stopId) || []),
      ])
    );
    state.allStopFeatures = [...state.stopFeaturesById.values()];
    state.networkBounds = [
      [minLon, minLat],
      [maxLon, maxLat],
    ];
  }

  function assignOverviewOffsets(templates) {
    const normalized = templates.map((template) => ({
      ...template,
      properties: {
        ...template.properties,
        lineOffset: 0,
      },
    }));
    const segmentOwners = new Map();
    const segmentsById = new Map();

    for (const template of normalized) {
      const segmentKeys = routeSegmentKeys(template.properties?.overviewOverlapCoordinates || template.geometry?.coordinates || []);
      segmentsById.set(template.id, segmentKeys);
      for (const key of segmentKeys) {
        if (!segmentOwners.has(key)) {
          segmentOwners.set(key, []);
        }
        segmentOwners.get(key).push(template.id);
      }
    }

    const adjacency = new Map(normalized.map((template) => [template.id, new Set()]));
    const overlapCounts = new Map();

    for (const owners of segmentOwners.values()) {
      if (owners.length < 2) {
        continue;
      }
      for (let index = 0; index < owners.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < owners.length; otherIndex += 1) {
          const left = owners[index];
          const right = owners[otherIndex];
          const pairKey = left < right ? `${left}::${right}` : `${right}::${left}`;
          overlapCounts.set(pairKey, (overlapCounts.get(pairKey) || 0) + 1);
        }
      }
    }

    for (const [pairKey, overlap] of overlapCounts.entries()) {
      const [left, right] = pairKey.split("::");
      const leftSegments = segmentsById.get(left)?.length || 0;
      const rightSegments = segmentsById.get(right)?.length || 0;
      const ratio = overlap / Math.max(1, Math.min(leftSegments, rightSegments));
      if (overlap < 2 || ratio < 0.08) {
        continue;
      }
      adjacency.get(left)?.add(right);
      adjacency.get(right)?.add(left);
    }

    const byId = new Map(normalized.map((template) => [template.id, template]));
    const seen = new Set();

    for (const template of normalized) {
      if (seen.has(template.id)) {
        continue;
      }
      const stack = [template.id];
      const component = [];
      while (stack.length) {
        const current = stack.pop();
        if (!current || seen.has(current)) {
          continue;
        }
        seen.add(current);
        component.push(current);
        for (const neighbor of adjacency.get(current) || []) {
          if (!seen.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }

      if (component.length < 2) {
        continue;
      }

      const ordered = component
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((left, right) => {
          const leftKey = `${left.properties.routeShortName || left.properties.routeLongName || left.properties.routeId}`;
          const rightKey = `${right.properties.routeShortName || right.properties.routeLongName || right.properties.routeId}`;
          return leftKey.localeCompare(rightKey, undefined, { numeric: true, sensitivity: "base" });
        });

      const offsets = symmetricOffsets(ordered.length, 2.3);
      ordered.forEach((item, index) => {
        item.properties.lineOffset = offsets[index];
      });
    }

    return normalized;
  }

  function routeSegmentKeys(coordinates) {
    const keys = [];
    const step = coordinates.length > 90 ? 4 : coordinates.length > 44 ? 3 : 2;
    for (let index = 0; index < coordinates.length - 1; index += step) {
      const start = coordinates[index];
      const end = coordinates[Math.min(index + step, coordinates.length - 1)];
      if (!Array.isArray(start) || !Array.isArray(end)) {
        continue;
      }
      const key = normalizedSegmentKey(start, end);
      if (key) {
        keys.push(key);
      }
    }
    return [...new Set(keys)];
  }

  function normalizedSegmentKey(start, end) {
    const a = `${Number(start[0]).toFixed(3)},${Number(start[1]).toFixed(3)}`;
    const b = `${Number(end[0]).toFixed(3)},${Number(end[1]).toFixed(3)}`;
    if (!a || !b || a === b) {
      return "";
    }
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function symmetricOffsets(count, spacing) {
    if (count <= 1) {
      return [0];
    }
    const center = (count - 1) / 2;
    return Array.from({ length: count }, (_, index) => Number(((index - center) * spacing).toFixed(2)));
  }

  function overviewTemplateScore(template) {
    const routeShortName = String(template?.properties?.routeShortName || "");
    const pathLength = Number(template?.properties?.pathLength || 0);
    const coordinateCount = Array.isArray(template?.geometry?.coordinates) ? template.geometry.coordinates.length : 0;
    const expressBias = /airbus|silver|express/i.test(routeShortName) ? 0.96 : 1;
    return pathLength * expressBias + coordinateCount * 28;
  }

  function pathLengthMeters(coordinates) {
    let total = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
      const prev = coordinates[index - 1];
      const current = coordinates[index];
      total += haversineMeters(prev[1], prev[0], current[1], current[0]);
    }
    return total;
  }

  function stylizeOverviewCoordinates(coordinates) {
    const simplified = simplifyOverviewPolyline(coordinates, OVERVIEW_SIMPLIFY_TOLERANCE_METERS);
    const smoothed = chaikinSmoothPolyline(simplified, OVERVIEW_SMOOTHING_PASSES);
    const thinned = thinPolylineByDistance(smoothed, OVERVIEW_MIN_POINT_SPACING_METERS);
    return thinned.length >= 2 ? thinned : coordinates;
  }

  function simplifyOverviewPolyline(coordinates, toleranceMeters) {
    if (!Array.isArray(coordinates) || coordinates.length <= 2) {
      return coordinates;
    }
    const keep = new Array(coordinates.length).fill(false);
    keep[0] = true;
    keep[coordinates.length - 1] = true;
    simplifyOverviewSegment(coordinates, 0, coordinates.length - 1, toleranceMeters * toleranceMeters, keep);
    return coordinates.filter((_, index) => keep[index]);
  }

  function simplifyOverviewSegment(coordinates, startIndex, endIndex, toleranceSq, keep) {
    if (endIndex - startIndex <= 1) {
      return;
    }
    let maxDistanceSq = 0;
    let maxIndex = -1;
    const start = coordinates[startIndex];
    const end = coordinates[endIndex];
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distanceSq = perpendicularDistanceSqMeters(coordinates[index], start, end);
      if (distanceSq > maxDistanceSq) {
        maxDistanceSq = distanceSq;
        maxIndex = index;
      }
    }
    if (maxIndex !== -1 && maxDistanceSq > toleranceSq) {
      keep[maxIndex] = true;
      simplifyOverviewSegment(coordinates, startIndex, maxIndex, toleranceSq, keep);
      simplifyOverviewSegment(coordinates, maxIndex, endIndex, toleranceSq, keep);
    }
  }

  function perpendicularDistanceSqMeters(point, start, end) {
    const refLat = (((point[1] + start[1] + end[1]) / 3) * Math.PI) / 180;
    const scaleX = 111320 * Math.cos(refLat);
    const scaleY = 110540;
    const sx = start[0] * scaleX;
    const sy = start[1] * scaleY;
    const ex = end[0] * scaleX;
    const ey = end[1] * scaleY;
    const px = point[0] * scaleX;
    const py = point[1] * scaleY;
    const dx = ex - sx;
    const dy = ey - sy;
    if (Math.abs(dx) < 0.00001 && Math.abs(dy) < 0.00001) {
      const qx = px - sx;
      const qy = py - sy;
      return qx * qx + qy * qy;
    }
    const t = clamp(((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy), 0, 1);
    const projX = sx + t * dx;
    const projY = sy + t * dy;
    const distX = px - projX;
    const distY = py - projY;
    return distX * distX + distY * distY;
  }

  function chaikinSmoothPolyline(coordinates, passes) {
    let current = Array.isArray(coordinates) ? coordinates.slice() : [];
    for (let pass = 0; pass < passes; pass += 1) {
      if (current.length <= 2) {
        return current;
      }
      const next = [current[0]];
      for (let index = 0; index < current.length - 1; index += 1) {
        const start = current[index];
        const end = current[index + 1];
        const q = [lerp(start[0], end[0], 0.25), lerp(start[1], end[1], 0.25)];
        const r = [lerp(start[0], end[0], 0.75), lerp(start[1], end[1], 0.75)];
        next.push(q, r);
      }
      next.push(current[current.length - 1]);
      current = next;
    }
    return current;
  }

  function thinPolylineByDistance(coordinates, minDistanceMeters) {
    if (!Array.isArray(coordinates) || coordinates.length <= 2) {
      return coordinates;
    }
    const thinned = [coordinates[0]];
    let anchor = coordinates[0];
    for (let index = 1; index < coordinates.length - 1; index += 1) {
      const point = coordinates[index];
      const distance = haversineMeters(anchor[1], anchor[0], point[1], point[0]);
      if (distance >= minDistanceMeters) {
        thinned.push(point);
        anchor = point;
      }
    }
    thinned.push(coordinates[coordinates.length - 1]);
    return dedupeConsecutiveCoordinates(thinned);
  }

  function renderRouteLegend() {
    const grouped = new Map();
    for (const route of Object.values(state.gtfs.routesByGtfsRouteId || {})) {
      const key = String(route.shortName || route.gtfsRouteId || "").trim() || String(route.gtfsRouteId || "").trim();
      if (!key) {
        continue;
      }
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: key,
          color: route.color || "#d9d1c3",
          routeIds: [],
          flags: new Set(),
        });
      }
      const entry = grouped.get(key);
      entry.routeIds.push(route.gtfsRouteId);
      const flags = routeLegendFlags(route);
      for (const flag of flags) {
        entry.flags.add(flag);
      }
      if (!entry.color && route.color) {
        entry.color = route.color;
      }
    }
    state.routeLegendEntries = [...grouped.values()]
      .map((entry) => ({
        ...entry,
        routeIds: [...new Set(entry.routeIds)],
        flags: [...entry.flags],
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));

    dom.routeLegendList.innerHTML = state.routeLegendEntries
      .map((entry) => {
        const flagsMarkup = entry.flags.length
          ? `<span class="route-legend-flags">${entry.flags
              .map((flag) => `<span class="route-legend-flag" title="${escapeAttr(flag.label)}"><span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(flag.icon)}</span></span>`)
              .join("")}</span>`
          : "";
        return `<button class="route-legend-item" type="button" data-route-legend-key="${escapeAttr(
          entry.key
        )}" aria-pressed="false"><span class="route-legend-swatch" style="background:${escapeAttr(
          entry.color || "#d9d1c3"
        )}"></span><span class="route-legend-copy"><span class="route-legend-title">${escapeHtml(
          entry.label
        )}</span></span>${flagsMarkup}</button>`;
      })
      .join("");
    syncRouteLegendSelection();
  }

  function makeStopFeature(stopId, stopMeta, routeIds) {
    const lat = Number(stopMeta?.location?.[0]);
    const lon = Number(stopMeta?.location?.[1]);
    return {
      type: "Feature",
      properties: {
        stopId,
        stopName: stopMeta?.displayName || stopMeta?.name || stopId,
        routeIds: Array.isArray(routeIds) ? routeIds.join("|") : "",
      },
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
    };
  }

  async function initializeMap() {
    if (typeof maplibregl === "undefined") {
      throw new Error("MapLibre failed to load.");
    }

    state.map = new maplibregl.Map({
      container: dom.map,
      style: buildStyle(),
      attributionControl: false,
      antialias: true,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
      renderWorldCopies: false,
      maxPitch: 0,
      bounds: padBounds(state.networkBounds, 0.06),
      fitBoundsOptions: {
        padding: 28,
        duration: 0,
      },
    });

    state.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      "bottom-right"
    );

    return new Promise((resolve, reject) => {
      let resolved = false;

      state.map.once("load", () => {
        try {
          configureMapCamera();
          addStaticLayers();
          bindMapEvents();
          syncRouteData();
          syncStopVisibility();
          syncPlannerRegionVisuals();
          syncPlannerHud();
          syncBasemapTheme();
          syncZoomSlider();
          resolved = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      state.map.once("error", (event) => {
        if (!resolved && event?.error) {
          reject(event.error);
        }
      });
    });
  }

  function buildStyle() {
    return {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: [state.config.tileUrl],
          tileSize: 256,
          attribution: state.config.tileAttribution,
          maxzoom: Number(state.config.tileMaxZoom) || 19,
        },
      },
      layers: [
        {
          id: "basemap",
          type: "raster",
          source: "basemap",
          paint: rasterPaintForTheme(dom.body.dataset.theme),
        },
      ],
    };
  }

  function configureMapCamera() {
    const paddedBounds = padBounds(state.networkBounds, NETWORK_PAD_RATIO);
    state.map.setMaxBounds(paddedBounds);
    state.map.fitBounds(padBounds(state.networkBounds, 0.05), { padding: 28, duration: 0 });
    state.initialZoom = state.map.getZoom();
    state.map.setMinZoom(state.initialZoom);
    state.map.setMaxZoom(state.initialZoom + EXTRA_MAX_ZOOM);
    if (state.map.touchZoomRotate && typeof state.map.touchZoomRotate.disableRotation === "function") {
      state.map.touchZoomRotate.disableRotation();
    }
  }

  function addStaticLayers() {
    state.map.addSource(ROUTE_BASE_SOURCE_ID, {
      type: "geojson",
      data: featureCollection([]),
      lineMetrics: true,
    });
    state.map.addSource(ROUTE_FOCUS_SOURCE_ID, {
      type: "geojson",
      data: featureCollection([]),
      lineMetrics: true,
    });
    state.map.addSource(ALL_STOPS_SOURCE_ID, {
      type: "geojson",
      data: featureCollection(state.allStopFeatures),
    });
    state.map.addSource(SELECTED_STOPS_SOURCE_ID, {
      type: "geojson",
      data: featureCollection([]),
    });
    state.map.addSource(PLANNER_REGIONS_SOURCE_ID, {
      type: "geojson",
      data: featureCollection([]),
    });
    state.map.addSource(PLANNER_REGION_STOPS_SOURCE_ID, {
      type: "geojson",
      data: featureCollection([]),
    });
    state.map.addSource(OCCUPANCY_HEAT_SOURCE_ID, {
      type: "geojson",
      data: featureCollection([]),
    });

    state.map.addLayer({
      id: PLANNER_REGIONS_FILL_LAYER_ID,
      type: "fill",
      source: PLANNER_REGIONS_SOURCE_ID,
      paint: {
        "fill-color": [
          "match",
          ["get", "role"],
          "from",
          "#6ca97a",
          "to",
          "#c96c92",
          "#d7d0bf",
        ],
        "fill-opacity": 0.11,
      },
    });
    state.map.addLayer({
      id: PLANNER_REGIONS_LINE_LAYER_ID,
      type: "line",
      source: PLANNER_REGIONS_SOURCE_ID,
      paint: {
        "line-color": [
          "match",
          ["get", "role"],
          "from",
          "#6ca97a",
          "to",
          "#c96c92",
          "#d7d0bf",
        ],
        "line-width": 1.45,
        "line-opacity": 0.82,
      },
    });
    state.map.addLayer({
      id: PLANNER_REGION_STOPS_LAYER_ID,
      type: "circle",
      source: PLANNER_REGION_STOPS_SOURCE_ID,
      paint: {
        "circle-radius": 4.1,
        "circle-color": [
          "match",
          ["get", "role"],
          "from",
          "#6ca97a",
          "to",
          "#c96c92",
          "#ffffff",
        ],
        "circle-stroke-color": "#111111",
        "circle-stroke-width": 1,
        "circle-opacity": 0.92,
      },
    });
    state.map.addLayer({
      id: OCCUPANCY_HEAT_GREEN_LAYER_ID,
      type: "circle",
      source: OCCUPANCY_HEAT_SOURCE_ID,
      filter: ["<", ["coalesce", ["get", "score"], 0], 0],
      paint: occupancyHeatPaint("green"),
    });
    state.map.addLayer({
      id: OCCUPANCY_HEAT_PINK_LAYER_ID,
      type: "circle",
      source: OCCUPANCY_HEAT_SOURCE_ID,
      filter: [">", ["coalesce", ["get", "score"], 0], 0],
      paint: occupancyHeatPaint("pink"),
    });
    state.map.addLayer({
      id: ROUTE_BASE_UNDERLAY_LAYER_ID,
      type: "line",
      source: ROUTE_BASE_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#111111",
        "line-width": ["coalesce", ["get", "outlineWidth"], 3.8],
        "line-offset": ["coalesce", ["get", "lineOffset"], 0],
        "line-opacity": ["coalesce", ["get", "outlineOpacity"], 0],
      },
    });
    state.map.addLayer({
      id: ROUTE_BASE_LINE_LAYER_ID,
      type: "line",
      source: ROUTE_BASE_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": ["coalesce", ["get", "routeColor"], "#d9d1c3"],
        "line-offset": ["coalesce", ["get", "lineOffset"], 0],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          state.initialZoom,
          ["*", ["coalesce", ["get", "lineWidth"], 3], 1],
          state.initialZoom + 1.2,
          ["*", ["coalesce", ["get", "lineWidth"], 3], 1.18],
          state.initialZoom + 2.2,
          ["*", ["coalesce", ["get", "lineWidth"], 3], 1.4],
          state.initialZoom + 3.4,
          ["*", ["coalesce", ["get", "lineWidth"], 3], 1.72],
        ],
        "line-opacity": ["coalesce", ["get", "lineOpacity"], 0.95],
      },
    });
    state.map.addLayer({
      id: ROUTE_BASE_HITBOX_LAYER_ID,
      type: "line",
      source: ROUTE_BASE_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#000000",
        "line-width": ["+", ["coalesce", ["get", "lineWidth"], 3], 10],
        "line-opacity": 0,
      },
    });
    state.map.addLayer({
      id: ROUTE_FOCUS_UNDERLAY_LAYER_ID,
      type: "line",
      source: ROUTE_FOCUS_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#111111",
        "line-width": ["coalesce", ["get", "outlineWidth"], 4.8],
        "line-offset": ["coalesce", ["get", "lineOffset"], 0],
        "line-opacity": ["coalesce", ["get", "outlineOpacity"], 0],
      },
    });
    state.map.addLayer({
      id: ROUTE_FOCUS_LINE_LAYER_ID,
      type: "line",
      source: ROUTE_FOCUS_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": ["coalesce", ["get", "routeColor"], "#d9d1c3"],
        "line-offset": ["coalesce", ["get", "lineOffset"], 0],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          state.initialZoom,
          ["*", ["coalesce", ["get", "lineWidth"], 3.3], 1.04],
          state.initialZoom + 1.2,
          ["*", ["coalesce", ["get", "lineWidth"], 3.3], 1.24],
          state.initialZoom + 2.2,
          ["*", ["coalesce", ["get", "lineWidth"], 3.3], 1.5],
          state.initialZoom + 3.4,
          ["*", ["coalesce", ["get", "lineWidth"], 3.3], 1.82],
        ],
        "line-opacity": ["coalesce", ["get", "lineOpacity"], 1],
      },
    });
    state.map.addLayer({
      id: ROUTE_FOCUS_HITBOX_LAYER_ID,
      type: "line",
      source: ROUTE_FOCUS_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#000000",
        "line-width": ["+", ["coalesce", ["get", "lineWidth"], 3.3], 10],
        "line-opacity": 0,
      },
    });
    state.map.addLayer({
      id: ALL_STOPS_LAYER_ID,
      type: "circle",
      source: ALL_STOPS_SOURCE_ID,
      minzoom: ALL_STOPS_MIN_ZOOM,
      paint: {
        "circle-radius": 8.1,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#111111",
        "circle-stroke-width": 4.6,
        "circle-opacity": 1,
      },
    });
    state.map.addLayer({
      id: SELECTED_STOPS_LAYER_ID,
      type: "circle",
      source: SELECTED_STOPS_SOURCE_ID,
      paint: {
        "circle-radius": 8.55,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#111111",
        "circle-stroke-width": 5,
        "circle-opacity": 1,
      },
    });
  }

  function bindMapEvents() {
    state.map.getCanvasContainer().addEventListener("mousedown", onPlannerPointerDown);
    state.map.on("click", (event) => {
      if (Date.now() < state.plannerSuppressMapClickUntil || state.plannerSelectionMode) {
        return;
      }
      const stopFeature = queryStopAtPoint(event.point);
      if (stopFeature) {
        openStopPanel(String(stopFeature.properties?.stopId || "").trim());
        return;
      }
      const feature = queryRouteAtPoint(event.point);
      if (feature && state.selectedBusId) {
        closeBusPanel();
      }
      if (!feature) {
        closeBusPanel();
      }
      setSelectedRoute(feature?.properties?.routeId || "");
    });
    state.map.on("mousemove", (event) => {
      if (state.plannerSelectionMode || state.plannerSelectionDrag) {
        state.map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const stopFeature = queryStopAtPoint(event.point);
      const feature = stopFeature || queryRouteAtPoint(event.point);
      state.map.getCanvas().style.cursor = feature ? "pointer" : "";
    });
    state.map.on("zoom", () => {
      syncZoomSlider();
      syncBusStyles();
    });
    state.map.on("zoomend", syncStopVisibility);
    state.map.on("moveend", syncZoomSlider);
    state.map.on("styledata", syncBasemapTheme);
  }

  function queryRouteAtPoint(point) {
    const features = state.map.queryRenderedFeatures(point, {
      layers: [ROUTE_FOCUS_HITBOX_LAYER_ID, ROUTE_BASE_HITBOX_LAYER_ID],
    });
    return features[0] || null;
  }

  function queryStopAtPoint(point) {
    const features = state.map.queryRenderedFeatures(point, {
      layers: [SELECTED_STOPS_LAYER_ID, ALL_STOPS_LAYER_ID],
    });
    return features[0] || null;
  }

  function zoomBy(delta) {
    if (!state.map) {
      return;
    }
    state.map.easeTo({
      zoom: clampZoom(state.map.getZoom() + delta),
      duration: 260,
      easing: easeOutCubic,
      essential: true,
    });
  }

  function onZoomSliderInput() {
    if (!state.map) {
      return;
    }
    state.map.jumpTo({ zoom: sliderValueToZoom(Number(dom.zoomSlider.value)) });
  }

  function onZoomSliderCommit() {
    if (!state.map) {
      return;
    }
    state.map.easeTo({
      zoom: sliderValueToZoom(Number(dom.zoomSlider.value)),
      duration: 180,
      easing: easeOutCubic,
      essential: true,
    });
  }

  function sliderValueToZoom(value) {
    const ratio = clamp(value / ZOOM_SLIDER_STEPS, 0, 1);
    return state.map.getMinZoom() + (state.map.getMaxZoom() - state.map.getMinZoom()) * ratio;
  }

  function zoomToSliderValue(zoom) {
    const min = state.map.getMinZoom();
    const max = state.map.getMaxZoom();
    if (max <= min) {
      return 0;
    }
    return Math.round(clamp((zoom - min) / (max - min), 0, 1) * ZOOM_SLIDER_STEPS);
  }

  function syncZoomSlider() {
    if (!state.map) {
      return;
    }
    dom.zoomSlider.value = String(zoomToSliderValue(state.map.getZoom()));
  }

  function clampZoom(zoom) {
    return clamp(zoom, state.map.getMinZoom(), state.map.getMaxZoom());
  }

  function syncRouteData() {
    const focusedRouteIds = getFocusedRouteIds();
    const baseFeatures = [];
    const focusFeatures = [];
    const hasSelection = focusedRouteIds.size > 0;
    const plannerIsolation = plannerIsolationActive();
    const darkMode = dom.body.dataset.theme === "dark";

    if (plannerIsolation) {
      const candidate = currentPlannerCandidate();
      const segmentFeatures = candidate ? buildPlannerJourneyFeatures(candidate) : [];
      getGeoJsonSource(ROUTE_BASE_SOURCE_ID).setData(featureCollection([]));
      getGeoJsonSource(ROUTE_FOCUS_SOURCE_ID).setData(featureCollection(segmentFeatures));
      renderOccupancyHeatmap();
      return;
    }

    const templates = state.routeTemplates;

    for (const template of templates) {
      const routeId = template.properties.routeId;
      const baseWidth = template.properties.baseWidth;

      if (!hasSelection) {
        baseFeatures.push(cloneFeature(template, {
          lineWidth: baseWidth,
          outlineWidth: baseWidth + 2.2,
          lineOffset: template.properties.lineOffset || 0,
          lineOpacity: darkMode ? 0.66 : 0.96,
          outlineOpacity: state.showRouteBorders ? (darkMode ? 0.78 : 1) : 0,
        }));
        continue;
      }

      if (focusedRouteIds.has(routeId)) {
        focusFeatures.push(cloneFeature(template, {
          lineWidth: baseWidth + 0.45,
          outlineWidth: baseWidth + 2.8,
          lineOffset: 0,
          lineOpacity: darkMode ? 0.8 : 1,
          outlineOpacity: state.showRouteBorders ? (darkMode ? 0.84 : 1) : 0,
        }));
      } else {
        baseFeatures.push(cloneFeature(template, {
          lineWidth: Math.max(1.8, baseWidth - 0.15),
          outlineWidth: Math.max(3.4, baseWidth + 1.9),
          lineOffset: 0,
          lineOpacity: plannerIsolation
            ? 0
            : state.selectedBusId || state.selectedStopId || state.selectedRouteId || state.selectedRouteLegendKey
              ? 0.03
              : darkMode
                ? 0.08
                : 0.1,
          outlineOpacity: state.showRouteBorders
            ? (plannerIsolation
              ? 0
              : state.selectedBusId || state.selectedStopId || state.selectedRouteId || state.selectedRouteLegendKey
                ? 0.05
                : darkMode
                  ? 0.12
                  : 0.16)
            : 0,
        }));
      }
    }

    getGeoJsonSource(ROUTE_BASE_SOURCE_ID).setData(featureCollection(baseFeatures));
    getGeoJsonSource(ROUTE_FOCUS_SOURCE_ID).setData(featureCollection(focusFeatures));
    renderOccupancyHeatmap();
  }

  function syncStopVisibility() {
    if (!state.map) {
      return;
    }

    const plannerIsolation = plannerIsolationActive();
    const focusedRouteIds = getFocusedRouteIds();
    const zoom = state.map.getZoom();
    const showFocusedRouteStops = focusedRouteIds.size > 0 && !state.selectedStopId && zoom >= FOCUSED_ROUTE_STOPS_MIN_ZOOM;
    const showPlannerRouteStops = plannerIsolation && zoom >= PLANNER_ROUTE_STOPS_MIN_ZOOM;
    const hasRouteSelection = Boolean(
      !state.selectedBusId &&
      !state.selectedStopId &&
      (state.selectedRouteId || state.selectedRouteLegendKey)
    );
    const hasSelection = Boolean(state.selectedStopId) || showFocusedRouteStops || hasRouteSelection || plannerIsolation;
    let selectedStops = [];
    if (plannerIsolation && showPlannerRouteStops) {
      selectedStops = plannerJourneyStopFeatures();
    } else if (plannerIsolation) {
      selectedStops = [];
    } else if (state.selectedStopId) {
      const feature = state.stopFeaturesById.get(state.selectedStopId);
      selectedStops = feature ? [feature] : [];
    } else if (showFocusedRouteStops) {
      const stopMap = new Map();
      for (const routeId of focusedRouteIds) {
        for (const feature of state.routeStops.get(routeId) || []) {
          stopMap.set(feature.properties?.stopId || JSON.stringify(feature.geometry.coordinates), feature);
        }
      }
      selectedStops = [...stopMap.values()];
    }
    getGeoJsonSource(SELECTED_STOPS_SOURCE_ID).setData(featureCollection(selectedStops));
    state.map.setLayoutProperty(SELECTED_STOPS_LAYER_ID, "visibility", hasSelection ? "visible" : "none");
    state.map.setLayoutProperty(
      ALL_STOPS_LAYER_ID,
      "visibility",
      !hasSelection && zoom >= ALL_STOPS_MIN_ZOOM ? "visible" : "none"
    );
  }

  function cloneFeature(feature, extraProperties) {
    return {
      id: feature.id,
      type: feature.type,
      properties: { ...feature.properties, ...extraProperties },
      geometry: feature.geometry,
    };
  }

  function openKeyPanel(open) {
    dom.keyPanel.hidden = !open;
    if (open) {
      requestAnimationFrame(() => dom.apiKeyInput.focus());
    }
  }

  function saveApiKey() {
    const nextKey = dom.apiKeyInput.value.trim();
    if (!nextKey) {
      return;
    }
    state.runtimeApiKey = nextKey;
    window.localStorage.setItem(STORAGE_KEYS.apiKey, nextKey);
    openKeyPanel(false);
    hideOverlay();
    startPolling(true);
  }

  function clearApiKey() {
    state.runtimeApiKey = "";
    window.localStorage.removeItem(STORAGE_KEYS.apiKey);
    stopPolling();
    clearBusMarkers();
    closeBusPanel();
    showOverlay("Awaiting API key", "Set API_KEY in .env or enter it here.");
    updateStatus("Awaiting API key", "Live feed disabled");
    openKeyPanel(true);
  }

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    dom.body.dataset.theme = nextTheme;
    window.localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
    if (dom.themeMeta) {
      dom.themeMeta.setAttribute("content", nextTheme === "dark" ? "#000000" : "#f1efe6");
    }
    syncThemeToggle();
    syncBasemapTheme();
    if (state.map) {
      syncRouteData();
      syncStopVisibility();
      syncBusStyles();
      syncOccupancyHeatLayerTheme();
    }
  }

  function syncBasemapTheme() {
    if (!state.map || !state.map.getLayer("basemap")) {
      return;
    }
    const paint = rasterPaintForTheme(dom.body.dataset.theme);
    for (const [key, value] of Object.entries(paint)) {
      state.map.setPaintProperty("basemap", key, value);
    }
    syncOccupancyHeatLayerTheme();
  }

  function rasterPaintForTheme(theme) {
    if (theme === "dark") {
      return {
        "raster-opacity": 0.56,
        "raster-saturation": -1,
        "raster-contrast": -0.34,
        "raster-brightness-min": 0.015,
        "raster-brightness-max": 0.34,
      };
    }
    return {
      "raster-opacity": 0.64,
      "raster-saturation": -1,
      "raster-contrast": -0.12,
      "raster-brightness-min": 0.22,
      "raster-brightness-max": 0.98,
    };
  }

  function startPolling(immediate) {
    stopPolling();
    if (!canUseLiveRestApi()) {
      return;
    }
    if (!state.vehicleMetaLoaded) {
      ensureVehicleMetadata().catch(() => { });
    }
    if (immediate) {
      refreshVehicles(false);
      return;
    }
    state.refreshTimer = window.setTimeout(() => refreshVehicles(false), state.refreshIntervalMs);
  }

  function stopPolling() {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  async function refreshVehicles(manual) {
    if (!canUseLiveRestApi()) {
      return;
    }
    if (document.visibilityState !== "visible" && !manual) {
      return;
    }
    if (state.refreshing) {
      state.queuedRefresh = true;
      return;
    }

    state.refreshing = true;
    stopPolling();
    dom.refreshButton.disabled = true;

    try {
      const [payload, vehiclePositions] = await Promise.all([
        fetchLive("/vehicles/locations"),
        fetchGtfsRtVehiclePositions(),
      ]);
      state.vehiclePositionsById = vehiclePositions;
      const vehicles = (Array.isArray(payload) ? payload : [])
        .map(normalizeVehicle)
        .filter((vehicle) => vehicle.location && vehicle.tripId && vehicle.route?.gtfsRouteId)
        .map(resolveVehicle)
        .map(attachVehiclePosition)
        .filter((vehicle) => vehicle.shapeId && state.gtfs.shapes?.[vehicle.shapeId])
        .filter((vehicle) => withinNetworkBounds(vehicle.location))
        .filter((vehicle) => withinRouteCorridor(vehicle))
        .filter(isFreshVehicle);
      const enrichedVehicles = attachDerivedTelemetry(vehicles);

      state.liveVehicles = enrichedVehicles;
      recordRouteAnalyticsHistory(enrichedVehicles);
      state.activeRouteCount = new Set(enrichedVehicles.map((vehicle) => vehicle.route.gtfsRouteId)).size;
      state.lastUpdatedLabel = new Intl.DateTimeFormat([], {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());

      syncOccupancyHeatmap(enrichedVehicles);
      applyVehicleSnapshot(enrichedVehicles);
      syncBusStyles();
      if (plannerRegionsReady() && !state.plannerLoading) {
        queuePlannerComputation();
      }
      refreshOpenBusPanel(false);
      hideOverlay();

      if (!state.selectedRouteId) {
        updateStatus(
          `${state.busMarkers.size} buses`,
          `${state.activeRouteCount} live lines • ${state.lastUpdatedLabel}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh vehicles.";
      updateStatus("Live request failed", "Check API key or network");
      if (!state.busMarkers.size) {
        showOverlay("Live request failed", message);
      }
    } finally {
      state.refreshing = false;
      dom.refreshButton.disabled = false;
      if (state.queuedRefresh) {
        state.queuedRefresh = false;
        refreshVehicles(manual);
      } else if (document.visibilityState === "visible") {
        state.refreshTimer = window.setTimeout(() => refreshVehicles(false), state.refreshIntervalMs);
      }
    }
  }

  async function fetchLive(path) {
    const headers = {
      Accept: "application/json",
    };
    if (usesDirectApi() && state.runtimeApiKey) {
      headers["X-ApiKey"] = state.runtimeApiKey;
    }
    const response = await fetch(`${resolveApiBase()}${path}`, {
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    const result = payload?.result ?? payload?.Result ?? payload;
    const errorMessage =
      payload?.error?.message ??
      payload?.error?.Message ??
      payload?.Error?.Message ??
      payload?.message ??
      "";
    if (!response.ok) {
      throw new Error(errorMessage || `HTTP ${response.status}`);
    }
    return result;
  }

  async function fetchGtfsRtVehiclePositions() {
    if (!state.gtfsRtFeedType) {
      return new Map();
    }
    try {
      const response = await fetch(GTFS_RT_VEHICLE_POSITIONS_URL, {
        headers: {
          Accept: "application/x-protobuf",
        },
      });
      if (!response.ok) {
        return new Map();
      }
      const buffer = await response.arrayBuffer();
      const message = state.gtfsRtFeedType.decode(new Uint8Array(buffer));
      const plain = state.gtfsRtFeedType.toObject(message, {
        longs: Number,
        enums: String,
        defaults: false,
      });
      return normalizeGtfsRtVehiclePositions(plain?.entity || []);
    } catch (error) {
      return new Map();
    }
  }

  function normalizeVehicle(raw) {
    return {
      id: String(raw.id || raw.vehicleId || raw.vehicle_id || "").trim(),
      tripId: String(raw.trip?.id || raw.tripId || raw.trip_id || "").trim(),
      route: normalizeRoute(raw.route || null),
      location: extractLocation(raw),
      updatedAt: String(raw.lastUpdated || raw.last_updated || "").trim(),
      headsign: String(raw.trip?.headsign || raw.headsign || "").trim(),
      direction: normalizeDirection(raw.trip?.direction || raw.direction || null),
    };
  }

  function normalizeGtfsRtVehiclePositions(entities) {
    const result = new Map();
    for (const entity of Array.isArray(entities) ? entities : []) {
      const vehicle = entity?.vehicle;
      const vehicleId = String(vehicle?.vehicle?.id || vehicle?.vehicle?.label || "").trim();
      if (!vehicleId) {
        continue;
      }
      result.set(vehicleId, {
        vehicleId,
        tripId: String(vehicle?.trip?.tripId || "").trim(),
        routeId: String(vehicle?.trip?.routeId || "").trim(),
        stopId: String(vehicle?.stopId || "").trim(),
        currentStopSequence: Number(vehicle?.currentStopSequence || 0) || 0,
        currentStatus: String(vehicle?.currentStatus || "").trim(),
        congestionLevel: String(vehicle?.congestionLevel || "").trim(),
        occupancyStatus: String(vehicle?.occupancyStatus || "").trim(),
        timestamp: Number(vehicle?.timestamp || 0) || 0,
        speed: Number(vehicle?.position?.speed || NaN),
        bearing: Number(vehicle?.position?.bearing || NaN),
      });
    }
    return result;
  }

  function normalizeDirection(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      id: raw.id ?? null,
      name: String(raw.name || "").trim(),
      shortName: String(raw.shortName || raw.short_name || "").trim(),
    };
  }

  function normalizeRoute(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      id: String(raw.id || "").trim(),
      gtfsRouteId: String(raw.gtfsRouteId || raw.gtfs_route_id || "").trim(),
      shortName: String(raw.shortName || raw.route_short_name || raw.number || "").trim(),
      longName: String(raw.longName || raw.route_long_name || "").trim(),
      color: normalizeColor(raw.color || raw.routeColor || raw.route_color),
      textColor: normalizeColor(raw.textColor || raw.routeTextColor || raw.route_text_color),
    };
  }

  function normalizeColor(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    return raw.startsWith("#") ? raw : `#${raw}`;
  }

  function extractLocation(raw) {
    const source = raw.location || raw.position || raw.coordinates || raw;
    const lat = Number(source?.latitude ?? source?.lat ?? raw.latitude ?? raw.lat ?? NaN);
    const lon = Number(source?.longitude ?? source?.lon ?? source?.lng ?? raw.longitude ?? raw.lon ?? raw.lng ?? NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return [lon, lat];
  }

  function resolveVehicle(vehicle) {
    const shapeId = state.gtfs.tripShapeIndex?.[vehicle.tripId] || "";
    const routeMeta = state.gtfs.routesByGtfsRouteId?.[vehicle.route?.gtfsRouteId || ""] || null;
    return {
      ...vehicle,
      shapeId,
      route: {
        id: vehicle.route?.id || routeMeta?.gtfsRouteId || shapeId,
        gtfsRouteId: vehicle.route?.gtfsRouteId || routeMeta?.gtfsRouteId || "",
        shortName: vehicle.route?.shortName || routeMeta?.shortName || "",
        longName: vehicle.route?.longName || routeMeta?.longName || "",
        color: vehicle.route?.color || routeMeta?.color || "#d9d1c3",
        textColor: vehicle.route?.textColor || routeMeta?.textColor || "#ffffff",
      },
    };
  }

  function attachVehiclePosition(vehicle) {
    return {
      ...vehicle,
      vehiclePosition: state.vehiclePositionsById.get(vehicle.id) || null,
    };
  }

  function attachDerivedTelemetry(vehicles) {
    const nextTelemetryByVehicleId = new Map();
    const now = Date.now();

    const enriched = vehicles.map((vehicle) => {
      const previous = state.previousTelemetryByVehicleId.get(vehicle.id) || null;
      const currentTimestamp = parseVehicleTimestamp(vehicle.updatedAt) || now;
      const rawLocation = vehicle.location;
      const derivedSpeedMph = deriveVehicleSpeedMph(vehicle, previous, currentTimestamp);
      const snapped = snapLocationToShape(rawLocation, vehicle.shapeId);
      nextTelemetryByVehicleId.set(vehicle.id, {
        location: rawLocation,
        timestamp: currentTimestamp,
      });
      return {
        ...vehicle,
        rawLocation,
        location: snapped.location,
        snapDistanceMeters: snapped.distance,
        shapeProgress: snapped.progress,
        derivedSpeedMph,
      };
    });

    state.previousTelemetryByVehicleId = nextTelemetryByVehicleId;
    return enriched;
  }

  function isFreshVehicle(vehicle) {
    if (!vehicle.updatedAt) {
      return true;
    }
    const updatedAt = new Date(vehicle.updatedAt).getTime();
    if (!Number.isFinite(updatedAt)) {
      return true;
    }
    return Date.now() - updatedAt <= LIVE_STALE_MAX_AGE_MS;
  }

  function withinNetworkBounds(location) {
    const [westSouth, eastNorth] = padBounds(state.networkBounds, 0.15);
    return (
      location[0] >= westSouth[0] &&
      location[0] <= eastNorth[0] &&
      location[1] >= westSouth[1] &&
      location[1] <= eastNorth[1]
    );
  }

  function withinRouteCorridor(vehicle) {
    const shape = state.gtfs.shapes?.[vehicle.shapeId];
    if (!shape || shape.length < 2) {
      return false;
    }
    const point = { lon: vehicle.location[0], lat: vehicle.location[1] };
    let best = Infinity;

    for (let index = 0; index < shape.length - 1; index += 1) {
      const start = { lat: shape[index][0], lon: shape[index][1] };
      const end = { lat: shape[index + 1][0], lon: shape[index + 1][1] };
      best = Math.min(best, pointToSegmentDistanceMeters(point, start, end));
      if (best <= ROUTE_CORRIDOR_MAX_METERS) {
        return true;
      }
    }

    return false;
  }

  function applyVehicleSnapshot(vehicles) {
    const nextById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

    for (const [id, markerState] of state.busMarkers.entries()) {
      if (!nextById.has(id)) {
        markerState.marker.remove();
        state.busMarkers.delete(id);
        if (state.selectedBusId === id) {
          closeBusPanel();
        }
      }
    }

    for (const vehicle of vehicles) {
      const existing = state.busMarkers.get(vehicle.id);
      if (!existing) {
        const marker = createBusMarker(vehicle);
        state.busMarkers.set(vehicle.id, {
          marker,
          current: vehicle.location,
          previous: vehicle.location,
          target: vehicle.location,
          currentProgress: vehicle.shapeProgress,
          previousProgress: vehicle.shapeProgress,
          targetProgress: vehicle.shapeProgress,
          shapeId: vehicle.shapeId,
          angle: inferVehicleAngleAtProgress(vehicle.shapeId, vehicle.shapeProgress),
          routeId: vehicle.route.gtfsRouteId,
          vehicle,
        });
        marker.addTo(state.map);
      } else {
        const shapeChanged = existing.shapeId !== vehicle.shapeId;
        existing.previous = existing.current;
        existing.previousProgress = shapeChanged ? vehicle.shapeProgress : existing.currentProgress;
        existing.target = vehicle.location;
        existing.targetProgress = vehicle.shapeProgress;
        existing.shapeId = vehicle.shapeId;
        existing.routeId = vehicle.route.gtfsRouteId;
        existing.angle = inferVehicleAngleAtProgress(vehicle.shapeId, vehicle.shapeProgress);
        existing.vehicle = vehicle;
        if (shapeChanged) {
          existing.previous = vehicle.location;
          existing.current = vehicle.location;
          existing.target = vehicle.location;
          existing.previousProgress = vehicle.shapeProgress;
          existing.currentProgress = vehicle.shapeProgress;
          existing.targetProgress = vehicle.shapeProgress;
        }
      }
    }

    startAnimationLoop();
  }

  function syncOccupancyHeatmap(vehicles) {
    const now = Date.now();
    const nextOccupancyByVehicleId = new Map();

    for (const vehicle of vehicles) {
      const currentStatus = canonicalOccupancyStatus(vehicle.vehiclePosition?.occupancyStatus);
      if (!currentStatus) {
        continue;
      }

      nextOccupancyByVehicleId.set(vehicle.id, currentStatus);
      const previousStatus = state.previousOccupancyByVehicleId.get(vehicle.id);
      if (!previousStatus || previousStatus === currentStatus) {
        continue;
      }

      const previousPressure = occupancyPressure(previousStatus);
      const currentPressure = occupancyPressure(currentStatus);
      if (!Number.isFinite(previousPressure) || !Number.isFinite(currentPressure) || previousPressure === currentPressure) {
        continue;
      }

      const anchor = resolveOccupancyHeatAnchor(vehicle);
      if (!anchor) {
        continue;
      }

      const delta = currentPressure - previousPressure;
      const signedScore = clamp(
        delta * OCCUPANCY_HEAT_EVENT_GAIN,
        -OCCUPANCY_HEAT_MAX_ABS_SCORE,
        OCCUPANCY_HEAT_MAX_ABS_SCORE
      );
      const existing = state.occupancyHeatByKey.get(anchor.key);
      const decayedScore = existing ? decayOccupancyHeatScore(existing.score, now - existing.updatedAt) : 0;
      state.occupancyHeatByKey.set(anchor.key, {
        key: anchor.key,
        routeId: anchor.routeId,
        stopId: anchor.stopId,
        label: anchor.label,
        location: anchor.location,
        score: clamp(decayedScore + signedScore, -OCCUPANCY_HEAT_MAX_ABS_SCORE, OCCUPANCY_HEAT_MAX_ABS_SCORE),
        updatedAt: now,
      });
    }

    state.previousOccupancyByVehicleId = nextOccupancyByVehicleId;
    persistAnalyticsCache();
    renderOccupancyHeatmap(now);
  }

  function renderOccupancyHeatmap(now = Date.now()) {
    if (!state.map || !state.map.getSource(OCCUPANCY_HEAT_SOURCE_ID)) {
      return;
    }
    if (!state.showOccupancyHeat) {
      getGeoJsonSource(OCCUPANCY_HEAT_SOURCE_ID).setData(featureCollection([]));
      return;
    }

    const focusedRouteIds = getFocusedRouteIds();
    const features = [];

    for (const [key, entry] of state.occupancyHeatByKey.entries()) {
      const score = decayOccupancyHeatScore(entry.score, now - entry.updatedAt);
      if (Math.abs(score) < OCCUPANCY_HEAT_MIN_VISIBLE_SCORE) {
        state.occupancyHeatByKey.delete(key);
        continue;
      }
      if (focusedRouteIds.size > 0 && entry.routeId && !focusedRouteIds.has(entry.routeId)) {
        continue;
      }
      features.push({
        type: "Feature",
        properties: {
          key,
          routeId: entry.routeId || "",
          stopId: entry.stopId || "",
          label: entry.label || "",
          score,
          magnitude: Math.abs(score),
        },
        geometry: {
          type: "Point",
          coordinates: entry.location,
        },
      });
    }

    getGeoJsonSource(OCCUPANCY_HEAT_SOURCE_ID).setData(featureCollection(features));
  }

  function clearOccupancyHeatmap() {
    state.previousOccupancyByVehicleId = new Map();
    state.occupancyHeatByKey = new Map();
    persistAnalyticsCache();
    if (state.map && state.map.getSource(OCCUPANCY_HEAT_SOURCE_ID)) {
      getGeoJsonSource(OCCUPANCY_HEAT_SOURCE_ID).setData(featureCollection([]));
    }
  }

  function resolveOccupancyHeatAnchor(vehicle) {
    const routeId = String(vehicle.route?.gtfsRouteId || "").trim();
    const stopId = String(vehicle.vehiclePosition?.stopId || "").trim();
    if (stopId) {
      const stopMeta = state.gtfs.stopsById?.[stopId];
      const lat = Number(stopMeta?.location?.[0]);
      const lon = Number(stopMeta?.location?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
          key: `${routeId}::stop::${stopId}`,
          routeId,
          stopId,
          label: stopMeta.displayName || stopMeta.name || stopId,
          location: [lon, lat],
        };
      }
    }

    const lon = Number(vehicle.location?.[0]);
    const lat = Number(vehicle.location?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }

    const snappedLon = Number(lon.toFixed(3));
    const snappedLat = Number(lat.toFixed(3));
    return {
      key: `${routeId}::cell::${snappedLat},${snappedLon}`,
      routeId,
      stopId: "",
      label: "Block occupancy change",
      location: [snappedLon, snappedLat],
    };
  }

  function decayOccupancyHeatScore(score, ageMs) {
    if (!Number.isFinite(score)) {
      return 0;
    }
    const age = Math.max(0, Number(ageMs) || 0);
    const decay = clamp(1 - age / OCCUPANCY_HEAT_DECAY_MS, 0, 1);
    return score * decay;
  }

  function occupancyHeatPaint(direction) {
    return {
      "circle-color": direction === "green" ? "#5f9870" : "#c95d86",
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "magnitude"], 0],
        0, 0,
        1, 24,
        2, 38,
        4, 58,
        6, 80,
        8, 98,
      ],
      "circle-opacity": occupancyHeatOpacityExpression(false),
      "circle-blur": 0.7,
      "circle-stroke-width": 0,
    };
  }

  function syncOccupancyHeatLayerTheme() {
    if (!state.map || !state.map.getLayer(OCCUPANCY_HEAT_PINK_LAYER_ID) || !state.map.getLayer(OCCUPANCY_HEAT_GREEN_LAYER_ID)) {
      return;
    }
    const darkMode = dom.body.dataset.theme === "dark";
    state.map.setPaintProperty(OCCUPANCY_HEAT_PINK_LAYER_ID, "circle-color", darkMode ? "#c14d7a" : "#c95d86");
    state.map.setPaintProperty(OCCUPANCY_HEAT_GREEN_LAYER_ID, "circle-color", darkMode ? "#4f8660" : "#5f9870");
    state.map.setPaintProperty(OCCUPANCY_HEAT_PINK_LAYER_ID, "circle-opacity", occupancyHeatOpacityExpression(darkMode));
    state.map.setPaintProperty(OCCUPANCY_HEAT_GREEN_LAYER_ID, "circle-opacity", occupancyHeatOpacityExpression(darkMode));
    state.map.setPaintProperty(OCCUPANCY_HEAT_PINK_LAYER_ID, "circle-blur", darkMode ? 0.74 : 0.7);
    state.map.setPaintProperty(OCCUPANCY_HEAT_GREEN_LAYER_ID, "circle-blur", darkMode ? 0.74 : 0.7);
  }

  function occupancyHeatOpacityExpression(darkMode) {
    return [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "magnitude"], 0],
      0, 0,
      1, darkMode ? 0.22 : 0.19,
      2, darkMode ? 0.32 : 0.28,
      4, darkMode ? 0.44 : 0.39,
      6, darkMode ? 0.56 : 0.49,
      8, darkMode ? 0.66 : 0.58,
    ];
  }

  function createBusMarker(vehicle) {
    const element = document.createElement("div");
    element.className = "bus-shell";
    const label = String(vehicle.route?.shortName || vehicle.id || "").trim();
    const labelColor = busMarkerLabelColor(vehicle.route?.color, vehicle.route?.textColor);
    element.innerHTML = `<div class="bus-marker" style="background:${escapeAttr(vehicle.route.color)};color:${escapeAttr(
      labelColor
    )}"><span class="bus-marker-label">${escapeHtml(label)}</span></div>`;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBusPanel(vehicle.id);
    });

    const marker = new maplibregl.Marker({
      element,
      anchor: "center",
      rotationAlignment: "map",
      pitchAlignment: "map",
    })
      .setLngLat(vehicle.location)
      .setRotation(inferVehicleAngle(vehicle, null));

    if (typeof marker.setSubpixelPositioning === "function") {
      marker.setSubpixelPositioning(true);
    }

    syncBusMarkerLabelRotation(element, inferVehicleAngle(vehicle, null));

    return marker;
  }

  function startAnimationLoop() {
    if (state.animationFrame) {
      window.cancelAnimationFrame(state.animationFrame);
    }
    const start = performance.now();
    const duration = Math.max(900, state.refreshIntervalMs * 0.88);

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeInOut(progress);

      for (const markerState of state.busMarkers.values()) {
        const animated = interpolateMarkerState(markerState, eased);
        markerState.current = animated.location;
        markerState.currentProgress = animated.progress;
        markerState.marker.setLngLat(animated.location);
        markerState.marker.setRotation(animated.angle);
        syncBusMarkerLabelRotation(markerState.marker.getElement(), animated.angle);
      }

      if (progress < 1) {
        state.animationFrame = window.requestAnimationFrame(tick);
      } else {
        state.animationFrame = null;
      }
    };

    state.animationFrame = window.requestAnimationFrame(tick);
  }

  function inferVehicleAngle(vehicle, previousLocation) {
    if (!state.map) {
      return 0;
    }

    if (previousLocation) {
      const a = state.map.project(previousLocation);
      const b = state.map.project(vehicle.location);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        return (Math.atan2(dy, dx) * 180) / Math.PI;
      }
    }

    const shape = state.gtfs.shapes?.[vehicle.shapeId];
    if (!shape || shape.length < 2) {
      return 0;
    }

    let bestDistance = Infinity;
    let bestAngle = 0;
    const point = state.map.project(vehicle.location);

    for (let index = 0; index < shape.length - 1; index += 1) {
      const start = state.map.project([shape[index][1], shape[index][0]]);
      const end = state.map.project([shape[index + 1][1], shape[index + 1][0]]);
      const distance = pointToSegmentDistance(point, start, end);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAngle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
      }
    }

    return bestAngle;
  }

  function interpolateMarkerState(markerState, amount) {
    const measured = getMeasuredShape(markerState.shapeId);
    const canFollowShape =
      measured &&
      Number.isFinite(markerState.previousProgress) &&
      Number.isFinite(markerState.targetProgress) &&
      Math.abs(markerState.targetProgress - markerState.previousProgress) <= measured.length * 0.45;

    if (canFollowShape) {
      const progress = lerp(markerState.previousProgress, markerState.targetProgress, amount);
      const sample = sampleShapeAtProgress(markerState.shapeId, progress);
      if (sample.location) {
        return {
          location: sample.location,
          progress,
          angle: sample.angle,
        };
      }
    }

    const lng = lerp(markerState.previous[0], markerState.target[0], amount);
    const lat = lerp(markerState.previous[1], markerState.target[1], amount);
    return {
      location: [lng, lat],
      progress: markerState.targetProgress,
      angle: markerState.angle,
    };
  }

  function inferVehicleAngleAtProgress(shapeId, progress) {
    return sampleShapeAtProgress(shapeId, progress).angle;
  }

  function syncBusStyles() {
    const zoomScale = busZoomScale();
    const plannerIsolation = plannerIsolationActive();
    const focusedRouteIds = getFocusedRouteIds();
    for (const [vehicleId, markerState] of state.busMarkers.entries()) {
      const element = markerState.marker.getElement();
      if (!element) {
        continue;
      }
      const busSelected = state.selectedBusId === vehicleId;
      let opacity = 1;
      if (state.selectedBusId) {
        if (busSelected) {
          opacity = 1;
        } else if (focusedRouteIds.has(markerState.routeId)) {
          opacity = 0.28;
        } else {
          opacity = 0.08;
        }
      } else if (state.selectedStopId) {
        opacity = focusedRouteIds.has(markerState.routeId) ? 0.42 : 0.1;
      } else if (plannerIsolation) {
        opacity = 0;
      } else if (focusedRouteIds.size > 0 && !focusedRouteIds.has(markerState.routeId)) {
        opacity = 0.16;
      }
      const hidden = opacity <= 0.001;
      element.style.display = hidden ? "none" : "";
      element.style.opacity = String(opacity);
      element.style.pointerEvents = hidden ? "none" : "";
      element.style.zIndex = busSelected ? "860" : opacity > 0.2 ? "800" : "420";
      const shell = element;
      const marker = element.querySelector(".bus-marker");
      const label = element.querySelector(".bus-marker-label");
      if (shell && marker) {
        const selectedScale = busSelected ? 1.18 : 1;
        const width = 18 * zoomScale * selectedScale;
        const height = 10 * zoomScale * selectedScale;
        shell.style.width = `${width.toFixed(2)}px`;
        shell.style.height = `${height.toFixed(2)}px`;
        shell.style.transform = "";
        marker.style.width = `${width.toFixed(2)}px`;
        marker.style.height = `${height.toFixed(2)}px`;
        marker.style.boxSizing = "border-box";
        marker.style.border = state.showBusBorders ? "3.2px solid #111111" : "0";
        if (label) {
          const labelScale = clamp((zoomScale - 1) / 1.2, 0, 1);
          const fontSize = Math.max(6, Math.min(width * 0.5, height * 0.9));
          label.style.fontSize = `${fontSize.toFixed(2)}px`;
          label.style.opacity = labelScale > 0.08 ? String(labelScale) : "0";
          label.style.letterSpacing = `${Math.max(0, Math.min(0.5, fontSize * 0.02)).toFixed(2)}px`;
        }
        syncBusMarkerLabelRotation(element, markerState.angle);
      }
    }
  }

  function busZoomScale() {
    if (!state.map) {
      return 1;
    }
    const zoom = state.map.getZoom();
    return interpolateLinear(
      zoom,
      [
        state.initialZoom, 1,
        state.initialZoom + 1.2, 1.3,
        state.initialZoom + 2.2, 1.8,
        state.initialZoom + 3.4, 2.5,
      ]
    );
  }

  function getFocusedRouteIds() {
    if (state.selectedBusId) {
      return new Set([state.busMarkers.get(state.selectedBusId)?.routeId || ""].filter(Boolean));
    }
    if (state.selectedStopId) {
      return new Set(state.stopRouteIdsByStopId.get(state.selectedStopId) || []);
    }
    if (state.selectedRouteLegendRouteIds.length) {
      return new Set(state.selectedRouteLegendRouteIds);
    }
    if (hasPlannerSelection()) {
      return plannerFocusedRouteIds();
    }
    return new Set(state.selectedRouteId ? [state.selectedRouteId] : []);
  }

  async function openBusPanel(vehicleId) {
    const markerState = state.busMarkers.get(vehicleId);
    if (!markerState) {
      return;
    }

    const switchingVehicle = state.selectedBusId && state.selectedBusId !== vehicleId;
    if (!state.selectedBusId || switchingVehicle) {
      state.mapRestoreView = {
        center: state.map.getCenter(),
        zoom: state.map.getZoom(),
      };
    }

    state.selectedBusId = vehicleId;
    state.selectedStopId = "";
    state.selectedBusLoading = true;
    state.selectedBusDeparture = null;
    state.selectedBusTrip = null;
    state.selectedBusStop = null;
    dom.busPanel.hidden = false;
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    focusBusOnMap(markerState.vehicle, true);
    renderBusPanel(markerState.vehicle, null);

    try {
      await ensureTripStopsData().catch(() => null);
      await ensureVehicleMetadata();
      const localDetail = deriveTripDetail(markerState.vehicle);
      const [trip, stop, departure] = await Promise.all([
        canUseLiveRestApi() ? fetchTripDetail(markerState.vehicle.tripId) : Promise.resolve(null),
        canUseLiveRestApi() && localDetail.nextStop?.stopId
          ? fetchStopDetail(localDetail.nextStop.stopId)
          : Promise.resolve(null),
        canUseLiveRestApi() && localDetail.nextStop?.stopId
          ? fetchNextStopDeparture(markerState.vehicle, localDetail.nextStop.stopId).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (state.selectedBusId !== vehicleId) {
        return;
      }
      state.selectedBusTrip = trip;
      state.selectedBusStop = stop;
      state.selectedBusDeparture = departure;
      renderBusPanel(markerState.vehicle, departure);
    } catch (error) {
      if (state.selectedBusId === vehicleId) {
        renderBusPanel(markerState.vehicle, null, error instanceof Error ? error.message : "");
      }
    } finally {
      if (state.selectedBusId === vehicleId) {
        state.selectedBusLoading = false;
        renderBusPanel(markerState.vehicle, state.selectedBusDeparture);
      }
    }
  }

  function refreshOpenBusPanel(reloadDeparture) {
    if (!state.selectedBusId) {
      syncFocusPanel();
      return;
    }
    const markerState = state.busMarkers.get(state.selectedBusId);
    if (!markerState) {
      closeBusPanel();
      return;
    }
    if (reloadDeparture) {
      openBusPanel(state.selectedBusId);
      return;
    }
    focusBusOnMap(markerState.vehicle, false);
    renderBusPanel(markerState.vehicle, state.selectedBusDeparture);
  }

  function closeBusPanel() {
    const restoreView = state.mapRestoreView;
    state.selectedBusId = "";
    state.selectedStopId = "";
    state.selectedBusDeparture = null;
    state.selectedBusTrip = null;
    state.selectedBusStop = null;
    state.selectedBusLoading = false;
    state.mapRestoreView = null;
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    syncFocusPanel();
    if (restoreView && state.map) {
      state.map.easeTo({
        center: restoreView.center,
        zoom: restoreView.zoom,
        duration: 700,
        easing: easeOutCubic,
        essential: true,
      });
    }
  }

  function openStopPanel(stopId) {
    const normalizedStopId = String(stopId || "").trim();
    if (!normalizedStopId || !state.stopFeaturesById.has(normalizedStopId)) {
      return;
    }
    if (!state.selectedBusId && state.selectedStopId !== normalizedStopId) {
      state.mapRestoreView = {
        center: state.map.getCenter(),
        zoom: state.map.getZoom(),
      };
    }
    state.selectedBusId = "";
    state.selectedRouteId = "";
    state.selectedStopId = normalizedStopId;
    state.selectedBusDeparture = null;
    state.selectedBusTrip = null;
    state.selectedBusStop = null;
    state.selectedBusLoading = false;
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    focusStopOnMap(normalizedStopId, true);
    renderStopPanel(normalizedStopId);
    ensureTripStopsData()
      .then(() => {
        if (state.selectedStopId === normalizedStopId) {
          renderStopPanel(normalizedStopId);
        }
      })
      .catch(() => { });
  }

  function focusStopOnMap(stopId, animate) {
    const stopMeta = state.gtfs.stopsById?.[stopId];
    const lat = Number(stopMeta?.location?.[0]);
    const lon = Number(stopMeta?.location?.[1]);
    if (!state.map || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    const targetZoom = clampZoom(Math.max(state.map.getMinZoom() + 1.7, state.map.getMaxZoom() - 1.35));
    state.map.easeTo({
      center: [lon, lat],
      zoom: targetZoom,
      duration: animate ? 620 : 380,
      easing: easeOutCubic,
      essential: true,
    });
  }

  function focusBusOnMap(vehicle, animate) {
    if (!state.map || !vehicle?.location) {
      return;
    }
    const targetZoom = clampZoom(Math.max(state.map.getMinZoom() + 2.6, state.map.getMaxZoom() - 0.55));
    state.map.easeTo({
      center: vehicle.location,
      zoom: targetZoom,
      duration: animate ? 700 : 450,
      easing: easeOutCubic,
      essential: true,
    });
  }

  async function ensureVehicleMetadata() {
    if (state.vehicleMetaLoaded || !canUseLiveRestApi()) {
      return;
    }
    const vehicles = await fetchLive("/vehicles");
    state.vehicleMetaById = new Map(
      (Array.isArray(vehicles) ? vehicles : []).map((vehicle) => [
        String(vehicle.id || "").trim(),
        {
          configurationId: String(vehicle.vehicleConfigurationId || vehicle.vehicle_configuration_id || "").trim(),
          dateInService: String(vehicle.dateInService || vehicle.date_in_service || "").trim(),
          isActive: Boolean(vehicle.isActive),
        },
      ])
    );
    state.vehicleMetaLoaded = true;
  }

  async function fetchNextStopDeparture(vehicle, stopId) {
    const departures = await fetchLive(`/stops/${encodeURIComponent(stopId)}/departures?time=90`);
    const list = Array.isArray(departures) ? departures : [];
    const exactMatch = list.find((departure) => {
      const departureTripId = String(
        departure.trip?.tripId || departure.trip?.id || departure.tripId || departure.trip_id || ""
      ).trim();
      const departureVehicleId = String(departure.vehicleId || departure.vehicle?.id || "").trim();
      return departureTripId === vehicle.tripId || departureVehicleId === vehicle.id;
    });
    if (exactMatch) {
      return exactMatch;
    }
    const routeMatch = list.find((departure) => {
      const departureRouteId = String(
        departure.route?.gtfsRouteId || departure.route?.id || departure.routeId || departure.route_id || ""
      ).trim();
      const departureHeadsign = String(
        departure.headsign || departure.trip?.headsign || departure.destination || ""
      ).trim();
      return (
        departureRouteId === vehicle.route?.gtfsRouteId &&
        (!vehicle.headsign || !departureHeadsign || departureHeadsign === vehicle.headsign)
      );
    });
    return routeMatch || list[0] || null;
  }

  async function fetchTripDetail(tripId) {
    if (!tripId) {
      return null;
    }
    return fetchLive(`/trips/${encodeURIComponent(tripId)}`);
  }

  async function fetchStopDetail(stopId) {
    if (!stopId) {
      return null;
    }
    return fetchLive(`/stops/${encodeURIComponent(stopId)}`);
  }

  function deriveTripDetail(vehicle) {
    const tripStops = state.gtfs.tripStopsByTripId?.[vehicle.tripId] || [];
    if (!tripStops.length) {
      return { nextStop: null, upcomingStops: [] };
    }

    const vehicleDistance = projectPointAlongShape(vehicle.location, vehicle.shapeId);
    const enrichedStops = tripStops
      .map((stop) => {
        const stopMeta = state.gtfs.stopsById?.[stop.stopId];
        if (!stopMeta) {
          return null;
        }
        return {
          ...stop,
          ...stopMeta,
          progress: projectPointAlongShape(
            [Number(stopMeta.location[1]), Number(stopMeta.location[0])],
            vehicle.shapeId
          ),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.stopSequence - right.stopSequence);

    const upcomingStops = enrichedStops
      .filter((stop) => stop.progress >= vehicleDistance - 35)
      .slice(0, UPCOMING_STOP_COUNT);

    return {
      nextStop: upcomingStops[0] || enrichedStops[0] || null,
      upcomingStops,
    };
  }

  function setBusPanelSpotlights(leftMarkup, rightMarkup) {
    setBusPanelSpotlight(dom.busPanelSpotlightLeft, leftMarkup);
    setBusPanelSpotlight(dom.busPanelSpotlightRight, rightMarkup);
  }

  function setBusPanelMetaCardVisible(visible) {
    if (!dom.busPanelMetaCard) {
      return;
    }
    dom.busPanelMetaCard.hidden = !visible;
  }

  function setBusPanelSpotlight(element, markup) {
    if (!element) {
      return;
    }
    element.hidden = !markup;
    element.innerHTML = markup || "";
  }

  function renderBusSpotlightCard(kicker, title, detail, icon, toneClass = "") {
    return `<article class="bus-spotlight-card ${escapeAttr(toneClass)}"><p class="bus-spotlight-kicker">${escapeHtml(
      kicker
    )}</p><p class="bus-spotlight-title">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      icon
    )}</span>` : ""}<span>${escapeHtml(title)}</span></p>${detail ? `<p class="bus-spotlight-detail">${escapeHtml(
      detail
    )}</p>` : ""}</article>`;
  }

  function renderBusPanel(vehicle, departure, errorMessage) {
    if (!vehicle) {
      closeBusPanel();
      return;
    }

    const detail = deriveTripDetail(vehicle);
    const vehicleMeta = state.vehicleMetaById.get(vehicle.id) || null;
    const trip = state.selectedBusTrip;
    const stop = state.selectedBusStop;
    const vehiclePosition = vehicle.vehiclePosition || null;
    const delayMinutes = departure ? computeDelayMinutes(departure) : null;
    const occupancyLabel = formatOccupancyStatus(vehiclePosition?.occupancyStatus);
    const nextStopTitle = detail.nextStop?.displayName || detail.nextStop?.name || detail.nextStop?.stopId || "Unavailable";
    const nextStopDetail = [
      (stop?.stopCode || detail.nextStop?.code) ? `Code ${stop?.stopCode || detail.nextStop?.code}` : "",
      departure?.departsIn || "",
      formatBoardingInfo(stop, departure),
    ]
      .filter(Boolean)
      .join(" • ");
    const destinationTitle = formatDestination(departure, detail.upcomingStops);
    const destinationDetail = [
      vehicle.headsign || "",
      trip?.direction?.name || vehicle.direction?.name || "",
      detail.upcomingStops.length ? `${detail.upcomingStops.length} live stops in sequence` : "",
    ]
      .filter(Boolean)
      .join(" • ");

    dom.busPanel.hidden = false;
    applyFocusTint("bus", vehicle.route?.color, vehiclePosition?.occupancyStatus);
    setBusPanelMetaCardVisible(false);
    dom.busPanelMetaLabel.textContent = "Live profile";
    dom.busPanelListLabel.textContent = "Upcoming stops";
    setHeaderWithIcon(
      dom.busPanelKicker,
      "directions_bus",
      vehicle.route.shortName ? `Route ${vehicle.route.shortName}` : vehicle.route.longName || "Live bus"
    );
    setHeaderWithIcon(dom.busPanelTitle, occupancyStatusIconName(vehiclePosition?.occupancyStatus), `Bus ${vehicle.id}`);
    dom.busPanelMeta.innerHTML = [
      chipMarkup(vehicle.route.longName || vehicle.route.gtfsRouteId || "Route"),
      chipMarkup(vehicle.headsign || "In service"),
      chipMarkup(vehicle.direction?.name || "Realtime"),
      departure?.isRealTime ? chipMarkup("Realtime") : "",
      departure?.isHopper ? chipMarkup("Hopper") : "",
      vehiclePosition?.occupancyStatus ? chipMarkup(occupancyLabel, occupancyStatusIconName(vehiclePosition?.occupancyStatus)) : "",
      vehiclePosition?.congestionLevel ? chipMarkup(formatCongestionLevel(vehiclePosition.congestionLevel)) : "",
      vehiclePosition?.currentStatus ? chipMarkup(formatVehicleStopStatus(vehiclePosition.currentStatus)) : "",
    ].join("");
    dom.busPanelMetaExtra.innerHTML = renderBusMetaSpark(
      "Occupancy",
      occupancyLabel,
      occupancyGradientSpark(canonicalOccupancyStatus(vehiclePosition?.occupancyStatus))
    );
    setBusPanelSpotlights(
      renderBusSpotlightCard("Next stop", nextStopTitle, nextStopDetail, "signpost"),
      renderBusSpotlightCard("Destination", destinationTitle, destinationDetail, "flag")
    );

    const stats = [
      statMarkup("Stop code", stop?.stopCode || detail.nextStop?.code || "Unavailable"),
      statMarkup("Direction", trip?.direction?.name || vehicle.direction?.name || "Unknown"),
      statMarkup("Stop status", formatVehicleStopStatus(vehiclePosition?.currentStatus)),
      statMarkup("Occupancy", occupancyLabel),
      statMarkup("Congestion", formatCongestionLevel(vehiclePosition?.congestionLevel)),
      statMarkup("Traffic", formatTrafficProxy(delayMinutes, departure, vehicle)),
      statMarkup("Speed", formatSpeed(vehicle)),
      statMarkup("Fleet status", vehicleMeta?.isActive ? "Active" : "Unknown"),
      statMarkup("Boarding", formatBoardingInfo(stop, departure)),
      statMarkup("Updated", formatTimestamp(vehicle.updatedAt)),
    ];

    dom.busPanelGridLeft.innerHTML = stats.join("");

    dom.busStopList.innerHTML = detail.upcomingStops.length
      ? detail.upcomingStops
        .map((stop, index) =>
          `<article class="bus-stop-item"><p class="bus-stop-name">${escapeHtml(
            stop.displayName || stop.name || stop.stopId
          )}</p><p class="bus-stop-meta">${index === 0 ? "Next" : `Then ${index}`} • ${stop.departureTime ? escapeHtml(stop.departureTime) : escapeHtml(stop.stopId)
          }</p><p class="bus-stop-meta">${formatStopMetaLine(stop, index === 0 ? state.selectedBusStop : null)}</p></article>`
        )
        .join("")
      : `<article class="bus-stop-item"><p class="bus-stop-name">No trip stop sequence available</p><p class="bus-stop-meta">GTFS cache missing for this trip</p></article>`;

    if (state.selectedBusLoading) {
      dom.busPanelGridLeft.insertAdjacentHTML("beforeend", statMarkup("Loading", "Fetching live stop detail"));
    }

    if (errorMessage) {
      dom.busStopList.insertAdjacentHTML(
        "afterbegin",
        `<article class="bus-stop-item"><p class="bus-stop-name">Live stop detail unavailable</p><p class="bus-stop-meta">${escapeHtml(
          errorMessage
        )}</p></article>`
      );
    }
  }

  function syncFocusPanel() {
    if (state.selectedBusId) {
      const markerState = state.busMarkers.get(state.selectedBusId);
      if (markerState) {
        renderBusPanel(markerState.vehicle, state.selectedBusDeparture);
        return;
      }
    }
    if (state.selectedStopId) {
      renderStopPanel(state.selectedStopId);
      return;
    }
    if (state.selectedRouteId) {
      renderRoutePanel(state.selectedRouteId);
      return;
    }
    if (hasPlannerSelection()) {
      renderPlannerPanel();
      return;
    }
    dom.busPanel.hidden = true;
  }

  function hasPlannerSelection() {
    return Boolean(state.plannerRegions.from.stopIds.length || state.plannerRegions.to.stopIds.length);
  }

  function plannerRegionsReady() {
    return Boolean(state.plannerRegions.from.stopIds.length && state.plannerRegions.to.stopIds.length);
  }

  function activatePlannerSelection(target) {
    const normalizedTarget = target === "to" ? "to" : "from";
    state.plannerSelectionMode = state.plannerSelectionMode === normalizedTarget ? "" : normalizedTarget;
    state.plannerSelectionDrag = null;
    state.plannerSuppressMapClickUntil = Date.now() + 120;
    hidePlannerSelectionBox();
    if (state.plannerSelectionMode) {
      clearFocusedEntitySelection();
      updateStatus(
        `Select ${capitalize(state.plannerSelectionMode)} region`,
        "Drag a box over the stops you want to use"
      );
    } else if (hasPlannerSelection()) {
      syncPlannerPanelStatus();
    }
    syncPlannerHud();
    syncFocusPanel();
  }

  function clearPlannerSelections() {
    state.plannerSelectionMode = "";
    state.plannerSelectionDrag = null;
    state.plannerLoading = false;
    state.plannerResults = null;
    state.plannerPreference = "sitting";
    state.plannerComputationSeq += 1;
    state.plannerRegions = {
      from: { stopIds: [], bounds: null },
      to: { stopIds: [], bounds: null },
    };
    hidePlannerSelectionBox();
    syncPlannerHud();
    syncPlannerRegionVisuals();
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    syncFocusPanel();
    if (!state.selectedBusId && !state.selectedStopId && !state.selectedRouteId) {
      updateStatus(
        state.busMarkers.size ? `${state.busMarkers.size} buses` : "Map ready",
        state.busMarkers.size
          ? `${state.activeRouteCount} live lines • ${state.lastUpdatedLabel || "idle"}`
          : "Click a route to isolate"
      );
    }
  }

  function setPlannerPreference(mode) {
    const nextMode = mode === "standing" ? "standing" : "sitting";
    if (state.plannerPreference === nextMode) {
      return;
    }
    state.plannerPreference = nextMode;
    syncPlannerHud();
    syncPlannerRegionVisuals();
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    if (hasPlannerSelection() && !state.selectedBusId && !state.selectedStopId && !state.selectedRouteId) {
      renderPlannerPanel();
    }
  }

  function toggleInfoPanel(forceOpen) {
    const nextOpen = typeof forceOpen === "boolean" ? forceOpen : dom.infoPanel.hidden;
    if (nextOpen) {
      toggleRouteLegendPanel(false);
    }
    dom.infoPanel.hidden = !nextOpen;
    dom.infoToggle.setAttribute("aria-pressed", nextOpen ? "true" : "false");
  }

  function toggleRouteLegendPanel(forceOpen) {
    const nextOpen = typeof forceOpen === "boolean" ? forceOpen : dom.routeLegendPanel.hidden;
    if (nextOpen) {
      toggleInfoPanel(false);
    }
    dom.routeLegendPanel.hidden = !nextOpen;
    dom.routeLegendToggle.setAttribute("aria-pressed", nextOpen ? "true" : "false");
  }

  function toggleBusBorders() {
    state.showBusBorders = !state.showBusBorders;
    window.localStorage.setItem(STORAGE_KEYS.showBusBorders, state.showBusBorders ? "1" : "0");
    syncInfoToggles();
    syncBusStyles();
  }

  function toggleRouteBorders() {
    state.showRouteBorders = !state.showRouteBorders;
    window.localStorage.setItem(STORAGE_KEYS.showRouteBorders, state.showRouteBorders ? "1" : "0");
    syncInfoToggles();
    syncRouteData();
  }

  function syncInfoToggles() {
    dom.busBorderToggle.setAttribute("aria-pressed", state.showBusBorders ? "true" : "false");
    dom.routeBorderToggle.setAttribute("aria-pressed", state.showRouteBorders ? "true" : "false");
    const busPill = dom.busBorderToggle.querySelector(".info-toggle-pill");
    const routePill = dom.routeBorderToggle.querySelector(".info-toggle-pill");
    if (busPill) {
      busPill.textContent = state.showBusBorders ? "On" : "Off";
    }
    if (routePill) {
      routePill.textContent = state.showRouteBorders ? "On" : "Off";
    }
  }

  function clearFocusedEntitySelection() {
    state.selectedBusId = "";
    state.selectedStopId = "";
    state.selectedRouteId = "";
    state.selectedBusDeparture = null;
    state.selectedBusTrip = null;
    state.selectedBusStop = null;
    state.selectedBusLoading = false;
    state.mapRestoreView = null;
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
  }

  function onGlobalKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }
    if (!dom.infoPanel.hidden) {
      toggleInfoPanel(false);
      return;
    }
    if (!dom.routeLegendPanel.hidden) {
      toggleRouteLegendPanel(false);
      return;
    }
    if (state.plannerSelectionDrag || state.plannerSelectionMode) {
      state.plannerSelectionDrag = null;
      state.plannerSelectionMode = "";
      hidePlannerSelectionBox();
      if (state.map?.dragPan) {
        state.map.dragPan.enable();
      }
      syncPlannerHud();
      syncFocusPanel();
      return;
    }
    if (hasPlannerSelection() && !state.selectedBusId && !state.selectedStopId && !state.selectedRouteId) {
      clearPlannerSelections();
    }
  }

  function onPlannerPointerDown(event) {
    if (!state.plannerSelectionMode || !state.map || event.button !== 0) {
      return;
    }
    const rect = dom.map.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    if (startX < 0 || startY < 0 || startX > rect.width || startY > rect.height) {
      return;
    }
    state.plannerSelectionDrag = {
      target: state.plannerSelectionMode,
      rect,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    };
    state.plannerSuppressMapClickUntil = Date.now() + 240;
    if (state.map.dragPan) {
      state.map.dragPan.disable();
    }
    renderPlannerSelectionBox(state.plannerSelectionDrag);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPlannerPointerMove(event) {
    if (!state.plannerSelectionDrag) {
      return;
    }
    const rect = state.plannerSelectionDrag.rect;
    state.plannerSelectionDrag.currentX = clamp(event.clientX - rect.left, 0, rect.width);
    state.plannerSelectionDrag.currentY = clamp(event.clientY - rect.top, 0, rect.height);
    renderPlannerSelectionBox(state.plannerSelectionDrag);
  }

  function onPlannerPointerUp() {
    if (!state.plannerSelectionDrag || !state.map) {
      return;
    }
    const drag = state.plannerSelectionDrag;
    state.plannerSelectionDrag = null;
    if (state.map.dragPan) {
      state.map.dragPan.enable();
    }
    hidePlannerSelectionBox();
    state.plannerSuppressMapClickUntil = Date.now() + 260;

    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    const target = drag.target;
    state.plannerSelectionMode = "";
    syncPlannerHud();

    if (width < PLANNER_MIN_SELECTION_PX || height < PLANNER_MIN_SELECTION_PX) {
      syncFocusPanel();
      syncPlannerPanelStatus();
      return;
    }

    const screenBounds = normalizeScreenRect(drag);
    const bounds = screenRectToLngLatBounds(screenBounds);
    const stopIds = stopIdsWithinBounds(bounds);
    applyPlannerRegion(target, bounds, stopIds);
  }

  function applyPlannerRegion(target, bounds, stopIds) {
    state.plannerRegions[target] = {
      bounds,
      stopIds,
    };
    state.plannerResults = null;
    state.plannerLoading = false;
    state.plannerComputationSeq += 1;
    syncPlannerRegionVisuals();
    syncPlannerHud();
    syncFocusPanel();
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();

    if (!stopIds.length) {
      updateStatus(
        `${capitalize(target)} region empty`,
        "No stops found inside that selection"
      );
      return;
    }

    if (plannerRegionsReady()) {
      queuePlannerComputation();
      return;
    }

    updateStatus(
      `${capitalize(target)} region set`,
      `${stopIds.length} stop${stopIds.length === 1 ? "" : "s"} found • select ${target === "from" ? "To" : "From"} next`
    );
  }

  function normalizeScreenRect(drag) {
    return {
      minX: Math.min(drag.startX, drag.currentX),
      maxX: Math.max(drag.startX, drag.currentX),
      minY: Math.min(drag.startY, drag.currentY),
      maxY: Math.max(drag.startY, drag.currentY),
    };
  }

  function screenRectToLngLatBounds(rect) {
    const northWest = state.map.unproject([rect.minX, rect.minY]);
    const southEast = state.map.unproject([rect.maxX, rect.maxY]);
    return {
      west: Math.min(northWest.lng, southEast.lng),
      east: Math.max(northWest.lng, southEast.lng),
      south: Math.min(northWest.lat, southEast.lat),
      north: Math.max(northWest.lat, southEast.lat),
    };
  }

  function stopIdsWithinBounds(bounds) {
    const selected = [];
    for (const [stopId, stopMeta] of Object.entries(state.gtfs.stopsById || {})) {
      const lat = Number(stopMeta?.location?.[0]);
      const lon = Number(stopMeta?.location?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }
      if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) {
        continue;
      }
      selected.push(stopId);
    }
    return selected.sort((left, right) => {
      const leftRoutes = state.stopRouteIdsByStopId.get(left)?.length || 0;
      const rightRoutes = state.stopRouteIdsByStopId.get(right)?.length || 0;
      if (leftRoutes !== rightRoutes) {
        return rightRoutes - leftRoutes;
      }
      return plannerStopLabel(left).localeCompare(plannerStopLabel(right));
    });
  }

  function renderPlannerSelectionBox(drag) {
    const rect = normalizeScreenRect(drag);
    dom.plannerSelectionBox.hidden = false;
    dom.plannerSelectionBox.style.left = `${rect.minX}px`;
    dom.plannerSelectionBox.style.top = `${rect.minY}px`;
    dom.plannerSelectionBox.style.width = `${Math.max(1, rect.maxX - rect.minX)}px`;
    dom.plannerSelectionBox.style.height = `${Math.max(1, rect.maxY - rect.minY)}px`;
  }

  function hidePlannerSelectionBox() {
    dom.plannerSelectionBox.hidden = true;
  }

  function syncPlannerHud() {
    const mode = state.plannerSelectionMode;
    dom.plannerFromButton.setAttribute("aria-pressed", mode === "from" ? "true" : "false");
    dom.plannerToButton.setAttribute("aria-pressed", mode === "to" ? "true" : "false");
    dom.plannerModeSitting.setAttribute("aria-pressed", state.plannerPreference === "sitting" ? "true" : "false");
    dom.plannerModeStanding.setAttribute("aria-pressed", state.plannerPreference === "standing" ? "true" : "false");
    if (mode) {
      dom.plannerHint.textContent = `Drag to select ${capitalize(mode)} stops`;
      return;
    }
    if (plannerRegionsReady()) {
      if (state.plannerLoading) {
        dom.plannerHint.textContent = "Computing best low-transfer routes";
        return;
      }
      dom.plannerHint.textContent = `${state.plannerRegions.from.stopIds.length} from • ${state.plannerRegions.to.stopIds.length} to`;
      return;
    }
    if (hasPlannerSelection()) {
      dom.plannerHint.textContent = `Select ${state.plannerRegions.from.stopIds.length ? "To" : "From"} region next`;
      return;
    }
    dom.plannerHint.textContent = "Click and drag a region";
  }

  function syncPlannerRegionVisuals() {
    if (!state.map) {
      return;
    }
    const isolated = plannerIsolationActive();
    const regionFeatures = [];
    const stopFeatures = [];
    for (const role of ["from", "to"]) {
      const region = state.plannerRegions[role];
      if (region.bounds) {
        regionFeatures.push(plannerRegionFeature(region.bounds, role));
      }
      for (const stopId of region.stopIds) {
        const stopMeta = state.gtfs.stopsById?.[stopId];
        if (!stopMeta) {
          continue;
        }
        stopFeatures.push({
          type: "Feature",
          properties: {
            role,
            stopId,
          },
          geometry: {
            type: "Point",
            coordinates: [Number(stopMeta.location[1]), Number(stopMeta.location[0])],
          },
        });
      }
    }
    getGeoJsonSource(PLANNER_REGIONS_SOURCE_ID).setData(featureCollection(regionFeatures));
    getGeoJsonSource(PLANNER_REGION_STOPS_SOURCE_ID).setData(featureCollection(stopFeatures));
    state.map.setLayoutProperty(PLANNER_REGIONS_FILL_LAYER_ID, "visibility", isolated ? "none" : "visible");
    state.map.setLayoutProperty(PLANNER_REGIONS_LINE_LAYER_ID, "visibility", isolated ? "none" : "visible");
    state.map.setLayoutProperty(PLANNER_REGION_STOPS_LAYER_ID, "visibility", isolated ? "none" : "visible");
  }

  function plannerRegionFeature(bounds, role) {
    return {
      type: "Feature",
      properties: { role },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [bounds.west, bounds.south],
          [bounds.east, bounds.south],
          [bounds.east, bounds.north],
          [bounds.west, bounds.north],
          [bounds.west, bounds.south],
        ]],
      },
    };
  }

  function renderPlannerPanel() {
    const fromStopIds = state.plannerRegions.from.stopIds;
    const toStopIds = state.plannerRegions.to.stopIds;
    const directRoutes = directPlannerRoutes(fromStopIds, toStopIds);
    const sitting = state.plannerResults?.sitting || null;
    const standing = state.plannerResults?.standing || null;
    const selectedCandidate = currentPlannerCandidate();
    const selectedModeLabel = plannerModeLabel(state.plannerPreference);
    const selectedOtherModeLabel = plannerModeLabel(state.plannerPreference === "sitting" ? "standing" : "sitting");

    dom.busPanel.hidden = false;
    applyFocusTint("neutral", "", "");
    setBusPanelMetaCardVisible(false);
    dom.busPanelMetaLabel.textContent = "Directions";
    dom.busPanelListLabel.textContent = plannerRegionsReady() ? `${selectedModeLabel} route` : "Route planning";
    setHeaderWithIcon(
      dom.busPanelKicker,
      state.plannerSelectionMode ? "crop_free" : "alt_route",
      state.plannerSelectionMode ? `Selecting ${capitalize(state.plannerSelectionMode)}` : "Region routing"
    );
    setHeaderWithIcon(
      dom.busPanelTitle,
      "swap_horiz",
      `${fromStopIds.length || 0} stop${fromStopIds.length === 1 ? "" : "s"} in From region to ${toStopIds.length || 0} stop${toStopIds.length === 1 ? "" : "s"} in Destination region`
    );
    dom.busPanelMeta.innerHTML = [
      chipMarkup(`${fromStopIds.length} from`, "trip_origin"),
      chipMarkup(`${toStopIds.length} to`, "place"),
      chipMarkup(selectedModeLabel, plannerModeIcon(state.plannerPreference)),
      directRoutes.length ? chipMarkup(`${directRoutes.length} direct route${directRoutes.length === 1 ? "" : "s"}`, "merge_type") : "",
      plannerRegionsReady() && state.plannerResults?.bestTransferCount != null
        ? chipMarkup(`${state.plannerResults.bestTransferCount} transfer${state.plannerResults.bestTransferCount === 1 ? "" : "s"} min`, "sync_alt")
        : "",
    ].join("");
    dom.busPanelMetaExtra.innerHTML = renderPlannerMetaCard();
    setBusPanelSpotlights("", "");

    const stats = [
      statMarkup("From region", `${fromStopIds.length || 0} stop${fromStopIds.length === 1 ? "" : "s"} selected`),
      statMarkup("Destination region", `${toStopIds.length || 0} stop${toStopIds.length === 1 ? "" : "s"} selected`),
      statMarkup("Direct routes", directRoutes.length ? directRoutes.join(" • ") : "None live"),
      statMarkup("Fewest transfers", state.plannerResults?.bestTransferCount != null ? String(state.plannerResults.bestTransferCount) : "Pending"),
      statMarkup("Preferred mode", selectedModeLabel),
      statMarkup("Recommended route", selectedCandidate ? summarizePlannerRoutes(selectedCandidate) : plannerRegionsReady() ? `No ${plannerModeLabel(state.plannerPreference).toLowerCase()} route` : "Select both"),
      statMarkup("Boarding ease", selectedCandidate?.boardingSummary || "Awaiting regions"),
      statMarkup("Deboard ease", selectedCandidate?.deboardSummary || "Awaiting regions"),
    ];
    dom.busPanelGridLeft.innerHTML = stats.join("");

    const groups = [];
    if (plannerRegionsReady()) {
      if (state.plannerLoading) {
        groups.push(`<article class="bus-stop-item"><p class="bus-stop-name">Computing route options</p><p class="bus-stop-meta">Scanning every stop pair across both regions and ranking low-transfer paths for comfort and convenience.</p></article>`);
      } else if (state.plannerResults?.error) {
        groups.push(`<article class="bus-stop-item"><p class="bus-stop-name">Directions unavailable</p><p class="bus-stop-meta">${escapeHtml(state.plannerResults.error)}</p></article>`);
      } else {
        if (selectedCandidate) {
          groups.push(renderPlannerCandidateCard(selectedCandidate, selectedModeLabel));
        } else if (sitting || standing) {
          groups.push(`<article class="bus-stop-item"><p class="bus-stop-name">No ${escapeHtml(
            selectedModeLabel.toLowerCase()
          )} route found</p><p class="bus-stop-meta">Try toggling to ${escapeHtml(
            selectedOtherModeLabel
          )}, or expand one of the regions so a lower-pressure boarding option is available.</p></article>`);
        } else {
          groups.push(`<article class="bus-stop-item"><p class="bus-stop-name">No route found</p><p class="bus-stop-meta">Try expanding the From or To region so more transfer points are available.</p></article>`);
        }
      }
    } else if (hasPlannerSelection()) {
      groups.push(`<article class="bus-stop-item"><p class="bus-stop-name">Select the other region</p><p class="bus-stop-meta">Pick both From and To before the planner can rank low-transfer rides.</p></article>`);
    } else {
      groups.push(`<article class="bus-stop-item"><p class="bus-stop-name">Directions tool ready</p><p class="bus-stop-meta">Use From and To, drag two map regions, and I’ll score the best rides for comfort and convenience.</p></article>`);
    }
    dom.busStopList.innerHTML = groups.join("");
    syncPlannerPanelStatus();
  }

  function renderPlannerMetaCard() {
    if (state.plannerLoading) {
      return `<article class="spark-card"><div class="spark-card-row"><p class="spark-card-label">Route scan</p><p class="spark-card-value">Running</p></div></article>`;
    }
    if (!plannerRegionsReady()) {
      const next = state.plannerRegions.from.stopIds.length ? "Select To region" : "Select From region";
      return `<article class="spark-card"><div class="spark-card-row"><p class="spark-card-label">Route scan</p><p class="spark-card-value">${escapeHtml(
        next
      )}</p></div></article>`;
    }
    if (state.plannerResults?.error) {
      return `<article class="spark-card spark-card-pressure"><div class="spark-card-row"><p class="spark-card-label">Route scan</p><p class="spark-card-value">Needs wider regions</p></div></article>`;
    }
    const best = currentPlannerCandidate();
    return `<article class="spark-card"><div class="spark-card-row"><p class="spark-card-label">Best route</p><p class="spark-card-value">${escapeHtml(
      best ? `${plannerModeLabel(state.plannerPreference)} • ${best.transferCount} transfer${best.transferCount === 1 ? "" : "s"} • ${best.totalRideStops} stop hops` : "No route yet"
    )}</p></div></article>`;
  }

  function syncPlannerPanelStatus() {
    if (!hasPlannerSelection() || state.selectedBusId || state.selectedStopId || state.selectedRouteId) {
      return;
    }
    if (state.plannerSelectionMode) {
      updateStatus(
        `Selecting ${capitalize(state.plannerSelectionMode)}`,
        "Drag a box over the stop cluster you want to use"
      );
      return;
    }
    if (!plannerRegionsReady()) {
      updateStatus(
        `${state.plannerRegions.from.stopIds.length || 0} from • ${state.plannerRegions.to.stopIds.length || 0} to`,
        "Select the remaining region to compute directions"
      );
      return;
    }
    if (state.plannerLoading) {
      updateStatus("Computing directions", "Ranking low-transfer rides for comfort and convenience");
      return;
    }
    const best = currentPlannerCandidate();
    updateStatus(
      "Directions ready",
      best
        ? `${plannerModeLabel(state.plannerPreference)} • ${best.transferCount} transfer${best.transferCount === 1 ? "" : "s"} min • ${best.routeSummary}`
        : `No ${plannerModeLabel(state.plannerPreference).toLowerCase()} route found`
    );
  }

  function currentPlannerCandidate() {
    if (state.plannerPreference === "standing") {
      return state.plannerResults?.standing || null;
    }
    return state.plannerResults?.sitting || null;
  }

  async function queuePlannerComputation() {
    if (!plannerRegionsReady()) {
      state.plannerResults = null;
      state.plannerLoading = false;
      syncPlannerHud();
      syncFocusPanel();
      return;
    }
    const seq = ++state.plannerComputationSeq;
    state.plannerLoading = true;
    syncPlannerHud();
    syncFocusPanel();
    try {
      await ensurePlannerModel();
      const results = computePlannerResults();
      if (seq !== state.plannerComputationSeq) {
        return;
      }
      state.plannerResults = results;
    } catch (error) {
      if (seq !== state.plannerComputationSeq) {
        return;
      }
      state.plannerResults = {
        error: error instanceof Error ? error.message : "Unable to compute directions.",
      };
    } finally {
      if (seq !== state.plannerComputationSeq) {
        return;
      }
      state.plannerLoading = false;
      syncPlannerHud();
      syncFocusPanel();
      syncPlannerRegionVisuals();
      syncRouteData();
      syncStopVisibility();
      syncBusStyles();
    }
  }

  async function ensurePlannerModel() {
    if (state.plannerModel) {
      return state.plannerModel;
    }
    await ensureTripStopsData();
    const patterns = [];
    const patternById = new Map();
    const patternsByStopId = new Map();
    const seen = new Set();

    for (const [tripId, tripStops] of Object.entries(state.gtfs.tripStopsByTripId || {})) {
      const shapeId = state.gtfs.tripShapeIndex?.[tripId] || "";
      const routeId = state.gtfs.shapeRouteIndex?.[shapeId] || "";
      if (!routeId || !Array.isArray(tripStops) || tripStops.length < 2) {
        continue;
      }
      const orderedStopIds = tripStops
        .slice()
        .sort((left, right) => Number(left.stopSequence || 0) - Number(right.stopSequence || 0))
        .map((stop) => String(stop.stopId || "").trim())
        .filter(Boolean)
        .filter((stopId, index, list) => stopId !== list[index - 1]);
      if (orderedStopIds.length < 2) {
        continue;
      }
      const key = `${routeId}|${orderedStopIds.join(">")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const route = state.gtfs.routesByGtfsRouteId?.[routeId] || {};
      const terminalStopId = orderedStopIds[orderedStopIds.length - 1];
      const terminalLabel = plannerStopLabel(terminalStopId);
      const pattern = {
        id: `pattern-${patterns.length + 1}`,
        routeId,
        shapeId,
        stopIds: orderedStopIds,
        label: terminalLabel || route.longName || route.shortName || routeId,
      };
      patterns.push(pattern);
      patternById.set(pattern.id, pattern);
      orderedStopIds.forEach((stopId, index) => {
        if (!patternsByStopId.has(stopId)) {
          patternsByStopId.set(stopId, []);
        }
        patternsByStopId.get(stopId).push({
          patternId: pattern.id,
          index,
        });
      });
    }

    state.plannerModel = {
      patterns,
      patternById,
      patternsByStopId,
    };
    return state.plannerModel;
  }

  function computePlannerResults() {
    const model = state.plannerModel;
    const fromStopIds = [...state.plannerRegions.from.stopIds];
    const toStopIds = [...state.plannerRegions.to.stopIds];
    const destinationSet = new Set(toStopIds);
    const frontier = new Set(fromStopIds);
    const overallLabels = new Map();
    const nextFrontier = new Set();

    for (const stopId of fromStopIds) {
      overallLabels.set(stopId, {
        stopId,
        rides: 0,
        travelStops: 0,
        previousLabel: null,
        leg: null,
      });
    }

    let activeFrontier = frontier;
    for (let round = 0; round < PLANNER_MAX_RIDES && activeFrontier.size; round += 1) {
      const touchedPatterns = new Set();
      for (const stopId of activeFrontier) {
        for (const entry of model.patternsByStopId.get(stopId) || []) {
          touchedPatterns.add(entry.patternId);
        }
      }
      nextFrontier.clear();
      for (const patternId of touchedPatterns) {
        const pattern = model.patternById.get(patternId);
        if (pattern) {
          scanPlannerPattern(pattern, overallLabels, nextFrontier);
        }
      }
      activeFrontier = new Set(nextFrontier);
    }

    const boardingCache = new Map();
    const stopSignalCache = new Map();
    const candidates = toStopIds
      .map((stopId) => overallLabels.get(stopId))
      .filter((label) => label && label.rides > 0)
      .map((label) => buildPlannerCandidate(label, boardingCache, stopSignalCache))
      .filter(Boolean);

    const bestTransferCount = candidates.length
      ? Math.min(...candidates.map((candidate) => candidate.transferCount))
      : null;
    const directRoutes = directPlannerRoutes(fromStopIds, toStopIds);
    const sitting = pickPlannerCandidate(candidates, "sitting");
    const standing = pickPlannerCandidate(candidates, "standing");

    return {
      candidates,
      bestTransferCount,
      directRoutes,
      sitting,
      standing,
    };
  }

  function scanPlannerPattern(pattern, overallLabels, nextFrontier) {
    let activeBoard = null;
    for (let index = 0; index < pattern.stopIds.length; index += 1) {
      const stopId = pattern.stopIds[index];
      const reachable = overallLabels.get(stopId);
      if (reachable && reachable.rides < PLANNER_MAX_RIDES) {
        const boardCandidate = {
          label: reachable,
          boardStopId: stopId,
          boardIndex: index,
        };
        if (!activeBoard || plannerBoardCandidateBetter(boardCandidate, activeBoard)) {
          activeBoard = boardCandidate;
        }
      }
      if (!activeBoard || index <= activeBoard.boardIndex) {
        continue;
      }

      const candidate = {
        stopId,
        rides: activeBoard.label.rides + 1,
        travelStops: activeBoard.label.travelStops + (index - activeBoard.boardIndex),
        previousLabel: activeBoard.label,
        leg: {
          routeId: pattern.routeId,
          shapeId: pattern.shapeId,
          patternId: pattern.id,
          label: pattern.label,
          boardStopId: activeBoard.boardStopId,
          alightStopId: stopId,
          boardIndex: activeBoard.boardIndex,
          alightIndex: index,
        },
      };
      const current = overallLabels.get(stopId);
      if (plannerLabelBetter(candidate, current)) {
        overallLabels.set(stopId, candidate);
        nextFrontier.add(stopId);
      }
    }
  }

  function plannerBoardCandidateBetter(left, right) {
    if (left.label.rides !== right.label.rides) {
      return left.label.rides < right.label.rides;
    }
    const leftRank = left.label.travelStops - left.boardIndex;
    const rightRank = right.label.travelStops - right.boardIndex;
    if (leftRank !== rightRank) {
      return leftRank < rightRank;
    }
    return left.boardIndex > right.boardIndex;
  }

  function plannerLabelBetter(left, right) {
    if (!right) {
      return true;
    }
    if (left.rides !== right.rides) {
      return left.rides < right.rides;
    }
    if (left.travelStops !== right.travelStops) {
      return left.travelStops < right.travelStops;
    }
    return false;
  }

  function buildPlannerCandidate(label, boardingCache, stopSignalCache) {
    const legs = [];
    let cursor = label;
    while (cursor?.leg) {
      legs.unshift(cursor.leg);
      cursor = cursor.previousLabel;
    }
    if (!legs.length) {
      return null;
    }
    const evaluatedLegs = legs.map((leg, index) => {
      const route = state.gtfs.routesByGtfsRouteId?.[leg.routeId] || null;
      const boarding = getPlannerBoardingSignal(leg.boardStopId, leg.routeId, boardingCache);
      return {
        ...leg,
        route,
        boarding,
        index,
      };
    });
    const destinationStopId = evaluatedLegs[evaluatedLegs.length - 1].alightStopId;
    const deboard = getPlannerStopSignal(destinationStopId, stopSignalCache);
    const transferCount = Math.max(0, evaluatedLegs.length - 1);
    const routeSummary = evaluatedLegs
      .map((leg) => leg.route?.shortName || leg.route?.gtfsRouteId || leg.routeId)
      .join(" → ");
    return {
      id: `${evaluatedLegs.map((leg) => `${leg.routeId}:${leg.boardStopId}:${leg.alightStopId}`).join("|")}`,
      label,
      legs: evaluatedLegs,
      transferCount,
      totalRideStops: label.travelStops,
      routeSummary,
      boardingSummary: summarizeBoardingSignal(evaluatedLegs[0]?.boarding),
      deboardSummary: summarizeDeboardSignal(deboard),
      deboard,
    };
  }

  function pickPlannerCandidate(candidates, mode) {
    if (!candidates.length) {
      return null;
    }
    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        modeLabel: capitalize(mode),
        score: scorePlannerCandidate(candidate, mode),
      }))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }
        if (left.transferCount !== right.transferCount) {
          return left.transferCount - right.transferCount;
        }
        return left.totalRideStops - right.totalRideStops;
      });
    return ranked[0] || null;
  }

  function scorePlannerCandidate(candidate, mode) {
    const boardingPenalty = candidate.legs.reduce((total, leg) => total + (leg.boarding?.comfortPenalty || 2.4), 0);
    const deboardPenalty = Math.max(0, candidate.deboard.netPressure || 0) * 0.9 + Math.max(0, (candidate.deboard.atStopCount || 0) - 2) * 0.15;
    const base = candidate.transferCount * 1800 + candidate.totalRideStops * 28;
    if (mode === "sitting") {
      return base + boardingPenalty * 170 + deboardPenalty * 42;
    }
    return base + boardingPenalty * 72 + deboardPenalty * 24;
  }

  function getPlannerBoardingSignal(stopId, routeId, cache) {
    const key = `${routeId}::${stopId}`;
    if (cache.has(key)) {
      return cache.get(key);
    }
    const stopMeta = state.gtfs.stopsById?.[stopId];
    const stopLocation = stopMeta?.location ? [Number(stopMeta.location[1]), Number(stopMeta.location[0])] : null;
    const matches = [];
    const routeVehicles = state.liveVehicles.filter((vehicle) => vehicle.route?.gtfsRouteId === routeId);
    for (const vehicle of routeVehicles) {
      const tripStops = state.gtfs.tripStopsByTripId?.[vehicle.tripId] || [];
      if (!tripStops.some((stop) => stop.stopId === stopId)) {
        continue;
      }
      const stopProgress = stopLocation ? projectPointAlongShape(stopLocation, vehicle.shapeId) : NaN;
      const vehicleProgress = Number.isFinite(vehicle.shapeProgress)
        ? vehicle.shapeProgress
        : projectPointAlongShape(vehicle.location, vehicle.shapeId);
      const delta = stopProgress - vehicleProgress;
      if (!Number.isFinite(delta) || delta < -120 || delta > PLANNER_APPROACH_DISTANCE_METERS) {
        continue;
      }
      matches.push({
        vehicle,
        delta,
        occupancyPressure: occupancyPressure(vehicle.vehiclePosition?.occupancyStatus),
      });
    }
    matches.sort((left, right) => {
      if (left.occupancyPressure !== right.occupancyPressure) {
        return left.occupancyPressure - right.occupancyPressure;
      }
      return left.delta - right.delta;
    });
    const bestVehicle = matches[0]?.vehicle || null;
    const routeAveragePressure = average(routeVehicles.map((vehicle) => occupancyPressure(vehicle.vehiclePosition?.occupancyStatus)).filter(Number.isFinite));
    const stopPressure = stopHeatScore(stopId, 1) - stopHeatScore(stopId, -1);
    const bestPressure = Number.isFinite(matches[0]?.occupancyPressure)
      ? matches[0].occupancyPressure
      : Number.isFinite(routeAveragePressure)
        ? routeAveragePressure
        : 2.7;
    const signal = {
      bestVehicle,
      matchCount: matches.length,
      etaLabel: matches.length ? estimateStopEtaLabel(matches[0].vehicle, matches[0].delta) : "",
      occupancyLabel: bestVehicle ? formatOccupancyStatus(bestVehicle.vehiclePosition?.occupancyStatus) : "Live telemetry limited",
      occupancyStatus: bestVehicle?.vehiclePosition?.occupancyStatus || "",
      comfortPenalty: bestPressure + Math.max(0, stopPressure) * 0.45,
      stopPressure,
    };
    cache.set(key, signal);
    return signal;
  }

  function getPlannerStopSignal(stopId, cache) {
    if (cache.has(stopId)) {
      return cache.get(stopId);
    }
    const pressure = stopHeatScore(stopId, 1);
    const relief = stopHeatScore(stopId, -1);
    const liveContext = deriveStopLiveContext(stopId);
    const signal = {
      netPressure: pressure - relief,
      pressure,
      relief,
      atStopCount: liveContext.atStop.length,
      approachingCount: liveContext.approaching.length,
    };
    cache.set(stopId, signal);
    return signal;
  }

  function summarizeBoardingSignal(signal) {
    if (!signal) {
      return "Telemetry limited";
    }
    if (signal.occupancyStatus && occupancyPressure(signal.occupancyStatus) < 3) {
      return `${signal.occupancyLabel}${signal.etaLabel ? ` • ${signal.etaLabel}` : ""}`;
    }
    if (signal.matchCount) {
      return `${signal.occupancyLabel}${signal.etaLabel ? ` • ${signal.etaLabel}` : ""}`;
    }
    return "Estimated from route trend";
  }

  function summarizeDeboardSignal(signal) {
    if (!signal) {
      return "Telemetry limited";
    }
    if (signal.netPressure > 0.9) {
      return "Busier stop exit";
    }
    if (signal.netPressure < -0.9) {
      return "Easy exit";
    }
    return "Balanced exit";
  }

  function renderPlannerCandidateCard(candidate, modeLabel) {
    const destinationStopId = candidate.legs[candidate.legs.length - 1]?.alightStopId || "";
    const transferMarkup = candidate.legs
      .slice(1)
      .map((leg, index) => renderPlannerTransfer(leg, index + 1))
      .join("");
    return `<article class="plan-card"><div class="plan-card-header"><p class="plan-card-kicker">${escapeHtml(
      modeLabel
    )}</p><p class="plan-card-title">${escapeHtml(candidate.routeSummary)}</p></div><div class="plan-card-meta">${planPillMarkup(
      `${candidate.transferCount} transfer${candidate.transferCount === 1 ? "" : "s"}`,
      "sync_alt"
    )}${planPillMarkup(`${candidate.totalRideStops} stop hops`, "route")}${planPillMarkup(
      candidate.boardingSummary,
      occupancyStatusIconName(candidate.legs[0]?.boarding?.occupancyStatus) || "airline_seat_recline_normal"
    )}${planPillMarkup(candidate.deboardSummary, "exit_to_app")}</div><p class="plan-card-copy">${escapeHtml(
      modeLabel === plannerModeLabel("sitting")
        ? "Weighted toward seats, lower boarding pressure, and easier exits while still minimizing transfers."
        : "Weighted toward directness and low-transfer movement, while tolerating denser boarding when needed."
    )}</p><div class="plan-card-timeline"><div class="plan-card-legs">${renderPlannerStart(candidate)}${renderPlannerLeg(
      candidate.legs[0],
      0,
      true
    )}${transferMarkup}${renderPlannerArrival(destinationStopId, candidate.deboardSummary)}</div></div></article>`;
  }

  function plannerModeLabel(mode) {
    return mode === "standing" ? "Convenience" : "Comfort";
  }

  function plannerModeIcon(mode) {
    return mode === "standing" ? "bolt" : "event_seat";
  }

  function renderPlannerLeg(leg, index, isPrimary) {
    const routeLabel = leg.route?.shortName ? `Route ${leg.route.shortName}` : leg.route?.longName || leg.routeId;
    const routeDot = routeColorDotMarkup(leg.route?.color, "small");
    return `<div class="plan-card-leg plan-card-leg-ride"><span class="plan-leg-index">${index + 1}</span><div class="plan-leg-content"><p class="bus-stop-name bus-stop-name-row">${routeDot}<span>${escapeHtml(
      routeLabel
    )}</span></p><p class="plan-leg-copy">${escapeHtml(
      `Board at ${plannerStopLabel(leg.boardStopId)} and ride toward ${leg.label}`
    )}</p><p class="bus-stop-meta">${escapeHtml(
      `${Math.max(1, leg.alightIndex - leg.boardIndex)} stop${Math.max(1, leg.alightIndex - leg.boardIndex) === 1 ? "" : "s"} • exit at ${plannerStopLabel(leg.alightStopId)}`
    )}</p></div></div>`;
  }

  function renderPlannerStart(candidate) {
    const firstLeg = candidate.legs[0];
    return `<div class="plan-card-leg plan-card-leg-anchor"><span class="plan-leg-index material-symbols-rounded" aria-hidden="true">trip_origin</span><div class="plan-leg-content"><p class="bus-stop-name">${escapeHtml(
      `Start near ${plannerStopLabel(firstLeg.boardStopId)}`
    )}</p><p class="plan-leg-copy">${escapeHtml(
      `${plannerModeLabel(state.plannerPreference)}-weighted boarding at the best stop found inside your From region.`
    )}</p></div></div>`;
  }

  function renderPlannerTransfer(leg, index) {
    return `<div class="plan-card-leg plan-card-leg-transfer"><span class="plan-leg-index material-symbols-rounded" aria-hidden="true">sync_alt</span><div class="plan-leg-content"><p class="bus-stop-name">${escapeHtml(
      `Transfer at ${plannerStopLabel(leg.boardStopId)}`
    )}</p><p class="plan-leg-copy">${escapeHtml(
      `Switch here to continue toward ${leg.label}.`
    )}</p></div></div>${renderPlannerLeg(
      leg,
      index,
      false
    )}`;
  }

  function renderPlannerArrival(stopId, deboardSummary) {
    return `<div class="plan-card-leg plan-card-leg-anchor"><span class="plan-leg-index material-symbols-rounded" aria-hidden="true">place</span><div class="plan-leg-content"><p class="bus-stop-name">${escapeHtml(
      `Arrive near ${plannerStopLabel(stopId)}`
    )}</p><p class="plan-leg-copy">${escapeHtml(deboardSummary)}</p></div></div>`;
  }

  function renderPlannerStopRegion(title, role, stopIds) {
    const items = stopIds
      .slice(0, 18)
      .map((stopId) => {
        const routeIds = state.stopRouteIdsByStopId.get(stopId) || [];
        const pressure = stopHeatScore(stopId, 1) - stopHeatScore(stopId, -1);
        const pressureLabel = pressure > 0.9 ? "Pressure" : pressure < -0.9 ? "Relief" : "Balanced";
        return `<article class="bus-stop-item bus-stop-item-button" data-stop-id="${escapeAttr(
          stopId
        )}" role="button" tabindex="0"><p class="bus-stop-name">${escapeHtml(
          plannerStopLabel(stopId)
        )}</p><p class="bus-stop-meta">${escapeHtml(
          `${routeIds.length} route${routeIds.length === 1 ? "" : "s"} • ${pressureLabel}`
        )}</p></article>`;
      })
      .join("");
    return `<section class="bus-stop-group"><p class="bus-stop-group-title">${escapeHtml(
      `${title} • ${capitalize(role)}`
    )}</p>${items}</section>`;
  }

  function planPillMarkup(value, icon) {
    return `<span class="plan-pill">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      icon
    )}</span>` : ""}<span>${escapeHtml(value)}</span></span>`;
  }

  function plannerStopLabel(stopId) {
    return state.gtfs.stopsById?.[stopId]?.displayName || state.gtfs.stopsById?.[stopId]?.name || stopId;
  }

  function summarizePlannerRoutes(candidate) {
    return candidate?.routeSummary || "Unavailable";
  }

  function directPlannerRoutes(fromStopIds, toStopIds) {
    const fromRoutes = new Set(
      fromStopIds.flatMap((stopId) => state.stopRouteIdsByStopId.get(stopId) || [])
    );
    const direct = new Set();
    for (const stopId of toStopIds) {
      for (const routeId of state.stopRouteIdsByStopId.get(stopId) || []) {
        if (fromRoutes.has(routeId)) {
          direct.add(state.gtfs.routesByGtfsRouteId?.[routeId]?.shortName || routeId);
        }
      }
    }
    return [...direct].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }

  function plannerFocusedRouteIds() {
    const selectedCandidate = currentPlannerCandidate();
    if (!selectedCandidate) {
      return new Set();
    }
    const routeIds = new Set();
    for (const leg of selectedCandidate.legs) {
      routeIds.add(leg.routeId);
    }
    return routeIds;
  }

  function plannerIsolationActive() {
    return Boolean(
      hasPlannerSelection() &&
      currentPlannerCandidate() &&
      !state.selectedBusId &&
      !state.selectedStopId &&
      !state.selectedRouteId &&
      !state.selectedRouteLegendKey
    );
  }

  function renderRoutePanel(routeId) {
    const usingLegendGroup = state.selectedRouteLegendKey && state.selectedRouteLegendRouteIds.includes(routeId);
    const focusedRouteIds = usingLegendGroup && state.selectedRouteLegendRouteIds.length
      ? [...state.selectedRouteLegendRouteIds]
      : [routeId];
    const primaryRoute = state.gtfs.routesByGtfsRouteId?.[routeId] || null;
    const titleLabel = usingLegendGroup
      ? state.selectedRouteLegendKey
      : primaryRoute?.shortName
        ? `Route ${primaryRoute.shortName}`
        : primaryRoute?.longName || routeId;
    const subtitleLabel = usingLegendGroup
      ? `Grouped variants • ${focusedRouteIds.length} patterns`
      : primaryRoute?.longName || routeId;
    const vehicles = state.liveVehicles
      .filter((vehicle) => focusedRouteIds.includes(vehicle.route?.gtfsRouteId))
      .sort((left, right) => {
        const occupancyDiff = occupancyPressure(right.vehiclePosition?.occupancyStatus) - occupancyPressure(left.vehiclePosition?.occupancyStatus);
        if (Number.isFinite(occupancyDiff) && occupancyDiff !== 0) {
          return occupancyDiff;
        }
        return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
      });
    const activeVehicleCount = vehicles.length;
    const occupancySummary = summarizeOccupancy(vehicles);
    const statusSummary = summarizeStopStatus(vehicles);
    const congestionSummary = summarizeCongestion(vehicles);
    const averageSpeedMph = average(numbersFromVehicles(vehicles, resolveVehicleSpeedMph));
    const latestUpdate = latestTimestamp(vehicles.map((vehicle) => vehicle.updatedAt));
    const pressureZones = focusedRouteIds.reduce((total, currentRouteId) => total + countHeatEntriesForRoute(currentRouteId, 1), 0);
    const reliefZones = focusedRouteIds.reduce((total, currentRouteId) => total + countHeatEntriesForRoute(currentRouteId, -1), 0);
    const directionSummary = summarizeDirections(vehicles);
    const dominantHeadsign = summarizeHeadsigns(vehicles);
    const liveCoverage = vehicles.filter((vehicle) => canonicalOccupancyStatus(vehicle.vehiclePosition?.occupancyStatus)).length;
    const history = usingLegendGroup
      ? mergeRouteHistory(focusedRouteIds)
      : state.routeAnalyticsHistory.get(routeId) || [];

    dom.busPanel.hidden = false;
    applyFocusTint("route", primaryRoute?.color || "", "");
    setBusPanelMetaCardVisible(false);
    dom.busPanelMetaLabel.textContent = "Route profile";
    dom.busPanelListLabel.textContent = "Live fleet by direction";
    setHeaderWithIcon(dom.busPanelKicker, "route", titleLabel);
    setHeaderWithIcon(dom.busPanelTitle, "analytics", subtitleLabel);
    dom.busPanelMeta.innerHTML = [
      chipMarkup(usingLegendGroup ? state.selectedRouteLegendKey : primaryRoute?.gtfsRouteId || routeId, "badge"),
      chipMarkup(`${activeVehicleCount} active buses`, "directions_bus"),
      dominantHeadsign ? chipMarkup(dominantHeadsign, "flag") : "",
      directionSummary ? chipMarkup(directionSummary, "explore") : "",
      pressureZones ? chipMarkup(`${pressureZones} pressure zone${pressureZones === 1 ? "" : "s"}`, "warning") : "",
      reliefZones ? chipMarkup(`${reliefZones} relief zone${reliefZones === 1 ? "" : "s"}`, "eco") : "",
    ].join("");
    dom.busPanelMetaExtra.innerHTML = renderRouteHistoryCard(history, averageOccupancyPressure(vehicles));
    setBusPanelSpotlights("", "");

    const stats = [
      statMarkup("Active buses", String(activeVehicleCount)),
      statMarkup("Avg speed", formatSpeedValue(averageSpeedMph)),
      statMarkup("Occupancy coverage", `${liveCoverage}/${activeVehicleCount || 0}`),
      statMarkup("Crowded buses", String(occupancySummary.crowded)),
      statMarkup("Pressure zones", String(pressureZones)),
      statMarkup("Relief zones", String(reliefZones)),
      statMarkup("Stopped", String(statusSummary.stopped)),
      statMarkup("In transit", String(statusSummary.inTransit)),
      statMarkup("Congested", String(congestionSummary.congested)),
      statMarkup("Latest update", latestUpdate || "Unknown"),
    ];

    dom.busPanelGridLeft.innerHTML = stats.join("");
    dom.busStopList.innerHTML = vehicles.length
      ? renderGroupedRouteFleet(vehicles).join("")
      : `<article class="bus-stop-item"><p class="bus-stop-name">No live vehicles on this route</p><p class="bus-stop-meta">Wait for the next refresh cycle</p></article>`;
  }

  function renderStopPanel(stopId) {
    const stopMeta = state.gtfs.stopsById?.[stopId];
    if (!stopMeta) {
      return;
    }
    const routeIds = state.stopRouteIdsByStopId.get(stopId) || [];
    const liveContext = deriveStopLiveContext(stopId);
    const pressureScore = stopHeatScore(stopId, 1);
    const reliefScore = stopHeatScore(stopId, -1);
    const stopLabel = stopMeta.displayName || stopMeta.name || stopId;

    dom.busPanel.hidden = false;
    applyFocusTint("neutral", "", "");
    setBusPanelMetaCardVisible(true);
    dom.busPanelMetaLabel.textContent = "Stop profile";
    dom.busPanelListLabel.textContent = "Live arrivals";
    setHeaderWithIcon(dom.busPanelKicker, "signpost", "Focused stop");
    setHeaderWithIcon(dom.busPanelTitle, "location_on", stopLabel);
    dom.busPanelMeta.innerHTML = [
      chipMarkup(`Code ${stopMeta.code || "N/A"}`, "pin_drop"),
      chipMarkup(`${routeIds.length} route${routeIds.length === 1 ? "" : "s"}`, "route"),
      liveContext.atStop.length ? chipMarkup(`${liveContext.atStop.length} at stop`, "pause_circle") : "",
      liveContext.approaching.length ? chipMarkup(`${liveContext.approaching.length} approaching`, "schedule") : "",
      pressureScore > 0 ? chipMarkup("Pressure point", "warning") : "",
      reliefScore > 0 ? chipMarkup("Relief point", "eco") : "",
    ].join("");
    dom.busPanelMetaExtra.innerHTML = renderStopPressureCard(pressureScore, reliefScore);
    setBusPanelSpotlights("", "");

    const activeRouteLabels = [...new Set(
      routeIds
        .map((routeId) => state.gtfs.routesByGtfsRouteId?.[routeId])
        .filter(Boolean)
        .map((route) => String(route.shortName || route.longName || route.gtfsRouteId || "").trim())
        .filter(Boolean)
    )].join(" • ");

    const stats = [
      statMarkup("Stop code", stopMeta.code || "Unavailable"),
      statMarkup("Serving routes", activeRouteLabels || "Unavailable"),
      statMarkup("Live approaching", String(liveContext.approaching.length)),
      statMarkup("At stop", String(liveContext.atStop.length)),
      statMarkup("Recent pass-by", String(liveContext.justPassed.length)),
      statMarkup("Pressure zones", String(pressureScore)),
      statMarkup("Relief zones", String(reliefScore)),
      statMarkup("Active route groups", String(new Set(liveContext.relevantVehicles.map((vehicle) => vehicle.route.gtfsRouteId)).size)),
      statMarkup("Busiest route", liveContext.busiestRouteLabel || "Unavailable"),
      statMarkup("Occupancy mix", liveContext.occupancySummary || "Telemetry limited"),
    ];
    dom.busPanelGridLeft.innerHTML = stats.join("");

    const arrivals = [...liveContext.atStop, ...liveContext.approaching, ...liveContext.justPassed];
    dom.busStopList.innerHTML = arrivals.length
      ? arrivals
        .slice(0, 12)
        .map((entry) => renderStopArrivalItem(entry))
        .join("")
      : `<article class="bus-stop-item"><p class="bus-stop-name">No live vehicles mapped to this stop</p><p class="bus-stop-meta">Routes serve this stop, but no active buses currently match it.</p></article>`;
    updateStatus(stopLabel, `${routeIds.length} serving routes • ${arrivals.length} live buses linked`);
  }

  function renderRouteVehicleItem(vehicle) {
    const occupancy = formatOccupancyStatus(vehicle.vehiclePosition?.occupancyStatus);
    const speed = formatSpeed(vehicle);
    const status = formatVehicleStopStatus(vehicle.vehiclePosition?.currentStatus);
    const updated = formatTimestamp(vehicle.updatedAt);
    const occupancyIcon = occupancyStatusIconName(vehicle.vehiclePosition?.occupancyStatus);
    return `<article class="bus-stop-item bus-stop-item-button" data-vehicle-id="${escapeAttr(vehicle.id)}" role="button" tabindex="0"><p class="bus-stop-name bus-stop-name-row">${routeColorDotMarkup(
      vehicle.route?.color
    )}${occupancyIcon ? `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      occupancyIcon
    )}</span>` : ""}<span>Bus ${escapeHtml(
      vehicle.id
    )} • ${escapeHtml(vehicle.headsign || vehicle.route.longName || vehicle.route.gtfsRouteId)}</span></p><p class="bus-stop-meta">${escapeHtml(
      [occupancy, speed, status].filter((value) => value && value !== "Unavailable").join(" • ") || "Live telemetry limited"
    )}</p><p class="bus-stop-meta">${escapeHtml(updated)}</p></article>`;
  }

  function renderStopArrivalItem(entry) {
    const vehicle = entry.vehicle;
    const occupancy = formatOccupancyStatus(vehicle.vehiclePosition?.occupancyStatus);
    const status = entry.stateLabel;
    const routeLabel = vehicle.route.shortName ? `Route ${vehicle.route.shortName}` : vehicle.route.longName || vehicle.route.gtfsRouteId;
    const eta = entry.etaLabel || (entry.distanceMeters > 0 ? `${Math.round(entry.distanceMeters)}m out` : "At stop");
    return `<article class="bus-stop-item bus-stop-item-button" data-vehicle-id="${escapeAttr(vehicle.id)}" role="button" tabindex="0"><p class="bus-stop-name bus-stop-name-row"><span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      occupancyStatusIconName(vehicle.vehiclePosition?.occupancyStatus)
    )}</span><span>${escapeHtml(routeLabel)} • ${escapeHtml(vehicle.headsign || `Bus ${vehicle.id}`)}</span></p><p class="bus-stop-meta">${escapeHtml(
      [status, eta, occupancy].filter(Boolean).join(" • ")
    )}</p><p class="bus-stop-meta bus-stop-name-row">${routeColorDotMarkup(vehicle.route?.color)}<span>${escapeHtml(
      `Bus ${vehicle.id} • ${formatTimestamp(vehicle.updatedAt)}`
    )}</span></p></article>`;
  }

  function renderGroupedRouteFleet(vehicles) {
    const groups = new Map();
    for (const vehicle of vehicles) {
      const direction = String(vehicle.direction?.name || vehicle.direction?.shortName || "").trim() || "Unlabeled";
      const headsign = String(vehicle.headsign || "").trim() || "In service";
      const key = `${direction}||${headsign}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: `${direction} • ${headsign}`,
          vehicles: [],
        });
      }
      groups.get(key).vehicles.push(vehicle);
    }
    return [...groups.values()].map(
      (group) =>
        `<section class="bus-stop-group"><p class="bus-stop-group-title">${escapeHtml(group.title)}</p>${group.vehicles
          .map((vehicle) => renderRouteVehicleItem(vehicle))
          .join("")}</section>`
    );
  }

  function renderBusMetaSpark(label, value, sparklineMarkup) {
    return `<article class="spark-card"><div class="spark-card-row"><p class="spark-card-label">${escapeHtml(
      label
    )}</p><p class="spark-card-value">${escapeHtml(value)}</p></div>${sparklineMarkup}</article>`;
  }

  function routeColorDotMarkup(color, size = "") {
    const normalized = normalizeColor(color) || "#9f9687";
    const sizeClass = size ? ` route-color-dot-${size}` : "";
    return `<span class="route-color-dot${sizeClass}" style="--route-dot:${escapeAttr(normalized)}" aria-hidden="true"></span>`;
  }

  function plannerJourneyStopFeatures() {
    const candidate = currentPlannerCandidate();
    if (!candidate?.legs?.length) {
      return [];
    }
    const stopMap = new Map();
    for (const leg of candidate.legs) {
      const pattern = state.plannerModel?.patternById?.get?.(leg.patternId);
      const stopIds = Array.isArray(pattern?.stopIds)
        ? pattern.stopIds.slice(leg.boardIndex, leg.alightIndex + 1)
        : [leg.boardStopId, leg.alightStopId].filter(Boolean);
      for (const stopId of stopIds) {
        const feature = state.stopFeaturesById.get(stopId);
        if (feature) {
          stopMap.set(stopId, feature);
        }
      }
    }
    return [...stopMap.values()];
  }

  function buildPlannerJourneyFeatures(candidate) {
    if (!candidate?.legs?.length) {
      return [];
    }
    const features = [];
    let featureId = 1;
    for (const leg of candidate.legs) {
      const route = leg.route || state.gtfs.routesByGtfsRouteId?.[leg.routeId] || {};
      const coordinates = plannerLegCoordinates(leg);
      if (coordinates.length < 2) {
        continue;
      }
      features.push({
        id: `planner-leg-${featureId++}`,
        type: "Feature",
        properties: {
          routeId: leg.routeId,
          shapeId: leg.shapeId || "",
          routeShortName: route.shortName || "",
          routeLongName: route.longName || "",
          routeColor: route.color || "#d9d1c3",
          lineWidth: routeStrokeWidth(route.shortName || route.longName) + 0.45,
          outlineWidth: routeStrokeWidth(route.shortName || route.longName) + 2.8,
          lineOpacity: 1,
          outlineOpacity: state.showRouteBorders ? (dom.body.dataset.theme === "dark" ? 0.84 : 1) : 0,
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      });
    }
    return features;
  }

  function plannerLegCoordinates(leg) {
    const shapeId = String(leg?.shapeId || "").trim();
    const boardStop = state.gtfs.stopsById?.[leg?.boardStopId];
    const alightStop = state.gtfs.stopsById?.[leg?.alightStopId];
    if (!shapeId || !boardStop?.location || !alightStop?.location) {
      return [];
    }
    const fromLocation = [Number(boardStop.location[1]), Number(boardStop.location[0])];
    const toLocation = [Number(alightStop.location[1]), Number(alightStop.location[0])];
    const startProgress = projectPointAlongShape(fromLocation, shapeId);
    const endProgress = projectPointAlongShape(toLocation, shapeId);
    return sliceShapeCoordinates(shapeId, startProgress, endProgress);
  }

  function sliceShapeCoordinates(shapeId, startProgress, endProgress) {
    const measured = getMeasuredShape(shapeId);
    if (!measured || measured.points.length < 2) {
      return [];
    }
    const start = clamp(Math.min(startProgress, endProgress), 0, measured.length);
    const end = clamp(Math.max(startProgress, endProgress), 0, measured.length);
    const startSample = sampleShapeAtProgress(shapeId, start).location;
    const endSample = sampleShapeAtProgress(shapeId, end).location;
    if (!startSample || !endSample) {
      return [];
    }
    const coordinates = [startSample];
    for (const point of measured.points) {
      if (point.progress > start && point.progress < end) {
        coordinates.push([point.lon, point.lat]);
      }
    }
    coordinates.push(endSample);
    return dedupeConsecutiveCoordinates(coordinates);
  }

  function dedupeConsecutiveCoordinates(coordinates) {
    const deduped = [];
    for (const coordinate of coordinates) {
      const prev = deduped[deduped.length - 1];
      if (!prev || prev[0] !== coordinate[0] || prev[1] !== coordinate[1]) {
        deduped.push(coordinate);
      }
    }
    return deduped;
  }

  function deriveStopLiveContext(stopId) {
    const relevantVehicles = [];
    const approaching = [];
    const atStop = [];
    const justPassed = [];
    const routeLoad = new Map();
    const occupancyCounts = new Map();
    const stopMeta = state.gtfs.stopsById?.[stopId];
    const stopLocation = stopMeta?.location ? [Number(stopMeta.location[1]), Number(stopMeta.location[0])] : null;

    for (const vehicle of state.liveVehicles) {
      const tripStops = state.gtfs.tripStopsByTripId?.[vehicle.tripId] || [];
      const targetStop = tripStops.find((item) => item.stopId === stopId);
      if (!targetStop) {
        continue;
      }
      relevantVehicles.push(vehicle);
      routeLoad.set(vehicle.route.gtfsRouteId, (routeLoad.get(vehicle.route.gtfsRouteId) || 0) + 1);
      const occupancyKey = canonicalOccupancyStatus(vehicle.vehiclePosition?.occupancyStatus) || "UNKNOWN";
      occupancyCounts.set(occupancyKey, (occupancyCounts.get(occupancyKey) || 0) + 1);

      const stopProgress = stopLocation ? projectPointAlongShape(stopLocation, vehicle.shapeId) : NaN;
      const vehicleProgress = Number.isFinite(vehicle.shapeProgress) ? vehicle.shapeProgress : projectPointAlongShape(vehicle.location, vehicle.shapeId);
      const delta = stopProgress - vehicleProgress;
      const entry = {
        vehicle,
        distanceMeters: Number.isFinite(delta) ? Math.round(Math.abs(delta)) : NaN,
        etaLabel: estimateStopEtaLabel(vehicle, delta),
        stateLabel: classifyVehicleAtStop(vehicle, stopId, delta),
      };

      if (entry.stateLabel === "At stop" || entry.stateLabel === "Incoming") {
        atStop.push(entry);
      } else if (Number.isFinite(delta) && delta > 0 && delta <= 2600) {
        approaching.push(entry);
      } else if (Number.isFinite(delta) && delta < 0 && delta >= -700) {
        justPassed.push(entry);
      }
    }

    const busiestRoute = [...routeLoad.entries()].sort((left, right) => right[1] - left[1])[0];
    return {
      relevantVehicles,
      approaching: sortStopEntries(approaching),
      atStop: sortStopEntries(atStop),
      justPassed: sortStopEntries(justPassed),
      busiestRouteLabel: busiestRoute
        ? state.gtfs.routesByGtfsRouteId?.[busiestRoute[0]]?.shortName || busiestRoute[0]
        : "",
      occupancySummary: summarizeStopOccupancyMix(occupancyCounts),
    };
  }

  function sortStopEntries(entries) {
    return [...entries].sort((left, right) => {
      if (left.stateLabel !== right.stateLabel) {
        if (left.stateLabel === "At stop") {
          return -1;
        }
        if (right.stateLabel === "At stop") {
          return 1;
        }
      }
      return (left.distanceMeters || Infinity) - (right.distanceMeters || Infinity);
    });
  }

  function classifyVehicleAtStop(vehicle, stopId, delta) {
    const status = String(vehicle.vehiclePosition?.currentStatus || "");
    if (String(vehicle.vehiclePosition?.stopId || "") === stopId) {
      return status === "1" || status === "STOPPED_AT" ? "At stop" : "Incoming";
    }
    if (Number.isFinite(delta)) {
      if (Math.abs(delta) <= 90) {
        return "At stop";
      }
      if (delta > 0 && delta <= 380) {
        return "Incoming";
      }
      if (delta < 0 && delta >= -700) {
        return "Just passed";
      }
    }
    return "Approaching";
  }

  function estimateStopEtaLabel(vehicle, delta) {
    if (!Number.isFinite(delta)) {
      return "";
    }
    if (Math.abs(delta) <= 90) {
      return "Now";
    }
    if (delta < 0) {
      return `${Math.round(Math.abs(delta))}m past`;
    }
    const speedMph = resolveVehicleSpeedMph(vehicle);
    if (!Number.isFinite(speedMph) || speedMph < 3) {
      return `${Math.round(delta)}m out`;
    }
    const minutes = (delta / (speedMph * 26.8224)) || 0;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return `${Math.round(delta)}m out`;
    }
    return minutes < 1 ? "<1 min" : `${Math.round(minutes)} min`;
  }

  function summarizeStopOccupancyMix(occupancyCounts) {
    const crowded = (occupancyCounts.get("STANDING_ROOM_ONLY") || 0) + (occupancyCounts.get("CRUSHED_STANDING_ROOM_ONLY") || 0) + (occupancyCounts.get("FULL") || 0);
    const seated = (occupancyCounts.get("EMPTY") || 0) + (occupancyCounts.get("MANY_SEATS_AVAILABLE") || 0) + (occupancyCounts.get("FEW_SEATS_AVAILABLE") || 0);
    if (!crowded && !seated) {
      return "Telemetry limited";
    }
    if (crowded > seated) {
      return `${crowded} crowded • ${seated} seated`;
    }
    return `${seated} seated • ${crowded} crowded`;
  }

  function renderRouteHistoryCard(history, currentAverage) {
    return renderBusMetaSpark(
      "Crowding trend",
      Number.isFinite(currentAverage) ? occupancyPressureLabel(currentAverage) : "Live telemetry limited",
      routeHistorySparkline(history)
    );
  }

  function renderStopPressureCard(pressureScore, reliefScore) {
    const balance = clamp(reliefScore - pressureScore, -5, 5);
    const value =
      balance > 0.9 ? "Easing" : balance < -0.9 ? "Building up" : "Balanced";
    const bias = Math.abs(balance) > 0.45 ? `${Math.abs(balance).toFixed(1)} intensity` : "Low variance";
    const toneClass = balance > 0.9 ? "spark-card-relief" : balance < -0.9 ? "spark-card-pressure" : "spark-card-balanced";
    return `<article class="spark-card ${toneClass}"><div class="spark-card-row"><p class="spark-card-label">${escapeHtml(
      "Stop pressure"
    )}</p><p class="spark-card-value">${escapeHtml(`${value} • ${bias}`)}</p></div></article>`;
  }

  function chipMarkup(value, icon) {
    return `<span class="bus-chip">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      icon
    )}</span>` : ""}<span>${escapeHtml(value)}</span></span>`;
  }

  function statMarkup(label, value) {
    const icon = statIconName(label);
    return `<article class="bus-stat"><p class="bus-stat-label"><span class="bus-stat-label-row">${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      icon
    )}</span>` : ""}${escapeHtml(label)}</span></p><p class="bus-stat-value">${escapeHtml(
      value
    )}</p></article>`;
  }

  function statIconName(label) {
    switch (String(label || "")) {
      case "Next stop":
        return "signpost";
      case "Stop code":
        return "pin_drop";
      case "Serving routes":
        return "route";
      case "From region":
        return "trip_origin";
      case "To region":
        return "place";
      case "Direct routes":
        return "merge_type";
      case "Fewest transfers":
        return "sync_alt";
      case "Preferred mode":
        return "tune";
      case "Recommended route":
        return "alt_route";
      case "Best sitting":
        return "event_seat";
      case "Best standing":
        return "bolt";
      case "Boarding ease":
        return "login";
      case "Deboard ease":
        return "exit_to_app";
      case "Live approaching":
        return "schedule";
      case "At stop":
        return "pause_circle";
      case "Recent pass-by":
        return "moving";
      case "Direction":
        return "explore";
      case "Stop status":
        return "commute";
      case "Occupancy":
        return "airline_seat_recline_normal";
      case "Congestion":
        return "traffic";
      case "Traffic":
        return "timeline";
      case "Destination":
        return "flag";
      case "Speed":
        return "speed";
      case "Fleet status":
        return "directions_bus";
      case "Boarding":
        return "accessible";
      case "Updated":
        return "schedule";
      case "Trip id":
        return "badge";
      case "Active buses":
        return "route";
      case "Avg speed":
        return "speed";
      case "Occupancy coverage":
        return "analytics";
      case "Crowded buses":
        return "groups";
      case "Pressure zones":
        return "warning";
      case "Relief zones":
        return "eco";
      case "Active route groups":
        return "hub";
      case "Busiest route":
        return "trending_up";
      case "Occupancy mix":
        return "groups";
      case "Stopped":
        return "pause_circle";
      case "In transit":
        return "moving";
      case "Congested":
        return "traffic_jam";
      case "Latest update":
        return "update";
      case "Loading":
        return "progress_activity";
      default:
        return "";
    }
  }

  function occupancyStatusIconName(value) {
    switch (canonicalOccupancyStatus(value)) {
      case "EMPTY":
        return "airline_seat_flat";
      case "MANY_SEATS_AVAILABLE":
        return "event_seat";
      case "FEW_SEATS_AVAILABLE":
        return "weekend";
      case "STANDING_ROOM_ONLY":
        return "accessibility_new";
      case "CRUSHED_STANDING_ROOM_ONLY":
      case "FULL":
        return "groups";
      case "NOT_ACCEPTING_PASSENGERS":
        return "block";
      default:
        return "airline_seat_recline_normal";
    }
  }

  function setHeaderWithIcon(element, icon, text) {
    if (!element) {
      return;
    }
    element.innerHTML = `${icon ? `<span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(
      icon
    )}</span>` : ""}<span>${escapeHtml(text)}</span>`;
  }

  function formatNextStop(nextStop, departure) {
    if (!nextStop) {
      return "Unavailable";
    }
    if (departure?.departsIn) {
      return `${nextStop.name || nextStop.stopId} • ${departure.departsIn}`;
    }
    return nextStop.displayName || nextStop.name || nextStop.stopId;
  }

  function formatTrafficProxy(delayMinutes, departure, vehicle) {
    if (delayMinutes === null) {
      const congestion = formatCongestionLevel(vehicle?.vehiclePosition?.congestionLevel);
      if (congestion !== "Unavailable" && congestion !== "Unknown") {
        return congestion;
      }
      const speedMph = resolveVehicleSpeedMph(vehicle);
      const stopStatus = String(vehicle?.vehiclePosition?.currentStatus || "");
      if (stopStatus === "1" || stopStatus === "STOPPED_AT") {
        return "Stopped at stop";
      }
      if (Number.isFinite(speedMph)) {
        if (speedMph < 6) {
          return "Slow movement";
        }
        if (speedMph < 14) {
          return "Moderate flow";
        }
        return "Running smoothly";
      }
      return departure ? "Realtime only" : "No delay feed";
    }
    if (delayMinutes <= 1) {
      return "On time";
    }
    if (delayMinutes <= 4) {
      return `${delayMinutes} min delay`;
    }
    return `${delayMinutes} min heavy delay`;
  }

  function formatVehicleStopStatus(value) {
    switch (String(value)) {
      case "0":
      case "INCOMING_AT":
        return "Incoming";
      case "1":
      case "STOPPED_AT":
        return "Stopped";
      case "2":
      case "IN_TRANSIT_TO":
        return "In transit";
      default:
        return "Unavailable";
    }
  }

  function formatCongestionLevel(value) {
    switch (String(value)) {
      case "1":
      case "RUNNING_SMOOTHLY":
        return "Running smoothly";
      case "2":
      case "STOP_AND_GO":
        return "Stop and go";
      case "3":
      case "CONGESTION":
        return "Congestion";
      case "4":
      case "SEVERE_CONGESTION":
        return "Severe congestion";
      case "0":
      case "UNKNOWN_CONGESTION_LEVEL":
        return "Unknown";
      default:
        return "Unavailable";
    }
  }

  function formatOccupancyStatus(value) {
    switch (canonicalOccupancyStatus(value)) {
      case "EMPTY":
        return "Empty";
      case "MANY_SEATS_AVAILABLE":
        return "Many seats";
      case "FEW_SEATS_AVAILABLE":
        return "Few seats";
      case "STANDING_ROOM_ONLY":
        return "Standing only";
      case "CRUSHED_STANDING_ROOM_ONLY":
        return "Crushed standing";
      case "FULL":
        return "Full";
      case "NOT_ACCEPTING_PASSENGERS":
        return "Not accepting";
      default:
        return "Unavailable";
    }
  }

  function formatStopSequence(value) {
    const number = Number(value || 0);
    return number > 0 ? String(number) : "Unavailable";
  }

  function formatSpeed(vehicle) {
    return formatSpeedValue(resolveVehicleSpeedMph(vehicle));
  }

  function formatSpeedValue(speedMph) {
    const speed = Number(speedMph);
    if (!Number.isFinite(speed)) {
      return "Unavailable";
    }
    return `${Math.round(speed)} mph`;
  }

  function formatVehicleConfig(vehicleMeta) {
    if (!vehicleMeta?.configurationId) {
      return "Unknown";
    }
    const year = vehicleMeta.dateInService ? vehicleMeta.dateInService.slice(0, 4) : "Fleet";
    return `${year} • ${vehicleMeta.configurationId.slice(0, 8)}`;
  }

  function formatDestination(departure, upcomingStops) {
    if (departure?.destination) {
      return departure.destination;
    }
    const terminal = upcomingStops?.[upcomingStops.length - 1];
    return terminal?.displayName || terminal?.name || "Unavailable";
  }

  function formatBoardingInfo(stop, departure) {
    const parts = [];
    if (stop?.city) {
      parts.push(stop.city);
    }
    if (stop?.isAccessible === true) {
      parts.push("Accessible");
    } else if (stop?.isAccessible === false) {
      parts.push("Not accessible");
    }
    if (stop?.isIStop || departure?.isIStop) {
      parts.push("I-Stop");
    }
    if (stop?.isStation) {
      parts.push("Station");
    }
    return parts.length ? parts.join(" • ") : "Standard stop";
  }

  function formatTripId(tripId) {
    const value = String(tripId || "").trim();
    if (!value) {
      return "Unavailable";
    }
    return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
  }

  function formatStopMetaLine(stop, liveStop) {
    const parts = [];
    if (liveStop?.stopCode || stop?.code) {
      parts.push(`Code ${liveStop?.stopCode || stop?.code}`);
    }
    if (liveStop?.city) {
      parts.push(liveStop.city);
    }
    if (stop?.stopSequence !== undefined) {
      parts.push(`Seq ${stop.stopSequence}`);
    }
    return escapeHtml(parts.join(" • ") || "Scheduled");
  }

  function formatTimestamp(value) {
    const stamp = new Date(value).getTime();
    if (!Number.isFinite(stamp)) {
      return "Unknown";
    }
    return new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(stamp);
  }

  function formatUnixTimestamp(value) {
    const stamp = Number(value || 0) * 1000;
    if (!Number.isFinite(stamp) || stamp <= 0) {
      return "Unavailable";
    }
    return new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(stamp);
  }

  function computeDelayMinutes(departure) {
    const scheduled = new Date(departure.scheduledDeparture || "").getTime();
    const estimated = new Date(departure.estimatedDeparture || "").getTime();
    if (!Number.isFinite(scheduled) || !Number.isFinite(estimated)) {
      return null;
    }
    return Math.max(0, Math.round((estimated - scheduled) / 60000));
  }

  function projectPointAlongShape(location, shapeId) {
    const measured = getMeasuredShape(shapeId);
    if (!measured || measured.points.length < 2) {
      return 0;
    }
    const point = { lon: Number(location[0]), lat: Number(location[1]) };
    let bestDistance = Infinity;
    let bestProgress = 0;

    for (let index = 0; index < measured.points.length - 1; index += 1) {
      const start = measured.points[index];
      const end = measured.points[index + 1];
      const projection = projectPointToSegmentMeters(point, start, end);
      if (projection.distance < bestDistance) {
        bestDistance = projection.distance;
        bestProgress = start.progress + projection.t * projection.segmentLength;
      }
    }

    return bestProgress;
  }

  function getMeasuredShape(shapeId) {
    if (state.shapeMeasureCache.has(shapeId)) {
      return state.shapeMeasureCache.get(shapeId);
    }
    const rawShape = state.gtfs.shapes?.[shapeId];
    if (!rawShape?.length) {
      return null;
    }

    let progress = 0;
    const points = rawShape.map((point, index) => {
      const current = { lat: Number(point[0]), lon: Number(point[1]), progress };
      if (index > 0) {
        progress += haversineMeters(rawShape[index - 1][0], rawShape[index - 1][1], point[0], point[1]);
        current.progress = progress;
      }
      return current;
    });

    const measured = { points, length: progress };
    state.shapeMeasureCache.set(shapeId, measured);
    return measured;
  }

  function sampleShapeAtProgress(shapeId, progress) {
    const measured = getMeasuredShape(shapeId);
    if (!measured || measured.points.length < 2 || !Number.isFinite(progress)) {
      return {
        location: null,
        angle: 0,
      };
    }

    const clampedProgress = clamp(progress, 0, measured.length);
    let start = measured.points[0];
    let end = measured.points[1];

    for (let index = 0; index < measured.points.length - 1; index += 1) {
      const candidateStart = measured.points[index];
      const candidateEnd = measured.points[index + 1];
      if (clampedProgress <= candidateEnd.progress || index === measured.points.length - 2) {
        start = candidateStart;
        end = candidateEnd;
        break;
      }
    }

    const span = Math.max(0.00001, end.progress - start.progress);
    const ratio = clamp((clampedProgress - start.progress) / span, 0, 1);
    const location = [
      lerp(start.lon, end.lon, ratio),
      lerp(start.lat, end.lat, ratio),
    ];

    let angle = 0;
    if (state.map) {
      const projectedStart = state.map.project([start.lon, start.lat]);
      const projectedEnd = state.map.project([end.lon, end.lat]);
      angle = (Math.atan2(projectedEnd.y - projectedStart.y, projectedEnd.x - projectedStart.x) * 180) / Math.PI;
    } else {
      angle = (Math.atan2(end.lat - start.lat, end.lon - start.lon) * 180) / Math.PI;
    }

    return {
      location,
      angle,
    };
  }

  function projectPointToSegmentMeters(point, start, end) {
    const refLat = ((start.lat + end.lat + point.lat) / 3) * (Math.PI / 180);
    const cosLat = Math.cos(refLat);
    const scaleX = 111320 * cosLat;
    const scaleY = 110540;
    const ax = start.lon * scaleX;
    const ay = start.lat * scaleY;
    const bx = end.lon * scaleX;
    const by = end.lat * scaleY;
    const px = point.lon * scaleX;
    const py = point.lat * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLength = Math.hypot(dx, dy);
    if (!segmentLength) {
      return { distance: Math.hypot(px - ax, py - ay), t: 0, segmentLength: 0 };
    }
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    const projX = ax + dx * t;
    const projY = ay + dy * t;
    return {
      distance: Math.hypot(px - projX, py - projY),
      t,
      segmentLength,
    };
  }

  function setSelectedRoute(routeId) {
    state.selectedStopId = "";
    state.selectedRouteLegendKey = routeId || "";
    state.selectedRouteLegendRouteIds = routeId ? [routeId] : [];
    state.selectedRouteId = routeId || "";
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    renderOccupancyHeatmap();
    syncRouteLegendSelection();
    syncFocusPanel();

    if (state.selectedRouteId) {
      const route = state.gtfs.routesByGtfsRouteId?.[state.selectedRouteId];
      updateStatus(
        `${state.activeRouteCount} live lines`,
        `Selected ${route?.shortName || route?.longName || state.selectedRouteId} • click map to clear`
      );
      return;
    }

    updateStatus(
      state.busMarkers.size ? `${state.busMarkers.size} buses` : "Map ready",
      state.busMarkers.size
        ? `${state.activeRouteCount} live lines • ${state.lastUpdatedLabel || "idle"}`
        : "Click a route to isolate"
    );
  }

  function setSelectedRouteLegend(key) {
    const entry = state.routeLegendEntries.find((item) => item.key === key);
    if (!entry) {
      setSelectedRoute("");
      return;
    }
    if (state.selectedRouteLegendKey === key) {
      setSelectedRoute("");
      return;
    }
    state.selectedStopId = "";
    state.selectedRouteLegendKey = key;
    state.selectedRouteLegendRouteIds = [...entry.routeIds];
    state.selectedRouteId = entry.routeIds[0] || "";
    syncRouteData();
    syncStopVisibility();
    syncBusStyles();
    renderOccupancyHeatmap();
    syncRouteLegendSelection();
    syncFocusPanel();
    updateStatus(
      `${state.activeRouteCount} live lines`,
      `Selected ${entry.label} • click again to clear`
    );
  }

  function syncRouteLegendSelection() {
    if (!dom.routeLegendList) {
      return;
    }
    for (const element of dom.routeLegendList.querySelectorAll("[data-route-legend-key]")) {
      element.setAttribute(
        "aria-pressed",
        element.getAttribute("data-route-legend-key") === state.selectedRouteLegendKey ? "true" : "false"
      );
    }
  }

  function routeLegendFlags(route) {
    const haystack = `${route.gtfsRouteId || ""} ${route.longName || ""} ${route.shortName || ""}`.toLowerCase();
    const flags = [];
    if (haystack.includes("limited")) {
      flags.push({ key: "limited", icon: "do_not_step", label: "Limited" });
    }
    if (haystack.includes("alternate") || haystack.includes(" alt")) {
      flags.push({ key: "alternate", icon: "alt_route", label: "Alternate" });
    }
    if (haystack.includes("express")) {
      flags.push({ key: "express", icon: "fast_forward", label: "Express" });
    }
    if (haystack.includes("hopper")) {
      flags.push({ key: "hopper", icon: "local_taxi", label: "Hopper" });
    }
    return flags;
  }

  function clearBusMarkers() {
    for (const markerState of state.busMarkers.values()) {
      markerState.marker.remove();
    }
    state.busMarkers.clear();
    state.liveVehicles = [];
    state.previousTelemetryByVehicleId = new Map();
    clearOccupancyHeatmap();
    closeBusPanel();
  }

  function showOverlay(primary, secondary) {
    dom.overlay.hidden = false;
    dom.overlayPrimary.textContent = primary || "";
    dom.overlaySecondary.textContent = secondary || "";
  }

  function hideOverlay() {
    dom.overlay.hidden = true;
  }

  function updateStatus(primary, secondary) {
    dom.statusPrimary.textContent = primary || "";
    dom.statusSecondary.textContent = secondary || "";
  }

  function getGeoJsonSource(id) {
    return state.map.getSource(id);
  }

  function featureCollection(features) {
    return {
      type: "FeatureCollection",
      features,
    };
  }

  function padBounds(bounds, ratio) {
    const [[west, south], [east, north]] = bounds;
    const lonPad = (east - west) * ratio;
    const latPad = (north - south) * ratio;
    return [
      [west - lonPad, south - latPad],
      [east + lonPad, north + latPad],
    ];
  }

  function routeStrokeWidth(routeName) {
    if (/silver/i.test(routeName)) {
      return 3.2;
    }
    if (/airbus/i.test(routeName)) {
      return 3.05;
    }
    return 3.15;
  }

  function parseVehicleTimestamp(value) {
    const stamp = new Date(value || "").getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function deriveVehicleSpeedMph(vehicle, previous, currentTimestamp) {
    const feedSpeed = Number(vehicle?.vehiclePosition?.speed);
    if (Number.isFinite(feedSpeed) && feedSpeed >= 0) {
      return feedSpeed * 2.23694;
    }
    if (!previous || !Array.isArray(previous.location)) {
      return NaN;
    }
    const deltaMs = currentTimestamp - previous.timestamp;
    if (!Number.isFinite(deltaMs) || deltaMs < 4000 || deltaMs > 10 * 60 * 1000) {
      return NaN;
    }
    const distanceMeters = haversineMeters(
      previous.location[1],
      previous.location[0],
      vehicle.location[1],
      vehicle.location[0]
    );
    const metersPerSecond = distanceMeters / (deltaMs / 1000);
    const mph = metersPerSecond * 2.23694;
    if (!Number.isFinite(mph) || mph < 0.5 || mph > 75) {
      return NaN;
    }
    return mph;
  }

  function resolveVehicleSpeedMph(vehicle) {
    if (!vehicle) {
      return NaN;
    }
    const derived = Number(vehicle.derivedSpeedMph);
    return Number.isFinite(derived) ? derived : NaN;
  }

  function summarizeOccupancy(vehicles) {
    let crowded = 0;
    for (const vehicle of vehicles) {
      const pressure = occupancyPressure(vehicle.vehiclePosition?.occupancyStatus);
      if (pressure >= 3) {
        crowded += 1;
      }
    }
    return { crowded };
  }

  function summarizeStopStatus(vehicles) {
    let stopped = 0;
    let inTransit = 0;
    for (const vehicle of vehicles) {
      const status = String(vehicle.vehiclePosition?.currentStatus || "");
      if (status === "1" || status === "STOPPED_AT") {
        stopped += 1;
      }
      if (status === "2" || status === "IN_TRANSIT_TO") {
        inTransit += 1;
      }
    }
    return { stopped, inTransit };
  }

  function summarizeCongestion(vehicles) {
    let congested = 0;
    for (const vehicle of vehicles) {
      const level = String(vehicle.vehiclePosition?.congestionLevel || "");
      if (level === "3" || level === "4" || level === "CONGESTION" || level === "SEVERE_CONGESTION") {
        congested += 1;
      }
    }
    return { congested };
  }

  function summarizeDirections(vehicles) {
    const counts = new Map();
    for (const vehicle of vehicles) {
      const direction = String(vehicle.direction?.shortName || vehicle.direction?.name || "").trim();
      if (!direction) {
        continue;
      }
      counts.set(direction, (counts.get(direction) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([direction, count]) => `${direction} ${count}`)
      .join(" • ");
  }

  function summarizeHeadsigns(vehicles) {
    const counts = new Map();
    for (const vehicle of vehicles) {
      const headsign = String(vehicle.headsign || "").trim();
      if (!headsign) {
        continue;
      }
      counts.set(headsign, (counts.get(headsign) || 0) + 1);
    }
    const [winner] = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    return winner ? winner[0] : "";
  }

  function numbersFromVehicles(vehicles, getter) {
    return vehicles
      .map((vehicle) => getter(vehicle))
      .filter((value) => Number.isFinite(value));
  }

  function average(values) {
    if (!values.length) {
      return NaN;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function latestTimestamp(values) {
    let best = 0;
    for (const value of values) {
      best = Math.max(best, parseVehicleTimestamp(value));
    }
    return best ? formatTimestamp(best) : "";
  }

  function countHeatEntriesForRoute(routeId, sign) {
    let count = 0;
    for (const entry of state.occupancyHeatByKey.values()) {
      if (entry.routeId !== routeId) {
        continue;
      }
      if (sign > 0 && entry.score > OCCUPANCY_HEAT_MIN_VISIBLE_SCORE) {
        count += 1;
      }
      if (sign < 0 && entry.score < -OCCUPANCY_HEAT_MIN_VISIBLE_SCORE) {
        count += 1;
      }
    }
    return count;
  }

  function stopHeatScore(stopId, sign) {
    let count = 0;
    for (const entry of state.occupancyHeatByKey.values()) {
      if (entry.stopId !== stopId) {
        continue;
      }
      if (sign > 0 && entry.score > OCCUPANCY_HEAT_MIN_VISIBLE_SCORE) {
        count += 1;
      }
      if (sign < 0 && entry.score < -OCCUPANCY_HEAT_MIN_VISIBLE_SCORE) {
        count += 1;
      }
    }
    return count;
  }

  function recordRouteAnalyticsHistory(vehicles) {
    const grouped = new Map();
    for (const vehicle of vehicles) {
      const routeId = String(vehicle.route?.gtfsRouteId || "").trim();
      if (!routeId) {
        continue;
      }
      if (!grouped.has(routeId)) {
        grouped.set(routeId, []);
      }
      grouped.get(routeId).push(vehicle);
    }

    for (const [routeId, routeVehicles] of grouped.entries()) {
      const currentAverage = averageOccupancyPressure(routeVehicles);
      if (!Number.isFinite(currentAverage)) {
        continue;
      }
      const history = state.routeAnalyticsHistory.get(routeId) || [];
      history.push({
        at: Date.now(),
        occupancyAverage: currentAverage,
      });
      state.routeAnalyticsHistory.set(routeId, history.slice(-12));
    }
    persistAnalyticsCache();
  }

  function averageOccupancyPressure(vehicles) {
    return average(numbersFromVehicles(vehicles, (vehicle) => occupancyPressure(vehicle.vehiclePosition?.occupancyStatus)));
  }

  function mergeRouteHistory(routeIds) {
    const merged = [];
    for (const routeId of routeIds) {
      const history = state.routeAnalyticsHistory.get(routeId) || [];
      for (const entry of history) {
        if (entry && Number.isFinite(Number(entry.occupancyAverage))) {
          merged.push(entry);
        }
      }
    }
    return merged
      .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0))
      .slice(-12);
  }

  function occupancyPressureLabel(value) {
    if (!Number.isFinite(value)) {
      return "Unavailable";
    }
    if (value < 1) {
      return "Open seats";
    }
    if (value < 2) {
      return "Many seats";
    }
    if (value < 3) {
      return "Filling up";
    }
    if (value < 4) {
      return "Standing";
    }
    return "Crowded";
  }

  function routeHistorySparkline(history) {
    const values = (Array.isArray(history) ? history : [])
      .map((entry) => Number(entry.occupancyAverage))
      .filter((value) => Number.isFinite(value));
    if (!values.length) {
      return `<svg class="sparkline" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true"><path d="M8 34 L112 34" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="1.5" stroke-linecap="round"/><circle cx="112" cy="34" r="2.8" fill="currentColor" fill-opacity="0.3"/></svg>`;
    }
    const points = buildSparklinePoints(values, 120, 48, 8);
    const area = buildSparklineArea(values, 120, 48, 8);
    const [lastX, lastY] = sparklineEndpoint(values, 120, 48, 8);
    return `<svg class="sparkline" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="currentColor" fill-opacity="0.12"/><path d="${points}" fill="none" stroke="currentColor" stroke-opacity="0.76" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lastX.toFixed(
      2
    )}" cy="${lastY.toFixed(2)}" r="2.8" fill="currentColor" fill-opacity="0.92"/></svg>`;
  }

  function occupancyGradientSpark(status) {
    const palette = occupancyPalette(status);
    const activeIndex = occupancyStageIndex(status);
    const widths = [16, 16, 16, 16, 16, 16];
    const heights = [12, 18, 24, 31, 38, 44];
    let x = 8;
    const bars = widths
      .map((width, index) => {
        const height = heights[index];
        const y = 50 - height;
        const filled = activeIndex >= 0 && index <= activeIndex;
        const current = index === activeIndex;
        const fill = filled ? palette.strong : "rgba(255,255,255,0.12)";
        const opacity = current ? 0.98 : filled ? 0.72 : 1;
        const stroke = current ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.18)";
        const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${current ? 1.4 : 1}"/>`;
        const currentMarker = current
          ? `<circle cx="${x + width / 2}" cy="${y - 7}" r="4.4" fill="${fill}" stroke="rgba(255,255,255,0.92)" stroke-width="1.5"/><path d="M${x + width / 2} ${y - 1.5} L${x + width / 2} ${y - 4.6}" stroke="rgba(255,255,255,0.82)" stroke-width="1.4" stroke-linecap="round"/>`
          : "";
        x += width + 4;
        return `${rect}${currentMarker}`;
      })
      .join("");
    return `<svg class="sparkline sparkline-occupancy" viewBox="0 0 132 56" preserveAspectRatio="none" aria-hidden="true"><path d="M8 49.5 H124" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1.4" stroke-linecap="round"/>${bars}</svg>`;
  }

  function occupancyStageIndex(status) {
    switch (canonicalOccupancyStatus(status)) {
      case "EMPTY":
        return 0;
      case "MANY_SEATS_AVAILABLE":
        return 1;
      case "FEW_SEATS_AVAILABLE":
        return 2;
      case "STANDING_ROOM_ONLY":
        return 3;
      case "CRUSHED_STANDING_ROOM_ONLY":
        return 4;
      case "FULL":
      case "NOT_ACCEPTING_PASSENGERS":
        return 5;
      default:
        return -1;
    }
  }

  function buildSparklinePoints(values, width, height, padding) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = padding + ((width - padding * 2) * index) / Math.max(1, values.length - 1);
        const y = height - padding - ((value - min) / span) * (height - padding * 2);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }

  function buildSparklineArea(values, width, height, padding) {
    const points = buildSparklinePoints(values, width, height, padding);
    const firstX = padding;
    const lastX = width - padding;
    return `${points} L ${lastX.toFixed(2)} ${(height - padding).toFixed(2)} L ${firstX.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
  }

  function sparklineEndpoint(values, width, height, padding) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const value = values[values.length - 1];
    const x = padding + ((width - padding * 2) * (values.length - 1)) / Math.max(1, values.length - 1);
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return [x, y];
  }

  function applyFocusTint(mode, routeColor, occupancyStatus) {
    const palette =
      mode === "bus"
        ? occupancyPalette(occupancyStatus)
        : mode === "route"
          ? routePalette(routeColor)
          : neutralPanelPalette();
    dom.busPanel.style.setProperty("--focus-tint", palette.soft);
    dom.busPanel.style.setProperty("--focus-tint-strong", palette.strong);
  }

  function neutralPanelPalette() {
    if (dom.body.dataset.theme === "dark") {
      return { soft: "rgba(255, 255, 255, 0.04)", strong: "rgba(255, 255, 255, 0.08)" };
    }
    return { soft: "rgba(255, 255, 255, 0.08)", strong: "rgba(255, 255, 255, 0.12)" };
  }

  function hydrateAnalyticsCache() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEYS.analytics);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      const previousOccupancy = Array.isArray(parsed?.previousOccupancyByVehicleId)
        ? parsed.previousOccupancyByVehicleId
        : [];
      const heatEntries = Array.isArray(parsed?.occupancyHeatByKey) ? parsed.occupancyHeatByKey : [];
      const historyEntries = Array.isArray(parsed?.routeAnalyticsHistory) ? parsed.routeAnalyticsHistory : [];
      state.previousOccupancyByVehicleId = new Map(previousOccupancy);
      state.occupancyHeatByKey = new Map(heatEntries.map((entry) => [entry.key, entry]));
      state.routeAnalyticsHistory = new Map(historyEntries);
    } catch (_error) {
      state.previousOccupancyByVehicleId = new Map();
      state.occupancyHeatByKey = new Map();
      state.routeAnalyticsHistory = new Map();
    }
  }

  function persistAnalyticsCache() {
    try {
      window.sessionStorage.setItem(
        SESSION_KEYS.analytics,
        JSON.stringify({
          previousOccupancyByVehicleId: [...state.previousOccupancyByVehicleId.entries()],
          occupancyHeatByKey: [...state.occupancyHeatByKey.values()],
          routeAnalyticsHistory: [...state.routeAnalyticsHistory.entries()],
        })
      );
    } catch (_error) {
      // Ignore storage failures; the runtime model still works in memory.
    }
  }

  function occupancyPalette(status) {
    switch (canonicalOccupancyStatus(status)) {
      case "EMPTY":
        return { soft: "rgba(108, 169, 122, 0.18)", strong: "rgba(108, 169, 122, 0.3)" };
      case "MANY_SEATS_AVAILABLE":
        return { soft: "rgba(120, 176, 130, 0.18)", strong: "rgba(120, 176, 130, 0.3)" };
      case "FEW_SEATS_AVAILABLE":
        return { soft: "rgba(170, 154, 116, 0.16)", strong: "rgba(170, 154, 116, 0.28)" };
      case "STANDING_ROOM_ONLY":
        return { soft: "rgba(199, 116, 138, 0.18)", strong: "rgba(199, 116, 138, 0.32)" };
      case "CRUSHED_STANDING_ROOM_ONLY":
      case "FULL":
      case "NOT_ACCEPTING_PASSENGERS":
        return { soft: "rgba(216, 119, 157, 0.2)", strong: "rgba(216, 119, 157, 0.34)" };
      default:
        return { soft: "rgba(255, 255, 255, 0.08)", strong: "rgba(255, 255, 255, 0.12)" };
    }
  }

  function routePalette(routeColor) {
    const color = normalizeColor(routeColor) || "#d9d1c3";
    const [r, g, b] = hexToRgb(color);
    return {
      soft: `rgba(${r}, ${g}, ${b}, 0.12)`,
      strong: `rgba(${r}, ${g}, ${b}, 0.2)`,
    };
  }

  function hexToRgb(color) {
    const value = String(color || "").replace("#", "");
    if (value.length !== 6) {
      return [217, 209, 195];
    }
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ].map((channel) => (Number.isFinite(channel) ? channel : 217));
  }

  function busMarkerLabelColor(backgroundColor, preferredTextColor) {
    const preferred = normalizeColor(preferredTextColor);
    if (preferred) {
      return preferred;
    }
    const [r, g, b] = hexToRgb(normalizeColor(backgroundColor));
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance < 0.56 ? "#ffffff" : "#111111";
  }

  function usesDirectApi() {
    return String(state.config?.apiMode || DEFAULT_CONFIG.apiMode).trim().toLowerCase() === "direct";
  }

  function canUseLiveRestApi() {
    return usesDirectApi() ? Boolean(state.runtimeApiKey) : Boolean(resolveApiBase());
  }

  function resolveApiBase() {
    const configured = String(state.config?.apiBase || "").trim();
    if (configured) {
      return configured.replace(/\/+$/, "");
    }
    return usesDirectApi() ? API_BASE : "/api";
  }

  function syncBusMarkerLabelRotation(element, angle) {
    const label = element?.querySelector?.(".bus-marker-label");
    if (!label) {
      return;
    }
    const value = Number.isFinite(angle) ? angle : 0;
    label.style.transform = `rotate(${(-value).toFixed(2)}deg)`;
  }

  function snapLocationToShape(location, shapeId) {
    const measured = getMeasuredShape(shapeId);
    if (!measured || measured.points.length < 2 || !Array.isArray(location)) {
      return { location, distance: Infinity, progress: NaN };
    }

    const point = { lon: Number(location[0]), lat: Number(location[1]) };
    let bestDistance = Infinity;
    let bestLocation = location;
    let bestProgress = NaN;

    for (let index = 0; index < measured.points.length - 1; index += 1) {
      const start = measured.points[index];
      const end = measured.points[index + 1];
      const projection = projectPointToSegmentMeters(point, start, end);
      if (projection.distance < bestDistance) {
        bestDistance = projection.distance;
        bestProgress = start.progress + projection.t * projection.segmentLength;
        bestLocation = [
          lerp(start.lon, end.lon, projection.t),
          lerp(start.lat, end.lat, projection.t),
        ];
      }
    }

    return {
      location: bestLocation,
      distance: bestDistance,
      progress: bestProgress,
    };
  }

  function toggleOccupancyHeat() {
    state.showOccupancyHeat = !state.showOccupancyHeat;
    window.localStorage.setItem(STORAGE_KEYS.showHeat, state.showOccupancyHeat ? "1" : "0");
    syncHeatToggle();
    renderOccupancyHeatmap();
  }

  function syncHeatToggle() {
    if (!dom.heatToggleButton) {
      return;
    }
    dom.heatToggleButton.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">fluid</span><span>${escapeHtml(
      state.showOccupancyHeat ? "Heat On" : "Heat Off"
    )}</span>`;
    dom.heatToggleButton.setAttribute("aria-pressed", state.showOccupancyHeat ? "true" : "false");
  }

  function syncThemeToggle() {
    if (!dom.themeToggle) {
      return;
    }
    const darkMode = dom.body.dataset.theme === "dark";
    dom.themeToggle.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">${darkMode ? "light_mode" : "dark_mode"}</span>`;
    dom.themeToggle.setAttribute("aria-label", darkMode ? "Switch to light theme" : "Switch to dark theme");
  }

  function onFocusListClick(event) {
    const stopButton = event.target.closest("[data-stop-id]");
    if (stopButton) {
      openStopPanel(stopButton.getAttribute("data-stop-id") || "");
      return;
    }
    const button = event.target.closest("[data-vehicle-id]");
    if (!button) {
      return;
    }
    openBusPanel(button.getAttribute("data-vehicle-id") || "");
  }

  function onRouteLegendClick(event) {
    const button = event.target.closest("[data-route-legend-key]");
    if (!button) {
      return;
    }
    const key = button.getAttribute("data-route-legend-key") || "";
    setSelectedRouteLegend(key);
  }

  function canonicalOccupancyStatus(value) {
    switch (String(value || "").trim()) {
      case "0":
      case "EMPTY":
        return "EMPTY";
      case "1":
      case "MANY_SEATS_AVAILABLE":
        return "MANY_SEATS_AVAILABLE";
      case "2":
      case "FEW_SEATS_AVAILABLE":
        return "FEW_SEATS_AVAILABLE";
      case "3":
      case "STANDING_ROOM_ONLY":
        return "STANDING_ROOM_ONLY";
      case "4":
      case "CRUSHED_STANDING_ROOM_ONLY":
        return "CRUSHED_STANDING_ROOM_ONLY";
      case "5":
      case "FULL":
        return "FULL";
      case "6":
      case "NOT_ACCEPTING_PASSENGERS":
        return "NOT_ACCEPTING_PASSENGERS";
      default:
        return "";
    }
  }

  function occupancyPressure(value) {
    switch (canonicalOccupancyStatus(value)) {
      case "EMPTY":
        return 0;
      case "MANY_SEATS_AVAILABLE":
        return 1;
      case "FEW_SEATS_AVAILABLE":
        return 2;
      case "STANDING_ROOM_ONLY":
        return 3;
      case "CRUSHED_STANDING_ROOM_ONLY":
        return 4;
      case "FULL":
        return 5;
      default:
        return NaN;
    }
  }

  function pointToSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
      return Math.hypot(point.x - start.x, point.y - start.y);
    }
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    const px = start.x + dx * t;
    const py = start.y + dy * t;
    return Math.hypot(point.x - px, point.y - py);
  }

  function pointToSegmentDistanceMeters(point, start, end) {
    const refLat = ((start.lat + end.lat + point.lat) / 3) * (Math.PI / 180);
    const cosLat = Math.cos(refLat);
    const project = (candidate) => ({
      x: candidate.lon * 111320 * cosLat,
      y: candidate.lat * 110540,
    });
    const p = project(point);
    const a = project(start);
    const b = project(end);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
      return Math.hypot(p.x - a.x, p.y - a.y);
    }
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    return Math.hypot(p.x - px, p.y - py);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const toRadians = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRadians;
    const dLon = (lon2 - lon1) * toRadians;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRadians) *
      Math.cos(lat2 * toRadians) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function interpolateLinear(value, stops) {
    if (!Array.isArray(stops) || stops.length < 4) {
      return 1;
    }
    if (value <= stops[0]) {
      return stops[1];
    }
    for (let index = 0; index < stops.length - 2; index += 2) {
      const leftX = stops[index];
      const leftY = stops[index + 1];
      const rightX = stops[index + 2];
      const rightY = stops[index + 3];
      if (value <= rightX) {
        const amount = (value - leftX) / Math.max(0.0001, rightX - leftX);
        return lerp(leftY, rightY, clamp(amount, 0, 1));
      }
    }
    return stops[stops.length - 1];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function easeInOut(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function escapeAttr(value) {
    return String(value).replace(/"/g, "&quot;");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
