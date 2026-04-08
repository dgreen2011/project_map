export const GEOMETRY_EPSILON = 1e-10;

export function parseGeometryValue(value) {
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

export function normalizePointLike(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const longitude = toNumber(point[0]);
    const latitude = toNumber(point[1]);

    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return null;
    }

    return [longitude, latitude];
  }

  if (point && typeof point === "object") {
    const longitude = toNumber(
      point.longitude ??
        point.lng ??
        point.lon ??
        point.x ??
        point?.location?.longitude ??
        point?.location?.lng
    );
    const latitude = toNumber(
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

export function normalizeCoordinateSet(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .map((point) => normalizePointLike(point))
    .filter((point) => Array.isArray(point));
}

export function normalizeNestedCoordinateSets(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  if (candidate.length && normalizePointLike(candidate[0])) {
    const normalizedSet = normalizeCoordinateSet(candidate);
    return normalizedSet.length >= 2 ? [normalizedSet] : [];
  }

  return candidate
    .map((item) => normalizeCoordinateSet(item))
    .filter((set) => Array.isArray(set) && set.length >= 2);
}

export function extractPolylineCoordinateSets(geometryRaw) {
  const parsed = parseGeometryValue(geometryRaw);
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed?.snappedPoints)) {
    const snappedCoordinates = parsed.snappedPoints
      .map((point) => normalizePointLike(point))
      .filter((point) => Array.isArray(point));

    return snappedCoordinates.length >= 2 ? [snappedCoordinates] : [];
  }

  if (parsed?.type === "Feature" && parsed.geometry) {
    return extractPolylineCoordinateSets(parsed.geometry);
  }

  if (parsed?.geometry) {
    const geometryResult = extractPolylineCoordinateSets(parsed.geometry);
    if (geometryResult.length) {
      return geometryResult;
    }
  }

  if (parsed?.type === "LineString" && Array.isArray(parsed.coordinates)) {
    return normalizeNestedCoordinateSets([parsed.coordinates]);
  }

  if (parsed?.type === "MultiLineString" && Array.isArray(parsed.coordinates)) {
    return normalizeNestedCoordinateSets(parsed.coordinates);
  }

  if (Array.isArray(parsed?.paths)) {
    return normalizeNestedCoordinateSets(parsed.paths);
  }

  if (Array.isArray(parsed?.path)) {
    return normalizeNestedCoordinateSets([parsed.path]);
  }

  if (Array.isArray(parsed?.coordinates)) {
    const directCoordinates = normalizeNestedCoordinateSets(parsed.coordinates);
    if (directCoordinates.length) {
      return directCoordinates;
    }

    return normalizeNestedCoordinateSets([parsed.coordinates]);
  }

  if (Array.isArray(parsed)) {
    const normalizedDirect = normalizeNestedCoordinateSets(parsed);
    if (normalizedDirect.length) {
      return normalizedDirect;
    }

    const singleSet = normalizeCoordinateSet(parsed);
    return singleSet.length >= 2 ? [singleSet] : [];
  }

  return [];
}

export function extractPolygonCoordinateSets(geometryRaw) {
  const parsed = parseGeometryValue(geometryRaw);
  if (!parsed) {
    return [];
  }

  if (parsed?.type === "Feature" && parsed.geometry) {
    return extractPolygonCoordinateSets(parsed.geometry);
  }

  if (parsed?.geometry) {
    const geometryResult = extractPolygonCoordinateSets(parsed.geometry);
    if (geometryResult.length) {
      return geometryResult;
    }
  }

  if (parsed?.type === "Polygon" && Array.isArray(parsed.coordinates)) {
    return [
      parsed.coordinates
        .map((ring) => normalizeCoordinateSet(ring))
        .filter((ring) => ring.length >= 3)
    ].filter((polygon) => polygon.length);
  }

  if (parsed?.type === "MultiPolygon" && Array.isArray(parsed.coordinates)) {
    return parsed.coordinates
      .map((polygon) =>
        polygon
          .map((ring) => normalizeCoordinateSet(ring))
          .filter((ring) => ring.length >= 3)
      )
      .filter((polygon) => polygon.length);
  }

  if (Array.isArray(parsed?.rings)) {
    const rings = parsed.rings
      .map((ring) => normalizeCoordinateSet(ring))
      .filter((ring) => ring.length >= 3);

    return rings.length ? [rings] : [];
  }

  if (Array.isArray(parsed)) {
    if (parsed.length && Array.isArray(parsed[0]) && Array.isArray(parsed[0][0])) {
      const polygon = parsed
        .map((ring) => normalizeCoordinateSet(ring))
        .filter((ring) => ring.length >= 3);

      return polygon.length ? [polygon] : [];
    }
  }

  return [];
}

export function toLatLngs(coordinates) {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates
    .map((point) => {
      const longitude = toNumber(point?.[0]);
      const latitude = toNumber(point?.[1]);

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }

      return [latitude, longitude];
    })
    .filter((point) => Array.isArray(point));
}

export function ensureClosedPolygonLatLngs(latLngs) {
  if (!Array.isArray(latLngs) || !latLngs.length) {
    return [];
  }

  const firstPoint = latLngs[0];
  const lastPoint = latLngs[latLngs.length - 1];

  if (areLatLngsEqual(firstPoint, lastPoint)) {
    return [...latLngs];
  }

  return [...latLngs, firstPoint];
}

export function areLatLngsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  return (
    Math.abs(Number(left[0]) - Number(right[0])) <= GEOMETRY_EPSILON &&
    Math.abs(Number(left[1]) - Number(right[1])) <= GEOMETRY_EPSILON
  );
}

export function doesFeatureIntersectLasso(feature, polygonLatLngs) {
  if (!feature || !Array.isArray(polygonLatLngs) || polygonLatLngs.length < 4) {
    return false;
  }

  if (feature.geometryType === "point") {
    const pointLatLng = [toNumber(feature.latitude), toNumber(feature.longitude)];
    if (!Number.isFinite(pointLatLng[0]) || !Number.isFinite(pointLatLng[1])) {
      return false;
    }

    return isPointInsidePolygon(pointLatLng, polygonLatLngs);
  }

  if (feature.geometryType === "polyline") {
    const coordinateSets = extractPolylineCoordinateSets(feature.geometryRaw);
    return coordinateSets.some((coordinateSet) => {
      const latLngs = toLatLngs(coordinateSet);
      return doesLatLngPolylineIntersectPolygon(latLngs, polygonLatLngs);
    });
  }

  return false;
}

export function doesLatLngPolylineIntersectPolygon(latLngs, polygonLatLngs) {
  if (!Array.isArray(latLngs) || latLngs.length < 2 || !Array.isArray(polygonLatLngs)) {
    return false;
  }

  if (latLngs.some((pointLatLng) => isPointInsidePolygon(pointLatLng, polygonLatLngs))) {
    return true;
  }

  if (polygonLatLngs.some((polygonPoint) => isPointOnPolyline(polygonPoint, latLngs))) {
    return true;
  }

  const polygonEdges = buildLatLngSegmentPairs(polygonLatLngs);

  for (let index = 0; index < latLngs.length - 1; index += 1) {
    const lineStart = latLngs[index];
    const lineEnd = latLngs[index + 1];

    for (let edgeIndex = 0; edgeIndex < polygonEdges.length; edgeIndex += 1) {
      const polygonEdge = polygonEdges[edgeIndex];
      if (doLatLngSegmentsIntersect(lineStart, lineEnd, polygonEdge.start, polygonEdge.end)) {
        return true;
      }
    }
  }

  return false;
}

export function buildLatLngSegmentPairs(latLngs) {
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

export function isPointInsidePolygon(pointLatLng, polygonLatLngs) {
  if (!Array.isArray(pointLatLng) || !Array.isArray(polygonLatLngs) || polygonLatLngs.length < 4) {
    return false;
  }

  if (isPointOnPolyline(pointLatLng, polygonLatLngs)) {
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

export function isPointOnPolyline(pointLatLng, lineLatLngs) {
  if (!Array.isArray(pointLatLng) || !Array.isArray(lineLatLngs) || lineLatLngs.length < 2) {
    return false;
  }

  for (let index = 0; index < lineLatLngs.length - 1; index += 1) {
    if (isPointOnLatLngSegment(pointLatLng, lineLatLngs[index], lineLatLngs[index + 1])) {
      return true;
    }
  }

  return false;
}

export function isPointOnLatLngSegment(pointLatLng, segmentStart, segmentEnd) {
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

export function doLatLngSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientation = getLatLngOrientation(firstStart, firstEnd, secondStart);
  const secondOrientation = getLatLngOrientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = getLatLngOrientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = getLatLngOrientation(secondStart, secondEnd, firstEnd);

  if (firstOrientation !== secondOrientation && thirdOrientation !== fourthOrientation) {
    return true;
  }

  if (firstOrientation === 0 && isPointOnLatLngSegment(secondStart, firstStart, firstEnd)) {
    return true;
  }
  if (secondOrientation === 0 && isPointOnLatLngSegment(secondEnd, firstStart, firstEnd)) {
    return true;
  }
  if (thirdOrientation === 0 && isPointOnLatLngSegment(firstStart, secondStart, secondEnd)) {
    return true;
  }
  if (fourthOrientation === 0 && isPointOnLatLngSegment(firstEnd, secondStart, secondEnd)) {
    return true;
  }

  return false;
}

export function getLatLngOrientation(startPoint, middlePoint, endPoint) {
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

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : NaN;
}
