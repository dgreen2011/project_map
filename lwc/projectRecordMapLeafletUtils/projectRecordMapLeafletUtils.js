import {
  extractPolylineCoordinateSets,
  extractPolygonCoordinateSets,
  toLatLngs
} from "c/projectRecordMapGeometryUtils";

const DEFAULT_POINT_COLOR = "#2f80ed";
const DEFAULT_LINE_COLOR = "#0b8f86";
const DEFAULT_POLYGON_COLOR = "#5779c1";
const SELECTION_HIGHLIGHT_COLOR = "#ff9f1c";

const SITE_OBJECT_API_NAME = "sitetracker__site__c";
const SEGMENT_OBJECT_API_NAME = "sitetracker__segment__c";

export function createLeafletLayer(L, layer, feature) {
  if (!L || !feature) {
    return null;
  }

  const popupHtml = buildPopupHtml(layer, feature);
  const symbol = resolveFeatureSymbol(layer, feature);

  if (feature.geometryType === "point") {
    return createPointLayer(L, feature, symbol, popupHtml);
  }

  if (feature.geometryType === "polyline") {
    return createPolylineLayer(L, feature, symbol, popupHtml);
  }

  if (feature.geometryType === "polygon") {
    return createPolygonLayer(L, feature, symbol, popupHtml);
  }

  return null;
}

export function createSelectionHighlightLayer(L, feature) {
  if (!L || !feature) {
    return null;
  }

  if (feature.geometryType === "point") {
    return createSelectionPointLayer(L, feature);
  }

  if (feature.geometryType === "polyline") {
    return createSelectionPolylineLayer(L, feature);
  }

  return null;
}

export function resolveFeatureSymbol(layer, feature) {
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

export function buildPopupHtml(layer, feature) {
  const popupValues = Array.isArray(feature?.popupValues) ? feature.popupValues : [];
  const escapedName = escapeHtml(feature?.name || layer?.mapLayerName || "Record");
  const escapedRecordId = escapeHtml(feature?.recordId || "");
  const escapedObjectApiName = escapeHtml(
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
      const value = escapeHtml(formatPopupValue(popupValue));
      if (!value) {
        return "";
      }

      return `<div style="${valueStyle}">${value}</div>`;
    })
    .filter((markup) => Boolean(markup))
    .join("");

  const actionMarkup = shouldShowWorkLogAction(layer, feature)
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

export function shouldShowWorkLogAction(layer, feature) {
  const objectApiName = normalizeString(
    feature?.targetObjectApiName || layer?.objectApiName || ""
  )?.toLowerCase();

  if (objectApiName !== SITE_OBJECT_API_NAME && objectApiName !== SEGMENT_OBJECT_API_NAME) {
    return false;
  }

  return Boolean(feature?.canCreateWorkLog || feature?.productionLineAllocationId);
}

export function formatPopupValue(popupValue) {
  const rawValue = popupValue?.displayValue ?? "";
  const dataType = normalizeString(popupValue?.dataType)?.toUpperCase();

  if (dataType === "DOUBLE" || dataType === "CURRENCY" || dataType === "INTEGER") {
    const numericValue = toNumber(rawValue);
    if (Number.isFinite(numericValue)) {
      return numericValue.toLocaleString();
    }
  }

  return rawValue;
}

export function buildPointLeafletStyle(symbol) {
  const fillColor = resolveSymbolColor(symbol?.color, DEFAULT_POINT_COLOR);
  const outlineColor = resolveSymbolColor(symbol?.outline?.color, "#000000");
  const radius = resolvePositiveNumber(symbol?.size, 6);
  const fillOpacity = resolveColorAlpha(symbol?.color, 0.75);
  const weight = resolvePositiveNumber(symbol?.outline?.width, 1);

  return {
    radius,
    color: outlineColor,
    weight,
    opacity: 1,
    fillColor,
    fillOpacity
  };
}

export function buildPolylineStyle(symbol) {
  return {
    color: resolveSymbolColor(symbol?.color, DEFAULT_LINE_COLOR),
    weight: resolvePositiveNumber(symbol?.width, 3),
    opacity: resolveColorAlpha(symbol?.color, 0.85),
    dashArray: resolveLineDashArray(symbol?.style),
    lineCap: "round",
    lineJoin: "round"
  };
}

export function buildPolylineOutlineStyle(symbol) {
  const outline = symbol?.outline;
  if (!outline) {
    return null;
  }

  const innerWeight = resolvePositiveNumber(symbol?.width, 3);
  const outlineWidth = resolvePositiveNumber(outline?.width, 1);

  return {
    color: resolveSymbolColor(outline?.color, "#000000"),
    weight: innerWeight + outlineWidth * 2,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round"
  };
}

export function buildPolygonStyle(symbol) {
  return {
    color: resolveSymbolColor(symbol?.outline?.color, "#000000"),
    weight: resolvePositiveNumber(symbol?.outline?.width, 1),
    opacity: 1,
    fillColor: resolveSymbolColor(symbol?.color, DEFAULT_POLYGON_COLOR),
    fillOpacity: resolveColorAlpha(symbol?.color, 0.35),
    dashArray: resolveLineDashArray(symbol?.style)
  };
}

export function resolveLineDashArray(styleName) {
  const normalizedStyle = normalizeString(styleName)?.toLowerCase();

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

export function resolveSymbolColor(inputColor, fallbackColor) {
  if (Array.isArray(inputColor)) {
    const [red, green, blue, alpha] = inputColor;
    const numericAlpha = toNumber(alpha);

    if (
      Number.isFinite(toNumber(red)) &&
      Number.isFinite(toNumber(green)) &&
      Number.isFinite(toNumber(blue))
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

export function resolveColorAlpha(inputColor, fallbackAlpha) {
  if (Array.isArray(inputColor) && inputColor.length >= 4) {
    const numericAlpha = toNumber(inputColor[3]);
    if (Number.isFinite(numericAlpha)) {
      return numericAlpha;
    }
  }

  return fallbackAlpha;
}

export function resolvePositiveNumber(value, fallbackValue) {
  const numericValue = toNumber(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallbackValue;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createPointLayer(L, feature, symbol, popupHtml) {
  const latitude = toNumber(feature?.latitude);
  const longitude = toNumber(feature?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const circleMarker = L.circleMarker([latitude, longitude], buildPointLeafletStyle(symbol));

  if (popupHtml) {
    circleMarker.bindPopup(popupHtml, { maxWidth: 320 });
  }

  return circleMarker;
}

function createPolylineLayer(L, feature, symbol, popupHtml) {
  const coordinateSets = extractPolylineCoordinateSets(feature?.geometryRaw);
  if (!coordinateSets.length) {
    return null;
  }

  const renderedLayers = [];
  coordinateSets.forEach((coordinateSet) => {
    const latLngs = toLatLngs(coordinateSet);
    if (latLngs.length < 2) {
      return;
    }

    const outlineStyle = buildPolylineOutlineStyle(symbol);
    if (outlineStyle) {
      renderedLayers.push(L.polyline(latLngs, outlineStyle));
    }

    renderedLayers.push(L.polyline(latLngs, buildPolylineStyle(symbol)));
  });

  if (!renderedLayers.length) {
    return null;
  }

  return bundleFeatureLayers(L, renderedLayers, popupHtml);
}

function createPolygonLayer(L, feature, symbol, popupHtml) {
  const polygonSets = extractPolygonCoordinateSets(feature?.geometryRaw);
  if (!polygonSets.length) {
    return null;
  }

  const renderedLayers = [];
  polygonSets.forEach((polygonSet) => {
    const latLngRings = polygonSet
      .map((ring) => toLatLngs(ring))
      .filter((ring) => Array.isArray(ring) && ring.length >= 3);

    if (!latLngRings.length) {
      return;
    }

    renderedLayers.push(L.polygon(latLngRings, buildPolygonStyle(symbol)));
  });

  if (!renderedLayers.length) {
    return null;
  }

  return bundleFeatureLayers(L, renderedLayers, popupHtml);
}

function bundleFeatureLayers(L, layers, popupHtml) {
  if (layers.length === 1) {
    if (popupHtml) {
      layers[0].bindPopup(popupHtml, { maxWidth: 320 });
    }
    return layers[0];
  }

  const featureGroup = L.featureGroup(layers);
  if (popupHtml) {
    featureGroup.bindPopup(popupHtml, { maxWidth: 320 });
  }
  return featureGroup;
}

function createSelectionPointLayer(L, feature) {
  const latitude = toNumber(feature?.latitude);
  const longitude = toNumber(feature?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return L.circleMarker([latitude, longitude], {
    radius: 8,
    color: "#ffffff",
    weight: 3,
    opacity: 1,
    fillColor: SELECTION_HIGHLIGHT_COLOR,
    fillOpacity: 0.95
  });
}

function createSelectionPolylineLayer(L, feature) {
  const coordinateSets = extractPolylineCoordinateSets(feature?.geometryRaw);
  if (!coordinateSets.length) {
    return null;
  }

  const renderedLayers = [];
  coordinateSets.forEach((coordinateSet) => {
    const latLngs = toLatLngs(coordinateSet);
    if (latLngs.length < 2) {
      return;
    }

    renderedLayers.push(
      L.polyline(latLngs, {
        color: "#ffffff",
        weight: 8,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round"
      })
    );

    renderedLayers.push(
      L.polyline(latLngs, {
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

  return renderedLayers.length === 1 ? renderedLayers[0] : L.featureGroup(renderedLayers);
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
