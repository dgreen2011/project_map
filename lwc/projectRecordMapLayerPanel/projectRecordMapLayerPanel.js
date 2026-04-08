import { api, LightningElement } from "lwc";

export default class ProjectRecordMapLayerPanel extends LightningElement {
  @api variant = "inline";
  @api layers = [];
  @api availableLayers = [];
  @api loading = false;
  @api sidebarToggleIconName = "utility:chevronleft";
  @api sidebarToggleTitle = "Hide Layers";

  isAddMenuOpen = false;
  boundDocumentClickHandler = null;

  connectedCallback() {
    this.boundDocumentClickHandler = this.handleDocumentClick.bind(this);

    if (typeof document !== "undefined") {
      document.addEventListener("click", this.boundDocumentClickHandler);
    }
  }

  disconnectedCallback() {
    if (this.boundDocumentClickHandler && typeof document !== "undefined") {
      document.removeEventListener("click", this.boundDocumentClickHandler);
    }

    this.boundDocumentClickHandler = null;
  }

  renderedCallback() {
    if (this.loading && this.isAddMenuOpen) {
      this.isAddMenuOpen = false;
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

  get hasSelectedLayers() {
    return this.shownLayers.length > 0;
  }

  get hasAvailableLayersToAdd() {
    return this.hiddenLayers.length > 0;
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

  handleDocumentClick(event) {
    if (!this.isAddMenuOpen) {
      return;
    }

    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(this.template.host)) {
      return;
    }

    this.isAddMenuOpen = false;
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

    this.isAddMenuOpen = !this.isAddMenuOpen;
  }

  handleAddLayersMenuClose(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    this.isAddMenuOpen = false;
  }

  handlePanelKeydown(event) {
    if (event.key === "Escape") {
      this.isAddMenuOpen = false;
    }
  }

  handleAddLayerClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.isAddMenuOpen = false;
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

  handleToggleFilterPanel(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const layerId = event?.currentTarget?.dataset?.layerId;
    if (!layerId) {
      return;
    }

    this.isAddMenuOpen = false;
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
