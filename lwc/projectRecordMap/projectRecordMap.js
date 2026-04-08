import { api, LightningElement } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { NavigationMixin } from "lightning/navigation";
import getProjectMapData from "@salesforce/apex/ProjectRecordMapController.getProjectMapData";
import { loadScript, loadStyle } from "lightning/platformResourceLoader";

import leafletResource from "@salesforce/resourceUrl/leaflet_1_9_4";

import {
  buildLayerStateSnapshot,
  normalizeLayerResponse,
  applyPreviousLayerState,
  hydrateLayerState,
  getFilteredFeatures,
  getSelectableVisibleFeatures
} from "c/projectRecordMapLayerStateUtils";
import {
  BASEMAP_MODE_SATELLITE,
  createInitialBasemapState,
  buildBasemapModeSwitchState,
  buildBasemapLoadedState,
  buildBasemapTileErrorResult,
  getBasemapProvider,
  buildTileLayerOptions,
  getNextBasemapMode,
  getBasemapToggleTitle,
  getActiveBasemapLabel
} from "c/projectRecordMapBasemapUtils";
import {
  ensureClosedPolygonLatLngs,
  doesFeatureIntersectLasso
} from "c/projectRecordMapGeometryUtils";
import {
  createLeafletLayer,
  createSelectionHighlightLayer
} from "c/projectRecordMapLeafletUtils";

const DEFAULT_MAP_CENTER = [39.8283, -98.5795];
const DEFAULT_MAP_ZOOM = 4;

const SITE_OBJECT_API_NAME = "sitetracker__site__c";
const SEGMENT_OBJECT_API_NAME = "sitetracker__segment__c";

const LASSO_CLOSE_DISTANCE_PX = 18;
const LASSO_STROKE_COLOR = "#0176d3";
const LASSO_FILL_COLOR = "#0176d3";

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
  zoomControl = null;
  basemapToggleControl = null;
  basemapToggleButtonElement = null;
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

  basemapState = createInitialBasemapState(BASEMAP_MODE_SATELLITE);

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

  get visibleUiLayers() {
    return this.uiLayers.filter((layer) => layer.isVisibleOnMap);
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

  get hasVisibleSelectedLayers() {
    return this.visibleUiLayers.length > 0;
  }

  get hasAvailableLayersToAdd() {
    return this.availableLayersToAdd.length > 0;
  }

  get selectedLayerCount() {
    return this.uiLayers.length;
  }

  get visibleLayerCount() {
    return this.visibleUiLayers.length;
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
    return !this.mapReady || this.isLoading || !this.hasVisibleSelectedLayers;
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
    return this.visibleUiLayers.reduce((sum, layer) => sum + (layer.visibleFeatureCount || 0), 0);
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
    } across ${this.visibleLayerCount} visible layer${
      this.visibleLayerCount === 1 ? "" : "s"
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

    this.createBasemapToggleControl();
    this.createZoomControl();
    this.initializeBasemapLayer();
    this.registerLeafletMapListeners();
    this.map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    this.mapReady = true;
    this.syncLassoInteractionState();
    this.scheduleMapViewportSync({ fitToBounds: false });
  }

  createBasemapToggleControl() {
    if (!this.map || !window.L || this.basemapToggleControl) {
      return;
    }

    this.basemapToggleControl = window.L.control({ position: "bottomright" });

    this.basemapToggleControl.onAdd = () => {
      const container = window.L.DomUtil.create("div", "leaflet-bar");
      container.style.boxShadow = "0 1px 5px rgb(0 0 0 / 45%)";
      container.style.borderRadius = "4px";
      container.style.overflow = "hidden";

      const button = window.L.DomUtil.create("button", "", container);
      button.type = "button";
      button.style.width = "30px";
      button.style.height = "30px";
      button.style.display = "flex";
      button.style.alignItems = "center";
      button.style.justifyContent = "center";
      button.style.background = "#ffffff";
      button.style.border = "0";
      button.style.color = "#2f3e5c";
      button.style.cursor = "pointer";
      button.style.padding = "0";
      button.style.margin = "0";
      button.style.lineHeight = "1";
      button.style.font = "inherit";

      window.L.DomEvent.disableClickPropagation(container);
      window.L.DomEvent.disableScrollPropagation(container);
      window.L.DomEvent.on(button, "click", (event) => {
        window.L.DomEvent.stop(event);
        this.handleToggleBasemapMode();
      });

      this.basemapToggleButtonElement = button;
      this.syncBasemapControlButton();

      return container;
    };

    this.basemapToggleControl.addTo(this.map);
  }

  createZoomControl() {
    if (!this.map || !window.L || this.zoomControl) {
      return;
    }

    this.zoomControl = window.L.control.zoom({
      position: "bottomright"
    });
    this.zoomControl.addTo(this.map);
  }

  syncBasemapControlButton() {
    if (!this.basemapToggleButtonElement) {
      return;
    }

    const activeLabel = getActiveBasemapLabel(this.basemapState.mode);
    const toggleTitle = getBasemapToggleTitle(this.basemapState.mode);

    this.basemapToggleButtonElement.innerHTML = getBasemapControlIconMarkup(this.basemapState.mode);
    this.basemapToggleButtonElement.title = `${activeLabel} view. ${toggleTitle}`;
    this.basemapToggleButtonElement.setAttribute("aria-label", `${activeLabel} view. ${toggleTitle}`);
    this.basemapToggleButtonElement.setAttribute("data-basemap-mode", this.basemapState.mode);
  }

  initializeBasemapLayer() {
    this.basemapState = buildBasemapModeSwitchState(
      this.basemapState?.mode || BASEMAP_MODE_SATELLITE
    );
    this.tileWarningMessage = "";
    this.replaceBasemapLayer();
  }

  replaceBasemapLayer() {
    if (!window.L || !this.map) {
      return;
    }

    const basemapProvider = getBasemapProvider(this.basemapState);
    if (!basemapProvider) {
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

    this.tileLayer = window.L.tileLayer(
      basemapProvider.url,
      buildTileLayerOptions(basemapProvider)
    );

    this.tileLayer.on("tileerror", () => {
      this.handleBasemapTileError();
    });

    this.tileLayer.on("load", () => {
      this.handleBasemapTileLoad();
    });

    this.tileLayer.addTo(this.map);
    this.syncBasemapControlButton();
  }

  handleBasemapTileLoad() {
    this.basemapState = buildBasemapLoadedState(this.basemapState);
    this.tileWarningMessage = this.basemapState.warningMessage || "";
    this.syncBasemapControlButton();
  }

  handleBasemapTileError() {
    const tileErrorResult = buildBasemapTileErrorResult(this.basemapState);
    this.basemapState = tileErrorResult.state;
    this.tileWarningMessage = this.basemapState.warningMessage || "";
    this.syncBasemapControlButton();

    if (tileErrorResult.shouldReplaceLayer) {
      this.replaceBasemapLayer();
    }
  }

  handleToggleBasemapMode() {
    if (!this.mapReady || !window.L) {
      return;
    }

    const viewState = this.captureMapViewState();

    this.basemapState = buildBasemapModeSwitchState(
      getNextBasemapMode(this.basemapState.mode)
    );
    this.tileWarningMessage = "";
    this.syncBasemapControlButton();
    this.replaceBasemapLayer();

    this.scheduleMapViewportSync({
      preserveView: true,
      viewState
    });
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

    if (this.tileLayer) {
      try {
        this.tileLayer.off();
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
    this.zoomControl = null;
    this.basemapToggleControl = null;
    this.basemapToggleButtonElement = null;
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
    const previousStateByLayerId = buildLayerStateSnapshot(this.allLayers);
    const responseLayers = Array.isArray(response?.layers) ? response.layers : [];
    const selectAllByDefault = this.hasLegacyConfiguredLayerInputs;

    this.allLayers = responseLayers.map((incomingLayer) => {
      let normalizedLayer = normalizeLayerResponse(incomingLayer, {
        isSelected: false,
        isVisibleOnMap: false,
        isFilterPanelOpen: false
      });

      const previousState = previousStateByLayerId[normalizedLayer.mapLayerId];
      if (previousState) {
        return applyPreviousLayerState(normalizedLayer, previousState);
      }

      const isSelected = selectAllByDefault ? true : Boolean(normalizedLayer.isDefaultSelected);

      return hydrateLayerState({
        ...normalizedLayer,
        isSelected,
        isVisibleOnMap: isSelected,
        isFilterPanelOpen: false
      });
    });

    this.reconcileSelectedLassoFeatures();
  }

  closeAllFilterMenus({ exceptLayerId = null } = {}) {
    this.allLayers = this.allLayers.map((layer) =>
      hydrateLayerState({
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
      const visibleFeatures = getFilteredFeatures(layer);
      const updatedLayer = hydrateLayerState({
        ...layer,
        visibleFeatureCount: visibleFeatures.length
      });

      if (!updatedLayer.hasError && updatedLayer.isSelected && updatedLayer.isVisibleOnMap) {
        visibleFeatures.forEach((feature) => {
          const leafletLayer = createLeafletLayer(window.L, updatedLayer, feature);
          if (leafletLayer) {
            featureGroup.addLayer(leafletLayer);
            hasAnyRenderedFeature = true;
          }
        });
      }

      return updatedLayer;
    });

    this.renderedFeatureGroup = featureGroup.addTo(this.map);
    this.reconcileSelectedLassoFeatures();
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
      const highlightLayer = createSelectionHighlightLayer(window.L, feature);
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

    const rawSlot = event?.currentTarget?.dataset?.slot || event?.target?.dataset?.slot || null;
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

      return hydrateLayerState({
        ...layer,
        isSelected,
        isVisibleOnMap: isSelected ? true : false,
        isFilterPanelOpen: isSelected ? layer.isFilterPanelOpen : false
      });
    });

    this.renderVisibleFeatures({
      preserveView: true,
      viewState
    });
  }

  toggleLayerVisibility(layerId) {
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

      return hydrateLayerState({
        ...layer,
        isVisibleOnMap: !layer.isVisibleOnMap
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
    this.handleLayerVisibilityToggle(event);
  }

  handleLayerVisibilityToggle(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    if (!layerId) {
      return;
    }

    this.toggleLayerVisibility(layerId);
  }

  handleToggleFilterPanel(event) {
    const layerId = this.resolveLayerIdFromEvent(event);
    if (!layerId) {
      return;
    }

    this.allLayers = this.allLayers.map((layer) => {
      const shouldOpen = layer.mapLayerId === layerId ? !layer.isFilterPanelOpen : false;
      return hydrateLayerState({
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
        return hydrateLayerState({
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

      return hydrateLayerState({
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

      return hydrateLayerState({
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
        return hydrateLayerState({
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
          selectedValues: selectedFilterValue ? [selectedFilterValue] : []
        };
      });

      return hydrateLayerState({
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

    const closedPolygon = ensureClosedPolygonLatLngs(this.lassoDraftLatLngs);
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
    const closedPolygon = ensureClosedPolygonLatLngs(polygonLatLngs);
    const selectedByKey = new Map();

    getSelectableVisibleFeatures(this.allLayers).forEach(({ layer, feature }) => {
      if (!doesFeatureIntersectLasso(feature, closedPolygon)) {
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

    getSelectableVisibleFeatures(this.allLayers).forEach(({ layer, feature }) => {
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
      return this.buildFallbackRecordUrl(recordId);
    }
  }

  buildFallbackRecordUrl(recordId) {
    if (!recordId) {
      return "#";
    }

    return `/${encodeURIComponent(recordId)}`;
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

function getBasemapControlIconMarkup(mode) {
  if (mode === "terrain") {
    return `
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        aria-hidden="true"
        focusable="false"
        style="display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;"
      >
        <path d="M3 18h18"></path>
        <path d="M5 18l5-7 3 4 3-5 3 8"></path>
      </svg>
    `;
  }

  return `
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      style="display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;"
    >
      <rect x="3.5" y="5" width="17" height="14" rx="1.75"></rect>
      <path d="M7 14l3-3 2.5 2.5 2.5-3.5 2 4"></path>
      <circle cx="16.75" cy="9.25" r="1.25"></circle>
    </svg>
  `;
}
