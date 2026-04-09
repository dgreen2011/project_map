const SITE_OBJECT_API_NAME = "sitetracker__site__c";
const SEGMENT_OBJECT_API_NAME = "sitetracker__segment__c";

export function buildLayerStateSnapshot(layers = []) {
  const snapshot = {};

  (Array.isArray(layers) ? layers : []).forEach((layer) => {
    snapshot[layer.mapLayerId] = {
      isSelected: Boolean(layer.isSelected),
      isVisibleOnMap:
        layer.isVisibleOnMap === undefined ? Boolean(layer.isSelected) : Boolean(layer.isVisibleOnMap),
      isFilterPanelOpen: Boolean(layer.isFilterPanelOpen),
      filterSelectionsByFieldPath: buildLayerFilterSelectionMap(layer)
    };
  });

  return snapshot;
}

export function normalizeLayerResponse(layer, options = {}) {
  const safeFeatures = Array.isArray(layer?.features) ? layer.features : [];
  const safeWarnings = Array.isArray(layer?.warnings) ? layer.warnings : [];
  const safePopupFields = Array.isArray(layer?.popupFields) ? layer.popupFields : [];
  const safeFilterFields = Array.isArray(layer?.filterFields) ? layer.filterFields : [];
  const safeStyleValueOptions = Array.isArray(layer?.styleValueOptions) ? layer.styleValueOptions : [];

  const baseLayer = {
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
    filterFields: safeFilterFields.map((filterField) => normalizeFilterField(filterField)),
    popupFieldsRawJson: layer?.popupFieldsRawJson || "",
    popupFields: safePopupFields,
    styleConfig: normalizeStyleConfig(layer?.styleConfig),
    styleValueOptions: safeStyleValueOptions,
    queriedRecordCount: Number(layer?.queriedRecordCount) || 0,
    renderedFeatureCount: Number(layer?.renderedFeatureCount) || 0,
    skippedRecordCount: Number(layer?.skippedRecordCount) || 0,
    warnings: safeWarnings,
    errorMessage: layer?.errorMessage || "",
    isSelected: Boolean(options?.isSelected),
    isVisibleOnMap:
      options?.isVisibleOnMap === undefined
        ? Boolean(options?.isSelected)
        : Boolean(options?.isVisibleOnMap),
    isFilterPanelOpen: Boolean(options?.isFilterPanelOpen),
    visibleFeatureCount: 0
  };

  const normalizedFeatures = safeFeatures.map((feature) => normalizeFeatureResponse(baseLayer, feature));

  return hydrateLayerState({
    ...baseLayer,
    features: normalizedFeatures
  });
}

export function applyPreviousLayerState(layer, previousState = {}) {
  const filterSelectionsByFieldPath = previousState?.filterSelectionsByFieldPath || {};
  const nextFilterFields = (Array.isArray(layer?.filterFields) ? layer.filterFields : []).map(
    (filterField) => {
      const availableValues = new Set(getAllFilterOptionValues(filterField));
      const priorSelectedValues = Array.isArray(filterSelectionsByFieldPath[filterField.fieldPath])
        ? filterSelectionsByFieldPath[filterField.fieldPath]
        : getAllFilterOptionValues(filterField);

      return {
        ...filterField,
        selectedValues: priorSelectedValues.filter((value) => availableValues.has(value))
      };
    }
  );

  return hydrateLayerState({
    ...layer,
    isSelected: Boolean(previousState?.isSelected),
    isVisibleOnMap:
      previousState?.isVisibleOnMap === undefined
        ? Boolean(previousState?.isSelected)
        : Boolean(previousState?.isVisibleOnMap),
    isFilterPanelOpen: Boolean(previousState?.isFilterPanelOpen),
    filterFields: nextFilterFields
  });
}

export function hydrateLayerState(layer) {
  const nextFilterFields = Array.isArray(layer?.filterFields)
    ? layer.filterFields.map((filterField) => hydrateFilterFieldState(filterField))
    : [];

  const nextLayer = {
    ...layer,
    filterFields: nextFilterFields,
    hasError: Boolean(layer?.errorMessage),
    hasWarnings: Array.isArray(layer?.warnings) && layer.warnings.length > 0,
    hasFilterControl: nextFilterFields.some((filterField) => filterField.hasOptions)
  };

  const activeFilterCount = getAppliedFilterCount(nextLayer);
  const visibleFeatureCount = getFilteredFeatures(nextLayer).length;

  return {
    ...nextLayer,
    activeFilterCount,
    visibleFeatureCount,
    filterSummaryText: buildLayerFilterSummaryText(nextLayer, activeFilterCount),
    selectionButtonLabel: nextLayer.isSelected ? "Remove" : "Add",
    selectionButtonTitle: nextLayer.isSelected ? "Remove layer from pane" : "Add layer to pane",
    isFilterButtonDisabled: !nextLayer.hasFilterControl,
    filterButtonTitle: nextLayer.hasFilterControl
      ? activeFilterCount
        ? "Edit layer filters"
        : "Filter layer"
      : "No filters available for this layer",
    visibilityButtonTitle: nextLayer.isVisibleOnMap ? "Hide layer on map" : "Show layer on map"
  };
}

export function buildLayerFilterSelectionMap(layer) {
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

export function getAppliedFilterCount(layer) {
  if (!Array.isArray(layer?.filterFields)) {
    return 0;
  }

  return layer.filterFields.reduce((sum, filterField) => {
    if (!doesFilterFieldHaveActiveSelection(filterField)) {
      return sum;
    }

    return sum + (Number(filterField?.selectedCount) || 0);
  }, 0);
}

export function buildLayerFilterSummaryText(layer, activeFilterCount = null) {
  const appliedCount = activeFilterCount === null ? getAppliedFilterCount(layer) : activeFilterCount;

  if (!layer?.hasFilterControl) {
    return "";
  }

  if (!appliedCount) {
    return "All";
  }

  return `${appliedCount} selected`;
}

export function buildSelectedValuesText(values, optionCount = 0) {
  if (!Array.isArray(values) || !values.length) {
    return "All";
  }

  if (optionCount > 0 && values.length >= optionCount) {
    return "All";
  }

  if (values.length <= 2) {
    return values.join(", ");
  }

  return `${values[0]}, ${values[1]} +${values.length - 2}`;
}

export function getFilteredFeatures(layer) {
  if (!layer?.isSelected || !layer?.isVisibleOnMap) {
    return [];
  }

  const filterFields = Array.isArray(layer?.filterFields) ? layer.filterFields : [];
  const appliedFilterFields = filterFields.filter((filterField) =>
    doesFilterFieldHaveActiveSelection(filterField)
  );

  const features = Array.isArray(layer?.features) ? layer.features : [];
  if (!appliedFilterFields.length) {
    return features;
  }

  return features.filter((feature) =>
    appliedFilterFields.every((filterField) => doesFeatureMatchFilterField(feature, filterField))
  );
}

export function getSelectableVisibleFeatures(layers = []) {
  const visibleSelectableFeatures = [];

  (Array.isArray(layers) ? layers : []).forEach((layer) => {
    if (!layer || layer.hasError || !layer.isSelected || !layer.isVisibleOnMap) {
      return;
    }

    getFilteredFeatures(layer).forEach((feature) => {
      if (isSelectableFeature(layer, feature)) {
        visibleSelectableFeatures.push({ layer, feature });
      }
    });
  });

  return visibleSelectableFeatures;
}

export function isSelectableFeature(layer, feature) {
  const normalizedObjectApiName = normalizeString(
    feature?.targetObjectApiName || layer?.objectApiName || ""
  )?.toLowerCase();

  return (
    Boolean(feature?.recordId) &&
    (normalizedObjectApiName === SITE_OBJECT_API_NAME ||
      normalizedObjectApiName === SEGMENT_OBJECT_API_NAME)
  );
}

export function normalizeStyleConfig(styleConfig) {
  if (!styleConfig) {
    return null;
  }

  const defaultSymbol = safeParseJson(styleConfig.defaultSymbolJson);
  const uniqueValueRules = Array.isArray(styleConfig.uniqueValueRules)
    ? styleConfig.uniqueValueRules.map((rule) => ({
        label: rule?.label || "",
        value: rule?.value || "",
        symbol: safeParseJson(rule?.symbolJson)
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

export function normalizeFilterField(filterField) {
  const rawOptions = Array.isArray(filterField?.options) ? filterField.options : [];
  const dedupedOptionValues = Array.from(
    new Set(
      rawOptions
        .map((option) => normalizeString(option))
        .filter((option) => Boolean(option))
    )
  );

  const options = dedupedOptionValues.map((optionValue) => ({
    label: optionValue,
    value: optionValue,
    checked: true
  }));

  return hydrateFilterFieldState({
    fieldPath: filterField?.fieldPath || "",
    fieldLabel: filterField?.fieldLabel || "",
    dataType: filterField?.dataType || "",
    options,
    selectedValues: dedupedOptionValues
  });
}

export function normalizeFeatureResponse(layer, feature) {
  return {
    recordId: feature?.recordId || "",
    name: feature?.name || "",
    geometryType: feature?.geometryType || "",
    geometryRaw: feature?.geometryRaw || "",
    latitude: toNumber(feature?.latitude),
    longitude: toNumber(feature?.longitude),
    geometrySourceFieldPath: feature?.geometrySourceFieldPath || "",
    filterValue: feature?.filterValue || "",
    filterValues: normalizeFeatureFilterValues(layer, feature),
    styleValue: feature?.styleValue || "",
    popupValues: Array.isArray(feature?.popupValues) ? feature.popupValues : [],
    canCreateWorkLog: Boolean(feature?.canCreateWorkLog),
    productionLineAllocationId: feature?.productionLineAllocationId || "",
    targetObjectApiName:
      feature?.targetObjectApiName || feature?.objectApiName || layer?.objectApiName || ""
  };
}

export function normalizeFeatureFilterValues(layer, feature) {
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

export function getAllFilterOptionValues(filterField) {
  return Array.isArray(filterField?.options)
    ? filterField.options
        .map((option) => option?.value || option?.label || "")
        .filter((value) => Boolean(value))
    : [];
}

function hydrateFilterFieldState(filterField) {
  const options = Array.isArray(filterField?.options)
    ? filterField.options.map((option) => ({
        label: option?.label || option?.value || "",
        value: option?.value || option?.label || "",
        checked: false
      }))
    : [];

  const optionValues = getAllFilterOptionValues({ options });
  const selectedValueSet = new Set(
    (Array.isArray(filterField?.selectedValues) ? filterField.selectedValues : []).filter((value) =>
      optionValues.includes(value)
    )
  );

  if (!selectedValueSet.size && optionValues.length) {
    optionValues.forEach((value) => selectedValueSet.add(value));
  }

  const selectedValues = optionValues.filter((value) => selectedValueSet.has(value));
  const hasAllSelectedValues = optionValues.length > 0 && selectedValues.length >= optionValues.length;

  const checkedOptions = options.map((option) => ({
    ...option,
    checked: hasAllSelectedValues
      ? true
      : selectedValueSet.has(option.value || option.label || "")
  }));

  return {
    ...filterField,
    options: checkedOptions,
    optionCount: optionValues.length,
    allOptionValues: optionValues,
    selectedValues: hasAllSelectedValues ? [...optionValues] : selectedValues,
    selectedCount: hasAllSelectedValues ? optionValues.length : selectedValues.length,
    hasOptions: checkedOptions.length > 0,
    hasSelectedValues: optionValues.length > 0,
    hasAllSelectedValues,
    selectedSummaryText: buildSelectedValuesText(
      hasAllSelectedValues ? optionValues : selectedValues,
      optionValues.length
    )
  };
}

function doesFilterFieldHaveActiveSelection(filterField) {
  if (!filterField?.hasOptions) {
    return false;
  }

  const optionCount = Number(filterField?.optionCount) || getAllFilterOptionValues(filterField).length;
  const selectedCount = Number(filterField?.selectedCount) || 0;

  if (!selectedCount) {
    return false;
  }

  return optionCount > 0 && selectedCount < optionCount;
}

function doesFeatureMatchFilterField(feature, filterField) {
  if (!doesFilterFieldHaveActiveSelection(filterField)) {
    return true;
  }

  const selectedValues = Array.isArray(filterField?.selectedValues) ? filterField.selectedValues : [];
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

function safeParseJson(value) {
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

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : NaN;
}
