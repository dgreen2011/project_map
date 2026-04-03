import { api, LightningElement } from "lwc";
import { loadScript, loadStyle } from "lightning/platformResourceLoader";

import leafletResource from "@salesforce/resourceUrl/leaflet_1_9_4";

const DEFAULT_MAP_HEIGHT_PX = 220;
const DEFAULT_MAP_PADDING = [18, 18];
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const SNAP_TOLERANCE_PX = 34;
const SELECTION_MODE_NONE = "";
const SELECTION_MODE_FULL = "full";
const SELECTION_MODE_PARTIAL = "partial";
const BASE_LINE_STYLE = {
  color: "#9fb0c3",
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
const SELECTION_POINT_STYLE = {
  radius: 6,
  color: "#0176d3",
  weight: 2,
  opacity: 1,
  fillColor: "#ffffff",
  fillOpacity: 1
};
const ENDPOINT_POINT_STYLE = {
  radius: 7,
  color: "#5b7ca0",
  weight: 2,
  opacity: 0.95,
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
  tileLayer = null;
  baseLayerGroup = null;
  selectedLayerGroup = null;
  boundMapClickHandler = null;
  pendingViewportSyncTimer = null;

  selectionMode = SELECTION_MODE_NONE;
  partialSelectionPoints = [];
  partialPathCoordinates = [];
  fullCoordinateSets = [];
  fullPathValue = "";
  errorMessage = "";
  interactionMessage = "";
  hasViewportBeenFitted = false;

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

  get isSelectionPending() {
    return this.selectionMode === SELECTION_MODE_NONE;
  }

  get isFullMode() {
    return this.selectionMode === SELECTION_MODE_FULL;
  }

  get isPartialMode() {
    return this.selectionMode === SELECTION_MODE_PARTIAL;
  }

  get fullButtonClass() {
    return this.buildModeButtonClass(this.isFullMode);
  }

  get partialButtonClass() {
    return this.buildModeButtonClass(this.isPartialMode);
  }

  get utilityButtonClass() {
    return "prm-segment-editor-button prm-segment-editor-button-utility";
  }

  get utilityRowClass() {
    return [
      "prm-segment-editor-utility-row",
      this.isPartialMode ? "" : "prm-segment-editor-utility-row-hidden"
    ]
      .filter((className) => Boolean(className))
      .join(" ");
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
    return this.partialSelectionPoints.length > 0;
  }

  get canClearPartial() {
    return this.partialSelectionPoints.length > 0;
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

      if (this.hasSegmentGeometry) {
        await this.waitForMapContainerReady();
        this.initializeMap();
        await this.waitForLayoutStabilization();
        this.renderMapState();
      }

      this.notifySelectionChange();
    })().catch((error) => {
      this.errorMessage = this.reduceError(error);
      this.bootstrapPromise = null;
      throw error;
    });

    return this.bootstrapPromise;
  }

  initializeStateFromGeometry() {
    this.hasViewportBeenFitted = false;
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
      doubleClickZoom: true,
      scrollWheelZoom: true,
      boxZoom: true,
      keyboard: true,
      dragging: true,
      touchZoom: true
    });

    this.tileLayer = window.L.tileLayer(DEFAULT_TILE_URL, {
      attribution: DEFAULT_TILE_ATTRIBUTION,
      maxZoom: 22
    });
    this.tileLayer.addTo(this.map);

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
    this.tileLayer = null;
    this.baseLayerGroup = null;
    this.selectedLayerGroup = null;
    this.boundMapClickHandler = null;
    this.mapReady = false;
    this.hasViewportBeenFitted = false;
  }

  buildModeButtonClass(isActive) {
    return [
      "prm-segment-editor-button",
      isActive ? "prm-segment-editor-button-active" : ""
    ]
      .filter((className) => Boolean(className))
      .join(" ");
  }

  handleSelectFull() {
    if (this.isFullMode) {
      return;
    }

    this.selectionMode = SELECTION_MODE_FULL;
    this.partialSelectionPoints = [];
    this.partialPathCoordinates = [];
    this.interactionMessage = "";
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleSelectPartial() {
    if (this.isPartialMode) {
      return;
    }

    this.selectionMode = SELECTION_MODE_PARTIAL;
    this.partialSelectionPoints = [];
    this.partialPathCoordinates = [];
    this.interactionMessage = "";
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleUndoPartial() {
    if (!this.canUndoPartial) {
      return;
    }

    this.partialSelectionPoints = this.partialSelectionPoints.slice(0, -1);
    this.partialPathCoordinates = this.buildPartialPathCoordinates(this.partialSelectionPoints);
    this.interactionMessage = "";
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleClearPartial() {
    if (!this.canClearPartial) {
      return;
    }

    this.partialSelectionPoints = [];
    this.partialPathCoordinates = [];
    this.interactionMessage = "";
    this.renderMapState();
    this.notifySelectionChange();
  }

  handleMapClick(event) {
    if (!this.isPartialMode || !this.hasSegmentGeometry || !this.map) {
      return;
    }

    const preferredCoordinateSetIndex =
      this.partialSelectionPoints.length === 1 ? this.partialSelectionPoints[0].coordinateSetIndex : null;

    const snapPoint = this.findClosestSnapPoint(event?.latlng, preferredCoordinateSetIndex);
    if (!snapPoint) {
      this.interactionMessage = "Click near the Segment line or its ends. The saved path will snap back onto the Segment.";
      this.notifySelectionChange();
      return;
    }

    this.interactionMessage = "";

    if (this.partialSelectionPoints.length >= 2) {
      this.partialSelectionPoints = [snapPoint];
      this.partialPathCoordinates = [];
    } else {
      this.partialSelectionPoints = [...this.partialSelectionPoints, snapPoint];
      this.partialPathCoordinates = this.buildPartialPathCoordinates(this.partialSelectionPoints);
    }

    this.renderMapState();
    this.notifySelectionChange();
  }

  findClosestSnapPoint(latLng, preferredCoordinateSetIndex = null) {
    if (!this.map || !latLng) {
      return null;
    }

    const latitude = this.toNumber(latLng.lat);
    const longitude = this.toNumber(latLng.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const clickPoint = this.map.latLngToContainerPoint([latitude, longitude]);
    let bestCandidate = null;

    this.fullCoordinateSets.forEach((coordinateSet, coordinateSetIndex) => {
      if (preferredCoordinateSetIndex !== null && coordinateSetIndex !== preferredCoordinateSetIndex) {
        return;
      }

      let cumulativeDistance = 0;

      for (let segmentIndex = 0; segmentIndex < coordinateSet.length - 1; segmentIndex += 1) {
        const start = coordinateSet[segmentIndex];
        const end = coordinateSet[segmentIndex + 1];
        const projection = this.projectPointOntoSegment(longitude, latitude, start, end);
        const segmentLength = this.measureCoordinateDistance(start, end);

        if (!projection || segmentLength <= 0) {
          cumulativeDistance += segmentLength;
          continue;
        }

        const projectedPoint = this.map.latLngToContainerPoint([
          projection.latitude,
          projection.longitude
        ]);
        const pixelDistance = clickPoint.distanceTo(projectedPoint);

        const candidate = {
          coordinateSetIndex,
          segmentIndex,
          t: projection.t,
          coordinate: [projection.longitude, projection.latitude],
          progress: cumulativeDistance + segmentLength * projection.t,
          pixelDistance
        };

        if (!bestCandidate || candidate.pixelDistance < bestCandidate.pixelDistance) {
          bestCandidate = candidate;
        }

        cumulativeDistance += segmentLength;
      }
    });

    if (!bestCandidate || bestCandidate.pixelDistance > SNAP_TOLERANCE_PX) {
      return null;
    }

    return bestCandidate;
  }

  projectPointOntoSegment(longitude, latitude, start, end) {
    const ax = this.toNumber(start?.[0]);
    const ay = this.toNumber(start?.[1]);
    const bx = this.toNumber(end?.[0]);
    const by = this.toNumber(end?.[1]);

    if (![ax, ay, bx, by].every((value) => Number.isFinite(value))) {
      return null;
    }

    const abx = bx - ax;
    const aby = by - ay;
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared <= 0) {
      return null;
    }

    let t = ((longitude - ax) * abx + (latitude - ay) * aby) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    return {
      t,
      longitude: ax + abx * t,
      latitude: ay + aby * t
    };
  }

  buildPartialPathCoordinates(selectionPoints) {
    if (!Array.isArray(selectionPoints) || selectionPoints.length < 2) {
      return [];
    }

    const [rawStart, rawEnd] = selectionPoints;
    if (rawStart.coordinateSetIndex !== rawEnd.coordinateSetIndex) {
      return [];
    }

    const coordinateSet = this.fullCoordinateSets[rawStart.coordinateSetIndex];
    if (!Array.isArray(coordinateSet) || coordinateSet.length < 2) {
      return [];
    }

    const [startSnap, endSnap] =
      rawStart.progress <= rawEnd.progress ? [rawStart, rawEnd] : [rawEnd, rawStart];

    const partialCoordinates = [startSnap.coordinate];

    for (let vertexIndex = startSnap.segmentIndex + 1; vertexIndex <= endSnap.segmentIndex; vertexIndex += 1) {
      partialCoordinates.push(coordinateSet[vertexIndex]);
    }

    partialCoordinates.push(endSnap.coordinate);

    const normalizedCoordinates = this.normalizeCoordinateList(partialCoordinates);
    return normalizedCoordinates.length >= 2 ? normalizedCoordinates : [];
  }

  normalizeCoordinateList(coordinates) {
    if (!Array.isArray(coordinates)) {
      return [];
    }

    const normalized = [];

    coordinates.forEach((coordinate) => {
      const longitude = this.toNumber(coordinate?.[0]);
      const latitude = this.toNumber(coordinate?.[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return;
      }

      const nextCoordinate = [longitude, latitude];
      const previousCoordinate = normalized[normalized.length - 1];
      if (previousCoordinate && this.areCoordinatesEqual(previousCoordinate, nextCoordinate)) {
        return;
      }

      normalized.push(nextCoordinate);
    });

    return normalized;
  }

  areCoordinatesEqual(firstCoordinate, secondCoordinate) {
    const epsilon = 0.0000001;
    return (
      Math.abs(this.toNumber(firstCoordinate?.[0]) - this.toNumber(secondCoordinate?.[0])) <= epsilon &&
      Math.abs(this.toNumber(firstCoordinate?.[1]) - this.toNumber(secondCoordinate?.[1])) <= epsilon
    );
  }

  measureCoordinateDistance(start, end) {
    const startLongitude = this.toNumber(start?.[0]);
    const startLatitude = this.toNumber(start?.[1]);
    const endLongitude = this.toNumber(end?.[0]);
    const endLatitude = this.toNumber(end?.[1]);

    if (![startLongitude, startLatitude, endLongitude, endLatitude].every((value) => Number.isFinite(value))) {
      return 0;
    }

    const deltaLongitude = endLongitude - startLongitude;
    const deltaLatitude = endLatitude - startLatitude;
    return Math.sqrt(deltaLongitude * deltaLongitude + deltaLatitude * deltaLatitude);
  }

  notifySelectionChange() {
    let pathValue = "";
    let isValid = false;

    if (this.isFullMode) {
      pathValue = this.fullPathValue;
      isValid = Boolean(pathValue);
    } else if (this.isPartialMode && this.partialPathCoordinates.length >= 2) {
      pathValue = JSON.stringify([this.partialPathCoordinates]);
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
    }

    if (this.isPartialMode) {
      this.fullCoordinateSets.forEach((coordinateSet) => {
        const endpointCoordinates = [coordinateSet?.[0], coordinateSet?.[coordinateSet.length - 1]].filter(
          (coordinate) => Array.isArray(coordinate)
        );

        endpointCoordinates.forEach((endpointCoordinate) => {
          const endpointLatLng = this.toLatLngs([endpointCoordinate])[0];
          if (endpointLatLng) {
            this.selectedLayerGroup.addLayer(window.L.circleMarker(endpointLatLng, ENDPOINT_POINT_STYLE));
          }
        });
      });

      const partialLatLngs = this.toLatLngs(this.partialPathCoordinates);
      if (partialLatLngs.length >= 2) {
        this.selectedLayerGroup.addLayer(window.L.polyline(partialLatLngs, SELECTED_LINE_STYLE));
      }

      this.partialSelectionPoints.forEach((selectionPoint) => {
        const latLng = this.toLatLngs([selectionPoint.coordinate])[0];
        if (latLng) {
          this.selectedLayerGroup.addLayer(window.L.circleMarker(latLng, SELECTION_POINT_STYLE));
        }
      });
    }

    this.baseLayerGroup.addTo(this.map);
    this.selectedLayerGroup.addTo(this.map);
    this.scheduleViewportSync({ fitToBounds: !this.hasViewportBeenFitted });
  }

  scheduleViewportSync({ fitToBounds = false } = {}) {
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

        if (!fitToBounds) {
          return;
        }

        const bounds = this.baseLayerGroup?.getBounds();
        if (bounds && bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: DEFAULT_MAP_PADDING });
          this.hasViewportBeenFitted = true;
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

  async waitForMapContainerReady(maxAttempts = 12) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const mapContainer = this.template.querySelector('[data-id="segment-map"]');
      if (mapContainer) {
        return;
      }

      await this.waitForNextFrame();
    }
  }

  waitForLayoutStabilization() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      } else {
        window.setTimeout(resolve, 0);
      }
    });
  }

  waitForNextFrame() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
      } else {
        window.setTimeout(resolve, 0);
      }
    });
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
