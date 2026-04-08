import { api, LightningElement } from "lwc";

const ADD_MENU_VIEWPORT_PADDING_PX = 12;
const SEARCHABLE_LAYER_FIELDS = ["mapLayerName", "objectApiName", "geometryType", "layerType"];

export default class ProjectRecordMapLayerPanel extends LightningElement {
  @api variant = "inline";
  @api layers = [];
  @api availableLayers = [];
  @api loading = false;
  @api sidebarToggleIconName = "utility:chevronleft";
  @api sidebarToggleTitle = "Hide Layers";

  isAddMenuOpen = false;
  addMenuSearchTerm = "";
  addMenuInlineStyle = "";
  shouldFocusAddMenuSearch = false;

  boundDocumentClickHandler = null;
  boundWindowResizeHandler = null;
  pendingAddMenuPositionFrame = null;

  connectedCallback() {
    this.boundDocumentClickHandler = this.handleDocumentClick.bind(this);
    this.boundWindowResizeHandler = this.handleWindowResize.bind(this);

    if (typeof document !== "undefined") {
      document.addEventListener("click", this.boundDocumentClickHandler);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.boundWindowResizeHandler);
    }
  }

  disconnectedCallback() {
    if (this.boundDocumentClickHandler && typeof document !== "undefined") {
      document.removeEventListener("click", this.boundDocumentClickHandler);
    }

    if (this.boundWindowResizeHandler && typeof window !== "undefined") {
      window.removeEventListener("resize", this.boundWindowResizeHandler);
    }

    this.boundDocumentClickHandler = null;
    this.boundWindowResizeHandler = null;
    this.cancelPendingAddMenuPositioning();
  }

  renderedCallback() {
    if (this.loading && this.isAddMenuOpen) {
      this.closeAddMenu();
      return;
    }

    if (!this.isAddMenuOpen) {
      return;
    }

    this.scheduleAddMenuPositioning();

    if (this.shouldFocusAddMenuSearch) {
      this.focusAddMenuSearchInput();
      this.shouldFocusAddMenuSearch = false;
    }
  }

  get isPopoutVariant() {
    return String(this.variant || "").toLowerCase() === "popout";
  }

  get sidePanelClass() {
    return this.isPopoutVariant ? "side-panel side-panel-popout" : "side-panel";
  }

  get shownLayers() {
    return Array.isArray(this.layers) ? this.layers : [];
  }

  get hiddenLayers() {
    return Array.isArray(this.availableLayers) ? this.availableLayers : [];
  }

  get filteredHiddenLayers() {
    const normalizedSearchTerm = this.normalizeSearchTerm(this.addMenuSearchTerm);
    if (!normalizedSearchTerm) {
      return this.hiddenLayers;
    }

    return this.hiddenLayers.filter((layer) =>
      this.buildLayerSearchText(layer).includes(normalizedSearchTerm)
    );
  }

  get hasSelectedLayers() {
    return this.shownLayers.length > 0;
  }

  get hasAvailableLayersToAdd() {
    return this.hiddenLayers.length > 0;
  }

  get hasFilteredAvailableLayersToAdd() {
    return this.filteredHiddenLayers.length > 0;
  }

  get showNoLayerSearchMatches() {
    return this.hasAvailableLayersToAdd && !this.hasFilteredAvailableLayersToAdd;
  }

  get isAddLayersButtonDisabled() {
    return this.loading || !this.hasAvailableLayersToAdd;
  }

  get addLayersButtonTitle() {
    return this.hasAvailableLayersToAdd ? "Add layers" : "No more layers to add";
  }

  get addLayersButtonIconName() {
    return "utility:add";
  }

  get addMenuClass() {
    return this.isAddMenuOpen ? "layer-add-menu layer-add-menu-open" : "layer-add-menu";
  }

  get addMenuSearchValue() {
    return this.addMenuSearchTerm;
  }

  get showAddMenuSearch() {
    return this.hasAvailableLayersToAdd;
  }

  get addMenuEmptyStateText() {
    return this.showNoLayerSearchMatches
      ? `No layers matched "${this.addMenuSearchTerm}".`
      : "No more layers to add.";
  }

  handleDocumentClick(event) {
    if (!this.isAddMenuOpen) {
      return;
    }

    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(this.template.host)) {
      return;
    }

    this.closeAddMenu();
  }

  handleWindowResize() {
    if (!this.isAddMenuOpen) {
      return;
    }

    this.scheduleAddMenuPositioning();
  }

  handleSidebarToggle(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    this.dispatchComponentEvent("sidebartoggle");
  }

  handleAddLayersMenuToggle(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (this.isAddLayersButtonDisabled) {
      return;
    }

    if (this.isAddMenuOpen) {
      this.closeAddMenu();
      return;
    }

    this.isAddMenuOpen = true;
    this.addMenuSearchTerm = "";
    this.addMenuInlineStyle = "";
    this.shouldFocusAddMenuSearch = true;
  }

  handleAddLayersMenuClose(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    this.closeAddMenu();
  }

  handlePanelKeydown(event) {
    if (event.key === "Escape") {
      this.closeAddMenu();
    }
  }

  handleAddMenuSearchInput(event) {
    this.addMenuSearchTerm = event?.target?.value || "";
    this.scheduleAddMenuPositioning();
  }

  handleAddLayerClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.closeAddMenu();
    this.dispatchComponentEvent("addlayer", { layerId });
  }

  handleRemoveLayerClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.dispatchComponentEvent("removelayer", { layerId });
  }

  handleToggleLayerVisibility(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.dispatchComponentEvent("layervisibilitytoggle", { layerId });
  }

  handleToggleFilterPanel(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.closeAddMenu({ preserveSearch: false, preserveStyle: false });
    this.dispatchComponentEvent("togglefilterpanel", { layerId });
  }

  handleClearLayerFilters(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.dispatchComponentEvent("clearlayerfilters", { layerId });
  }

  handleLayerFilterOptionChange(event) {
    event?.stopPropagation?.();

    const layerId = event?.target?.dataset?.layerId || event?.currentTarget?.dataset?.layerId;
    const fieldPath =
      event?.target?.dataset?.fieldPath || event?.currentTarget?.dataset?.fieldPath;
    const value = event?.target?.dataset?.value || event?.currentTarget?.dataset?.value;
    const checked = Boolean(event?.target?.checked);

    if (!layerId || !fieldPath || !value) {
      return;
    }

    this.dispatchComponentEvent("layerfilteroptionchange", {
      layerId,
      fieldPath,
      value,
      checked
    });
  }

  closeAddMenu({ preserveSearch = false, preserveStyle = false } = {}) {
    this.isAddMenuOpen = false;
    this.shouldFocusAddMenuSearch = false;
    this.cancelPendingAddMenuPositioning();

    if (!preserveSearch) {
      this.addMenuSearchTerm = "";
    }

    if (!preserveStyle) {
      this.addMenuInlineStyle = "";
    }
  }

  focusAddMenuSearchInput() {
    const searchInput = this.template.querySelector('[data-id="add-layer-search"]');
    if (!searchInput || typeof searchInput.focus !== "function") {
      return;
    }

    try {
      searchInput.focus();
    } catch (error) {
      // ignore focus issues
    }
  }

  scheduleAddMenuPositioning() {
    this.cancelPendingAddMenuPositioning();

    if (typeof window === "undefined") {
      return;
    }

    this.pendingAddMenuPositionFrame = window.requestAnimationFrame(() => {
      this.pendingAddMenuPositionFrame = null;
      this.positionAddMenuWithinViewport();
    });
  }

  cancelPendingAddMenuPositioning() {
    if (!this.pendingAddMenuPositionFrame || typeof window === "undefined") {
      return;
    }

    window.cancelAnimationFrame(this.pendingAddMenuPositionFrame);
    this.pendingAddMenuPositionFrame = null;
  }

  positionAddMenuWithinViewport() {
    if (!this.isAddMenuOpen || typeof window === "undefined") {
      return;
    }

    const addMenu = this.template.querySelector('[data-id="layer-add-menu"]');
    if (!addMenu) {
      return;
    }

    addMenu.style.transform = "translateX(0)";
    const rect = addMenu.getBoundingClientRect();
    const maxRight = window.innerWidth - ADD_MENU_VIEWPORT_PADDING_PX;

    let shiftX = 0;

    if (rect.left < ADD_MENU_VIEWPORT_PADDING_PX) {
      shiftX += ADD_MENU_VIEWPORT_PADDING_PX - rect.left;
    }

    if (rect.right + shiftX > maxRight) {
      shiftX -= rect.right + shiftX - maxRight;
    }

    const nextInlineStyle =
      shiftX === 0 ? "" : `transform: translateX(${Math.round(shiftX)}px);`;

    if (nextInlineStyle !== this.addMenuInlineStyle) {
      this.addMenuInlineStyle = nextInlineStyle;
    }
  }

  buildLayerSearchText(layer) {
    return SEARCHABLE_LAYER_FIELDS.map((fieldName) => layer?.[fieldName] || "")
      .join(" ")
      .toLowerCase();
  }

  normalizeSearchTerm(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  dispatchComponentEvent(name, detail = {}) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }
}
