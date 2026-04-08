import { api, LightningElement } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { NavigationMixin } from "lightning/navigation";
import getProjectMapData from "@salesforce/apex/ProjectRecordMapController.getProjectMapData";
import { loadScript, loadStyle } from "lightning/platformResourceLoader";

import leafletResource from "@salesforce/resourceUrl/leaflet_1_9_4";

const ALL_FILTER_VALUE = "__ALL__";
const DEFAULT_MAP_CENTER = [39.8283, -98.5795];
const DEFAULT_MAP_ZOOM = 4;
const DEFAULT_POINT_COLOR = "#2f80ed";
const DEFAULT_LINE_COLOR = "#0b8f86";
const DEFAULT_POLYGON_COLOR = "#5779c1";

const OPENSTREETMAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OPENSTREETMAP_TILE_ATTRIBUTION = "&copy; OpenStreetMap contributors";

const BASEMAP_PROVIDERS = [
  {
    key: "esri-services",
    label: "Esri World Imagery",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    host: "https://services.arcgisonline.com",
    isSatellite: true
  },
  {
    key: "esri-server",
    label: "Esri World Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    host: "https://server.arcgisonline.com",
    isSatellite: true
  },
  {
    key: "osm-fallback",
    label: "OpenStreetMap",
    url: OPENSTREETMAP_TILE_URL,
    attribution: OPENSTREETMAP_TILE_ATTRIBUTION,
    host: "https://tile.openstreetmap.org",
    isSatellite: false
  }
];

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
  @api layerFilterFieldSetApiName;

  // Legacy inputs retained for backward compatibility.
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

  allLayers = [];

  popupActionListenerRegistered = false;
  boundTemplateClickHandler = null;
  isMapExpanded = false;

  boundLeafletMapClickHandler = null;
  boundLeafletMapDoubleClickHandler = null;
  boundLeafletMapMouseMoveHandler = null;

  basemapProviderIndex = 0;
  basemapTileErrorCount = 0;
  basemapHasLoaded = false;
  basemapFallbackTriggered = false;

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

  get uiLayers() {
    return this.allLayers.filter((layer) => layer.isSelected);
  }

  get availableLayersToAdd() {
    return this.allLayers.filter((layer) => !layer.isSelected);
  }

  get hasLegacyConfiguredLayerInputs() {
    return this.buildLegacyConfiguredLayerInputs().length > 0;
  }

  get hasConfiguredLayers() {
    return this.allLayers.length > 0;
  }

  get hasLayerPanels() {
    return this.allLayers.length > 0;
  }

  get hasSelectedLayers() {
    return this.uiLayers.length > 0;
  }

  get hasAvailableLayersToAdd() {
    return this.availableLayersToAdd.length > 0;
  }

  get selectedLayerCount() {
    return this.uiLayers.length;
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
    return this.isLassoMode ? "Cancel lasso selection" : "Lasso select Sites and Segments";
  }

  get lassoButtonIcon() {
    return this.isLassoMode ? "×" : "◌";
  }

  get isLassoButtonDisabled() {
    return !this.mapReady || this.isLoading || !this.hasSelectedLayers;
  }

  get showInlineMapPanel() {
    return !this.isMapExpanded;
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

  get showNoSelectedLayers() {
    return !this.isLoading && !this.errorMessage && this.hasConfiguredLayers && !this.hasSelectedLayers;
  }

  get totalRenderedFeatureCount() {
    return this.uiLayers.reduce((sum, layer) => sum + (layer.visibleFeatureCount || 0), 0);
  }

  get showNoVisibleFeatures() {
    return (
      !this.isLoading &&
      !this.errorMessage &&
      this.hasConfiguredLayers &&
      this.hasSelectedLayers &&
      this.totalRenderedFeatureCount === 0
    );
  }

  get mapSummaryText() {
    if (!this.hasConfiguredLayers) {
      return "";
    }

    return `${this.totalRenderedFeatureCount} visible feature${
      this.totalRenderedFeatureCount === 1 ? "" : "s"
    } across ${this.selectedLayerCount} selected layer${
      this.selectedLayerCount === 1 ? "" : "s"
    }`;
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

    this.initializeBasemapLayer();
    this.registerLeafletMapListeners();
    this.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    this.mapReady = true;
    this.syncLassoInteractionState();
    this.scheduleMapViewportSync({ fitToBounds: false });
  }

  initializeBasemapLayer() {
    this.basemapProviderIndex = 0;
    this.basemapTileErrorCount = 0;
    this.basemapHasLoaded = false;
    this.basemapFallbackTriggered = false;
    this.replaceBasemapLayer();
  }

  replaceBasemapLayer() {
    if (!window.L || !this.map) {
      return;
    }

    const basemap = BASEMAP_PROVIDERS[this.basemapProviderIndex];
    if (!basemap) {
      return;
    }

    if (this.tileLayer) {
      try {
        this.tileLayer.off();
        this.map.removeLayer(this.tileLayer);
      } catch (error) {
        // swallow cleanup errors
      }
    }

    this.basemapTileErrorCount = 0;
    this.basemapHasLoaded = false;
    this.tileLayer = window.L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: 22
    });

    this.tileLayer.on("tileerror", () => {
      this.handleBasemapTileError();
    });

    this.tileLayer.on("load", () => {
      this.basemapHasLoaded = true;
      if (basemap.isSatellite) {
        this.tileWarningMessage = "";
      } else {
        this.tileWarningMessage =
          "Satellite tiles were unavailable, so the map fell back to standard map tiles.";
      }
    });

    this.tileLayer.addTo(this.map);
  }

  handleBasemapTileError() {
    this.basemapTileErrorCount += 1;

    if (this.basemapHasLoaded || this.basemapFallbackTriggered) {
      return;
    }

    if (this.basemapTileErrorCount < 2) {
      return;
    }

    const nextIndex = this.basemapProviderIndex + 1;
    if (nextIndex >= BASEMAP_PROVIDERS.length) {
      const currentBasemap = BASEMAP_PROVIDERS[this.basemapProviderIndex];
      this.tileWarningMessage = `Map tiles failed to load. Confirm CSP Trusted Site access for ${currentBasemap.host}.`;
      return;
    }

    this.basemapFallbackTriggered = true;
    this.basemapProviderIndex = nextIndex;
    const nextBasemap = BASEMAP_PROVIDERS[nextIndex];
    this.tileWarningMessage = nextBasemap.isSatellite
      ? `Trying an alternate satellite tile source. Confirm CSP Trusted Site access for ${nextBasemap.host} if tiles still do not load.`
      : "Satellite tiles were unavailable, so the map fell back to standard map tiles.";
    this.replaceBasemapLayer();
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
      layerFilterFieldSetApiName: this.normalizeString(this.layerFilterFieldSetApiName),

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

  buildLegacyConfiguredLayerInputs() {
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

    const shouldPreserveExistingView = this.initialLoadComplete;
    const viewState = shouldPreserveExistingView ? this.captureMapViewState() : null;

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    this.isLoading = true;
    this.errorMessage = "";
    this.closeAllFilterMenus();

    try {
      const response = await getProjectMapData({
        request: this.buildRequestPayload()
      });

      await this.applyResponse(response);
      await this.waitForLayoutStabilization();

      if (viewState) {
        this.renderVisibleFeatures({
          preserveView: true,
          viewState
        });
      } else {
        this.renderVisibleFeatures({
          fitToBounds: true,
          fallbackToDefault: true
        });
      }

      await this.waitForLayoutStabilization();
      this.markInitialLoadComplete();
    } catch (error) {
      this.errorMessage = this.reduceError(error);
      this.allLayers = [];
      this.clearRenderedFeatures();
      this.clearSelectedFeatures();

      if (viewState) {
        this.scheduleMapViewportSync({
          preserveView: true,
          viewState
        });
      } else {
        this.resetMapView();
        this.scheduleMapViewportSync({ fitToBounds: false });
      }

      this.markInitialLoadComplete();
    } finally {
      this.isLoading = false;
    }
  }

  async applyResponse(response) {
    const previousStateByLayerId = {};

    this.allLayers.forEach((layer) => {
      previousStateByLayerId[layer.mapLayerId] = {
        isSelected: Boolean(layer.isSelected),
        isFilterPanelOpen: Boolean(layer.isFilterPanelOpen),
        filterSelectionsByFieldPath: this.buildLayerFilterSelectionMap(layer)
      };
    });

    const responseLayers = Array.isArray(response?.layers) ? response.layers : [];
    const selectAllByDefault = this.hasLegacyConfiguredLayerInputs;

    this.allLayers = responseLayers.map((incomingLayer) => {
      let normalizedLayer = this.normalizeLayerResponse(incomingLayer);
      const previousState = previousStateByLayerId[normalizedLayer.mapLayerId];

      if (previousState) {
        normalizedLayer = this.applyPreviousLayerState(normalizedLayer, previousState);
      } else {
        normalizedLayer = this.hydrateLayerState({
          ...normalizedLayer,
          isSelected: selectAllByDefault ? true : Boolean(normalizedLayer.isDefaultSelected),
          isFilterPanelOpen: false
        });
      }

      return normalizedLayer;
    });

    this.reconcileSelectedLassoFeatures();
  }

  normalizeLayerResponse(layer) {
    const safeFeatures = Array.isArray(layer?.features) ? layer.features : [];
    const safeWarnings = Array.isArray(layer?.warnings) ? layer.warnings : [];
    const safePopupFields = Array.isArray(layer?.popupFields) ? layer.popupFields : [];
    const safeFilterFields = Array.isArray(layer?.filterFields) ? layer.filterFields : [];
    const safeStyleValueOptions = Array.isArray(layer?.styleValueOptions)
      ? layer.styleValueOptions
      : [];

    const normalizedStyleConfig = this.normalizeStyleConfig(layer?.styleConfig);
    const normalizedFilterFields = safeFilterFields.map((filterField) =>
      this.normalizeFilterField(filterField)
    );

    return this.hydrateLayerState({
      slotNumber: Number(layer?.slotNumber) || 0,
      mapLayerId: layer?.mapLayerId || "",
      mapLayerName: layer?.mapLayerName || `Layer ${layer?.slotNumber || ""}`.trim(),
      layerType: layer?.layerType || "",
      layerStatus: layer?.layerStatus || "",
      isDefaultSelected: Boolean(layer?.isDefaultSelected),
      objectApiName: layer?.objectApiName || "",
      geometryType: layer?.geometryType || "",
      relationshipFieldPath: layer?.relationshipFieldPath || "",
      relationshipFieldSource: layer?.relationshipFieldSource || "",
      filterFieldPath: layer?.filterFieldPath || "",
      filterFieldLabel: layer?.filterFieldLabel || "",
      filterFieldSource: layer?.filterFieldSource || "",
      filterOptions: Array.isArray(layer?.filterOptions) ? layer.filterOptions : [],
      filterFields: normalizedFilterFields,
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
      isSelected: false,
      isFilterPanelOpen: false,
      visibleFeatureCount: 0
    });
  }

  normalizeFilterField(filterField) {
    const rawOptions = Array.isArray(filterField?.options) ? filterField.options : [];
    const options = rawOptions
      .map((option) => this.normalizeString(option))
      .filter((option) => Boolean(option))
      .map((option) => ({
        label: option,
        value: option,
        checked: false
      }));

    return this.hydrateFilterFieldState({
      fieldPath: filterField?.fieldPath || "",
      fieldLabel: filterField?.fieldLabel || "",
      dataType: filterField?.dataType || "",
      options,
      selectedValues: []
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
      filterValues: this.normalizeFeatureFilterValues(layer, feature),
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

  normalizeFeatureFilterValues(layer, feature) {
    const incomingFilterValues = Array.isArray(feature?.filterValues) ? feature.filterValues : [];

    if (incomingFilterValues.length) {
      return incomingFilterValues
        .map((item) => ({
          fieldPath: item?.fieldPath || "",
          value: item?.value || ""
        }))
        .filter((item) => item.fieldPath && item.value);
    }

    if (feature?.filterValue && layer?.filterFieldPath) {
      return [
        {
          fieldPath: layer.filterFieldPath,
          value: feature.filterValue
        }
      ];
    }

    return [];
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

  hydrateFilterFieldState(filterField) {
    const selectedValues = Array.isArray(filterField?.selectedValues)
      ? filterField.selectedValues.filter((value) => Boolean(value))
      : [];
    const selectedValueSet = new Set(selectedValues);

    const options = Array.isArray(filterField?.options)
      ? filterField.options.map((option) => ({
          label: option?.label || option?.value || "",
          value: option?.value || option?.label || "",
          checked: selectedValueSet.has(option?.value || option?.label || "")
        }))
      : [];

    return {
      ...filterField,
      options,
      selectedValues,
      selectedCount: selectedValues.length,
      hasOptions: options.length > 0,
      hasSelectedValues: selectedValues.length > 0,
      selectedSummaryText: this.buildSelectedValuesText(selectedValues)
    };
  }

  hydrateLayerState(layer) {
    const nextFilterFields = Array.isArray(layer?.filterFields)
      ? layer.filterFields.map((filterField) => this.hydrateFilterFieldState(filterField))
      : [];

    const nextLayer = {
      ...layer,
      filterFields: nextFilterFields,
      hasError: Boolean(layer?.errorMessage),
      hasWarnings: Array.isArray(layer?.warnings) && layer.warnings.length > 0,
      hasFilterControl: nextFilterFields.some((filterField) => filterField.hasOptions)
    };

    const activeFilterCount = this.getAppliedFilterCount(nextLayer);
    const visibleFeatureCount = this.getFilteredFeatures(nextLayer).length;

    return {
      ...nextLayer,
      activeFilterCount,
      filterSummaryText: this.buildLayerFilterSummaryText(nextLayer, activeFilterCount),
      selectionButtonLabel: nextLayer.isSelected ? "Remove" : "Add",
      selectionButtonTitle: nextLayer.isSelected
        ? "Remove layer from pane"
        : "Add layer to pane",
      visibleFeatureCount
    };
  }

  applyPreviousLayerState(layer, previousState) {
    const filterSelectionsByFieldPath = previousState?.filterSelectionsByFieldPath || {};
    const nextFilterFields = layer.filterFields.map((filterField) => {
      const availableValues = new Set(filterField.options.map((option) => option.value));
      const priorSelectedValues = Array.isArray(filterSelectionsByFieldPath[filterField.fieldPath])
        ? filterSelectionsByFieldPath[filterField.fieldPath]
        : [];

      const validSelectedValues = priorSelectedValues.filter((value) => availableValues.has(value));

      return {
        ...filterField,
        selectedValues: validSelectedValues
      };
    });

    return this.hydrateLayerState({
      ...layer,
      isSelected: Boolean(previousState?.isSelected),
      isFilterPanelOpen: Boolean(previousState?.isFilterPanelOpen),
      filterFields: nextFilterFields
    });
  }

  buildLayerFilterSelectionMap(layer) {
    const selections = {};

    if (!Array.isArray(layer?.filterFields)) {
      return selections;
    }

    layer.filterFields.forEach((filterField) => {
      selections[filterField.fieldPath] = Array.isArray(filterField.selectedValues)
        ? [...filterField.selectedValues]
        : [];
    });

    return selections;
  }

  buildSelectedValuesText(values) {
    if (!Array.isArray(values) || !values.length) {
      return "All";
    }

    if (values.length <= 2) {
      return values.join(", ");
    }

    return `${values[0]}, ${values[1]} +${values.length - 2}`;
  }

  buildLayerFilterSummaryText(layer, activeFilterCount = null) {
    const appliedCount =
      activeFilterCount === null ? this.getAppliedFilterCount(layer) : activeFilterCount;

    if (!layer?.hasFilterControl) {
      return "";
    }

    if (!appliedCount) {
      return "All";
    }

    return `${appliedCount} selected`;
  }

  getAppliedFilterCount(layer) {
    if (!Array.isArray(layer?.filterFields)) {
      return 0;
    }

    return layer.filterFields.reduce(
      (sum, filterField) => sum + (filterField.selectedCount || 0),
      0
    );
  }

  getFilteredFeatures(layer) {
    if (!layer?.isSelected) {
      return [];
    }

    const filterFields = Array.isArray(layer?.filterFields) ? layer.filterFields : [];
    const appliedFilterFields = filterFields.filter(
      (filterField) => Array.isArray(filterField.selectedValues) && filterField.selectedValues.length
    );

    if (!appliedFilterFields.length) {
      return Array.isArray(layer?.features) ? layer.features : [];
    }

    return (Array.isArray(layer?.features) ? layer.features : []).filter((feature) =>
      appliedFilterFields.every((filterField) =>
        this.doesFeatureMatchFilterField(feature, filterField)
      )
    );
  }

  doesFeatureMatchFilterField(feature, filterField) {
    const selectedValues = Array.isArray(filterField?.selectedValues)
      ? filterField.selectedValues
      : [];

    if (!selectedValues.length) {
      return true;
    }

    const featureValues = (Array.isArray(feature?.filterValues) ? feature.filterValues : [])
      .filter((item) => item?.fieldPath === filterField.fieldPath)
      .map((item) => item?.value)
      .filter((value) => Boolean(value));

    if (!featureValues.length) {
      return false;
    }

    return selectedValues.some((selectedValue) => featureValues.includes(selectedValue));
  }

  getSelectableVisibleFeatures() {
    const visibleSelectableFeatures = [];

    this.uiLayers.forEach((layer) => {
      if (!layer || layer.hasError || !layer.isSelected) {
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

  closeAllFilterMenus({ exceptLayerId = null } = {}) {
    this.allLayers = this.allLayers.map((layer) =>
      this.hydrateLayerState({
        ...layer,
        isFilterPanelOpen:
          exceptLayerId && layer.mapLayerId === exceptLayerId ? layer.isFilterPanelOpen : false
      })
    );
  }

  clearRenderedFeatures() {
    if (this.map && this.renderedFeatureGroup) {
      this.map.removeLayer(this.renderedFeatureGroup);
    }

    this.renderedFeatureGroup = null;
  }

  renderVisibleFeatures({
    fitToBounds = false,
    fallbackToDefault = false,
    preserveView = false,
    viewState = null
  } = {}) {
    if (!this.mapReady || !window.L) {
      return;
    }

    this.clearRenderedFeatures();

    const featureGroup = window.L.featureGroup();
    let hasAnyRenderedFeature = false;

    this.allLayers = this.allLayers.map((layer) => {
      const visibleFeatures = this.getFilteredFeatures(layer);
      const updatedLayer = this.hydrateLayerState({
        ...layer,
        visibleFeatureCount: visibleFeatures.length
      });

      if (!updatedLayer.hasError && updatedLayer.isSelected) {
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
      fallbackToDefault: !hasAnyRenderedFeature && fallbackToDefault,
      preserveView,
      viewState
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

  resolveLayerIdFromEvent(event) {
    const detailLayerId = event?.detail?.layerId || event?.detail?.mapLayerId;
    if (detailLayerId) {
      return detailLayerId;
    }

    const directLayerId =
      event?.currentTarget?.dataset?.layerId ||
      event?.target?.dataset?.layerId ||
      event?.currentTarget?.dataset?.mapLayerId ||
      event?.target?.dataset?.mapLayerId;

    if (directLayerId) {
      return directLayerId;
    }

    const rawSlot =
      event?.currentTarget?.dataset?.slot || event?.target?.dataset?.slot || null;
    const slotNumber = Number(rawSlot);

    if (!Number.isFinite(slotNumber)) {
      return null;
    }

    return this.allLayers.find((layer) => layer.slotNumber === slotNumber)?.mapLayerId || null;
  }

  resolveFilterChangeFromEvent(event) {
    const detailChecked = event?.detail?.checked;

    return {
      layerId: this.resolveLayerIdFromEvent(event),
      fieldPath:
        event?.detail?.fieldPath ||
        event?.target?.dataset?.fieldPath ||
        event?.currentTarget?.dataset?.fieldPath,
      optionValue:
        event?.detail?.value ||
        event?.detail?.optionValue ||
        event?.target?.dataset?.value ||
        event?.currentTarget?.dataset?.value,
      isChecked:
        typeof detailChecked === "boolean" ? detailChecked : Boolean(event?.target?.checked)
    };
  }

  setLayerSelected(layerId, isSelected) {
    if (!layerId) {
      return;
    }

    const viewState = this.captureMapViewState();

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    this.allLayers = this.allLayers.map((layer) => {
      if (layer.mapLayerId !== layerId) {
        return layer;
      }

      return this.hydrateLayerState({
        ...layer,
        isSelected,
        isFilterPanelOpen: isSelected ? layer.isFilterPanelOpen : false
      });
    });

    this.renderVisibleFeatures({
      preserveView: true,
      viewState
    });
  }

  handleAddLayerToPane(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    if (!layerId) {
      return;
    }

    this.setLayerSelected(layerId, true);
  }

  handleRemoveLayerFromPane(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    if (!layerId) {
      return;
    }

    this.setLayerSelected(layerId, false);
  }

  handleLayerSelectionToggle(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    const targetLayer = this.allLayers.find((layer) => layer.mapLayerId === layerId);

    if (!targetLayer) {
      return;
    }

    this.setLayerSelected(layerId, !targetLayer.isSelected);
  }

  handleLayerVisibilityChange(event) {
    this.handleLayerSelectionToggle(event);
  }

  handleLayerVisibilityToggle(event) {
    this.handleLayerSelectionToggle(event);
  }

  handleToggleFilterPanel(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    if (!layerId) {
      return;
    }

    this.allLayers = this.allLayers.map((layer) => {
      const shouldOpen = layer.mapLayerId === layerId ? !layer.isFilterPanelOpen : false;
      return this.hydrateLayerState({
        ...layer,
        isFilterPanelOpen: shouldOpen
      });
    });
  }

  handleToggleFilterMenu(event) {
    this.handleToggleFilterPanel(event);
  }

  handleFilterSearchInput() {
    // no-op retained for backward compatibility
  }

  handleLayerFilterOptionChange(event) {
    const { layerId, fieldPath, optionValue, isChecked } = this.resolveFilterChangeFromEvent(event);

    if (!layerId || !fieldPath || !optionValue) {
      return;
    }

    const viewState = this.captureMapViewState();

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    this.allLayers = this.allLayers.map((layer) => {
      if (layer.mapLayerId !== layerId) {
        return this.hydrateLayerState({
          ...layer,
          isFilterPanelOpen: false
        });
      }

      const nextFilterFields = layer.filterFields.map((filterField) => {
        if (filterField.fieldPath !== fieldPath) {
          return filterField;
        }

        let nextSelectedValues = Array.isArray(filterField.selectedValues)
          ? [...filterField.selectedValues]
          : [];

        if (isChecked) {
          if (!nextSelectedValues.includes(optionValue)) {
            nextSelectedValues.push(optionValue);
          }
        } else {
          nextSelectedValues = nextSelectedValues.filter((value) => value !== optionValue);
        }

        return {
          ...filterField,
          selectedValues: nextSelectedValues
        };
      });

      return this.hydrateLayerState({
        ...layer,
        filterFields: nextFilterFields,
        isFilterPanelOpen: true
      });
    });

    this.renderVisibleFeatures({
      preserveView: true,
      viewState
    });
  }

  handleClearLayerFilters(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    if (!layerId) {
      return;
    }

    const viewState = this.captureMapViewState();

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    this.allLayers = this.allLayers.map((layer) => {
      if (layer.mapLayerId !== layerId) {
        return layer;
      }

      const nextFilterFields = layer.filterFields.map((filterField) => ({
        ...filterField,
        selectedValues: []
      }));

      return this.hydrateLayerState({
        ...layer,
        filterFields: nextFilterFields,
        isFilterPanelOpen: true
      });
    });

    this.renderVisibleFeatures({
      preserveView: true,
      viewState
    });
  }

  handleFilterOptionSelect(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    const selectedFilterValue = event.currentTarget?.dataset?.value;

    if (!layerId) {
      return;
    }

    const viewState = this.captureMapViewState();

    this.cancelLassoMode({
      clearSelection: true,
      closeBulkModal: true
    });

    this.allLayers = this.allLayers.map((layer) => {
      if (layer.mapLayerId !== layerId) {
        return this.hydrateLayerState({
          ...layer,
          isFilterPanelOpen: false
        });
      }

      const nextFilterFields = layer.filterFields.map((filterField, index) => {
        if (index !== 0) {
          return filterField;
        }

        return {
          ...filterField,
          selectedValues:
            selectedFilterValue && selectedFilterValue !== ALL_FILTER_VALUE
              ? [selectedFilterValue]
              : []
        };
      });

      return this.hydrateLayerState({
        ...layer,
        filterFields: nextFilterFields,
        isFilterPanelOpen: false
      });
    });

    this.renderVisibleFeatures({
      preserveView: true,
      viewState
    });
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
          this.doLatLngSegmentsIntersect(lineStart, lineEnd, polygonEdge.start, polygonEdge.end)
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
    if (!Array.isArray(pointLatLng) || !Array.isArray(polygonLatLngs) || polygonLatLngs.length < 4) {
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

  parseGeometryValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value === "string") {
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

    if (typeof value === "object") {
      return value;
    }

    return null;
  }

  normalizePointLike(point) {
    if (Array.isArray(point) && point.length >= 2) {
      const longitude = this.toNumber(point[0]);
      const latitude = this.toNumber(point[1]);

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }

      return [longitude, latitude];
    }

    if (point && typeof point === "object") {
      const longitude = this.toNumber(
        point.longitude ??
          point.lng ??
          point.lon ??
          point.x ??
          point?.location?.longitude ??
          point?.location?.lng
      );
      const latitude = this.toNumber(
        point.latitude ??
          point.lat ??
          point.y ??
          point?.location?.latitude ??
          point?.location?.lat
      );

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }

      return [longitude, latitude];
    }

    return null;
  }

  normalizeCoordinateSet(candidate) {
    if (!Array.isArray(candidate)) {
      return [];
    }

    return candidate
      .map((point) => this.normalizePointLike(point))
      .filter((point) => Array.isArray(point));
  }

  normalizeNestedCoordinateSets(candidate) {
    if (!Array.isArray(candidate)) {
      return [];
    }

    if (candidate.length && this.normalizePointLike(candidate[0])) {
      const normalizedSet = this.normalizeCoordinateSet(candidate);
      return normalizedSet.length >= 2 ? [normalizedSet] : [];
    }

    return candidate
      .map((item) => this.normalizeCoordinateSet(item))
      .filter((set) => Array.isArray(set) && set.length >= 2);
  }

  extractPolylineCoordinateSets(geometryRaw) {
    const parsed = this.parseGeometryValue(geometryRaw);
    if (!parsed) {
      return [];
    }

    if (Array.isArray(parsed?.snappedPoints)) {
      const snappedCoordinates = parsed.snappedPoints
        .map((point) => this.normalizePointLike(point))
        .filter((point) => Array.isArray(point));

      return snappedCoordinates.length >= 2 ? [snappedCoordinates] : [];
    }

    if (parsed?.type === "Feature" && parsed.geometry) {
      return this.extractPolylineCoordinateSets(parsed.geometry);
    }

    if (parsed?.geometry) {
      const geometryResult = this.extractPolylineCoordinateSets(parsed.geometry);
      if (geometryResult.length) {
        return geometryResult;
      }
    }

    if (parsed?.type === "LineString" && Array.isArray(parsed.coordinates)) {
      return this.normalizeNestedCoordinateSets([parsed.coordinates]);
    }

    if (parsed?.type === "MultiLineString" && Array.isArray(parsed.coordinates)) {
      return this.normalizeNestedCoordinateSets(parsed.coordinates);
    }

    if (Array.isArray(parsed?.paths)) {
      return this.normalizeNestedCoordinateSets(parsed.paths);
    }

    if (Array.isArray(parsed?.path)) {
      return this.normalizeNestedCoordinateSets([parsed.path]);
    }

    if (Array.isArray(parsed?.coordinates)) {
      const directCoordinates = this.normalizeNestedCoordinateSets(parsed.coordinates);
      if (directCoordinates.length) {
        return directCoordinates;
      }

      return this.normalizeNestedCoordinateSets([parsed.coordinates]);
    }

    if (Array.isArray(parsed)) {
      const normalizedDirect = this.normalizeNestedCoordinateSets(parsed);
      if (normalizedDirect.length) {
        return normalizedDirect;
      }

      const singleSet = this.normalizeCoordinateSet(parsed);
      return singleSet.length >= 2 ? [singleSet] : [];
    }

    return [];
  }

  extractPolygonCoordinateSets(geometryRaw) {
    const parsed = this.parseGeometryValue(geometryRaw);
    if (!parsed) {
      return [];
    }

    if (parsed?.type === "Feature" && parsed.geometry) {
      return this.extractPolygonCoordinateSets(parsed.geometry);
    }

    if (parsed?.geometry) {
      const geometryResult = this.extractPolygonCoordinateSets(parsed.geometry);
      if (geometryResult.length) {
        return geometryResult;
      }
    }

    if (parsed?.type === "Polygon" && Array.isArray(parsed.coordinates)) {
      return [
        parsed.coordinates
          .map((ring) => this.normalizeCoordinateSet(ring))
          .filter((ring) => ring.length >= 3)
      ].filter((polygon) => polygon.length);
    }

    if (parsed?.type === "MultiPolygon" && Array.isArray(parsed.coordinates)) {
      return parsed.coordinates
        .map((polygon) =>
          polygon
            .map((ring) => this.normalizeCoordinateSet(ring))
            .filter((ring) => ring.length >= 3)
        )
        .filter((polygon) => polygon.length);
    }

    if (Array.isArray(parsed?.rings)) {
      const rings = parsed.rings
        .map((ring) => this.normalizeCoordinateSet(ring))
        .filter((ring) => ring.length >= 3);

      return rings.length ? [rings] : [];
    }

    if (Array.isArray(parsed)) {
      if (parsed.length && Array.isArray(parsed[0]) && Array.isArray(parsed[0][0])) {
        const polygon = parsed
          .map((ring) => this.normalizeCoordinateSet(ring))
          .filter((ring) => ring.length >= 3);

        return polygon.length ? [polygon] : [];
      }
    }

    return [];
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

  isEventFromLayerPanel(event) {
    const isLayerPanelNode = (node) =>
      node?.tagName === "C-PROJECT-RECORD-MAP-LAYER-PANEL" ||
      node?.localName === "c-project-record-map-layer-panel";

    if (isLayerPanelNode(event?.target)) {
      return true;
    }

    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    return path.some((node) => isLayerPanelNode(node));
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
    if (actionButton) {
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
      return;
    }

    if (this.isEventFromLayerPanel(event)) {
      return;
    }

    const clickedInsideFilterUi = Boolean(
      event.target?.closest?.('[data-filter-panel="true"]') ||
        event.target?.closest?.('[data-filter-trigger="true"]')
    );

    if (!clickedInsideFilterUi) {
      this.closeAllFilterMenus();
    }
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

      if (viewState) {
        this.renderVisibleFeatures({
          preserveView: true,
          viewState
        });
      } else {
        this.renderVisibleFeatures({
          fitToBounds: true,
          fallbackToDefault: true
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
