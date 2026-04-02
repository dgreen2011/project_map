public with sharing class ProjectRecordMapController {
    private static final Integer MAX_LAYER_RECORDS = 5000;
    private static final String SUPPORTED_LAYER_TYPE = 'Sitetracker Layer';
    private static final String WORK_LOG_OBJECT_API = 'sitetracker__Production_Work_Log__c';
    private static final String WORK_LOG_FALLBACK_LAT_FIELD = 'sitetracker__Location__Latitude__s';
    private static final String WORK_LOG_FALLBACK_LNG_FIELD = 'sitetracker__Location__Longitude__s';
    private static final Pattern SAFE_FIELD_PATH_PATTERN =
        Pattern.compile('^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*$');

    public class MapRequest {
        @AuraEnabled public Id projectId { get; set; }

        @AuraEnabled public Id mapLayerRecordId1 { get; set; }
        @AuraEnabled public Id mapLayerRecordId2 { get; set; }
        @AuraEnabled public Id mapLayerRecordId3 { get; set; }
        @AuraEnabled public Id mapLayerRecordId4 { get; set; }
        @AuraEnabled public Id mapLayerRecordId5 { get; set; }

        @AuraEnabled public String relationshipFieldPathOverride1 { get; set; }
        @AuraEnabled public String relationshipFieldPathOverride2 { get; set; }
        @AuraEnabled public String relationshipFieldPathOverride3 { get; set; }
        @AuraEnabled public String relationshipFieldPathOverride4 { get; set; }
        @AuraEnabled public String relationshipFieldPathOverride5 { get; set; }

        // Optional. This supports your earlier "RUS Code" style filtering ask on the map.
        @AuraEnabled public String filterFieldPathOverride1 { get; set; }
        @AuraEnabled public String filterFieldPathOverride2 { get; set; }
        @AuraEnabled public String filterFieldPathOverride3 { get; set; }
        @AuraEnabled public String filterFieldPathOverride4 { get; set; }
        @AuraEnabled public String filterFieldPathOverride5 { get; set; }
    }

    public class MapResponse {
        @AuraEnabled public Id projectId { get; set; }
        @AuraEnabled public String generatedAtIso { get; set; }
        @AuraEnabled public List<LayerSlotResponse> layers { get; set; }
    }

    public class LayerSlotResponse {
        @AuraEnabled public Integer slotNumber { get; set; }
        @AuraEnabled public Id mapLayerId { get; set; }
        @AuraEnabled public String mapLayerName { get; set; }
        @AuraEnabled public String layerType { get; set; }
        @AuraEnabled public String layerStatus { get; set; }

        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String geometryType { get; set; }

        @AuraEnabled public String relationshipFieldPath { get; set; }
        @AuraEnabled public String relationshipFieldSource { get; set; }

        @AuraEnabled public String filterFieldPath { get; set; }
        @AuraEnabled public String filterFieldLabel { get; set; }
        @AuraEnabled public String filterFieldSource { get; set; }
        @AuraEnabled public List<String> filterOptions { get; set; }

        @AuraEnabled public String popupFieldsRawJson { get; set; }
        @AuraEnabled public List<PopupFieldConfig> popupFields { get; set; }

        @AuraEnabled public StyleConfig styleConfig { get; set; }
        @AuraEnabled public List<String> styleValueOptions { get; set; }

        @AuraEnabled public Integer queriedRecordCount { get; set; }
        @AuraEnabled public Integer renderedFeatureCount { get; set; }
        @AuraEnabled public Integer skippedRecordCount { get; set; }

        @AuraEnabled public List<String> warnings { get; set; }
        @AuraEnabled public String errorMessage { get; set; }
        @AuraEnabled public List<FeatureResponse> features { get; set; }
    }

    public class StyleConfig {
        @AuraEnabled public String rawJson { get; set; }
        @AuraEnabled public String fieldPath { get; set; }
        @AuraEnabled public String fieldLabel { get; set; }
        @AuraEnabled public String defaultSymbolJson { get; set; }
        @AuraEnabled public List<StyleRule> uniqueValueRules { get; set; }
    }

    public class StyleRule {
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String value { get; set; }
        @AuraEnabled public String symbolJson { get; set; }
    }

    public class PopupFieldConfig {
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String valueFieldPath { get; set; }
        @AuraEnabled public String dataType { get; set; }
        @AuraEnabled public String relationshipName { get; set; }
    }

    public class FeatureResponse {
        @AuraEnabled public Id recordId { get; set; }
        @AuraEnabled public String name { get; set; }

        @AuraEnabled public String geometryType { get; set; }
        @AuraEnabled public String geometryRaw { get; set; }
        @AuraEnabled public Decimal latitude { get; set; }
        @AuraEnabled public Decimal longitude { get; set; }
        @AuraEnabled public String geometrySourceFieldPath { get; set; }

        @AuraEnabled public String filterValue { get; set; }
        @AuraEnabled public String styleValue { get; set; }

        @AuraEnabled public List<PopupValue> popupValues { get; set; }
    }

    public class PopupValue {
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String valueFieldPath { get; set; }
        @AuraEnabled public String dataType { get; set; }
        @AuraEnabled public String displayValue { get; set; }
    }

    private class RequestedLayerSlot {
        public Integer slotNumber;
        public Id mapLayerId;
        public String relationshipFieldPathOverride;
        public String filterFieldPathOverride;

        public RequestedLayerSlot(
            Integer slotNumber,
            Id mapLayerId,
            String relationshipFieldPathOverride,
            String filterFieldPathOverride
        ) {
            this.slotNumber = slotNumber;
            this.mapLayerId = mapLayerId;
            this.relationshipFieldPathOverride = relationshipFieldPathOverride;
            this.filterFieldPathOverride = filterFieldPathOverride;
        }
    }

    private class ResolvedFieldPath {
        public String path;
        public String label;

        public ResolvedFieldPath(String path, String label) {
            this.path = path;
            this.label = label;
        }
    }

    private class RelationshipResolution {
        public Schema.DescribeFieldResult fieldDescribe;
        public Schema.DescribeSObjectResult relatedDescribe;

        public RelationshipResolution(
            Schema.DescribeFieldResult fieldDescribe,
            Schema.DescribeSObjectResult relatedDescribe
        ) {
            this.fieldDescribe = fieldDescribe;
            this.relatedDescribe = relatedDescribe;
        }
    }

    @AuraEnabled(cacheable=true)
    public static MapResponse getProjectMapData(MapRequest request) {
        if (request == null) {
            throw handledException('Request payload is required.');
        }
        if (request.projectId == null) {
            throw handledException('Project Id is required.');
        }

        List<RequestedLayerSlot> requestedSlots = buildRequestedLayerSlots(request);

        MapResponse response = new MapResponse();
        response.projectId = request.projectId;
        response.generatedAtIso = Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
        response.layers = new List<LayerSlotResponse>();

        if (requestedSlots.isEmpty()) {
            return response;
        }

        Set<Id> mapLayerIds = new Set<Id>();
        for (RequestedLayerSlot slot : requestedSlots) {
            mapLayerIds.add(slot.mapLayerId);
        }

        Map<Id, sitetracker__Map_Layer__c> mapLayersById = new Map<Id, sitetracker__Map_Layer__c>([
            SELECT
                Id,
                Name,
                sitetracker__Layer_Type__c,
                sitetracker__Status__c,
                sitetracker__Layer_Styling__c,
                sitetracker__Popup_Fields__c,
                sitetracker__Relationship__c,
                sitetracker__Relationship_to_Use__c,
                sitetracker__Map_Object_Configuration__c,
                sitetracker__Map_Object_Configuration__r.Id,
                sitetracker__Map_Object_Configuration__r.Name,
                sitetracker__Map_Object_Configuration__r.sitetracker__Map_Object__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Geometry_Type__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Coordinates_Field__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Latitude_Field__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Longitude_Field__c
            FROM sitetracker__Map_Layer__c
            WHERE Id IN :mapLayerIds
        ]);

        for (RequestedLayerSlot slot : requestedSlots) {
            response.layers.add(processLayerSlot(request.projectId, slot, mapLayersById.get(slot.mapLayerId)));
        }

        return response;
    }

    private static LayerSlotResponse processLayerSlot(
        Id projectId,
        RequestedLayerSlot slot,
        sitetracker__Map_Layer__c mapLayer
    ) {
        LayerSlotResponse layer = buildEmptyLayerResponse(slot);

        if (mapLayer == null) {
            layer.errorMessage = 'Map Layer record was not found.';
            return layer;
        }

        layer.mapLayerId = mapLayer.Id;
        layer.mapLayerName = mapLayer.Name;
        layer.layerType = mapLayer.sitetracker__Layer_Type__c;
        layer.layerStatus = mapLayer.sitetracker__Status__c;
        layer.popupFieldsRawJson = mapLayer.sitetracker__Popup_Fields__c;

        try {
            validateMapLayer(mapLayer);

            sitetracker__Map_Object_Configuration__c mapObjectConfig =
                mapLayer.sitetracker__Map_Object_Configuration__r;

            String objectApiName = mapObjectConfig.sitetracker__Map_Object__c;
            String geometryType = normalizeGeometryType(
                mapObjectConfig.sitetracker__Geometry_Type__c,
                'Map Object Configuration geometry type'
            );

            layer.objectApiName = objectApiName;
            layer.geometryType = geometryType;

            String relationshipPathRaw = firstNonBlank(
                slot.relationshipFieldPathOverride,
                mapLayer.sitetracker__Relationship_to_Use__c,
                mapLayer.sitetracker__Relationship__c
            );

            if (String.isBlank(relationshipPathRaw)) {
                throw handledException(
                    'No Project relationship field was provided for layer "' + mapLayer.Name + '".'
                );
            }

            layer.relationshipFieldSource =
                !String.isBlank(slot.relationshipFieldPathOverride)
                    ? 'componentOverride'
                    : (!String.isBlank(mapLayer.sitetracker__Relationship_to_Use__c)
                        ? 'mapLayer.relationshipToUse'
                        : 'mapLayer.relationship');

            ResolvedFieldPath relationshipField = validateFieldPath(
                objectApiName,
                relationshipPathRaw,
                'Project relationship field'
            );
            layer.relationshipFieldPath = relationshipField.path;

            StyleConfig styleConfig = parseStyleConfig(
                mapLayer.sitetracker__Layer_Styling__c,
                objectApiName,
                layer.warnings
            );
            layer.styleConfig = styleConfig;

            List<PopupFieldConfig> popupFields = parsePopupFields(
                mapLayer.sitetracker__Popup_Fields__c,
                objectApiName,
                layer.warnings
            );
            layer.popupFields = popupFields;

            String filterPathRaw = firstNonBlank(
                slot.filterFieldPathOverride,
                styleConfig == null ? null : styleConfig.fieldPath
            );

            ResolvedFieldPath filterField = null;
            if (!String.isBlank(filterPathRaw)) {
                filterField = validateFieldPath(
                    objectApiName,
                    filterPathRaw,
                    'Filter field'
                );
                layer.filterFieldPath = filterField.path;
                layer.filterFieldLabel = filterField.label;
                layer.filterFieldSource =
                    !String.isBlank(slot.filterFieldPathOverride)
                        ? 'componentOverride'
                        : 'layerStyling.field';
            }

            Set<String> selectFieldPaths = new Set<String>();
            selectFieldPaths.add('Id');
            selectFieldPaths.add('Name');

            addFieldPathIfPresent(selectFieldPaths, filterField == null ? null : filterField.path);
            addFieldPathIfPresent(selectFieldPaths, styleConfig == null ? null : styleConfig.fieldPath);

            for (PopupFieldConfig popupField : popupFields) {
                addFieldPathIfPresent(selectFieldPaths, popupField.valueFieldPath);
            }

            String coordinatesFieldPath = null;
            String latitudeFieldPath = null;
            String longitudeFieldPath = null;

            if (geometryType == 'point') {
                latitudeFieldPath = validateFieldPath(
                    objectApiName,
                    mapObjectConfig.sitetracker__Latitude_Field__c,
                    'Latitude field'
                ).path;
                longitudeFieldPath = validateFieldPath(
                    objectApiName,
                    mapObjectConfig.sitetracker__Longitude_Field__c,
                    'Longitude field'
                ).path;

                addFieldPathIfPresent(selectFieldPaths, latitudeFieldPath);
                addFieldPathIfPresent(selectFieldPaths, longitudeFieldPath);
            } else {
                coordinatesFieldPath = validateFieldPath(
                    objectApiName,
                    mapObjectConfig.sitetracker__Coordinates_Field__c,
                    'Coordinates field'
                ).path;
                addFieldPathIfPresent(selectFieldPaths, coordinatesFieldPath);

                if (objectApiName == WORK_LOG_OBJECT_API) {
                    addFieldPathIfPresent(selectFieldPaths, WORK_LOG_FALLBACK_LAT_FIELD);
                    addFieldPathIfPresent(selectFieldPaths, WORK_LOG_FALLBACK_LNG_FIELD);
                }
            }

            List<SObject> records = queryLayerRecords(
                objectApiName,
                relationshipField.path,
                projectId,
                selectFieldPaths
            );

            Set<String> filterOptions = new Set<String>();
            Set<String> styleValueOptions = new Set<String>();
            Integer skippedCount = 0;

            for (SObject recordItem : records) {
                FeatureResponse feature = buildFeatureResponse(
                    recordItem,
                    geometryType,
                    coordinatesFieldPath,
                    latitudeFieldPath,
                    longitudeFieldPath,
                    filterField == null ? null : filterField.path,
                    styleConfig == null ? null : styleConfig.fieldPath,
                    popupFields,
                    objectApiName
                );

                if (feature == null) {
                    skippedCount++;
                    continue;
                }

                layer.features.add(feature);
                collectNonBlankOption(filterOptions, feature.filterValue);
                collectNonBlankOption(styleValueOptions, feature.styleValue);
            }

            layer.queriedRecordCount = records.size();
            layer.renderedFeatureCount = layer.features.size();
            layer.skippedRecordCount = skippedCount;
            layer.filterOptions = toSortedList(filterOptions);
            layer.styleValueOptions = toSortedList(styleValueOptions);
        } catch (Exception ex) {
            layer.errorMessage = reduceException(ex);
        }

        return layer;
    }

    private static List<SObject> queryLayerRecords(
        String objectApiName,
        String relationshipFieldPath,
        Id projectId,
        Set<String> selectFieldPaths
    ) {
        List<String> orderedSelectPaths = new List<String>();
        orderedSelectPaths.addAll(selectFieldPaths);
        orderedSelectPaths.sort();

        String soql =
            'SELECT ' + String.join(orderedSelectPaths, ', ') +
            ' FROM ' + objectApiName +
            ' WHERE ' + relationshipFieldPath + ' = :projectId' +
            ' ORDER BY Name' +
            ' LIMIT ' + String.valueOf(MAX_LAYER_RECORDS);

        return Database.query(soql);
    }

    private static FeatureResponse buildFeatureResponse(
        SObject recordItem,
        String configuredGeometryType,
        String coordinatesFieldPath,
        String latitudeFieldPath,
        String longitudeFieldPath,
        String filterFieldPath,
        String styleFieldPath,
        List<PopupFieldConfig> popupFields,
        String objectApiName
    ) {
        FeatureResponse feature = new FeatureResponse();
        feature.recordId = (Id)recordItem.get('Id');
        feature.name = toDisplayString(recordItem.get('Name'));
        feature.filterValue = getPathValueAsString(recordItem, filterFieldPath);
        feature.styleValue = getPathValueAsString(recordItem, styleFieldPath);
        feature.popupValues = buildPopupValues(recordItem, popupFields);

        if (configuredGeometryType == 'point') {
            Decimal latitude = getPathValueAsDecimal(recordItem, latitudeFieldPath);
            Decimal longitude = getPathValueAsDecimal(recordItem, longitudeFieldPath);

            if (latitude == null || longitude == null) {
                return null;
            }

            feature.geometryType = 'point';
            feature.latitude = latitude;
            feature.longitude = longitude;
            feature.geometrySourceFieldPath = latitudeFieldPath + ' / ' + longitudeFieldPath;
            return feature;
        }

        String geometryRaw = getPathValueAsString(recordItem, coordinatesFieldPath);

        if (String.isNotBlank(geometryRaw)) {
            feature.geometryType = configuredGeometryType;
            feature.geometryRaw = geometryRaw;
            feature.geometrySourceFieldPath = coordinatesFieldPath;
            return feature;
        }

        if (objectApiName == WORK_LOG_OBJECT_API && configuredGeometryType == 'polyline') {
            Decimal fallbackLatitude = getPathValueAsDecimal(recordItem, WORK_LOG_FALLBACK_LAT_FIELD);
            Decimal fallbackLongitude = getPathValueAsDecimal(recordItem, WORK_LOG_FALLBACK_LNG_FIELD);

            if (fallbackLatitude != null && fallbackLongitude != null) {
                feature.geometryType = 'point';
                feature.latitude = fallbackLatitude;
                feature.longitude = fallbackLongitude;
                feature.geometrySourceFieldPath =
                    WORK_LOG_FALLBACK_LAT_FIELD + ' / ' + WORK_LOG_FALLBACK_LNG_FIELD;
                return feature;
            }
        }

        return null;
    }

    private static List<PopupValue> buildPopupValues(
        SObject recordItem,
        List<PopupFieldConfig> popupFields
    ) {
        List<PopupValue> popupValues = new List<PopupValue>();

        for (PopupFieldConfig popupField : popupFields) {
            String displayValue = getPathValueAsString(recordItem, popupField.valueFieldPath);
            if (String.isBlank(displayValue)) {
                continue;
            }

            PopupValue popupValue = new PopupValue();
            popupValue.label = popupField.label;
            popupValue.valueFieldPath = popupField.valueFieldPath;
            popupValue.dataType = popupField.dataType;
            popupValue.displayValue = displayValue;
            popupValues.add(popupValue);
        }

        return popupValues;
    }

    private static StyleConfig parseStyleConfig(
        String rawJson,
        String objectApiName,
        List<String> warnings
    ) {
        if (String.isBlank(rawJson)) {
            return null;
        }

        try {
            Object parsed = JSON.deserializeUntyped(rawJson);
            if (!(parsed instanceof Map<String, Object>)) {
                warnings.add('Layer styling JSON is not a valid object.');
                return null;
            }

            Map<String, Object> styleMap = (Map<String, Object>)parsed;

            StyleConfig styleConfig = new StyleConfig();
            styleConfig.rawJson = rawJson;
            styleConfig.uniqueValueRules = new List<StyleRule>();

            String fieldPathRaw = asString(styleMap.get('field'));
            if (String.isNotBlank(fieldPathRaw)) {
                ResolvedFieldPath styleField = validateFieldPath(
                    objectApiName,
                    fieldPathRaw,
                    'Layer styling field'
                );
                styleConfig.fieldPath = styleField.path;
                styleConfig.fieldLabel = styleField.label;
            }

            if (styleMap.containsKey('symbol')) {
                styleConfig.defaultSymbolJson = JSON.serialize(styleMap.get('symbol'));
            } else if (styleMap.containsKey('type')) {
                styleConfig.defaultSymbolJson = JSON.serialize(styleMap);
            }

            Object uniqueValueInfos = styleMap.get('uniqueValueInfos');
            if (uniqueValueInfos instanceof List<Object>) {
                for (Object item : (List<Object>)uniqueValueInfos) {
                    if (!(item instanceof Map<String, Object>)) {
                        continue;
                    }

                    Map<String, Object> info = (Map<String, Object>)item;
                    StyleRule rule = new StyleRule();
                    rule.label = asString(info.get('label'));
                    rule.value = asString(info.get('value'));

                    if (info.containsKey('symbol')) {
                        rule.symbolJson = JSON.serialize(info.get('symbol'));
                    }

                    styleConfig.uniqueValueRules.add(rule);
                }
            }

            return styleConfig;
        } catch (Exception ex) {
            warnings.add('Layer styling JSON could not be parsed: ' + reduceException(ex));
            return null;
        }
    }

    private static List<PopupFieldConfig> parsePopupFields(
        String rawJson,
        String objectApiName,
        List<String> warnings
    ) {
        List<PopupFieldConfig> popupFields = new List<PopupFieldConfig>();

        if (String.isBlank(rawJson)) {
            return popupFields;
        }

        try {
            Object parsed = JSON.deserializeUntyped(rawJson);
            if (!(parsed instanceof List<Object>)) {
                warnings.add('Popup Fields JSON is not a valid array.');
                return popupFields;
            }

            for (Object item : (List<Object>)parsed) {
                if (!(item instanceof Map<String, Object>)) {
                    continue;
                }

                Map<String, Object> popupMap = (Map<String, Object>)item;
                String valueFieldPathRaw = asString(popupMap.get('value'));

                if (String.isBlank(valueFieldPathRaw)) {
                    continue;
                }

                ResolvedFieldPath popupValueField = validateFieldPath(
                    objectApiName,
                    valueFieldPathRaw,
                    'Popup field value'
                );

                PopupFieldConfig popupField = new PopupFieldConfig();
                popupField.label = firstNonBlank(
                    asString(popupMap.get('label')),
                    popupValueField.label
                );
                popupField.valueFieldPath = popupValueField.path;
                popupField.dataType = asString(popupMap.get('dataType'));
                popupField.relationshipName = asString(popupMap.get('relationshipName'));

                popupFields.add(popupField);
            }
        } catch (Exception ex) {
            warnings.add('Popup Fields JSON could not be parsed: ' + reduceException(ex));
        }

        return popupFields;
    }

    private static void validateMapLayer(sitetracker__Map_Layer__c mapLayer) {
        if (mapLayer.sitetracker__Layer_Type__c != SUPPORTED_LAYER_TYPE) {
            throw handledException(
                'Map Layer "' + mapLayer.Name + '" is "' + mapLayer.sitetracker__Layer_Type__c +
                '" and is not supported by this component. Use Sitetracker Layer records only.'
            );
        }

        if (mapLayer.sitetracker__Map_Object_Configuration__c == null ||
            mapLayer.sitetracker__Map_Object_Configuration__r == null) {
            throw handledException(
                'Map Layer "' + mapLayer.Name + '" does not have a Map Object Configuration.'
            );
        }

        if (String.isBlank(mapLayer.sitetracker__Map_Object_Configuration__r.sitetracker__Map_Object__c)) {
            throw handledException(
                'Map Object Configuration on layer "' + mapLayer.Name + '" does not specify a Map Object.'
            );
        }
    }

    private static String normalizeGeometryType(String rawValue, String fieldLabel) {
        String normalized = normalizeString(rawValue);
        if (String.isBlank(normalized)) {
            throw handledException(fieldLabel + ' is required.');
        }

        String lowerValue = normalized.toLowerCase();

        if (lowerValue == 'point') {
            return 'point';
        }
        if (lowerValue == 'polyline') {
            return 'polyline';
        }
        if (lowerValue == 'polygon') {
            return 'polygon';
        }

        throw handledException(fieldLabel + ' is not supported: ' + rawValue);
    }

    private static List<RequestedLayerSlot> buildRequestedLayerSlots(MapRequest request) {
        List<RequestedLayerSlot> slots = new List<RequestedLayerSlot>();

        addRequestedSlot(
            slots,
            1,
            request.mapLayerRecordId1,
            request.relationshipFieldPathOverride1,
            request.filterFieldPathOverride1
        );
        addRequestedSlot(
            slots,
            2,
            request.mapLayerRecordId2,
            request.relationshipFieldPathOverride2,
            request.filterFieldPathOverride2
        );
        addRequestedSlot(
            slots,
            3,
            request.mapLayerRecordId3,
            request.relationshipFieldPathOverride3,
            request.filterFieldPathOverride3
        );
        addRequestedSlot(
            slots,
            4,
            request.mapLayerRecordId4,
            request.relationshipFieldPathOverride4,
            request.filterFieldPathOverride4
        );
        addRequestedSlot(
            slots,
            5,
            request.mapLayerRecordId5,
            request.relationshipFieldPathOverride5,
            request.filterFieldPathOverride5
        );

        return slots;
    }

    private static void addRequestedSlot(
        List<RequestedLayerSlot> slots,
        Integer slotNumber,
        Id mapLayerId,
        String relationshipFieldPathOverride,
        String filterFieldPathOverride
    ) {
        if (mapLayerId == null) {
            return;
        }

        slots.add(new RequestedLayerSlot(
            slotNumber,
            mapLayerId,
            relationshipFieldPathOverride,
            filterFieldPathOverride
        ));
    }

    private static LayerSlotResponse buildEmptyLayerResponse(RequestedLayerSlot slot) {
        LayerSlotResponse response = new LayerSlotResponse();
        response.slotNumber = slot.slotNumber;
        response.mapLayerId = slot.mapLayerId;
        response.filterOptions = new List<String>();
        response.popupFields = new List<PopupFieldConfig>();
        response.styleValueOptions = new List<String>();
        response.features = new List<FeatureResponse>();
        response.warnings = new List<String>();
        response.queriedRecordCount = 0;
        response.renderedFeatureCount = 0;
        response.skippedRecordCount = 0;
        return response;
    }

    private static void addFieldPathIfPresent(Set<String> paths, String fieldPath) {
        if (String.isNotBlank(fieldPath)) {
            paths.add(fieldPath);
        }
    }

    private static void collectNonBlankOption(Set<String> target, String value) {
        if (String.isNotBlank(value)) {
            target.add(value);
        }
    }

    private static List<String> toSortedList(Set<String> values) {
        List<String> orderedValues = new List<String>();
        orderedValues.addAll(values);
        orderedValues.sort();
        return orderedValues;
    }

    private static ResolvedFieldPath validateFieldPath(
        String rootObjectApiName,
        String fieldPath,
        String fieldLabel
    ) {
        String normalizedPath = normalizeFieldPath(fieldPath, fieldLabel);

        List<String> segments = normalizedPath.split('\\.');
        Schema.DescribeSObjectResult currentDescribe = getObjectDescribe(rootObjectApiName);

        for (Integer index = 0; index < segments.size() - 1; index++) {
            RelationshipResolution relationship = resolveRelationshipByName(
                currentDescribe,
                segments[index],
                fieldLabel
            );
            currentDescribe = relationship.relatedDescribe;
        }

        String finalFieldName = segments[segments.size() - 1];
        Map<String, Schema.SObjectField> fieldMap = currentDescribe.fields.getMap();

        if (!fieldMap.containsKey(finalFieldName)) {
            throw handledException(
                fieldLabel + ' was not found: ' + normalizedPath
            );
        }

        Schema.DescribeFieldResult fieldDescribe = fieldMap.get(finalFieldName).getDescribe();

        return new ResolvedFieldPath(normalizedPath, fieldDescribe.getLabel());
    }

    private static RelationshipResolution resolveRelationshipByName(
        Schema.DescribeSObjectResult describeResult,
        String relationshipName,
        String fieldLabel
    ) {
        for (Schema.SObjectField fieldToken : describeResult.fields.getMap().values()) {
            Schema.DescribeFieldResult fieldDescribe = fieldToken.getDescribe();

            if (fieldDescribe.getType() != Schema.DisplayType.REFERENCE) {
                continue;
            }

            if (fieldDescribe.getRelationshipName() != relationshipName) {
                continue;
            }

            List<Schema.SObjectType> referencedTypes = fieldDescribe.getReferenceTo();
            if (referencedTypes == null || referencedTypes.isEmpty()) {
                break;
            }

            return new RelationshipResolution(
                fieldDescribe,
                referencedTypes[0].getDescribe()
            );
        }

        throw handledException(
            fieldLabel + ' contains an invalid relationship segment: ' + relationshipName
        );
    }

    private static Schema.DescribeSObjectResult getObjectDescribe(String objectApiName) {
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();

        if (!globalDescribe.containsKey(objectApiName)) {
            throw handledException('Object was not found: ' + objectApiName);
        }

        return globalDescribe.get(objectApiName).getDescribe();
    }

    private static String normalizeFieldPath(String fieldPath, String fieldLabel) {
        String normalized = normalizeString(fieldPath);

        if (String.isBlank(normalized)) {
            throw handledException(fieldLabel + ' is required.');
        }

        if (!SAFE_FIELD_PATH_PATTERN.matcher(normalized).matches()) {
            throw handledException(fieldLabel + ' is invalid: ' + fieldPath);
        }

        return normalized;
    }

    private static String getPathValueAsString(SObject recordItem, String fieldPath) {
        Object value = getPathValue(recordItem, fieldPath);
        return toDisplayString(value);
    }

    private static Decimal getPathValueAsDecimal(SObject recordItem, String fieldPath) {
        Object value = getPathValue(recordItem, fieldPath);
        if (value == null) {
            return null;
        }
        if (value instanceof Decimal) {
            return (Decimal)value;
        }
        if (value instanceof Integer || value instanceof Long || value instanceof Double) {
            return Decimal.valueOf(String.valueOf(value));
        }

        String textValue = String.valueOf(value);
        if (String.isBlank(textValue)) {
            return null;
        }

        return Decimal.valueOf(textValue);
    }

    private static Object getPathValue(SObject recordItem, String fieldPath) {
        if (recordItem == null || String.isBlank(fieldPath)) {
            return null;
        }

        List<String> segments = fieldPath.split('\\.');
        SObject currentRecord = recordItem;

        for (Integer index = 0; index < segments.size() - 1; index++) {
            if (currentRecord == null) {
                return null;
            }
            currentRecord = currentRecord.getSObject(segments[index]);
        }

        if (currentRecord == null) {
            return null;
        }

        return currentRecord.get(segments[segments.size() - 1]);
    }

    private static String toDisplayString(Object value) {
        if (value == null) {
            return null;
        }

        String stringValue = String.valueOf(value);
        return String.isBlank(stringValue) ? null : stringValue;
    }

    private static String asString(Object value) {
        if (value == null) {
            return null;
        }
        String stringValue = String.valueOf(value);
        return String.isBlank(stringValue) ? null : stringValue;
    }

    private static String normalizeString(String value) {
        return value == null ? null : value.trim();
    }

    private static String firstNonBlank(String firstValue, String secondValue) {
        return String.isNotBlank(firstValue) ? firstValue : secondValue;
    }

    private static String firstNonBlank(String firstValue, String secondValue, String thirdValue) {
        if (String.isNotBlank(firstValue)) {
            return firstValue;
        }
        if (String.isNotBlank(secondValue)) {
            return secondValue;
        }
        return thirdValue;
    }

    private static AuraHandledException handledException(String message) {
        return new AuraHandledException(message);
    }

    private static String reduceException(Exception ex) {
        if (ex == null) {
            return 'Unknown error.';
        }

        String message = ex.getMessage();
        return String.isBlank(message) ? 'Unknown error.' : message;
    }
}
