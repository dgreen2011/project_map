import { api, LightningElement } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { NavigationMixin } from "lightning/navigation";
import getProjectMapData from "@salesforce/apex/ProjectRecordMapController.getProjectMapData";
import { loadScript, loadStyle } from "lightning/platformResourceLoader";

import leafletResource from "@salesforce/resourceUrl/leaflet_1_9_4";

const ALL_FILTER_VALUE = "__ALL__";
const DEFAULT_MAP_CENTER = [39.8283, -98.5795];
const DEFAULT_MAP_ZOOM = 4;
const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";
const DEFAULT_POINT_COLOR = "#2f80ed";
const DEFAULT_LINE_COLOR = "#0b8f86";
const DEFAULT_POLYGON_COLOR = "#5779c1";

const SITE_OBJECT_API_NAME = "sitetracker__site__c";
const SEGMENT_OBJECT_API_NAME = "sitetracker__segment__c";

const LASSO_CLOSE_DISTANCE_PX = 18;
const LASSO_STROKE_COLOR = "#0176d3";
const LASSO_FILL_COLOR = "#0176d3";
const SELECTION_HIGHLIGHT_COLOR = "#ff9f1c";
const GEOMETRY_EPSILON = 1e-10;

export default class ProjectRecordMap extends NavigationMixin(LightningElement) {
  @api recordId;
  @api mapHeightPx = 520;
  @api workLogFieldSetApiName;
  @api siteDetailFieldSetApiName;
  @api segmentDetailFieldSetApiName;

  @api mapLayerRecordId1;
  @api relationshipFieldPathOverride1;
  @api filterFieldPathOverride1;

  @api mapLayerRecordId2;
  @api relationshipFieldPathOverride2;
  @api filterFieldPathOverride2;

  @api mapLayerRecordId3;
  @api relationshipFieldPathOverride3;
  @api filterFieldPathOverride3;

  @api mapLayerRecordId4;
  @api relationshipFieldPathOverride4;
  @api filterFieldPathOverride4;

  @api mapLayerRecordId5;
  @api relationshipFieldPathOverride5;
  @api filterFieldPathOverride5;

  map = null;
  tileLayer = null;
  renderedFeatureGroup = null;
  selectionHighlightGroup = null;

  lassoDraftPolyline = null;
  lassoDraftPolygon = null;
  lassoGuidePolyline = null;
  lassoStartMarker = null;
  lassoDraftLatLngs = [];

  librariesReady = false;
  mapReady = false;
  bootstrapPromise = null;
  lastRequestSignature = null;
  pendingViewportSyncTimer = null;

  isLoading = false;
  isSidebarCollapsed = false;
  errorMessage = "";
  tileWarningMessage = "";
  initialLoadComplete = false;

  isWorkLogModalOpen = false;
  workLogLaunchContext = null;

  isBulkWorkLogModalOpen = false;
  selectedLassoFeatures = [];
  isLassoMode = false;

  uiLayers = [];

  popupActionListenerRegistered = false;
  boundTemplateClickHandler = null;
  isMapExpanded = false;

  boundLeafletMapClickHandler = null;
  boundLeafletMapDoubleClickHandler = null;
  boundLeafletMapMouseMoveHandler = null;

  renderedCallback() {
    this.ensurePopupActionListener();
    this.ensureBootstrapped();
    this.refreshIfNeeded();
  }

  disconnectedCallback() {
    this.clearPendingViewportSync();
    this.destroyMap();
    this.removePopupActionListener();
  }

  get mapStyle() {
    if (this.isMapExpanded) {
      return "height: 100%;";
    }

    const rawHeight = Number(this.mapHeightPx);
    const safeHeight = Number.isFinite(rawHeight) && rawHeight >= 180 ? rawHeight : 520;
    return `height: ${safeHeight}px;`;
  }

  get hasConfiguredLayers() {
    return this.buildConfiguredLayerInputs().length > 0;
  }

  get hasLayerPanels() {
    return this.uiLayers.length > 0;
  }

  get showSidePanel() {
    return this.hasLayerPanels && !this.isSidebarCollapsed && !this.isMapExpanded;
  }

  get showSidePanelInPopout() {
    return this.hasLayerPanels && !this.isSidebarCollapsed && this.isMapExpanded;
  }

  get showCollapsedSidebarHandle() {
    return this.hasLayerPanels && this.isSidebarCollapsed && !this.isMapExpanded;
  }

  get showCollapsedSidebarHandleInPopout() {
    return this.hasLayerPanels && this.isSidebarCollapsed && this.isMapExpanded;
  }

  get sidebarToggleIconName() {
    return this.isSidebarCollapsed ? "utility:chevronright" : "utility:chevronleft";
  }

  get sidebarToggleTitle() {
    return this.isSidebarCollapsed ? "Show Layers" : "Hide Layers";
  }

  get mapExpandButtonTitle() {
    return this.isMapExpanded ? "Collapse map" : "Expand map";
  }

  get mapExpandButtonIcon() {
    return this.isMapExpanded ? "×" : "⛶";
  }

  get lassoButtonTitle() {
    return this.isLassoMode
      ? "Cancel lasso selection"
      : "Lasso select Sites and Segments";
  }

  get lassoButtonIcon() {
    return this.isLassoMode ? "×" : "◌";
  }

  get isLassoButtonDisabled() {
    return !this.mapReady || this.isLoading || !this.hasLayerPanels;
  }

  get showInlineMapPanel() {
    return !this.isMapExpanded;
  }

  get contentGridClass() {
    return this.showSidePanel ? "content-grid" : "content-grid content-grid-collapsed";
  }

  get mapPopoutContentGridClass() {
    return this.showSidePanelInPopout
      ? "map-popout-content-grid"
      : "map-popout-content-grid map-popout-content-grid-collapsed";
  }

  get showNoConfiguredLayers() {
    return !this.isLoading && !this.errorMessage && !this.hasConfiguredLayers;
  }

  get totalRenderedFeatureCount() {
    return this.uiLayers.reduce((sum, layer) => sum + (layer.visibleFeatureCount || 0), 0);
  }

  get showNoVisibleFeatures() {
    return (
      !this.isLoading &&
      !this.errorMessage &&
      this.hasConfiguredLayers &&
      this.hasLayerPanels &&
      this.totalRenderedFeatureCount === 0
    );
  }

  get mapSummaryText() {
    if (!this.hasLayerPanels) {
      return "";
    }

    const visibleLayerCount = this.uiLayers.filter((layer) => layer.isVisible).length;
    return `${this.totalRenderedFeatureCount} visible feature${
      this.totalRenderedFeatureCount === 1 ? "" : "s"
    } across ${visibleLayerCount} visible layer${visibleLayerCount === 1 ? "" : "s"}`;
  }

  get workLogModalTargetRecordId() {
    return this.workLogLaunchContext?.targetRecordId || "";
  }

  get workLogModalTargetObjectApiName() {
    return this.workLogLaunchContext?.targetObjectApiName || "";
  }

  get workLogModalFeatureName() {
    return this.workLogLaunchContext?.featureName || "";
  }

  get bulkWorkLogSelections() {
    return this.selectedLassoFeatures.map((feature) => ({ ...feature }));
  }

  get showInitialLoadingOverlay() {
    return !this.initialLoadComplete;
  }

  get showInlineSpinner() {
    return this.isLoading && this.initialLoadComplete;
  }

  get contentSurfaceClass() {
    return this.showInitialLoadingOverlay
      ? "content-surface content-surface-pending"
      : "content-surface";
  }

  ensurePopupActionListener() {
    if (this.popupActionListenerRegistered) {
      return;
    }

    this.boundTemplateClickHandler = this.handleTemplateClick.bind(this);
    this.template.addEventListener("click", this.boundTemplateClickHandler);
    this.popupActionListenerRegistered = true;
  }

  removePopupActionListener() {
    if (!this.popupActionListenerRegistered || !this.boundTemplateClickHandler) {
      return;
    }

    try {
      this.template.removeEventListener("click", this.boundTemplateClickHandler);
    } catch (error) {
      // swallow cleanup errors
    }

    this.boundTemplateClickHandler = null;
    this.popupActionListenerRegistered = false;
  }

  async ensureBootstrapped() {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    this.bootstrapPromise = (async () => {
      await loadStyle(this, `${leafletResource}/leaflet.css`);
      await loadScript(this, `${leafletResource}/leaflet.js`);
      this.librariesReady = true;

      this.initializeMap();
      this.refreshIfNeeded();
    })().catch((error) => {
      this.errorMessage = this.reduceError(error);
      this.bootstrapPromise = null;
      this.markInitialLoadComplete();
      throw error;
    });

    return this.bootstrapPromise;
  }

  initializeMap() {
    if (this.mapReady || !window.L) {
      return;
    }

    const mapContainer = this.template.querySelector('[data-id="map"]');
    if (!mapContainer) {
      return;
    }

    this.map = window.L.map(mapContainer, {
      zoomControl: false
    });

    window.L.control
      .zoom({
        position: "bottomright"
      })
      .addTo(this.map);

    this.tileLayer = window.L
      .tileLayer(DEFAULT_TILE_URL, {
        attribution: DEFAULT_TILE_ATTRIBUTION,
        maxZoom: 22
      })
      .addTo(this.map);

    this.tileLayer.on("tileerror", () => {
      this.tileWarningMessage =
        "Map tiles failed to load. Confirm CSP Trusted Site access for https://tile.openstreetmap.org.";
    });

    this.tileLayer.on("load", () => {
      this.tileWarningMessage = "";
    });

    this.registerLeafletMapListeners();
    this.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    this.mapReady = true;
    this.syncLassoInteractionState();
    this.scheduleMapViewportSync({ fitToBounds: false });
  }

  registerLeafletMapListeners() {
    if (!this.map) {
      return;
    }

    if (!this.boundLeafletMapClickHandler) {
      this.boundLeafletMapClickHandler = this.handleLeafletMapClick.bind(this);
    }
    if (!this.boundLeafletMapDoubleClickHandler) {
      this.boundLeafletMapDoubleClickHandler = this.handleLeafletMapDoubleClick.bind(this);
    }
    if (!this.boundLeafletMapMouseMoveHandler) {
      this.boundLeafletMapMouseMoveHandler = this.handleLeafletMapMouseMove.bind(this);
    }

    this.map.on("click", this.boundLeafletMapClickHandler);
    this.map.on("dblclick", this.boundLeafletMapDoubleClickHandler);
    this.map.on("mousemove", this.boundLeafletMapMouseMoveHandler);
  }

  unregisterLeafletMapListeners() {
    if (!this.map) {
      return;
    }

    if (this.boundLeafletMapClickHandler) {
      this.map.off("click", this.boundLeafletMapClickHandler);
    }
    if (this.boundLeafletMapDoubleClickHandler) {
      this.map.off("dblclick", this.boundLeafletMapDoubleClickHandler);
    }
    if (this.boundLeafletMapMouseMoveHandler) {
      this.map.off("mousemove", this.boundLeafletMapMouseMoveHandler);
    }
  }

  destroyMap() {
    this.unregisterLeafletMapListeners();
    this.clearLassoDraftLayers();
    this.clearSelectionHighlightLayers();
    this.setMapContainerLassoState(false);
    this.isLassoMode = false;

    if (this.map) {
      try {
        this.map.remove();
      } catch (error) {
        // swallow cleanup errors
      }
    }

    this.map = null;
    this.tileLayer = null;
    this.renderedFeatureGroup = null;
    this.mapReady = false;
  }

  refreshIfNeeded() {
    if (!this.librariesReady || !this.mapReady || !this.recordId) {
      return;
    }

    const signature = this.buildRequestSignature();
    if (signature === this.lastRequestSignature) {
      return;
    }

    this.lastRequestSignature = signature;
    this.loadProjectMapData();
  }

  buildRequestSignature() {
    return JSON.stringify(this.buildRequestPayload());
  }

  buildRequestPayload() {
    return {
      projectId: this.recordId || null,

      mapLayerRecordId1: this.normalizeString(this.mapLayerRecordId1),
      relationshipFieldPathOverride1: this.normalizeString(this.relationshipFieldPathOverride1),
      filterFieldPathOverride1: this.normalizeString(this.filterFieldPathOverride1),

      mapLayerRecordId2: this.normalizeString(this.mapLayerRecordId2),
      relationshipFieldPathOverride2: this.normalizeString(this.relationshipFieldPathOverride2),
      filterFieldPathOverride2: this.normalizeString(this.filterFieldPathOverride2),

      mapLayerRecordId3: this.normalizeString(this.mapLayerRecordId3),
      relationshipFieldPathOverride3: this.normalizeString(this.relationshipFieldPathOverride3),
      filterFieldPathOverride3: this.normalizeString(this.filterFieldPathOverride3),

      mapLayerRecordId4: this.normalizeString(this.mapLayerRecordId4),
      relationshipFieldPathOverride4: this.normalizeString(this.relationshipFieldPathOverride4),
      filterFieldPathOverride4: this.normalizeString(this.filterFieldPathOverride4),

      mapLayerRecordId5: this.normalizeString(this.mapLayerRecordId5),
      relationshipFieldPathOverride5: this.normalizeString(this.relationshipFieldPathOverride5),
      filterFieldPathOverride5: this.normalizeString(this.filterFieldPathOverride5)
    };
  }

  buildConfiguredLayerInputs() {
    const request = this.buildRequestPayload();

    return [
      request.mapLayerRecordId1,
      request.mapLayerRecordId2,
      request.mapLayerRecordId3,
      request.mapLayerRecordId4,
      request.mapLayerRecordId5
    ].filter((value) => Boolean(value));
  }

  async loadProjectMapData() {
    if (!this.recordId) {
      return;
    }

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    if (!this.hasConfiguredLayers) {
      this.errorMessage = "";
      this.uiLayers = [];
      this.clearRenderedFeatures();
      this.resetMapView();
      this.scheduleMapViewportSync({ fitToBounds: false });
      this.markInitialLoadComplete();
      return;
    }

    this.isLoading = true;
    this.errorMessage = "";
    this.closeAllFilterMenus();

    try {
      const response = await getProjectMapData({
        request: this.buildRequestPayload()
      });

      await this.applyResponse(response);
      await this.waitForLayoutStabilization();
      this.renderVisibleFeatures({ fitToBounds: true });
      await this.waitForLayoutStabilization();
      this.markInitialLoadComplete();
    } catch (error) {
      this.errorMessage = this.reduceError(error);
      this.uiLayers = [];
      this.clearRenderedFeatures();
      this.clearSelectedFeatures();
      this.resetMapView();
      this.scheduleMapViewportSync({ fitToBounds: false });
      this.markInitialLoadComplete();
    } finally {
      this.isLoading = false;
    }
  }

  async applyResponse(response) {
    const previousVisibilityBySlot = {};
    const previousFilterBySlot = {};

    this.uiLayers.forEach((layer) => {
      previousVisibilityBySlot[layer.slotNumber] = layer.isVisible;
      previousFilterBySlot[layer.slotNumber] = layer.selectedFilterValue;
    });

    const responseLayers = Array.isArray(response?.layers) ? response.layers : [];

    this.uiLayers = responseLayers.map((layer) => {
      let normalizedLayer = this.normalizeLayerResponse(layer);

      const priorVisible = previousVisibilityBySlot[normalizedLayer.slotNumber];
      if (typeof priorVisible === "boolean") {
        normalizedLayer.isVisible = priorVisible;
      }

      const priorFilter = previousFilterBySlot[normalizedLayer.slotNumber];
      if (
        priorFilter &&
        normalizedLayer.filterControlOptions.some((option) => option.value === priorFilter)
      ) {
        normalizedLayer.selectedFilterValue = priorFilter;
      }

      normalizedLayer = this.applyFilterMenuState(normalizedLayer, {
        preserveSearchText: false,
        preserveMenuState: false
      });

      normalizedLayer.visibleFeatureCount = this.getFilteredFeatures(normalizedLayer).length;
      return normalizedLayer;
    });

    this.reconcileSelectedLassoFeatures();
  }

  normalizeLayerResponse(layer) {
    const safeFeatures = Array.isArray(layer?.features) ? layer.features : [];
    const safeWarnings = Array.isArray(layer?.warnings) ? layer.warnings : [];
    const safePopupFields = Array.isArray(layer?.popupFields) ? layer.popupFields : [];
    const safeFilterOptions = Array.isArray(layer?.filterOptions) ? layer.filterOptions : [];
    const safeStyleValueOptions = Array.isArray(layer?.styleValueOptions)
      ? layer.styleValueOptions
      : [];

    const normalizedStyleConfig = this.normalizeStyleConfig(layer?.styleConfig);

    const normalizedLayer = {
      slotNumber: Number(layer?.slotNumber) || 0,
      mapLayerId: layer?.mapLayerId || "",
      mapLayerName: layer?.mapLayerName || `Layer ${layer?.slotNumber || ""}`.trim(),
      layerType: layer?.layerType || "",
      layerStatus: layer?.layerStatus || "",
      objectApiName: layer?.objectApiName || "",
      geometryType: layer?.geometryType || "",
      relationshipFieldPath: layer?.relationshipFieldPath || "",
      relationshipFieldSource: layer?.relationshipFieldSource || "",
      filterFieldPath: layer?.filterFieldPath || "",
      filterFieldLabel: layer?.filterFieldLabel || "",
      filterFieldSource: layer?.filterFieldSource || "",
      popupFieldsRawJson: layer?.popupFieldsRawJson || "",
      popupFields: safePopupFields,
      styleConfig: normalizedStyleConfig,
      styleValueOptions: safeStyleValueOptions,
      queriedRecordCount: Number(layer?.queriedRecordCount) || 0,
      renderedFeatureCount: Number(layer?.renderedFeatureCount) || 0,
      skippedRecordCount: Number(layer?.skippedRecordCount) || 0,
      warnings: safeWarnings,
      errorMessage: layer?.errorMessage || "",
      features: safeFeatures.map((feature) => this.normalizeFeatureResponse(layer, feature)),
      isVisible: true,
      selectedFilterValue: ALL_FILTER_VALUE,
      selectedFilterLabel: "All",
      filterSearchText: "",
      filteredFilterOptions: [],
      isFilterMenuOpen: false,
      visibleFeatureCount: 0
    };

    normalizedLayer.hasError = Boolean(normalizedLayer.errorMessage);
    normalizedLayer.hasWarnings = normalizedLayer.warnings.length > 0;
    normalizedLayer.hasFilterControl =
      Boolean(normalizedLayer.filterFieldPath) && safeFilterOptions.length > 0;
    normalizedLayer.filterControlOptions = [
      { label: "All", value: ALL_FILTER_VALUE },
      ...safeFilterOptions.map((option) => ({
        label: option,
        value: option
      }))
    ];

    return this.applyFilterMenuState(normalizedLayer, {
      preserveSearchText: false,
      preserveMenuState: false
    });
  }

  normalizeFeatureResponse(layer, feature) {
    return {
      recordId: feature?.recordId || "",
      name: feature?.name || "",
      geometryType: feature?.geometryType || "",
      geometryRaw: feature?.geometryRaw || "",
      latitude: this.toNumber(feature?.latitude),
      longitude: this.toNumber(feature?.longitude),
      geometrySourceFieldPath: feature?.geometrySourceFieldPath || "",
      filterValue: feature?.filterValue || "",
      styleValue: feature?.styleValue || "",
      popupValues: Array.isArray(feature?.popupValues) ? feature.popupValues : [],
      canCreateWorkLog: Boolean(feature?.canCreateWorkLog),
      productionLineAllocationId: feature?.productionLineAllocationId || "",
      targetObjectApiName:
        feature?.targetObjectApiName || feature?.objectApiName || layer?.objectApiName || "",
      recordUrl: this.buildFallbackRecordUrl(
        feature?.recordId || "",
        feature?.targetObjectApiName || feature?.objectApiName || layer?.objectApiName || ""
      )
    };
  }

  normalizeStyleConfig(styleConfig) {
    if (!styleConfig) {
      return null;
    }

    const defaultSymbol = this.safeParseJson(styleConfig.defaultSymbolJson);
    const uniqueValueRules = Array.isArray(styleConfig.uniqueValueRules)
      ? styleConfig.uniqueValueRules.map((rule) => ({
          label: rule?.label || "",
          value: rule?.value || "",
          symbol: this.safeParseJson(rule?.symbolJson)
        }))
      : [];

    return {
      rawJson: styleConfig.rawJson || "",
      fieldPath: styleConfig.fieldPath || "",
      fieldLabel: styleConfig.fieldLabel || "",
      defaultSymbol,
      uniqueValueRules
    };
  }

  applyFilterMenuState(layer, { preserveSearchText = true, preserveMenuState = true } = {}) {
    const selectedOption =
      layer.filterControlOptions.find((option) => option.value === layer.selectedFilterValue) ||
      layer.filterControlOptions[0] || { label: "All", value: ALL_FILTER_VALUE };

    const filterSearchText = preserveSearchText ? layer.filterSearchText || "" : "";
    const normalizedSearch = this.normalizeString(filterSearchText) || "";
    const loweredSearch = normalizedSearch.toLowerCase();

    const filteredFilterOptions = loweredSearch
      ? layer.filterControlOptions.filter((option) =>
          option.label.toLowerCase().includes(loweredSearch)
        )
      : layer.filterControlOptions;

    return {
      ...layer,
      selectedFilterLabel: selectedOption.label,
      filterSearchText,
      filteredFilterOptions,
      isFilterMenuOpen: preserveMenuState ? Boolean(layer.isFilterMenuOpen) : false
    };
  }

  getFilteredFeatures(layer) {
    if (!layer?.isVisible) {
      return [];
    }

    if (!layer?.selectedFilterValue || layer.selectedFilterValue === ALL_FILTER_VALUE) {
      return layer.features;
    }

    return layer.features.filter((feature) => feature.filterValue === layer.selectedFilterValue);
  }

  getSelectableVisibleFeatures() {
    const visibleSelectableFeatures = [];

    this.uiLayers.forEach((layer) => {
      if (!layer || layer.hasError || !layer.isVisible) {
        return;
      }

      this.getFilteredFeatures(layer).forEach((feature) => {
        if (this.isSelectableFeature(layer, feature)) {
          visibleSelectableFeatures.push({ layer, feature });
        }
      });
    });

    return visibleSelectableFeatures;
  }

  isSelectableFeature(layer, feature) {
    const normalizedObjectApiName = this.normalizeString(
      feature?.targetObjectApiName || layer?.objectApiName || ""
    )?.toLowerCase();

    return (
      Boolean(feature?.recordId) &&
      (normalizedObjectApiName === SITE_OBJECT_API_NAME ||
        normalizedObjectApiName === SEGMENT_OBJECT_API_NAME)
    );
  }

  closeAllFilterMenus() {
    this.uiLayers = this.uiLayers.map((layer) =>
      this.applyFilterMenuState(
        {
          ...layer,
          isFilterMenuOpen: false
        },
        {
          preserveSearchText: false,
          preserveMenuState: true
        }
      )
    );
  }

  clearRenderedFeatures() {
    if (this.map && this.renderedFeatureGroup) {
      this.map.removeLayer(this.renderedFeatureGroup);
    }

    this.renderedFeatureGroup = null;
  }

  renderVisibleFeatures({ fitToBounds = false } = {}) {
    if (!this.mapReady || !window.L) {
      return;
    }

    this.clearRenderedFeatures();

    const featureGroup = window.L.featureGroup();
    let hasAnyRenderedFeature = false;

    this.uiLayers = this.uiLayers.map((layer) => {
      const visibleFeatures = this.getFilteredFeatures(layer);
      const updatedLayer = {
        ...layer,
        visibleFeatureCount: visibleFeatures.length
      };

      if (!layer.hasError && layer.isVisible) {
        visibleFeatures.forEach((feature) => {
          const leafletLayer = this.createLeafletLayer(updatedLayer, feature);
          if (leafletLayer) {
            featureGroup.addLayer(leafletLayer);
            hasAnyRenderedFeature = true;
          }
        });
      }

      return updatedLayer;
    });

    this.renderedFeatureGroup = featureGroup.addTo(this.map);
    this.renderSelectionHighlights();
    this.syncLassoDraftLayers();

    this.scheduleMapViewportSync({
      fitToBounds,
      fallbackToDefault: !hasAnyRenderedFeature
    });
  }

  renderSelectionHighlights() {
    this.clearSelectionHighlightLayers();

    if (!this.mapReady || !window.L || !Array.isArray(this.selectedLassoFeatures)) {
      return;
    }

    if (!this.selectedLassoFeatures.length) {
      return;
    }

    const highlightGroup = window.L.featureGroup();

    this.selectedLassoFeatures.forEach((feature) => {
      const highlightLayer = this.createSelectionHighlightLayer(feature);
      if (highlightLayer) {
        highlightGroup.addLayer(highlightLayer);
      }
    });

    if (highlightGroup.getLayers().length) {
      this.selectionHighlightGroup = highlightGroup.addTo(this.map);
    }
  }

  clearSelectionHighlightLayers() {
    if (this.map && this.selectionHighlightGroup) {
      this.map.removeLayer(this.selectionHighlightGroup);
    }

    this.selectionHighlightGroup = null;
  }

  createSelectionHighlightLayer(feature) {
    if (!window.L || !feature) {
      return null;
    }

    if (feature.geometryType === "point") {
      return this.createSelectionPointLayer(feature);
    }

    if (feature.geometryType === "polyline") {
      return this.createSelectionPolylineLayer(feature);
    }

    return null;
  }

  createSelectionPointLayer(feature) {
    const latitude = this.toNumber(feature?.latitude);
    const longitude = this.toNumber(feature?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return window.L.circleMarker([latitude, longitude], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      opacity: 1,
      fillColor: SELECTION_HIGHLIGHT_COLOR,
      fillOpacity: 0.95
    });
  }

  createSelectionPolylineLayer(feature) {
    const coordinateSets = this.extractPolylineCoordinateSets(feature?.geometryRaw);
    if (!coordinateSets.length) {
      return null;
    }

    const renderedLayers = [];

    coordinateSets.forEach((coordinateSet) => {
      const latLngs = this.toLatLngs(coordinateSet);
      if (latLngs.length < 2) {
        return;
      }

      renderedLayers.push(
        window.L.polyline(latLngs, {
          color: "#ffffff",
          weight: 8,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round"
        })
      );

      renderedLayers.push(
        window.L.polyline(latLngs, {
          color: SELECTION_HIGHLIGHT_COLOR,
          weight: 5,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round"
        })
      );
    });

    if (!renderedLayers.length) {
      return null;
    }

    return renderedLayers.length === 1
      ? renderedLayers[0]
      : window.L.featureGroup(renderedLayers);
  }

  fitMapToFeatureGroup(featureGroup) {
    if (!this.map || !featureGroup) {
      return;
    }

    const bounds = featureGroup.getBounds();
    if (bounds && bounds.isValid()) {
      this.map.fitBounds(bounds, {
        padding: [24, 24]
      });
      return;
    }

    this.resetMapView();
  }

  resetMapView() {
    if (!this.map) {
      return;
    }

    this.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  }

  captureMapViewState() {
    if (!this.map) {
      return null;
    }

    try {
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();

      if (!center || !Number.isFinite(zoom)) {
        return null;
      }

      return {
        center: [center.lat, center.lng],
        zoom
      };
    } catch (error) {
      return null;
    }
  }

  restoreMapViewState(viewState) {
    if (!this.map || !viewState?.center || !Number.isFinite(viewState?.zoom)) {
      return;
    }

    try {
      this.map.setView(viewState.center, viewState.zoom, {
        animate: false
      });
    } catch (error) {
      // swallow restore errors
    }
  }

  clearPendingViewportSync() {
    if (this.pendingViewportSyncTimer) {
      window.clearTimeout(this.pendingViewportSyncTimer);
      this.pendingViewportSyncTimer = null;
    }
  }

  scheduleMapViewportSync({
    fitToBounds = false,
    fallbackToDefault = false,
    preserveView = false,
    viewState = null
  } = {}) {
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

        if (preserveView && viewState) {
          this.restoreMapViewState(viewState);
        }

        if (!fitToBounds) {
          return;
        }

        const featureGroup = this.renderedFeatureGroup;
        const hasRenderedLayers =
          featureGroup &&
          typeof featureGroup.getLayers === "function" &&
          featureGroup.getLayers().length > 0;

        if (hasRenderedLayers) {
          this.fitMapToFeatureGroup(featureGroup);
        } else if (fallbackToDefault) {
          this.resetMapView();
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

  markInitialLoadComplete() {
    if (this.initialLoadComplete) {
      return;
    }

    this.initialLoadComplete = true;

    if (this.mapReady) {
      window.setTimeout(() => {
        this.scheduleMapViewportSync({
          fitToBounds: true,
          fallbackToDefault: true
        });
      }, 0);
    }
  }

  createLeafletLayer(layer, feature) {
    if (!window.L || !feature) {
      return null;
    }

    const popupHtml = this.buildPopupHtml(layer, feature);
    const symbol = this.resolveFeatureSymbol(layer, feature);

    if (feature.geometryType === "point") {
      return this.createPointLayer(feature, symbol, popupHtml);
    }

    if (feature.geometryType === "polyline") {
      return this.createPolylineLayer(feature, symbol, popupHtml);
    }

    if (feature.geometryType === "polygon") {
      return this.createPolygonLayer(feature, symbol, popupHtml);
    }

    return null;
  }

  createPointLayer(feature, symbol, popupHtml) {
    const latitude = this.toNumber(feature.latitude);
    const longitude = this.toNumber(feature.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const pointStyle = this.buildPointLeafletStyle(symbol);
    const circleMarker = window.L.circleMarker([latitude, longitude], pointStyle);

    if (popupHtml) {
      circleMarker.bindPopup(popupHtml, { maxWidth: 320 });
    }

    return circleMarker;
  }

  createPolylineLayer(feature, symbol, popupHtml) {
    const coordinateSets = this.extractPolylineCoordinateSets(feature.geometryRaw);
    if (!coordinateSets.length) {
      return null;
    }

    const renderedLayers = [];
    coordinateSets.forEach((coordinateSet) => {
      const latLngs = this.toLatLngs(coordinateSet);
      if (latLngs.length < 2) {
        return;
      }

      const outlineStyle = this.buildPolylineOutlineStyle(symbol);
      if (outlineStyle) {
        renderedLayers.push(window.L.polyline(latLngs, outlineStyle));
      }

      renderedLayers.push(window.L.polyline(latLngs, this.buildPolylineStyle(symbol)));
    });

    if (!renderedLayers.length) {
      return null;
    }

    return this.bundleFeatureLayers(renderedLayers, popupHtml);
  }

  createPolygonLayer(feature, symbol, popupHtml) {
    const polygonSets = this.extractPolygonCoordinateSets(feature.geometryRaw);
    if (!polygonSets.length) {
      return null;
    }

    const renderedLayers = [];
    polygonSets.forEach((polygonSet) => {
      const latLngRings = polygonSet
        .map((ring) => this.toLatLngs(ring))
        .filter((ring) => Array.isArray(ring) && ring.length >= 3);

      if (!latLngRings.length) {
        return;
      }

      renderedLayers.push(window.L.polygon(latLngRings, this.buildPolygonStyle(symbol)));
    });

    if (!renderedLayers.length) {
      return null;
    }

    return this.bundleFeatureLayers(renderedLayers, popupHtml);
  }

  bundleFeatureLayers(layers, popupHtml) {
    if (layers.length === 1) {
      if (popupHtml) {
        layers[0].bindPopup(popupHtml, { maxWidth: 320 });
      }
      return layers[0];
    }

    const featureGroup = window.L.featureGroup(layers);
    if (popupHtml) {
      featureGroup.bindPopup(popupHtml, { maxWidth: 320 });
    }
    return featureGroup;
  }

  resolveFeatureSymbol(layer, feature) {
    const styleConfig = layer?.styleConfig;
    if (!styleConfig) {
      return null;
    }

    const styleValue = feature?.styleValue;
    if (styleValue && Array.isArray(styleConfig.uniqueValueRules)) {
      const match = styleConfig.uniqueValueRules.find((rule) => rule.value === styleValue);
      if (match?.symbol) {
        return match.symbol;
      }
    }

    return styleConfig.defaultSymbol || null;
  }

  buildPointLeafletStyle(symbol) {
    const fillColor = this.resolveSymbolColor(symbol?.color, DEFAULT_POINT_COLOR);
    const outlineColor = this.resolveSymbolColor(symbol?.outline?.color, "#000000");
    const radius = this.resolvePositiveNumber(symbol?.size, 6);
    const fillOpacity = this.resolveColorAlpha(symbol?.color, 0.75);
    const weight = this.resolvePositiveNumber(symbol?.outline?.width, 1);

    return {
      radius,
      color: outlineColor,
      weight,
      opacity: 1,
      fillColor,
      fillOpacity
    };
  }

  buildPolylineStyle(symbol) {
    return {
      color: this.resolveSymbolColor(symbol?.color, DEFAULT_LINE_COLOR),
      weight: this.resolvePositiveNumber(symbol?.width, 3),
      opacity: this.resolveColorAlpha(symbol?.color, 0.85),
      dashArray: this.resolveLineDashArray(symbol?.style),
      lineCap: "round",
      lineJoin: "round"
    };
  }

  buildPolylineOutlineStyle(symbol) {
    const outline = symbol?.outline;
    if (!outline) {
      return null;
    }

    const innerWeight = this.resolvePositiveNumber(symbol?.width, 3);
    const outlineWidth = this.resolvePositiveNumber(outline?.width, 1);

    return {
      color: this.resolveSymbolColor(outline?.color, "#000000"),
      weight: innerWeight + outlineWidth * 2,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round"
    };
  }

  buildPolygonStyle(symbol) {
    return {
      color: this.resolveSymbolColor(symbol?.outline?.color, "#000000"),
      weight: this.resolvePositiveNumber(symbol?.outline?.width, 1),
      opacity: 1,
      fillColor: this.resolveSymbolColor(symbol?.color, DEFAULT_POLYGON_COLOR),
      fillOpacity: this.resolveColorAlpha(symbol?.color, 0.35),
      dashArray: this.resolveLineDashArray(symbol?.style)
    };
  }

  resolveLineDashArray(styleName) {
    const normalizedStyle = this.normalizeString(styleName)?.toLowerCase();

    switch (normalizedStyle) {
      case "dash":
      case "short-dash":
      case "long-dash":
        return "8 6";
      case "dot":
      case "short-dot":
        return "2 6";
      case "dash-dot":
      case "short-dash-dot":
        return "8 4 2 4";
      default:
        return null;
    }
  }

  resolveSymbolColor(inputColor, fallbackColor) {
    if (Array.isArray(inputColor)) {
      const [red, green, blue, alpha] = inputColor;
      const numericAlpha = this.toNumber(alpha);

      if (
        Number.isFinite(this.toNumber(red)) &&
        Number.isFinite(this.toNumber(green)) &&
        Number.isFinite(this.toNumber(blue))
      ) {
        if (Number.isFinite(numericAlpha)) {
          return `rgba(${Number(red)}, ${Number(green)}, ${Number(blue)}, ${numericAlpha})`;
        }

        return `rgb(${Number(red)}, ${Number(green)}, ${Number(blue)})`;
      }
    }

    if (typeof inputColor === "string" && inputColor.trim()) {
      return inputColor.trim();
    }

    return fallbackColor;
  }

  resolveColorAlpha(inputColor, fallbackAlpha) {
    if (Array.isArray(inputColor) && inputColor.length >= 4) {
      const numericAlpha = this.toNumber(inputColor[3]);
      if (Number.isFinite(numericAlpha)) {
        return numericAlpha;
      }
    }

    return fallbackAlpha;
  }

  resolvePositiveNumber(value, fallbackValue) {
    const numericValue = this.toNumber(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallbackValue;
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

  extractPolygonCoordinateSets(geometryRaw) {
    const parsed = this.safeParseJson(geometryRaw);
    if (!parsed) {
      return [];
    }

    if (parsed?.type === "Feature" && parsed.geometry) {
      return this.extractPolygonCoordinateSets(parsed.geometry);
    }

    if (parsed?.type === "Polygon" && Array.isArray(parsed.coordinates)) {
      return [parsed.coordinates];
    }

    if (parsed?.type === "MultiPolygon" && Array.isArray(parsed.coordinates)) {
      return parsed.coordinates.filter(
        (polygon) => Array.isArray(polygon) && polygon.every((ring) => this.isCoordinateSet(ring))
      );
    }

    if (Array.isArray(parsed) && this.isCoordinateSet(parsed)) {
      return [[parsed]];
    }

    if (Array.isArray(parsed) && parsed.every((item) => this.isCoordinateSet(item))) {
      return [parsed];
    }

    if (
      Array.isArray(parsed) &&
      parsed.every(
        (polygon) => Array.isArray(polygon) && polygon.every((ring) => this.isCoordinateSet(ring))
      )
    ) {
      return parsed;
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

  buildFallbackRecordUrl(recordId) {
    if (!recordId) {
      return "#";
    }

    return `/${encodeURIComponent(recordId)}`;
  }

  shouldShowWorkLogAction(layer, feature) {
    const objectApiName = this.normalizeString(
      feature?.targetObjectApiName || layer?.objectApiName || ""
    )?.toLowerCase();

    if (objectApiName !== SITE_OBJECT_API_NAME && objectApiName !== SEGMENT_OBJECT_API_NAME) {
      return false;
    }

    return Boolean(feature?.canCreateWorkLog || feature?.productionLineAllocationId);
  }

  buildPopupHtml(layer, feature) {
    const popupValues = Array.isArray(feature?.popupValues) ? feature.popupValues : [];
    const escapedName = this.escapeHtml(feature?.name || layer?.mapLayerName || "Record");
    const escapedRecordId = this.escapeHtml(feature?.recordId || "");
    const escapedObjectApiName = this.escapeHtml(
      feature?.targetObjectApiName || layer?.objectApiName || ""
    );
    const popupShellStyle = [
      "display:flex",
      "flex-direction:column",
      "gap:0.7rem",
      "min-width:13rem",
      "max-width:17rem",
      "font-family:'Salesforce Sans',Arial,sans-serif",
      "color:#181818"
    ].join(";");
    const titleButtonStyle = [
      "display:block",
      "width:100%",
      "padding:0",
      "border:0",
      "background:transparent",
      "font-family:'Salesforce Sans',Arial,sans-serif",
      "font-size:0.96rem",
      "font-weight:700",
      "line-height:1.3",
      "color:#0176d3",
      "text-align:left",
      "text-decoration:none",
      "word-break:break-word",
      "cursor:pointer"
    ].join(";");
    const valuesWrapStyle = "display:flex;flex-direction:column;gap:0.38rem;";
    const valueStyle = "font-size:0.84rem;line-height:1.4;color:#181818;word-break:break-word;";
    const emptyStyle = "font-size:0.8rem;line-height:1.35;color:#5c5c5c;";
    const footerStyle =
      "display:flex;justify-content:flex-end;padding-top:0.2rem;border-top:1px solid #eef1f6;";
    const actionButtonStyle = [
      "display:inline-flex",
      "align-items:center",
      "gap:0.38rem",
      "border:1px solid #d8dde6",
      "border-radius:0.45rem",
      "background:#ffffff",
      "color:#0176d3",
      "padding:0.45rem 0.7rem",
      "font-size:0.78rem",
      "font-weight:600",
      "line-height:1",
      "cursor:pointer"
    ].join(";");
    const actionIconStyle = "font-size:0.92rem;line-height:1;";

    const detailRows = popupValues
      .map((popupValue) => {
        const value = this.escapeHtml(this.formatPopupValue(popupValue));
        if (!value) {
          return "";
        }

        return `<div style="${valueStyle}">${value}</div>`;
      })
      .filter((markup) => Boolean(markup))
      .join("");

    const actionMarkup = this.shouldShowWorkLogAction(layer, feature)
      ? `
        <div style="${footerStyle}">
          <button
            type="button"
            title="Create Work Log"
            aria-label="Create Work Log"
            data-worklog-action="true"
            data-record-id="${escapedRecordId}"
            data-object-api-name="${escapedObjectApiName}"
            data-feature-name="${escapedName}"
            style="${actionButtonStyle}"
          >
            <span style="${actionIconStyle}" aria-hidden="true">＋</span>
            <span>Create Work Log</span>
          </button>
        </div>`
      : "";

    return `
      <div style="${popupShellStyle}">
        <div>
          <button
            type="button"
            title="Open record"
            aria-label="Open record"
            data-record-action="true"
            data-record-id="${escapedRecordId}"
            data-object-api-name="${escapedObjectApiName}"
            style="${titleButtonStyle}"
          >
            ${escapedName}
          </button>
        </div>
        <div style="${valuesWrapStyle}">
          ${detailRows || `<div style="${emptyStyle}">No popup details configured.</div>`}
        </div>
        ${actionMarkup}
      </div>
    `;
  }

  formatPopupValue(popupValue) {
    const rawValue = popupValue?.displayValue ?? "";
    const dataType = this.normalizeString(popupValue?.dataType)?.toUpperCase();

    if (dataType === "DOUBLE" || dataType === "CURRENCY" || dataType === "INTEGER") {
      const numericValue = this.toNumber(rawValue);
      if (Number.isFinite(numericValue)) {
        return numericValue.toLocaleString();
      }
    }

    return rawValue;
  }

  async handleTemplateClick(event) {
    const recordActionButton = event.target?.closest?.('[data-record-action="true"]');
    if (recordActionButton) {
      event.preventDefault();
      event.stopPropagation();

      const targetRecordId = recordActionButton.dataset.recordId;
      const targetObjectApiName = recordActionButton.dataset.objectApiName;
      await this.openRecordInNewTab(targetRecordId, targetObjectApiName);
      return;
    }

    const actionButton = event.target?.closest?.('[data-worklog-action="true"]');
    if (!actionButton) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const targetRecordId = actionButton.dataset.recordId;
    const targetObjectApiName = actionButton.dataset.objectApiName;
    const featureName = actionButton.dataset.featureName;

    if (!targetRecordId || !targetObjectApiName) {
      this.dispatchToast("Work Log Error", "Unable to determine which record was clicked.", "error");
      return;
    }

    this.openWorkLogModal({
      targetRecordId,
      targetObjectApiName,
      featureName
    });
  }

  openWorkLogModal({ targetRecordId, targetObjectApiName, featureName }) {
    this.workLogLaunchContext = {
      targetRecordId,
      targetObjectApiName,
      featureName: featureName || ""
    };
    this.isWorkLogModalOpen = true;
  }

  handleWorkLogModalClose() {
    this.isWorkLogModalOpen = false;
    this.workLogLaunchContext = null;
  }

  handleBulkWorkLogModalClose() {
    this.isBulkWorkLogModalOpen = false;
    this.clearSelectedFeatures();
  }

  handleBulkWorkLogCreated() {
    this.isBulkWorkLogModalOpen = false;
    this.clearSelectedFeatures();
    this.lastRequestSignature = null;
    this.loadProjectMapData();
  }

  setLayerVisibility(slotNumber, isVisible) {
    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });
    this.closeAllFilterMenus();
    this.uiLayers = this.uiLayers.map((layer) =>
      layer.slotNumber === slotNumber ? { ...layer, isVisible } : layer
    );
    this.renderVisibleFeatures({ fitToBounds: true });
  }

  handleLayerVisibilityChange(event) {
    const slotNumber = Number(event.target.dataset.slot);
    const isVisible = event.target.checked;
    this.setLayerVisibility(slotNumber, isVisible);
  }

  handleLayerVisibilityToggle(event) {
    const slotNumber = Number(event.currentTarget.dataset.slot);
    const targetLayer = this.uiLayers.find((layer) => layer.slotNumber === slotNumber);
    if (!targetLayer) {
      return;
    }

    this.setLayerVisibility(slotNumber, !targetLayer.isVisible);
  }

  handleToggleFilterMenu(event) {
    const slotNumber = Number(event.currentTarget.dataset.slot);

    this.uiLayers = this.uiLayers.map((layer) => {
      const shouldOpen = layer.slotNumber === slotNumber ? !layer.isFilterMenuOpen : false;
      return this.applyFilterMenuState(
        {
          ...layer,
          isFilterMenuOpen: shouldOpen,
          filterSearchText: shouldOpen ? "" : layer.filterSearchText
        },
        {
          preserveSearchText: shouldOpen,
          preserveMenuState: true
        }
      );
    });
  }

  handleFilterSearchInput(event) {
    const slotNumber = Number(event.target.dataset.slot);
    const searchText = event.target.value || "";

    this.uiLayers = this.uiLayers.map((layer) =>
      layer.slotNumber === slotNumber
        ? this.applyFilterMenuState(
            {
              ...layer,
              filterSearchText: searchText,
              isFilterMenuOpen: true
            },
            {
              preserveSearchText: true,
              preserveMenuState: true
            }
          )
        : layer
    );
  }

  handleFilterOptionSelect(event) {
    const slotNumber = Number(event.currentTarget.dataset.slot);
    const selectedFilterValue = event.currentTarget.dataset.value;

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    this.uiLayers = this.uiLayers.map((layer) => {
      if (layer.slotNumber !== slotNumber) {
        return this.applyFilterMenuState(
          {
            ...layer,
            isFilterMenuOpen: false
          },
          {
            preserveSearchText: false,
            preserveMenuState: true
          }
        );
      }

      return this.applyFilterMenuState(
        {
          ...layer,
          selectedFilterValue,
          isFilterMenuOpen: false
        },
        {
          preserveSearchText: false,
          preserveMenuState: true
        }
      );
    });

    this.renderVisibleFeatures({ fitToBounds: true });
  }

  handleToggleSidebar() {
    this.closeAllFilterMenus();

    const viewState = this.captureMapViewState();
    this.isSidebarCollapsed = !this.isSidebarCollapsed;

    this.scheduleMapViewportSync({
      preserveView: true,
      viewState
    });
  }

  handleRefreshClick() {
    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });
    this.closeAllFilterMenus();
    this.lastRequestSignature = null;
    this.loadProjectMapData();
  }

  handleToggleLassoMode() {
    if (this.isLassoButtonDisabled) {
      return;
    }

    if (this.isLassoMode) {
      this.cancelLassoMode();
      return;
    }

    this.clearSelectedFeatures();
    this.isBulkWorkLogModalOpen = false;
    this.isLassoMode = true;
    this.lassoDraftLatLngs = [];
    this.clearLassoDraftLayers();
    this.closeAllFilterMenus();

    if (this.map) {
      this.map.closePopup();
    }

    this.syncLassoInteractionState();
    this.dispatchToast(
      "Lasso Selection",
      "Click around the Sites and Segments you want. Double-click, or click back near the starting point, to close the lasso.",
      "info"
    );
  }

  cancelLassoMode({ clearSelection = false, closeBulkModal = false } = {}) {
    this.isLassoMode = false;
    this.clearLassoDraftLayers();
    this.syncLassoInteractionState();

    if (clearSelection) {
      this.clearSelectedFeatures();
    }

    if (closeBulkModal) {
      this.isBulkWorkLogModalOpen = false;
    }
  }

  clearSelectedFeatures() {
    this.selectedLassoFeatures = [];
    this.clearSelectionHighlightLayers();
  }

  handleLeafletMapClick(event) {
    if (!this.isLassoMode || !this.map || !event?.latlng) {
      return;
    }

    this.map.closePopup();

    const nextPoint = [event.latlng.lat, event.latlng.lng];

    if (this.lassoDraftLatLngs.length >= 3 && this.isNearFirstLassoVertex(nextPoint)) {
      this.completeLassoSelection();
      return;
    }

    this.lassoDraftLatLngs = [...this.lassoDraftLatLngs, nextPoint];
    this.syncLassoDraftLayers();
  }

  handleLeafletMapDoubleClick(event) {
    if (!this.isLassoMode) {
      return;
    }

    event?.originalEvent?.preventDefault?.();
    event?.originalEvent?.stopPropagation?.();

    if (this.lassoDraftLatLngs.length < 3) {
      this.dispatchToast(
        "Lasso Selection",
        "Add at least 3 points before closing the lasso.",
        "warning"
      );
      return;
    }

    this.completeLassoSelection();
  }

  handleLeafletMapMouseMove(event) {
    if (!this.isLassoMode || !this.map || !event?.latlng || !this.lassoDraftLatLngs.length) {
      this.clearLassoGuideLayer();
      return;
    }

    const lastPoint = this.lassoDraftLatLngs[this.lassoDraftLatLngs.length - 1];
    const guideLatLngs = [lastPoint, [event.latlng.lat, event.latlng.lng]];

    if (!this.lassoGuidePolyline) {
      this.lassoGuidePolyline = window.L.polyline(guideLatLngs, {
        color: LASSO_STROKE_COLOR,
        weight: 1.5,
        opacity: 0.7,
        dashArray: "4 6",
        lineCap: "round",
        lineJoin: "round",
        interactive: false
      }).addTo(this.map);
      return;
    }

    this.lassoGuidePolyline.setLatLngs(guideLatLngs);
  }

  completeLassoSelection() {
    if (this.lassoDraftLatLngs.length < 3) {
      this.dispatchToast(
        "Lasso Selection",
        "Add at least 3 points before closing the lasso.",
        "warning"
      );
      return;
    }

    const closedPolygon = this.ensureClosedPolygonLatLngs(this.lassoDraftLatLngs);
    const selectedFeatures = this.selectFeaturesWithinLasso(closedPolygon);

    this.isLassoMode = false;
    this.clearLassoDraftLayers();
    this.syncLassoInteractionState();

    if (!selectedFeatures.length) {
      this.clearSelectedFeatures();
      this.dispatchToast(
        "Lasso Selection",
        "No visible Sites or Segments were found inside the lasso.",
        "info"
      );
      return;
    }

    this.selectedLassoFeatures = selectedFeatures;
    this.renderSelectionHighlights();
    this.isBulkWorkLogModalOpen = true;
  }

  syncLassoInteractionState() {
    if (this.map?.doubleClickZoom) {
      if (this.isLassoMode) {
        this.map.doubleClickZoom.disable();
      } else {
        this.map.doubleClickZoom.enable();
      }
    }

    this.setMapContainerLassoState(this.isLassoMode);
  }

  setMapContainerLassoState(isActive) {
    const mapContainer = this.template.querySelector('[data-id="map"]');
    if (!mapContainer) {
      return;
    }

    mapContainer.classList.toggle("lasso-mode-active", Boolean(isActive));
  }

  syncLassoDraftLayers() {
    if (!this.isLassoMode || !this.map || !window.L) {
      this.clearLassoDraftLayers();
      return;
    }

    const draftLatLngs = this.lassoDraftLatLngs;

    if (!draftLatLngs.length) {
      this.clearLassoDraftLayers();
      return;
    }

    const firstPoint = draftLatLngs[0];

    if (!this.lassoStartMarker) {
      this.lassoStartMarker = window.L.circleMarker(firstPoint, {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        opacity: 1,
        fillColor: LASSO_STROKE_COLOR,
        fillOpacity: 1,
        interactive: false
      }).addTo(this.map);
    } else {
      this.lassoStartMarker.setLatLng(firstPoint);
    }

    if (!this.lassoDraftPolyline) {
      this.lassoDraftPolyline = window.L.polyline(draftLatLngs, {
        color: LASSO_STROKE_COLOR,
        weight: 2,
        opacity: 0.95,
        dashArray: "6 6",
        lineCap: "round",
        lineJoin: "round",
        interactive: false
      }).addTo(this.map);
    } else {
      this.lassoDraftPolyline.setLatLngs(draftLatLngs);
    }

    if (draftLatLngs.length >= 3) {
      if (!this.lassoDraftPolygon) {
        this.lassoDraftPolygon = window.L.polygon(draftLatLngs, {
          color: LASSO_STROKE_COLOR,
          weight: 2,
          opacity: 0.9,
          dashArray: "6 6",
          fillColor: LASSO_FILL_COLOR,
          fillOpacity: 0.08,
          interactive: false
        }).addTo(this.map);
      } else {
        this.lassoDraftPolygon.setLatLngs(draftLatLngs);
      }
    } else if (this.lassoDraftPolygon && this.map) {
      this.map.removeLayer(this.lassoDraftPolygon);
      this.lassoDraftPolygon = null;
    }
  }

  clearLassoGuideLayer() {
    if (this.map && this.lassoGuidePolyline) {
      this.map.removeLayer(this.lassoGuidePolyline);
    }

    this.lassoGuidePolyline = null;
  }

  clearLassoDraftLayers() {
    if (this.map && this.lassoDraftPolyline) {
      this.map.removeLayer(this.lassoDraftPolyline);
    }
    if (this.map && this.lassoDraftPolygon) {
      this.map.removeLayer(this.lassoDraftPolygon);
    }
    if (this.map && this.lassoGuidePolyline) {
      this.map.removeLayer(this.lassoGuidePolyline);
    }
    if (this.map && this.lassoStartMarker) {
      this.map.removeLayer(this.lassoStartMarker);
    }

    this.lassoDraftPolyline = null;
    this.lassoDraftPolygon = null;
    this.lassoGuidePolyline = null;
    this.lassoStartMarker = null;
    this.lassoDraftLatLngs = [];
  }

  isNearFirstLassoVertex(candidateLatLng) {
    if (!this.map || !this.lassoDraftLatLngs.length || !candidateLatLng) {
      return false;
    }

    const firstPoint = this.lassoDraftLatLngs[0];
    const firstContainerPoint = this.map.latLngToContainerPoint(firstPoint);
    const candidateContainerPoint = this.map.latLngToContainerPoint(candidateLatLng);

    return firstContainerPoint.distanceTo(candidateContainerPoint) <= LASSO_CLOSE_DISTANCE_PX;
  }

  selectFeaturesWithinLasso(polygonLatLngs) {
    const closedPolygon = this.ensureClosedPolygonLatLngs(polygonLatLngs);
    const selectedByKey = new Map();

    this.getSelectableVisibleFeatures().forEach(({ layer, feature }) => {
      if (!this.doesFeatureIntersectLasso(feature, closedPolygon)) {
        return;
      }

      const snapshot = this.buildSelectedFeatureSnapshot(layer, feature);
      if (!selectedByKey.has(snapshot.key)) {
        selectedByKey.set(snapshot.key, snapshot);
      }
    });

    return Array.from(selectedByKey.values()).sort((left, right) => {
      const typeComparison = (left.typeLabel || "").localeCompare(right.typeLabel || "");
      if (typeComparison !== 0) {
        return typeComparison;
      }

      return (left.name || "").localeCompare(right.name || "");
    });
  }

  reconcileSelectedLassoFeatures() {
    if (!Array.isArray(this.selectedLassoFeatures) || !this.selectedLassoFeatures.length) {
      return;
    }

    const selectedKeys = new Set(this.selectedLassoFeatures.map((feature) => feature.key));
    const nextSelections = [];

    this.getSelectableVisibleFeatures().forEach(({ layer, feature }) => {
      const snapshot = this.buildSelectedFeatureSnapshot(layer, feature);
      if (selectedKeys.has(snapshot.key)) {
        nextSelections.push(snapshot);
      }
    });

    this.selectedLassoFeatures = nextSelections;

    if (!this.selectedLassoFeatures.length) {
      this.isBulkWorkLogModalOpen = false;
      this.clearSelectionHighlightLayers();
    }
  }

  buildSelectedFeatureSnapshot(layer, feature) {
    const objectApiName = this.normalizeString(
      feature?.targetObjectApiName || layer?.objectApiName || ""
    )?.toLowerCase();

    return {
      key: this.buildFeatureSelectionKey(objectApiName, feature?.recordId),
      recordId: feature?.recordId || "",
      objectApiName,
      name: feature?.name || "",
      typeLabel: objectApiName === SITE_OBJECT_API_NAME ? "Site" : "Segment",
      layerName: layer?.mapLayerName || "",
      geometryType: feature?.geometryType || "",
      geometryRaw: feature?.geometryRaw || "",
      latitude: this.toNumber(feature?.latitude),
      longitude: this.toNumber(feature?.longitude),
      canCreateWorkLog: Boolean(feature?.canCreateWorkLog || feature?.productionLineAllocationId),
      productionLineAllocationId: feature?.productionLineAllocationId || ""
    };
  }

  buildFeatureSelectionKey(objectApiName, recordId) {
    return `${this.normalizeString(objectApiName || "") || ""}::${recordId || ""}`;
  }

  doesFeatureIntersectLasso(feature, polygonLatLngs) {
    if (!feature || !Array.isArray(polygonLatLngs) || polygonLatLngs.length < 4) {
      return false;
    }

    if (feature.geometryType === "point") {
      const pointLatLng = [this.toNumber(feature.latitude), this.toNumber(feature.longitude)];
      if (!Number.isFinite(pointLatLng[0]) || !Number.isFinite(pointLatLng[1])) {
        return false;
      }

      return this.isPointInsidePolygon(pointLatLng, polygonLatLngs);
    }

    if (feature.geometryType === "polyline") {
      const coordinateSets = this.extractPolylineCoordinateSets(feature.geometryRaw);
      return coordinateSets.some((coordinateSet) => {
        const latLngs = this.toLatLngs(coordinateSet);
        return this.doesLatLngPolylineIntersectPolygon(latLngs, polygonLatLngs);
      });
    }

    return false;
  }

  ensureClosedPolygonLatLngs(latLngs) {
    if (!Array.isArray(latLngs) || !latLngs.length) {
      return [];
    }

    const firstPoint = latLngs[0];
    const lastPoint = latLngs[latLngs.length - 1];

    if (this.areLatLngsEqual(firstPoint, lastPoint)) {
      return [...latLngs];
    }

    return [...latLngs, firstPoint];
  }

  areLatLngsEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    return (
      Math.abs(Number(left[0]) - Number(right[0])) <= GEOMETRY_EPSILON &&
      Math.abs(Number(left[1]) - Number(right[1])) <= GEOMETRY_EPSILON
    );
  }

  doesLatLngPolylineIntersectPolygon(latLngs, polygonLatLngs) {
    if (!Array.isArray(latLngs) || latLngs.length < 2 || !Array.isArray(polygonLatLngs)) {
      return false;
    }

    if (latLngs.some((pointLatLng) => this.isPointInsidePolygon(pointLatLng, polygonLatLngs))) {
      return true;
    }

    if (polygonLatLngs.some((polygonPoint) => this.isPointOnPolyline(polygonPoint, latLngs))) {
      return true;
    }

    const polygonEdges = this.buildLatLngSegmentPairs(polygonLatLngs);

    for (let index = 0; index < latLngs.length - 1; index += 1) {
      const lineStart = latLngs[index];
      const lineEnd = latLngs[index + 1];

      for (let edgeIndex = 0; edgeIndex < polygonEdges.length; edgeIndex += 1) {
        const polygonEdge = polygonEdges[edgeIndex];
        if (
          this.doLatLngSegmentsIntersect(
            lineStart,
            lineEnd,
            polygonEdge.start,
            polygonEdge.end
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  buildLatLngSegmentPairs(latLngs) {
    const segments = [];

    if (!Array.isArray(latLngs) || latLngs.length < 2) {
      return segments;
    }

    for (let index = 0; index < latLngs.length - 1; index += 1) {
      segments.push({
        start: latLngs[index],
        end: latLngs[index + 1]
      });
    }

    return segments;
  }

  isPointInsidePolygon(pointLatLng, polygonLatLngs) {
    if (
      !Array.isArray(pointLatLng) ||
      !Array.isArray(polygonLatLngs) ||
      polygonLatLngs.length < 4
    ) {
      return false;
    }

    if (this.isPointOnPolyline(pointLatLng, polygonLatLngs)) {
      return true;
    }

    const pointX = Number(pointLatLng[1]);
    const pointY = Number(pointLatLng[0]);

    let isInside = false;

    for (
      let currentIndex = 0, previousIndex = polygonLatLngs.length - 1;
      currentIndex < polygonLatLngs.length;
      previousIndex = currentIndex++
    ) {
      const currentPoint = polygonLatLngs[currentIndex];
      const previousPoint = polygonLatLngs[previousIndex];

      const currentX = Number(currentPoint[1]);
      const currentY = Number(currentPoint[0]);
      const previousX = Number(previousPoint[1]);
      const previousY = Number(previousPoint[0]);

      const doesRayIntersect =
        currentY > pointY !== previousY > pointY &&
        pointX <
          ((previousX - currentX) * (pointY - currentY)) /
            (previousY - currentY || GEOMETRY_EPSILON) +
            currentX;

      if (doesRayIntersect) {
        isInside = !isInside;
      }
    }

    return isInside;
  }

  isPointOnPolyline(pointLatLng, lineLatLngs) {
    if (!Array.isArray(pointLatLng) || !Array.isArray(lineLatLngs) || lineLatLngs.length < 2) {
      return false;
    }

    for (let index = 0; index < lineLatLngs.length - 1; index += 1) {
      if (this.isPointOnLatLngSegment(pointLatLng, lineLatLngs[index], lineLatLngs[index + 1])) {
        return true;
      }
    }

    return false;
  }

  isPointOnLatLngSegment(pointLatLng, segmentStart, segmentEnd) {
    const pointX = Number(pointLatLng[1]);
    const pointY = Number(pointLatLng[0]);
    const startX = Number(segmentStart[1]);
    const startY = Number(segmentStart[0]);
    const endX = Number(segmentEnd[1]);
    const endY = Number(segmentEnd[0]);

    const crossProduct =
      (pointY - startY) * (endX - startX) - (pointX - startX) * (endY - startY);

    if (Math.abs(crossProduct) > GEOMETRY_EPSILON) {
      return false;
    }

    const dotProduct =
      (pointX - startX) * (endX - startX) + (pointY - startY) * (endY - startY);

    if (dotProduct < -GEOMETRY_EPSILON) {
      return false;
    }

    const segmentLengthSquared = (endX - startX) ** 2 + (endY - startY) ** 2;

    return dotProduct - segmentLengthSquared <= GEOMETRY_EPSILON;
  }

  doLatLngSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
    const firstOrientation = this.getLatLngOrientation(firstStart, firstEnd, secondStart);
    const secondOrientation = this.getLatLngOrientation(firstStart, firstEnd, secondEnd);
    const thirdOrientation = this.getLatLngOrientation(secondStart, secondEnd, firstStart);
    const fourthOrientation = this.getLatLngOrientation(secondStart, secondEnd, firstEnd);

    if (firstOrientation !== secondOrientation && thirdOrientation !== fourthOrientation) {
      return true;
    }

    if (
      firstOrientation === 0 &&
      this.isPointOnLatLngSegment(secondStart, firstStart, firstEnd)
    ) {
      return true;
    }
    if (
      secondOrientation === 0 &&
      this.isPointOnLatLngSegment(secondEnd, firstStart, firstEnd)
    ) {
      return true;
    }
    if (
      thirdOrientation === 0 &&
      this.isPointOnLatLngSegment(firstStart, secondStart, secondEnd)
    ) {
      return true;
    }
    if (
      fourthOrientation === 0 &&
      this.isPointOnLatLngSegment(firstEnd, secondStart, secondEnd)
    ) {
      return true;
    }

    return false;
  }

  getLatLngOrientation(startPoint, middlePoint, endPoint) {
    const startX = Number(startPoint[1]);
    const startY = Number(startPoint[0]);
    const middleX = Number(middlePoint[1]);
    const middleY = Number(middlePoint[0]);
    const endX = Number(endPoint[1]);
    const endY = Number(endPoint[0]);

    const orientationValue =
      (middleY - startY) * (endX - middleX) - (middleX - startX) * (endY - middleY);

    if (Math.abs(orientationValue) <= GEOMETRY_EPSILON) {
      return 0;
    }

    return orientationValue > 0 ? 1 : 2;
  }

  async handleToggleMapExpanded() {
    await this.setMapExpanded(!this.isMapExpanded);
  }

  async handleCloseMapExpanded() {
    await this.setMapExpanded(false);
  }

  async setMapExpanded(nextExpandedState) {
    if (this.isMapExpanded === nextExpandedState) {
      return;
    }

    const viewState = this.captureMapViewState();

    this.closeAllFilterMenus();
    this.cancelLassoMode();
    this.clearPendingViewportSync();
    this.destroyMap();
    this.isMapExpanded = nextExpandedState;

    await this.waitForLayoutStabilization();
    await this.waitForMapContainerReady();

    this.initializeMap();

    if (this.mapReady) {
      await this.waitForLayoutStabilization();
      this.renderVisibleFeatures({ fitToBounds: !viewState });

      if (viewState) {
        this.scheduleMapViewportSync({
          preserveView: true,
          viewState
        });
      }
    }
  }

  async openRecordInNewTab(recordId, objectApiName) {
    const url = await this.generateRecordUrl(recordId, objectApiName);
    if (!url || typeof window === "undefined") {
      return;
    }

    window.open(url, "_blank", "noopener");
  }

  async generateRecordUrl(recordId, objectApiName) {
    if (!recordId) {
      return "";
    }

    try {
      return await this[NavigationMixin.GenerateUrl]({
        type: "standard__recordPage",
        attributes: {
          recordId,
          objectApiName,
          actionName: "view"
        }
      });
    } catch (error) {
      return this.buildFallbackRecordUrl(recordId, objectApiName);
    }
  }

  async waitForMapContainerReady(maxAttempts = 16) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const mapContainer = this.template.querySelector('[data-id="map"]');
      if (mapContainer) {
        return;
      }

      await this.waitForNextFrame();
    }
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

  normalizeString(value) {
    return typeof value === "string" ? value.trim() : value;
  }

  toNumber(value) {
    if (value === null || value === undefined || value === "") {
      return NaN;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : NaN;
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  dispatchToast(title, message, variant) {
    this.dispatchEvent(
      new ShowToastEvent({
        title,
        message,
        variant
      })
    );
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
