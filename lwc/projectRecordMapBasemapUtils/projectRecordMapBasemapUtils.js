export const BASEMAP_MODE_SATELLITE = "satellite";
export const BASEMAP_MODE_TERRAIN = "terrain";

const OPENSTREETMAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OPENSTREETMAP_TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";

const BASEMAP_PROVIDERS_BY_MODE = {
  [BASEMAP_MODE_SATELLITE]: [
    {
      key: "satellite-esri-services",
      label: "Satellite",
      mode: BASEMAP_MODE_SATELLITE,
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      host: "https://services.arcgisonline.com",
      isFallback: false
    },
    {
      key: "satellite-esri-server",
      label: "Satellite",
      mode: BASEMAP_MODE_SATELLITE,
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      host: "https://server.arcgisonline.com",
      isFallback: false
    },
    {
      key: "satellite-osm-fallback",
      label: "Map",
      mode: BASEMAP_MODE_SATELLITE,
      url: OPENSTREETMAP_TILE_URL,
      attribution: OPENSTREETMAP_TILE_ATTRIBUTION,
      host: "https://tile.openstreetmap.org",
      isFallback: true
    }
  ],
  [BASEMAP_MODE_TERRAIN]: [
    {
      key: "terrain-esri-services",
      label: "Terrain",
      mode: BASEMAP_MODE_TERRAIN,
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Sources: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, METI, TomTom, Garmin, and the GIS User Community",
      host: "https://services.arcgisonline.com",
      isFallback: false
    },
    {
      key: "terrain-esri-server",
      label: "Terrain",
      mode: BASEMAP_MODE_TERRAIN,
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution:
        "Tiles &copy; Esri &mdash; Sources: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, METI, TomTom, Garmin, and the GIS User Community",
      host: "https://server.arcgisonline.com",
      isFallback: false
    },
    {
      key: "terrain-osm-fallback",
      label: "Map",
      mode: BASEMAP_MODE_TERRAIN,
      url: OPENSTREETMAP_TILE_URL,
      attribution: OPENSTREETMAP_TILE_ATTRIBUTION,
      host: "https://tile.openstreetmap.org",
      isFallback: true
    }
  ]
};

export function createInitialBasemapState(mode = BASEMAP_MODE_SATELLITE) {
  return {
    mode: normalizeBasemapMode(mode),
    providerIndex: 0,
    tileErrorCount: 0,
    hasLoaded: false,
    warningMessage: ""
  };
}

export function normalizeBasemapMode(mode) {
  return mode === BASEMAP_MODE_TERRAIN ? BASEMAP_MODE_TERRAIN : BASEMAP_MODE_SATELLITE;
}

export function getNextBasemapMode(currentMode) {
  return normalizeBasemapMode(currentMode) === BASEMAP_MODE_SATELLITE
    ? BASEMAP_MODE_TERRAIN
    : BASEMAP_MODE_SATELLITE;
}

export function getBasemapProvidersForMode(mode) {
  const normalizedMode = normalizeBasemapMode(mode);
  return (
    BASEMAP_PROVIDERS_BY_MODE[normalizedMode] ||
    BASEMAP_PROVIDERS_BY_MODE[BASEMAP_MODE_SATELLITE]
  );
}

export function getBasemapProvider(stateOrMode) {
  const state =
    typeof stateOrMode === "string"
      ? createInitialBasemapState(stateOrMode)
      : createInitialBasemapState(stateOrMode?.mode);

  const providers = getBasemapProvidersForMode(state.mode);
  const safeIndex = clampProviderIndex(state.providerIndex, providers.length);
  return providers[safeIndex];
}

export function getBasemapToggleTitle(currentMode) {
  return normalizeBasemapMode(currentMode) === BASEMAP_MODE_SATELLITE
    ? "Switch to Terrain view"
    : "Switch to Satellite view";
}

export function getActiveBasemapLabel(currentMode) {
  return normalizeBasemapMode(currentMode) === BASEMAP_MODE_SATELLITE ? "Satellite" : "Terrain";
}

export function buildTileLayerOptions(provider) {
  return {
    attribution: provider?.attribution || "",
    maxZoom: 22
  };
}

export function buildBasemapModeSwitchState(nextMode) {
  return {
    mode: normalizeBasemapMode(nextMode),
    providerIndex: 0,
    tileErrorCount: 0,
    hasLoaded: false,
    warningMessage: ""
  };
}

export function buildBasemapLoadedState(currentState) {
  const state = {
    ...createInitialBasemapState(currentState?.mode),
    ...currentState,
    providerIndex: clampProviderIndex(
      currentState?.providerIndex,
      getBasemapProvidersForMode(currentState?.mode).length
    ),
    tileErrorCount: 0,
    hasLoaded: true
  };

  const provider = getBasemapProvider(state);

  return {
    ...state,
    warningMessage: provider?.isFallback
      ? `${getActiveBasemapLabel(state.mode)} tiles were unavailable, so the map fell back to standard map tiles.`
      : ""
  };
}

export function buildBasemapTileErrorResult(currentState) {
  const state = {
    ...createInitialBasemapState(currentState?.mode),
    ...currentState
  };
  const providers = getBasemapProvidersForMode(state.mode);
  const currentProviderIndex = clampProviderIndex(state.providerIndex, providers.length);
  const nextTileErrorCount = Number(state.tileErrorCount || 0) + 1;

  if (state.hasLoaded) {
    return {
      state: {
        ...state,
        providerIndex: currentProviderIndex,
        tileErrorCount: nextTileErrorCount
      },
      shouldReplaceLayer: false
    };
  }

  if (nextTileErrorCount < 2) {
    return {
      state: {
        ...state,
        providerIndex: currentProviderIndex,
        tileErrorCount: nextTileErrorCount
      },
      shouldReplaceLayer: false
    };
  }

  const nextProviderIndex = currentProviderIndex + 1;
  if (nextProviderIndex >= providers.length) {
    const currentProvider = providers[currentProviderIndex];

    return {
      state: {
        ...state,
        providerIndex: currentProviderIndex,
        tileErrorCount: nextTileErrorCount,
        hasLoaded: false,
        warningMessage: `Map tiles failed to load. Confirm CSP Trusted Site access for ${currentProvider.host}.`
      },
      shouldReplaceLayer: false
    };
  }

  const nextProvider = providers[nextProviderIndex];

  return {
    state: {
      ...state,
      providerIndex: nextProviderIndex,
      tileErrorCount: 0,
      hasLoaded: false,
      warningMessage: nextProvider.isFallback
        ? `${getActiveBasemapLabel(state.mode)} tiles were unavailable, so the map fell back to standard map tiles.`
        : `Trying an alternate ${getActiveBasemapLabel(state.mode).toLowerCase()} tile source. Confirm CSP Trusted Site access for ${nextProvider.host} if tiles still do not load.`
    },
    shouldReplaceLayer: true
  };
}

function clampProviderIndex(index, providerCount) {
  const numericIndex = Number(index);
  if (!Number.isFinite(numericIndex) || numericIndex < 0) {
    return 0;
  }

  if (!providerCount || numericIndex >= providerCount) {
    return Math.max(0, providerCount - 1);
  }

  return numericIndex;
}
