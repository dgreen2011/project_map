import { api, LightningElement } from "lwc";
import { loadScript, loadStyle } from "lightning/platformResourceLoader";

import leafletResource from "@salesforce/resourceUrl/leaflet_1_9_4";

const DEFAULT_MAP_HEIGHT_PX = 220;
const DEFAULT_MAP_PADDING = [18, 18];
const BASE_LINE_STYLE = {
  color: "#91a6bd",
  weight: 4,
  opacity: 0.9,
  lineCap: "round",
  lineJoin: "round"
};
const SELECTED_LINE_STYLE = {
  color: "#0176d3",
  weight: 6,
  opacity: 1,
  lineCap: "round",
  lineJoin: "round"
};
const SELECTED_POINT_STYLE = {
  radius: 4,
  color: "#0176d3",
  weight: 1,
  opacity: 1,
  fillColor: "#ffffff",
  fillOpacity: 1
};

export default class ProjectRecordMapSegmentPathEditor extends LightningElement {
  @api segmentName = "";
  @api segmentGeometryRaw = "";
  @api mapHeightPx = DEFAULT_MAP_HEIGHT_PX;

  bootstrapPromise = null;
  librariesReady = false;
  mapReady = false;

  map = null;
  baseLayerGroup = null;
  selectedLayerGroup = null;
  boundMapClickHandler = null;
  pendingViewportSyncTimer = null;

  selectionMode = "full";
  partialCoordinates = [];
  fullCoordinateSets = [];
  fullPathValue = "";
  errorMessage = "";

  renderedCallback() {
    this.ensureBootstrapped();
  }

  disconnectedCallback() {
    this.clearPendingViewportSync();
    this.destroyMap();
  }

  get mapStyle() {
    const rawHeight = Number(this.mapHeightPx);
    const safeHeight = Number.isFinite(rawHeight) && rawHeight >= 160 ? rawHeight : DEFAULT_MAP_HEIGHT_PX;
    return `height: ${safeHeight}px;`;
  }

  get isFullMode() {
    return this.selectionMode === "full";
  }

  get isPartialMode() {
    return this.selectionMode === "partial";
  }

  get fullButtonVariant() {
    return this.isFullMode ? "brand" : "neutral";
  }

  get partialButtonVariant() {
    return this.isPartialMode ? "brand" : "neutral";
  }

  get hasSegmentGeometry() {
    return Array.isArray(this.fullCoordinateSets) && this.fullCoordinateSets.length > 0;
  }


  get hasGeometryError() {
    return Boolean(this.errorMessage);
  }

  get disablePartialModeButton() {
    return this.hasGeometryError;
  }

  get disableUndoButton() {
    return !this.canUndoPartial;
  }

  get disableClearButton() {
    return !this.canClearPartial;
  }

  get canUndoPartial() {
    return this.partialCoordinates.length > 0;
  }

  get canClearPartial() {
    return this.partialCoordinates.length > 0;
  }

  get helperText() {
    if (this.isFullMode) {
      return "Full Segment is selected. The entire Segment path will be saved to the Work Log.";
    }

    return "Partial Segment is selected. Click along the completed portion of the line to draw the path that should be saved.";
  }

  async ensureBootstrapped() {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.bootstrapPromise = (async () => {
      await loadStyle(this, `${leafletResource}/leaflet.css`);
      await loadScript(this, `${leafletResource}/leaflet.js`);
      this.librariesReady = true;

      this.initializeStateFromGeometry();
      this.initializeMap();
      this.renderMapState();
      this.notifySelectionChange();
    })().catch((error) => {
      this.errorMessage = this.reduceError(error);
      this.bootstrapPromise = null;
      throw error;
    });

    return this.bootstrapPromise;
  }

  initializeStateFromGeometry() {
    this.fullCoordinateSets = this.extractPolylineCoordinateSets(this.segmentGeometryRaw);
    this.fullPathValue = this.hasSegmentGeometry ? JSON.stringify(this.fullCoordinateSets) : "";

    if (!this.hasSegmentGeometry) {
      this.errorMessage =
        "The Segment geometry could not be read, so the completion path selector cannot be shown.";
    }
  }

  initializeMap() {
    if (this.mapReady || !window.L) {
      return;
    }

    const mapContainer = this.template.querySelector('[data-id="segment-map"]');
    if (!mapContainer) {
      return;
    }

    this.map = window.L.map(mapContainer, {
      zoomControl: true,
      attributionControl: false,
      doubleClickZoom: false,
      scrollWheelZoom: false
    });

    this.map.setView([39.8283, -98.5795], 4);
    this.boundMapClickHandler = this.handleMapClick.bind(this);
    this.map.on("click", this.boundMapClickHandler);

    this.mapReady = true;
  }

  destroyMap() {
    if (this.map && this.boundMapClickHandler) {
      try {
        this.map.off("click", this.boundMapClickHandler);
      } catch (error) {
        // swallow cleanup errors
      }
    }

    if (this.map) {
      try {
        this.map.remove();
      } catch (error) {
        // swallow cleanup errors
      }
    }

    this.map = null;
    this.baseLayerGroup = null;
    this.selectedLayerGroup = null;
    this.boundMapClickHandler = null;
    this.mapReady = false;
  }

  handleSelectFull() {
    if (this.isFullMode) {
      return;
    }

    this.selectionMode = "full";
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleSelectPartial() {
    if (this.isPartialMode) {
      return;
    }

    this.selectionMode = "partial";
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleUndoPartial() {
    if (!this.canUndoPartial) {
      return;
    }

    this.partialCoordinates = this.partialCoordinates.slice(0, -1);
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleClearPartial() {
    if (!this.canClearPartial) {
      return;
    }

    this.partialCoordinates = [];
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleMapClick(event) {
    if (!this.isPartialMode || !this.hasSegmentGeometry) {
      return;
    }

    const latitude = this.toNumber(event?.latlng?.lat);
    const longitude = this.toNumber(event?.latlng?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    this.partialCoordinates = [...this.partialCoordinates, [longitude, latitude]];
    this.renderMapState();
    this.notifySelectionChange();
  }

  notifySelectionChange() {
    let pathValue = "";
    let isValid = false;

    if (this.isFullMode) {
      pathValue = this.fullPathValue;
      isValid = Boolean(pathValue);
    } else if (this.partialCoordinates.length >= 2) {
      pathValue = JSON.stringify([this.partialCoordinates]);
      isValid = true;
    }

    this.dispatchEvent(
      new CustomEvent("selectionchange", {
        detail: {
          pathValue,
          isValid,
          selectionMode: this.selectionMode
        }
      })
    );
  }

  renderMapState() {
    if (!this.mapReady || !window.L || !this.hasSegmentGeometry) {
      return;
    }

    if (this.baseLayerGroup) {
      this.map.removeLayer(this.baseLayerGroup);
      this.baseLayerGroup = null;
    }
    if (this.selectedLayerGroup) {
      this.map.removeLayer(this.selectedLayerGroup);
      this.selectedLayerGroup = null;
    }

    this.baseLayerGroup = window.L.featureGroup();
    this.selectedLayerGroup = window.L.featureGroup();

    this.fullCoordinateSets.forEach((coordinateSet) => {
      const latLngs = this.toLatLngs(coordinateSet);
      if (latLngs.length >= 2) {
        this.baseLayerGroup.addLayer(window.L.polyline(latLngs, BASE_LINE_STYLE));
      }
    });

    if (this.isFullMode) {
      this.fullCoordinateSets.forEach((coordinateSet) => {
        const latLngs = this.toLatLngs(coordinateSet);
        if (latLngs.length >= 2) {
          this.selectedLayerGroup.addLayer(window.L.polyline(latLngs, SELECTED_LINE_STYLE));
        }
      });
    } else {
      const partialLatLngs = this.toLatLngs(this.partialCoordinates);
      if (partialLatLngs.length >= 2) {
        this.selectedLayerGroup.addLayer(window.L.polyline(partialLatLngs, SELECTED_LINE_STYLE));
      }
      partialLatLngs.forEach((latLng) => {
        this.selectedLayerGroup.addLayer(window.L.circleMarker(latLng, SELECTED_POINT_STYLE));
      });
    }

    this.baseLayerGroup.addTo(this.map);
    this.selectedLayerGroup.addTo(this.map);
    this.scheduleViewportSync();
  }

  scheduleViewportSync() {
    if (!this.map) {
      return;
    }

    this.clearPendingViewportSync();

    this.pendingViewportSyncTimer = window.setTimeout(() => {
      const runSync = () => {
        if (!this.map) {
          return;
        }

        try {
          this.map.invalidateSize({
            pan: false,
            debounceMoveend: true
          });
        } catch (error) {
          this.map.invalidateSize(false);
        }

        const bounds = this.baseLayerGroup?.getBounds();
        if (bounds && bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: DEFAULT_MAP_PADDING });
        }
      };

      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(runSync);
        });
      } else {
        runSync();
      }
    }, 0);
  }

  clearPendingViewportSync() {
    if (this.pendingViewportSyncTimer) {
      window.clearTimeout(this.pendingViewportSyncTimer);
      this.pendingViewportSyncTimer = null;
    }
  }

  extractPolylineCoordinateSets(geometryRaw) {
    const parsed = this.safeParseJson(geometryRaw);
    if (!parsed) {
      return [];
    }

    if (Array.isArray(parsed?.snappedPoints)) {
      const snappedCoordinates = parsed.snappedPoints
        .map((point) => {
          const longitude = this.toNumber(
            point?.location?.longitude ?? point?.location?.lng ?? point?.location?.lon
          );
          const latitude = this.toNumber(point?.location?.latitude ?? point?.location?.lat);

          if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
            return null;
          }

          return [longitude, latitude];
        })
        .filter((point) => Array.isArray(point));

      return snappedCoordinates.length >= 2 ? [snappedCoordinates] : [];
    }

    if (parsed?.type === "Feature" && parsed.geometry) {
      return this.extractPolylineCoordinateSets(parsed.geometry);
    }

    if (parsed?.type === "LineString" && Array.isArray(parsed.coordinates)) {
      return [parsed.coordinates];
    }

    if (parsed?.type === "MultiLineString" && Array.isArray(parsed.coordinates)) {
      return parsed.coordinates.filter((item) => this.isCoordinateSet(item));
    }

    if (Array.isArray(parsed) && this.isCoordinateSet(parsed)) {
      return [parsed];
    }

    if (Array.isArray(parsed) && parsed.every((item) => this.isCoordinateSet(item))) {
      return parsed;
    }

    if (Array.isArray(parsed)) {
      return this.collectCoordinateSetsRecursively(parsed);
    }

    return [];
  }

  collectCoordinateSetsRecursively(value, collector = []) {
    if (!Array.isArray(value)) {
      return collector;
    }

    if (this.isCoordinateSet(value)) {
      collector.push(value);
      return collector;
    }

    value.forEach((item) => this.collectCoordinateSetsRecursively(item, collector));
    return collector;
  }

  isCoordinateSet(value) {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((point) => Array.isArray(point) && point.length >= 2)
    );
  }

  toLatLngs(coordinates) {
    if (!Array.isArray(coordinates)) {
      return [];
    }

    return coordinates
      .map((point) => {
        const longitude = this.toNumber(point?.[0]);
        const latitude = this.toNumber(point?.[1]);

        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          return null;
        }

        return [latitude, longitude];
      })
      .filter((point) => Array.isArray(point));
  }

  safeParseJson(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    try {
      return JSON.parse(trimmedValue);
    } catch (error) {
      return null;
    }
  }

  toNumber(value) {
    if (value === null || value === undefined || value === "") {
      return NaN;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : NaN;
  }

  reduceError(error) {
    if (!error) {
      return "Unknown error.";
    }

    if (Array.isArray(error?.body)) {
      return error.body.map((item) => item.message).join(", ");
    }

    if (typeof error?.body?.message === "string") {
      return error.body.message;
    }

    if (typeof error?.message === "string") {
      return error.message;
    }

    return "Unknown error.";
  }
}
