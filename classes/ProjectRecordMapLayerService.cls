public with sharing class ProjectRecordMapLayerService {
    private static final Integer MAX_LAYER_RECORDS = ProjectRecordMapController.MAX_LAYER_RECORDS;
    private static final String SUPPORTED_LAYER_TYPE = ProjectRecordMapController.SUPPORTED_LAYER_TYPE;
    private static final String WORK_LOG_OBJECT_API = ProjectRecordMapController.WORK_LOG_OBJECT_API;
    private static final String SEGMENT_OBJECT_API = ProjectRecordMapController.SEGMENT_OBJECT_API;
    private static final String FEATURE_PLA_FIELD = ProjectRecordMapController.FEATURE_PLA_FIELD;
    private static final String WORK_LOG_GIS_PATH_FIELD = ProjectRecordMapController.WORK_LOG_GIS_PATH_FIELD;
    private static final String SEGMENT_GEOMETRY_FIELD_API = ProjectRecordMapController.SEGMENT_GEOMETRY_FIELD_API;
    private static final String WORK_LOG_FALLBACK_LAT_FIELD = ProjectRecordMapController.WORK_LOG_FALLBACK_LAT_FIELD;
    private static final String WORK_LOG_FALLBACK_LNG_FIELD = ProjectRecordMapController.WORK_LOG_FALLBACK_LNG_FIELD;

    private static final Pattern SAFE_FIELD_PATH_PATTERN =
        Pattern.compile('^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*$');

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

    private class ResolvedFilterFieldDescriptor {
        public String path;
        public String label;
        public String dataType;

        public ResolvedFilterFieldDescriptor(String path, String label, String dataType) {
            this.path = path;
            this.label = label;
            this.dataType = dataType;
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

    private class FieldPathCandidate {
        public String rawPath;
        public String source;

        public FieldPathCandidate(String rawPath, String source) {
            this.rawPath = rawPath;
            this.source = source;
        }
    }

    private class ResolvedFieldPathWithSource {
        public String path;
        public String label;
        public String source;

        public ResolvedFieldPathWithSource(String path, String label, String source) {
            this.path = path;
            this.label = label;
            this.source = source;
        }
    }

    public static ProjectRecordMapController.MapResponse getProjectMapData(
        ProjectRecordMapController.MapRequest request
    ) {
        if (request == null) {
            throw handledException('Request payload is required.');
        }
        if (request.projectId == null) {
            throw handledException('Project Id is required.');
        }

        List<RequestedLayerSlot> requestedSlots = buildRequestedLayerSlots(request);
        Boolean hasExplicitLayerSelection = !requestedSlots.isEmpty();

        ProjectRecordMapController.MapResponse response =
            new ProjectRecordMapController.MapResponse();
        response.projectId = request.projectId;
        response.generatedAtIso = Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
        response.layers = new List<ProjectRecordMapController.LayerSlotResponse>();

        Map<Id, sitetracker__Map_Layer__c> mapLayersById = new Map<Id, sitetracker__Map_Layer__c>();

        if (hasExplicitLayerSelection) {
            Set<Id> mapLayerIds = new Set<Id>();
            for (RequestedLayerSlot slot : requestedSlots) {
                mapLayerIds.add(slot.mapLayerId);
            }
            mapLayersById = queryMapLayersById(mapLayerIds);
        } else {
            Integer slotCounter = 1;
            for (sitetracker__Map_Layer__c availableLayer : getAvailableProjectMapLayers()) {
                requestedSlots.add(
                    new RequestedLayerSlot(
                        slotCounter,
                        availableLayer.Id,
                        null,
                        null
                    )
                );
                mapLayersById.put(availableLayer.Id, availableLayer);
                slotCounter++;
            }
        }

        if (requestedSlots.isEmpty()) {
            return response;
        }

        for (RequestedLayerSlot slot : requestedSlots) {
            response.layers.add(
                processLayerSlot(
                    request.projectId,
                    slot,
                    mapLayersById.get(slot.mapLayerId),
                    request.layerFilterFieldSetApiName
                )
            );
        }

        return response;
    }

    private static ProjectRecordMapController.LayerSlotResponse processLayerSlot(
        Id projectId,
        RequestedLayerSlot slot,
        sitetracker__Map_Layer__c mapLayer,
        String layerFilterFieldSetApiName
    ) {
        ProjectRecordMapController.LayerSlotResponse layer = buildEmptyLayerResponse(slot);

        if (mapLayer == null) {
            layer.errorMessage = 'Map Layer record was not found.';
            return layer;
        }

        layer.mapLayerId = mapLayer.Id;
        layer.mapLayerName = mapLayer.Name;
        layer.layerType = mapLayer.sitetracker__Layer_Type__c;
        layer.layerStatus = mapLayer.sitetracker__Status__c;
        layer.isDefaultSelected = mapLayer.Default_Layer_on_Project_Map__c;
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

            ResolvedFieldPathWithSource relationshipField = resolveProjectLookupFieldPath(
                slot,
                mapLayer,
                mapObjectConfig,
                objectApiName,
                layer.warnings
            );
            layer.relationshipFieldPath = relationshipField.path;
            layer.relationshipFieldSource = relationshipField.source;

            ProjectRecordMapController.StyleConfig styleConfig = parseStyleConfig(
                mapLayer.sitetracker__Layer_Styling__c,
                objectApiName,
                layer.warnings
            );
            layer.styleConfig = styleConfig;

            List<ProjectRecordMapController.PopupFieldConfig> popupFields = parsePopupFields(
                mapLayer.sitetracker__Popup_Fields__c,
                objectApiName,
                layer.warnings
            );
            layer.popupFields = popupFields;

            List<ResolvedFilterFieldDescriptor> filterFieldDescriptors =
                getLayerFilterFieldDescriptors(
                    objectApiName,
                    layerFilterFieldSetApiName,
                    layer.warnings
                );

            if (filterFieldDescriptors.isEmpty() && String.isNotBlank(slot.filterFieldPathOverride)) {
                ResolvedFieldPath overrideFilterField = validateFieldPath(
                    objectApiName,
                    slot.filterFieldPathOverride,
                    'Filter field'
                );
                filterFieldDescriptors.add(
                    new ResolvedFilterFieldDescriptor(
                        overrideFilterField.path,
                        overrideFilterField.label,
                        null
                    )
                );
            }

            Set<String> selectFieldPaths = new Set<String>();
            selectFieldPaths.add('Id');
            selectFieldPaths.add('Name');

            for (ResolvedFilterFieldDescriptor descriptor : filterFieldDescriptors) {
                addFieldPathIfPresent(selectFieldPaths, descriptor.path);
            }

            addFieldPathIfPresent(selectFieldPaths, styleConfig == null ? null : styleConfig.fieldPath);

            if (isSupportedWorkLogSourceObject(objectApiName)) {
                addFieldPathIfPresent(selectFieldPaths, FEATURE_PLA_FIELD);
            }

            for (ProjectRecordMapController.PopupFieldConfig popupField : popupFields) {
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
                coordinatesFieldPath = resolveCoordinatesFieldPath(
                    objectApiName,
                    mapObjectConfig,
                    layer.warnings
                );
                addFieldPathIfPresent(selectFieldPaths, coordinatesFieldPath);

                if (objectApiName == SEGMENT_OBJECT_API) {
                    addFieldPathIfPresent(selectFieldPaths, SEGMENT_GEOMETRY_FIELD_API);
                }

                if (objectApiName == WORK_LOG_OBJECT_API && geometryType == 'polyline') {
                    addFieldPathIfPresent(selectFieldPaths, WORK_LOG_GIS_PATH_FIELD);
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

            Map<String, Set<String>> filterOptionsByFieldPath = new Map<String, Set<String>>();
            for (ResolvedFilterFieldDescriptor descriptor : filterFieldDescriptors) {
                filterOptionsByFieldPath.put(descriptor.path, new Set<String>());
            }

            Set<String> styleValueOptions = new Set<String>();
            Integer skippedCount = 0;

            for (SObject recordItem : records) {
                ProjectRecordMapController.FeatureResponse feature = buildFeatureResponse(
                    recordItem,
                    geometryType,
                    coordinatesFieldPath,
                    latitudeFieldPath,
                    longitudeFieldPath,
                    filterFieldDescriptors,
                    styleConfig == null ? null : styleConfig.fieldPath,
                    popupFields,
                    objectApiName
                );

                if (feature == null) {
                    skippedCount++;
                    continue;
                }

                layer.features.add(feature);
                collectFilterOptions(filterOptionsByFieldPath, feature.filterValues);
                collectNonBlankOption(styleValueOptions, feature.styleValue);
            }

            layer.filterFields = buildFilterFieldConfigs(
                filterFieldDescriptors,
                filterOptionsByFieldPath
            );

            if (!layer.filterFields.isEmpty()) {
                layer.filterFieldPath = layer.filterFields[0].fieldPath;
                layer.filterFieldLabel = layer.filterFields[0].fieldLabel;
                layer.filterFieldSource = String.isBlank(layerFilterFieldSetApiName)
                    ? (String.isNotBlank(slot.filterFieldPathOverride) ? 'componentOverride' : null)
                    : 'fieldSet';
                layer.filterOptions = layer.filterFields[0].options;
            }

            layer.queriedRecordCount = records.size();
            layer.renderedFeatureCount = layer.features.size();
            layer.skippedRecordCount = skippedCount;
            layer.styleValueOptions = toSortedList(styleValueOptions);
        } catch (Exception ex) {
            layer.errorMessage = reduceException(ex);
        }

        return layer;
    }

    private static ResolvedFieldPathWithSource resolveProjectLookupFieldPath(
        RequestedLayerSlot slot,
        sitetracker__Map_Layer__c mapLayer,
        sitetracker__Map_Object_Configuration__c mapObjectConfig,
        String objectApiName,
        List<String> warnings
    ) {
        List<FieldPathCandidate> candidates = new List<FieldPathCandidate>();

        if (String.isNotBlank(slot.relationshipFieldPathOverride)) {
            candidates.add(new FieldPathCandidate(
                slot.relationshipFieldPathOverride,
                'componentOverride'
            ));
        }
        if (String.isNotBlank(mapObjectConfig.Project_Lookup__c)) {
            candidates.add(new FieldPathCandidate(
                mapObjectConfig.Project_Lookup__c,
                'mapObjectConfiguration.projectLookup'
            ));
        }
        if (String.isNotBlank(mapLayer.sitetracker__Relationship_to_Use__c)) {
            candidates.add(new FieldPathCandidate(
                mapLayer.sitetracker__Relationship_to_Use__c,
                'mapLayer.relationshipToUse'
            ));
        }
        if (String.isNotBlank(mapLayer.sitetracker__Relationship__c)) {
            candidates.add(new FieldPathCandidate(
                mapLayer.sitetracker__Relationship__c,
                'mapLayer.relationship'
            ));
        }

        if (candidates.isEmpty()) {
            throw handledException(
                'No Project relationship field was provided for layer "' + mapLayer.Name + '".'
            );
        }

        return resolveFirstValidFieldPath(
            objectApiName,
            candidates,
            'Project relationship field',
            warnings
        );
    }

    private static String resolveCoordinatesFieldPath(
        String objectApiName,
        sitetracker__Map_Object_Configuration__c mapObjectConfig,
        List<String> warnings
    ) {
        List<FieldPathCandidate> candidates = new List<FieldPathCandidate>();

        if (String.isNotBlank(mapObjectConfig.sitetracker__Coordinates_Field__c)) {
            candidates.add(new FieldPathCandidate(
                mapObjectConfig.sitetracker__Coordinates_Field__c,
                'mapObjectConfiguration.coordinatesField'
            ));
        }

        if (objectApiName == SEGMENT_OBJECT_API) {
            candidates.add(new FieldPathCandidate(
                SEGMENT_GEOMETRY_FIELD_API,
                'segment.standardGeometryFallback'
            ));
        }

        if (objectApiName == WORK_LOG_OBJECT_API) {
            candidates.add(new FieldPathCandidate(
                WORK_LOG_GIS_PATH_FIELD,
                'workLog.standardGeometryFallback'
            ));
        }

        ResolvedFieldPathWithSource resolved = resolveFirstValidFieldPath(
            objectApiName,
            candidates,
            'Coordinates field',
            warnings
        );

        return resolved.path;
    }

    private static ResolvedFieldPathWithSource resolveFirstValidFieldPath(
        String objectApiName,
        List<FieldPathCandidate> candidates,
        String fieldLabel,
        List<String> warnings
    ) {
        Set<String> seenPaths = new Set<String>();

        for (FieldPathCandidate candidate : candidates) {
            String normalizedCandidatePath = normalizeString(candidate.rawPath);

            if (String.isBlank(normalizedCandidatePath) || seenPaths.contains(normalizedCandidatePath)) {
                continue;
            }

            seenPaths.add(normalizedCandidatePath);

            try {
                ResolvedFieldPath resolvedField = validateFieldPath(
                    objectApiName,
                    normalizedCandidatePath,
                    fieldLabel
                );

                return new ResolvedFieldPathWithSource(
                    resolvedField.path,
                    resolvedField.label,
                    candidate.source
                );
            } catch (Exception ex) {
                if (warnings != null) {
                    warnings.add(
                        'Skipped ' + candidate.source + ' value "' + normalizedCandidatePath +
                        '" for ' + fieldLabel + ': ' + reduceException(ex)
                    );
                }
            }
        }

        throw handledException(fieldLabel + ' could not be resolved on ' + objectApiName + '.');
    }

    private static Map<Id, sitetracker__Map_Layer__c> queryMapLayersById(Set<Id> mapLayerIds) {
        if (mapLayerIds == null || mapLayerIds.isEmpty()) {
            return new Map<Id, sitetracker__Map_Layer__c>();
        }

        return new Map<Id, sitetracker__Map_Layer__c>([
            SELECT
                Id,
                Name,
                Default_Layer_on_Project_Map__c,
                sitetracker__Layer_Type__c,
                sitetracker__Status__c,
                sitetracker__Layer_Styling__c,
                sitetracker__Popup_Fields__c,
                sitetracker__Relationship__c,
                sitetracker__Relationship_to_Use__c,
                sitetracker__Map_Object_Configuration__c,
                sitetracker__Map_Object_Configuration__r.Id,
                sitetracker__Map_Object_Configuration__r.Name,
                sitetracker__Map_Object_Configuration__r.Project_Lookup__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Map_Object__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Geometry_Type__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Coordinates_Field__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Latitude_Field__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Longitude_Field__c
            FROM sitetracker__Map_Layer__c
            WHERE Id IN :mapLayerIds
        ]);
    }

    private static List<sitetracker__Map_Layer__c> getAvailableProjectMapLayers() {
        return [
            SELECT
                Id,
                Name,
                Default_Layer_on_Project_Map__c,
                sitetracker__Layer_Type__c,
                sitetracker__Status__c,
                sitetracker__Layer_Styling__c,
                sitetracker__Popup_Fields__c,
                sitetracker__Relationship__c,
                sitetracker__Relationship_to_Use__c,
                sitetracker__Map_Object_Configuration__c,
                sitetracker__Map_Object_Configuration__r.Id,
                sitetracker__Map_Object_Configuration__r.Name,
                sitetracker__Map_Object_Configuration__r.Project_Lookup__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Map_Object__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Geometry_Type__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Coordinates_Field__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Latitude_Field__c,
                sitetracker__Map_Object_Configuration__r.sitetracker__Longitude_Field__c
            FROM sitetracker__Map_Layer__c
            WHERE sitetracker__Layer_Type__c = :SUPPORTED_LAYER_TYPE
            AND sitetracker__Map_Object_Configuration__c != null
            ORDER BY Default_Layer_on_Project_Map__c DESC, Name ASC
        ];
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

    private static ProjectRecordMapController.FeatureResponse buildFeatureResponse(
        SObject recordItem,
        String configuredGeometryType,
        String coordinatesFieldPath,
        String latitudeFieldPath,
        String longitudeFieldPath,
        List<ResolvedFilterFieldDescriptor> filterFieldDescriptors,
        String styleFieldPath,
        List<ProjectRecordMapController.PopupFieldConfig> popupFields,
        String objectApiName
    ) {
        ProjectRecordMapController.FeatureResponse feature =
            new ProjectRecordMapController.FeatureResponse();
        feature.recordId = (Id)recordItem.get('Id');
        feature.name = toDisplayString(recordItem.get('Name'));
        feature.filterValues = buildFeatureFilterValues(recordItem, filterFieldDescriptors);
        feature.filterValue = feature.filterValues.isEmpty() ? null : feature.filterValues[0].value;
        feature.styleValue = getPathValueAsString(recordItem, styleFieldPath);
        feature.productionLineAllocationId = (Id)getPathValue(recordItem, FEATURE_PLA_FIELD);
        feature.targetObjectApiName = objectApiName;
        feature.canCreateWorkLog = isSupportedWorkLogSourceObject(objectApiName) &&
            feature.productionLineAllocationId != null;
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
        String geometrySourceFieldPath = coordinatesFieldPath;

        if (String.isBlank(geometryRaw) && objectApiName == SEGMENT_OBJECT_API) {
            String segmentFallbackGeometry = getPathValueAsString(recordItem, SEGMENT_GEOMETRY_FIELD_API);
            if (String.isNotBlank(segmentFallbackGeometry)) {
                geometryRaw = segmentFallbackGeometry;
                geometrySourceFieldPath = SEGMENT_GEOMETRY_FIELD_API;
            }
        }

        if (String.isBlank(geometryRaw) && objectApiName == WORK_LOG_OBJECT_API) {
            String workLogFallbackGeometry = getPathValueAsString(recordItem, WORK_LOG_GIS_PATH_FIELD);
            if (String.isNotBlank(workLogFallbackGeometry)) {
                geometryRaw = workLogFallbackGeometry;
                geometrySourceFieldPath = WORK_LOG_GIS_PATH_FIELD;
            }
        }

        if (String.isNotBlank(geometryRaw)) {
            feature.geometryType = configuredGeometryType;
            feature.geometryRaw = geometryRaw;
            feature.geometrySourceFieldPath = geometrySourceFieldPath;
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

    private static List<ProjectRecordMapController.FeatureFilterValue> buildFeatureFilterValues(
        SObject recordItem,
        List<ResolvedFilterFieldDescriptor> filterFieldDescriptors
    ) {
        List<ProjectRecordMapController.FeatureFilterValue> filterValues =
            new List<ProjectRecordMapController.FeatureFilterValue>();

        if (recordItem == null || filterFieldDescriptors == null || filterFieldDescriptors.isEmpty()) {
            return filterValues;
        }

        for (ResolvedFilterFieldDescriptor descriptor : filterFieldDescriptors) {
            String rawValue = getPathValueAsString(recordItem, descriptor.path);
            if (String.isBlank(rawValue)) {
                continue;
            }

            for (String token : splitFilterValueTokens(rawValue)) {
                if (String.isBlank(token)) {
                    continue;
                }

                ProjectRecordMapController.FeatureFilterValue filterValue =
                    new ProjectRecordMapController.FeatureFilterValue();
                filterValue.fieldPath = descriptor.path;
                filterValue.value = token;
                filterValues.add(filterValue);
            }
        }

        return filterValues;
    }

    private static List<String> splitFilterValueTokens(String rawValue) {
        List<String> tokens = new List<String>();

        if (String.isBlank(rawValue)) {
            return tokens;
        }

        if (!rawValue.contains(';')) {
            tokens.add(rawValue);
            return tokens;
        }

        Set<String> seenTokens = new Set<String>();
        for (String rawToken : rawValue.split(';')) {
            String normalizedToken = normalizeString(rawToken);
            if (String.isBlank(normalizedToken) || seenTokens.contains(normalizedToken)) {
                continue;
            }

            seenTokens.add(normalizedToken);
            tokens.add(normalizedToken);
        }

        if (tokens.isEmpty()) {
            tokens.add(rawValue);
        }

        return tokens;
    }

    private static void collectFilterOptions(
        Map<String, Set<String>> targetOptionsByFieldPath,
        List<ProjectRecordMapController.FeatureFilterValue> featureFilterValues
    ) {
        if (targetOptionsByFieldPath == null || featureFilterValues == null) {
            return;
        }

        for (ProjectRecordMapController.FeatureFilterValue featureFilterValue : featureFilterValues) {
            if (featureFilterValue == null || String.isBlank(featureFilterValue.fieldPath)) {
                continue;
            }

            if (!targetOptionsByFieldPath.containsKey(featureFilterValue.fieldPath)) {
                targetOptionsByFieldPath.put(featureFilterValue.fieldPath, new Set<String>());
            }

            collectNonBlankOption(
                targetOptionsByFieldPath.get(featureFilterValue.fieldPath),
                featureFilterValue.value
            );
        }
    }

    private static List<ProjectRecordMapController.FilterFieldConfig> buildFilterFieldConfigs(
        List<ResolvedFilterFieldDescriptor> descriptors,
        Map<String, Set<String>> optionsByPath
    ) {
        List<ProjectRecordMapController.FilterFieldConfig> filterFields =
            new List<ProjectRecordMapController.FilterFieldConfig>();

        if (descriptors == null || descriptors.isEmpty()) {
            return filterFields;
        }

        for (ResolvedFilterFieldDescriptor descriptor : descriptors) {
            ProjectRecordMapController.FilterFieldConfig filterField =
                new ProjectRecordMapController.FilterFieldConfig();
            filterField.fieldPath = descriptor.path;
            filterField.fieldLabel = descriptor.label;
            filterField.dataType = descriptor.dataType;
            filterField.options = toSortedList(
                optionsByPath != null && optionsByPath.containsKey(descriptor.path)
                    ? optionsByPath.get(descriptor.path)
                    : new Set<String>()
            );
            filterFields.add(filterField);
        }

        return filterFields;
    }

    private static List<ResolvedFilterFieldDescriptor> getLayerFilterFieldDescriptors(
        String objectApiName,
        String fieldSetApiName,
        List<String> warnings
    ) {
        List<ResolvedFilterFieldDescriptor> descriptors = new List<ResolvedFilterFieldDescriptor>();
        String normalizedFieldSetApiName = normalizeString(fieldSetApiName);

        if (String.isBlank(normalizedFieldSetApiName)) {
            return descriptors;
        }

        Schema.DescribeSObjectResult describeResult = getObjectDescribe(objectApiName);
        Map<String, Schema.FieldSet> fieldSetMap = describeResult.fieldSets.getMap();

        if (!fieldSetMap.containsKey(normalizedFieldSetApiName)) {
            warnings.add(
                'Layer filters were not loaded because Field Set was not found on ' +
                objectApiName + ': ' + normalizedFieldSetApiName
            );
            return descriptors;
        }

        Map<String, Schema.SObjectField> fieldMap = describeResult.fields.getMap();
        Set<String> seenFieldApiNames = new Set<String>();

        for (Schema.FieldSetMember member : fieldSetMap.get(normalizedFieldSetApiName).getFields()) {
            String fieldApiName = normalizeString(member.getFieldPath());

            if (String.isBlank(fieldApiName) || seenFieldApiNames.contains(fieldApiName)) {
                continue;
            }

            if (fieldApiName.contains('.')) {
                warnings.add(
                    'Skipped filter field set entry "' + fieldApiName +
                    '" because relationship paths are not supported for Project Map filters.'
                );
                continue;
            }

            if (!fieldMap.containsKey(fieldApiName)) {
                warnings.add(
                    'Skipped filter field set entry "' + fieldApiName +
                    '" because the field was not found on ' + objectApiName + '.'
                );
                continue;
            }

            Schema.DescribeFieldResult fieldDescribe = fieldMap.get(fieldApiName).getDescribe();
            if (!fieldDescribe.isAccessible()) {
                warnings.add(
                    'Skipped filter field "' + fieldDescribe.getLabel() +
                    '" because it is not accessible.'
                );
                continue;
            }

            seenFieldApiNames.add(fieldApiName);
            descriptors.add(
                new ResolvedFilterFieldDescriptor(
                    fieldApiName,
                    fieldDescribe.getLabel(),
                    String.valueOf(fieldDescribe.getType())
                )
            );
        }

        return descriptors;
    }

    private static List<ProjectRecordMapController.PopupValue> buildPopupValues(
        SObject recordItem,
        List<ProjectRecordMapController.PopupFieldConfig> popupFields
    ) {
        List<ProjectRecordMapController.PopupValue> popupValues =
            new List<ProjectRecordMapController.PopupValue>();

        for (ProjectRecordMapController.PopupFieldConfig popupField : popupFields) {
            String displayValue = getPathValueAsString(recordItem, popupField.valueFieldPath);
            if (String.isBlank(displayValue)) {
                continue;
            }

            ProjectRecordMapController.PopupValue popupValue =
                new ProjectRecordMapController.PopupValue();
            popupValue.label = popupField.label;
            popupValue.valueFieldPath = popupField.valueFieldPath;
            popupValue.dataType = popupField.dataType;
            popupValue.displayValue = displayValue;
            popupValues.add(popupValue);
        }

        return popupValues;
    }

    private static ProjectRecordMapController.StyleConfig parseStyleConfig(
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

            ProjectRecordMapController.StyleConfig styleConfig =
                new ProjectRecordMapController.StyleConfig();
            styleConfig.rawJson = rawJson;
            styleConfig.uniqueValueRules = new List<ProjectRecordMapController.StyleRule>();

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
                    ProjectRecordMapController.StyleRule rule =
                        new ProjectRecordMapController.StyleRule();
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

    private static List<ProjectRecordMapController.PopupFieldConfig> parsePopupFields(
        String rawJson,
        String objectApiName,
        List<String> warnings
    ) {
        List<ProjectRecordMapController.PopupFieldConfig> popupFields =
            new List<ProjectRecordMapController.PopupFieldConfig>();

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

                ProjectRecordMapController.PopupFieldConfig popupField =
                    new ProjectRecordMapController.PopupFieldConfig();
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

    private static Boolean isSupportedWorkLogSourceObject(String objectApiName) {
        return objectApiName == ProjectRecordMapController.SITE_OBJECT_API ||
            objectApiName == SEGMENT_OBJECT_API;
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
                'Map Object Configuration on layer "' + mapLayer.Name +
                '" does not specify a Map Object.'
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

    private static List<RequestedLayerSlot> buildRequestedLayerSlots(
        ProjectRecordMapController.MapRequest request
    ) {
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

    private static ProjectRecordMapController.LayerSlotResponse buildEmptyLayerResponse(
        RequestedLayerSlot slot
    ) {
        ProjectRecordMapController.LayerSlotResponse response =
            new ProjectRecordMapController.LayerSlotResponse();
        response.slotNumber = slot.slotNumber;
        response.mapLayerId = slot.mapLayerId;
        response.isDefaultSelected = false;
        response.filterOptions = new List<String>();
        response.filterFields = new List<ProjectRecordMapController.FilterFieldConfig>();
        response.popupFields = new List<ProjectRecordMapController.PopupFieldConfig>();
        response.styleValueOptions = new List<String>();
        response.features = new List<ProjectRecordMapController.FeatureResponse>();
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
            throw handledException(fieldLabel + ' was not found: ' + normalizedPath);
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
