public with sharing class ProjectRecordMapController {
    private static final Integer MAX_LAYER_RECORDS = 5000;
    private static final String SUPPORTED_LAYER_TYPE = 'Sitetracker Layer';
    private static final String WORK_LOG_OBJECT_API = 'sitetracker__Production_Work_Log__c';
    private static final String SITE_OBJECT_API = 'sitetracker__Site__c';
    private static final String SEGMENT_OBJECT_API = 'sitetracker__Segment__c';
    private static final String FEATURE_PLA_FIELD = 'Production_Line_Allocation__c';
    private static final String DEFAULT_WORK_LOG_FIELD_SET = 'sitetracker__Create_Work_Logs_Form_GIS';
    private static final String WORK_LOG_GIS_PATH_FIELD = 'sitetracker__st_GIS_Path__c';
    private static final String SEGMENT_GEOMETRY_FIELD_API = 'sitetracker__Gis_Segment_Path__c';
    private static final String SEGMENT_TOTAL_LENGTH_FIELD_API = 'sitetracker__st_Total_Length__c';
    private static final String WORK_LOG_FALLBACK_LAT_FIELD = 'sitetracker__Location__Latitude__s';
    private static final String WORK_LOG_FALLBACK_LNG_FIELD = 'sitetracker__Location__Longitude__s';

    private static final String WORK_LOG_PROJECT_FIELD = 'sitetracker__Project__c';
    private static final String WORK_LOG_PLA_FIELD = 'sitetracker__Production_Line_Allocation__c';
    private static final String WORK_LOG_PPL_FIELD = 'sitetracker__st_Production_Plan_Line__c';
    private static final String WORK_LOG_SERVICE_FIELD = 'sitetracker__Item__c';
    private static final String WORK_LOG_SITE_FIELD = 'sitetracker__Site__c';
    private static final String WORK_LOG_SEGMENT_FIELD = 'sitetracker__Segment__c';
    private static final String WORK_LOG_START_DATE_FIELD = 'sitetracker__Start_Date__c';
    private static final String WORK_LOG_END_DATE_FIELD = 'sitetracker__End_Date__c';
    private static final String WORK_LOG_STATUS_FIELD = 'sitetracker__Status__c';
    private static final String WORK_LOG_JOB_FIELD = 'sitetracker__Job__c';
    private static final String WORK_LOG_ACTIVITY_FIELD = 'sitetracker__Activity__c';
    private static final String WORK_LOG_ACTUAL_RESOURCE_FIELD = 'sitetracker__Actual_Resource__c';
    private static final String WORK_LOG_COMMENTS_FIELD = 'sitetracker__Comments__c';
    private static final String WORK_LOG_BULK_CREATED_FIELD = 'Bulk_Created__c';
    private static final String WORK_LOG_STATUS_DRAFT = 'Draft';

    private static final List<String> WORK_LOG_QUANTITY_FIELD_CANDIDATES = new List<String>{
        'sitetracker__Quantity__c',
        'Quantity__c'
    };

    private static final Pattern SAFE_FIELD_PATH_PATTERN =
        Pattern.compile('^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)*$');

    public class MapRequest {
        @AuraEnabled public Id projectId { get; set; }
        @AuraEnabled public String layerFilterFieldSetApiName { get; set; }

        // Retained for backward compatibility with prior component configs.
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
        @AuraEnabled public Boolean isDefaultSelected { get; set; }

        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String geometryType { get; set; }

        @AuraEnabled public String relationshipFieldPath { get; set; }
        @AuraEnabled public String relationshipFieldSource { get; set; }

        @AuraEnabled public String filterFieldPath { get; set; }
        @AuraEnabled public String filterFieldLabel { get; set; }
        @AuraEnabled public String filterFieldSource { get; set; }
        @AuraEnabled public List<String> filterOptions { get; set; }

        @AuraEnabled public List<FilterFieldConfig> filterFields { get; set; }

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

    public class FilterFieldConfig {
        @AuraEnabled public String fieldPath { get; set; }
        @AuraEnabled public String fieldLabel { get; set; }
        @AuraEnabled public String dataType { get; set; }
        @AuraEnabled public List<String> options { get; set; }
    }

    public class FeatureFilterValue {
        @AuraEnabled public String fieldPath { get; set; }
        @AuraEnabled public String value { get; set; }
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
        @AuraEnabled public List<FeatureFilterValue> filterValues { get; set; }

        @AuraEnabled public String styleValue { get; set; }
        @AuraEnabled public Boolean canCreateWorkLog { get; set; }
        @AuraEnabled public Id productionLineAllocationId { get; set; }
        @AuraEnabled public String targetObjectApiName { get; set; }

        @AuraEnabled public List<PopupValue> popupValues { get; set; }
    }

    public class PopupValue {
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String valueFieldPath { get; set; }
        @AuraEnabled public String dataType { get; set; }
        @AuraEnabled public String displayValue { get; set; }
    }

    public class WorkLogLaunchResponse {
        @AuraEnabled public Id featureRecordId { get; set; }
        @AuraEnabled public String featureObjectApiName { get; set; }
        @AuraEnabled public String featureName { get; set; }
        @AuraEnabled public String workLogObjectApiName { get; set; }
        @AuraEnabled public String fieldSetApiName { get; set; }
        @AuraEnabled public String targetDetailFieldSetApiName { get; set; }
        @AuraEnabled public String statusValue { get; set; }
        @AuraEnabled public String startDateIso { get; set; }
        @AuraEnabled public String endDateIso { get; set; }
        @AuraEnabled public Id projectId { get; set; }
        @AuraEnabled public String projectName { get; set; }
        @AuraEnabled public Id productionLineAllocationId { get; set; }
        @AuraEnabled public String productionLineAllocationName { get; set; }
        @AuraEnabled public Id productionPlanLineId { get; set; }
        @AuraEnabled public Id serviceId { get; set; }
        @AuraEnabled public String serviceName { get; set; }
        @AuraEnabled public Id jobId { get; set; }
        @AuraEnabled public Id activityId { get; set; }
        @AuraEnabled public Id siteId { get; set; }
        @AuraEnabled public Id segmentId { get; set; }
        @AuraEnabled public String quantityFieldApiName { get; set; }
        @AuraEnabled public Decimal segmentTotalLength { get; set; }
        @AuraEnabled public String segmentGeometryRaw { get; set; }
        @AuraEnabled public Map<String, String> defaultValues { get; set; }
        @AuraEnabled public List<RecordDetailField> targetDetailFields { get; set; }
        @AuraEnabled public List<WorkLogFormField> formFields { get; set; }
        @AuraEnabled public List<String> warnings { get; set; }
    }

    public class RecordDetailField {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String displayValue { get; set; }
    }

    public class WorkLogFormField {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label { get; set; }
    }

    public class WorkLogFileUploadRequest {
        @AuraEnabled public String fileName { get; set; }
        @AuraEnabled public String base64Data { get; set; }
    }

    public class WorkLogFileUploadResult {
        @AuraEnabled public String fileName { get; set; }
        @AuraEnabled public Boolean success { get; set; }
        @AuraEnabled public String message { get; set; }
        @AuraEnabled public Id contentDocumentId { get; set; }
    }

    public class BulkWorkLogSelectionRequest {
        @AuraEnabled public Id featureRecordId { get; set; }
        @AuraEnabled public String featureObjectApiName { get; set; }
    }

    public class BulkWorkLogCreateRequest {
        @AuraEnabled public Id projectId { get; set; }
        @AuraEnabled public String workLogDateIso { get; set; }
        @AuraEnabled public Id actualResourceId { get; set; }
        @AuraEnabled public String comments { get; set; }
        @AuraEnabled public List<BulkWorkLogSelectionRequest> selections { get; set; }
    }

    public class BulkWorkLogCreateResult {
        @AuraEnabled public Integer requestedCount { get; set; }
        @AuraEnabled public Integer eligibleCount { get; set; }
        @AuraEnabled public Integer createdCount { get; set; }
        @AuraEnabled public Integer skippedCount { get; set; }
        @AuraEnabled public List<String> messages { get; set; }
        @AuraEnabled public List<String> createdWorkLogIds { get; set; }
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

    @AuraEnabled(cacheable=true)
    public static MapResponse getProjectMapData(MapRequest request) {
        if (request == null) {
            throw handledException('Request payload is required.');
        }
        if (request.projectId == null) {
            throw handledException('Project Id is required.');
        }

        List<RequestedLayerSlot> requestedSlots = buildRequestedLayerSlots(request);
        Boolean hasExplicitLayerSelection = !requestedSlots.isEmpty();

        MapResponse response = new MapResponse();
        response.projectId = request.projectId;
        response.generatedAtIso = Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');
        response.layers = new List<LayerSlotResponse>();

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

    @AuraEnabled
    public static WorkLogLaunchResponse getWorkLogLaunchConfig(
        Id featureRecordId,
        String featureObjectApiName,
        Id projectId,
        String fieldSetApiName,
        String targetDetailFieldSetApiName
    ) {
        if (featureRecordId == null) {
            throw handledException('Feature record Id is required.');
        }

        String normalizedObjectApiName = normalizeString(featureObjectApiName);
        if (!isSupportedWorkLogSourceObject(normalizedObjectApiName)) {
            throw handledException('Work Log creation is supported only for Site and Segment records.');
        }

        WorkLogLaunchResponse response = new WorkLogLaunchResponse();
        response.featureRecordId = featureRecordId;
        response.featureObjectApiName = normalizedObjectApiName;
        response.workLogObjectApiName = WORK_LOG_OBJECT_API;
        response.fieldSetApiName = String.isBlank(fieldSetApiName)
            ? DEFAULT_WORK_LOG_FIELD_SET
            : normalizeString(fieldSetApiName);
        response.targetDetailFieldSetApiName = normalizeString(targetDetailFieldSetApiName);
        response.statusValue = WORK_LOG_STATUS_DRAFT;
        response.startDateIso = String.valueOf(Date.today());
        response.endDateIso = String.valueOf(Date.today());
        response.defaultValues = new Map<String, String>();
        response.targetDetailFields = new List<RecordDetailField>();
        response.formFields = new List<WorkLogFormField>();
        response.warnings = new List<String>();

        if (normalizedObjectApiName == SITE_OBJECT_API) {
            sitetracker__Site__c siteRecord = [
                SELECT
                    Id,
                    Name,
                    Project__c,
                    Project__r.Name,
                    Production_Line_Allocation__c,
                    Production_Line_Allocation__r.Id,
                    Production_Line_Allocation__r.Name,
                    Production_Line_Allocation__r.sitetracker__Job__c,
                    Production_Line_Allocation__r.sitetracker__Activity__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__r.Name,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__r.Name
                FROM sitetracker__Site__c
                WHERE Id = :featureRecordId
                LIMIT 1
            ];

            response.featureName = siteRecord.Name;
            response.siteId = siteRecord.Id;
            populateWorkLogDefaultsFromFeature(
                response,
                projectId,
                siteRecord.Project__c,
                siteRecord.Project__r == null ? null : siteRecord.Project__r.Name,
                siteRecord.Production_Line_Allocation__c,
                siteRecord.Production_Line_Allocation__r
            );
        } else {
            sitetracker__Segment__c segmentRecord = [
                SELECT
                    Id,
                    Name,
                    Project__c,
                    Project__r.Name,
                    Production_Line_Allocation__c,
                    Production_Line_Allocation__r.Id,
                    Production_Line_Allocation__r.Name,
                    Production_Line_Allocation__r.sitetracker__Job__c,
                    Production_Line_Allocation__r.sitetracker__Activity__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__r.Name,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__r.Name,
                    sitetracker__Gis_Segment_Path__c,
                    sitetracker__st_Total_Length__c
                FROM sitetracker__Segment__c
                WHERE Id = :featureRecordId
                LIMIT 1
            ];

            response.featureName = segmentRecord.Name;
            response.segmentId = segmentRecord.Id;
            response.segmentGeometryRaw = segmentRecord.sitetracker__Gis_Segment_Path__c;
            response.segmentTotalLength = segmentRecord.sitetracker__st_Total_Length__c;
            populateWorkLogDefaultsFromFeature(
                response,
                projectId,
                segmentRecord.Project__c,
                segmentRecord.Project__r == null ? null : segmentRecord.Project__r.Name,
                segmentRecord.Production_Line_Allocation__c,
                segmentRecord.Production_Line_Allocation__r
            );
        }

        applyObjectSpecificWorkLogDefaults(response, normalizedObjectApiName);

        response.formFields = getCreateableFieldSetFields(
            WORK_LOG_OBJECT_API,
            response.fieldSetApiName,
            response.warnings
        );

        if (String.isNotBlank(response.targetDetailFieldSetApiName)) {
            response.targetDetailFields = getRecordDetailFields(
                featureRecordId,
                normalizedObjectApiName,
                response.targetDetailFieldSetApiName,
                response.warnings
            );
        }

        return response;
    }

    @AuraEnabled
    public static BulkWorkLogCreateResult createBulkWorkLogs(BulkWorkLogCreateRequest request) {
        if (request == null) {
            throw handledException('Bulk Work Log request is required.');
        }

        String normalizedDateIso = normalizeString(request.workLogDateIso);
        if (String.isBlank(normalizedDateIso)) {
            throw handledException('A valid Work Log date is required.');
        }

        Date workLogDate;
        try {
            workLogDate = Date.valueOf(normalizedDateIso);
        } catch (Exception ex) {
            throw handledException('A valid Work Log date is required.');
        }

        List<BulkWorkLogSelectionRequest> incomingSelections = request.selections == null
            ? new List<BulkWorkLogSelectionRequest>()
            : request.selections;

        if (incomingSelections.isEmpty()) {
            throw handledException('Select at least one Site or Segment before creating Work Logs.');
        }

        BulkWorkLogCreateResult result = new BulkWorkLogCreateResult();
        result.requestedCount = 0;
        result.eligibleCount = 0;
        result.createdCount = 0;
        result.skippedCount = 0;
        result.messages = new List<String>();
        result.createdWorkLogIds = new List<String>();

        Set<String> seenSelectionKeys = new Set<String>();
        List<BulkWorkLogSelectionRequest> orderedSelections = new List<BulkWorkLogSelectionRequest>();
        Set<Id> siteIds = new Set<Id>();
        Set<Id> segmentIds = new Set<Id>();

        for (BulkWorkLogSelectionRequest incomingSelection : incomingSelections) {
            if (incomingSelection == null || incomingSelection.featureRecordId == null) {
                result.skippedCount++;
                result.messages.add('Skipped a selected record because its identity was incomplete.');
                continue;
            }

            String normalizedObjectApiName = normalizeString(incomingSelection.featureObjectApiName);
            if (!isSupportedWorkLogSourceObject(normalizedObjectApiName)) {
                result.skippedCount++;
                result.messages.add(
                    'Skipped ' + firstNonBlank(normalizedObjectApiName, 'an unsupported record') +
                    ' because only Site and Segment records can be used to create Work Logs.'
                );
                continue;
            }

            String selectionKey = normalizedObjectApiName + '::' + String.valueOf(incomingSelection.featureRecordId);
            if (seenSelectionKeys.contains(selectionKey)) {
                continue;
            }

            seenSelectionKeys.add(selectionKey);

            BulkWorkLogSelectionRequest normalizedSelection = new BulkWorkLogSelectionRequest();
            normalizedSelection.featureRecordId = incomingSelection.featureRecordId;
            normalizedSelection.featureObjectApiName = normalizedObjectApiName;
            orderedSelections.add(normalizedSelection);

            if (normalizedObjectApiName == SITE_OBJECT_API) {
                siteIds.add(normalizedSelection.featureRecordId);
            } else if (normalizedObjectApiName == SEGMENT_OBJECT_API) {
                segmentIds.add(normalizedSelection.featureRecordId);
            }
        }

        result.requestedCount = orderedSelections.size();

        if (orderedSelections.isEmpty()) {
            return result;
        }

        Map<Id, sitetracker__Site__c> sitesById = siteIds.isEmpty()
            ? new Map<Id, sitetracker__Site__c>()
            : new Map<Id, sitetracker__Site__c>([
                SELECT
                    Id,
                    Name,
                    Project__c,
                    Project__r.Name,
                    Production_Line_Allocation__c,
                    Production_Line_Allocation__r.Id,
                    Production_Line_Allocation__r.Name,
                    Production_Line_Allocation__r.sitetracker__Job__c,
                    Production_Line_Allocation__r.sitetracker__Activity__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__r.Name,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__r.Name
                FROM sitetracker__Site__c
                WHERE Id IN :siteIds
            ]);

        Map<Id, sitetracker__Segment__c> segmentsById = segmentIds.isEmpty()
            ? new Map<Id, sitetracker__Segment__c>()
            : new Map<Id, sitetracker__Segment__c>([
                SELECT
                    Id,
                    Name,
                    Project__c,
                    Project__r.Name,
                    Production_Line_Allocation__c,
                    Production_Line_Allocation__r.Id,
                    Production_Line_Allocation__r.Name,
                    Production_Line_Allocation__r.sitetracker__Job__c,
                    Production_Line_Allocation__r.sitetracker__Activity__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Item__r.Name,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__c,
                    Production_Line_Allocation__r.sitetracker__Production_Plan_Line__r.sitetracker__Project__r.Name,
                    sitetracker__Gis_Segment_Path__c,
                    sitetracker__st_Total_Length__c
                FROM sitetracker__Segment__c
                WHERE Id IN :segmentIds
            ]);

        List<SObject> workLogsToInsert = new List<SObject>();
        List<String> workLogSourceLabels = new List<String>();

        for (BulkWorkLogSelectionRequest selection : orderedSelections) {
            String sourceLabel = buildWorkLogSourceLabel(
                selection.featureObjectApiName,
                null,
                selection.featureRecordId
            );

            try {
                WorkLogLaunchResponse workLogContext;

                if (selection.featureObjectApiName == SITE_OBJECT_API) {
                    sitetracker__Site__c siteRecord = sitesById.get(selection.featureRecordId);
                    if (siteRecord == null) {
                        throw handledException('Site was not found.');
                    }

                    sourceLabel = buildWorkLogSourceLabel(SITE_OBJECT_API, siteRecord.Name, siteRecord.Id);
                    workLogContext = buildBulkWorkLogContextForSite(siteRecord, request.projectId);
                } else {
                    sitetracker__Segment__c segmentRecord = segmentsById.get(selection.featureRecordId);
                    if (segmentRecord == null) {
                        throw handledException('Segment was not found.');
                    }

                    sourceLabel = buildWorkLogSourceLabel(SEGMENT_OBJECT_API, segmentRecord.Name, segmentRecord.Id);
                    workLogContext = buildBulkWorkLogContextForSegment(segmentRecord, request.projectId);
                }

                result.eligibleCount++;

                if (workLogContext.warnings != null) {
                    for (String warning : workLogContext.warnings) {
                        if (String.isNotBlank(warning)) {
                            result.messages.add(sourceLabel + ': ' + warning);
                        }
                    }
                }

                workLogsToInsert.add(
                    buildBulkWorkLogRecord(
                        workLogContext,
                        workLogDate,
                        request.actualResourceId,
                        request.comments
                    )
                );
                workLogSourceLabels.add(sourceLabel);
            } catch (Exception ex) {
                result.skippedCount++;
                result.messages.add(sourceLabel + ': ' + reduceException(ex));
            }
        }

        if (workLogsToInsert.isEmpty()) {
            return result;
        }

        Database.SaveResult[] saveResults = Database.insert(workLogsToInsert, false);

        for (Integer index = 0; index < saveResults.size(); index++) {
            Database.SaveResult saveResult = saveResults[index];

            if (saveResult.isSuccess()) {
                result.createdCount++;
                result.createdWorkLogIds.add(String.valueOf(saveResult.getId()));
            } else {
                result.skippedCount++;
                result.messages.add(
                    'Could not create a Work Log for ' + workLogSourceLabels[index] + ': ' +
                    reduceSaveErrors(saveResult.getErrors())
                );
            }
        }

        return result;
    }

    @AuraEnabled
    public static void linkUploadedFilesToRecord(List<Id> contentDocumentIds, Id linkedRecordId) {
        if (linkedRecordId == null || contentDocumentIds == null || contentDocumentIds.isEmpty()) {
            return;
        }

        Set<Id> documentIds = new Set<Id>(contentDocumentIds);
        Map<Id, ContentDocumentLink> existingLinksByDocumentId = new Map<Id, ContentDocumentLink>();

        for (ContentDocumentLink existingLink : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :linkedRecordId
            AND ContentDocumentId IN :documentIds
        ]) {
            existingLinksByDocumentId.put(existingLink.ContentDocumentId, existingLink);
        }

        List<ContentDocumentLink> linksToInsert = new List<ContentDocumentLink>();

        for (Id documentId : documentIds) {
            if (existingLinksByDocumentId.containsKey(documentId)) {
                continue;
            }

            ContentDocumentLink newLink = new ContentDocumentLink();
            newLink.LinkedEntityId = linkedRecordId;
            newLink.ContentDocumentId = documentId;
            newLink.ShareType = 'V';
            newLink.Visibility = 'AllUsers';
            linksToInsert.add(newLink);
        }

        if (!linksToInsert.isEmpty()) {
            insert linksToInsert;
        }
    }

    @AuraEnabled
    public static List<WorkLogFileUploadResult> uploadFilesToWorkLog(
        List<WorkLogFileUploadRequest> uploadRequests,
        Id workLogId
    ) {
        if (workLogId == null) {
            throw handledException('Work Log Id is required for file upload.');
        }

        List<WorkLogFileUploadResult> results = new List<WorkLogFileUploadResult>();
        if (uploadRequests == null || uploadRequests.isEmpty()) {
            return results;
        }

        for (WorkLogFileUploadRequest uploadRequest : uploadRequests) {
            WorkLogFileUploadResult result = new WorkLogFileUploadResult();
            result.fileName = uploadRequest == null ? null : uploadRequest.fileName;
            result.success = false;

            try {
                if (uploadRequest == null) {
                    throw handledException('A file upload request was missing.');
                }
                if (String.isBlank(uploadRequest.fileName)) {
                    throw handledException('File name is required.');
                }
                if (String.isBlank(uploadRequest.base64Data)) {
                    throw handledException('File contents were empty for ' + uploadRequest.fileName + '.');
                }

                ContentVersion contentVersion = new ContentVersion();
                contentVersion.Title = buildContentVersionTitle(uploadRequest.fileName);
                contentVersion.PathOnClient = uploadRequest.fileName;
                contentVersion.VersionData = EncodingUtil.base64Decode(uploadRequest.base64Data);
                contentVersion.FirstPublishLocationId = workLogId;
                insert contentVersion;

                ContentVersion insertedVersion = [
                    SELECT ContentDocumentId
                    FROM ContentVersion
                    WHERE Id = :contentVersion.Id
                    LIMIT 1
                ];

                result.contentDocumentId = insertedVersion.ContentDocumentId;
                result.success = true;
            } catch (Exception ex) {
                result.message = reduceException(ex);
            }

            results.add(result);
        }

        return results;
    }

    private static LayerSlotResponse processLayerSlot(
        Id projectId,
        RequestedLayerSlot slot,
        sitetracker__Map_Layer__c mapLayer,
        String layerFilterFieldSetApiName
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

            List<ResolvedFilterFieldDescriptor> filterFieldDescriptors = getLayerFilterFieldDescriptors(
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
                FeatureResponse feature = buildFeatureResponse(
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

    private static FeatureResponse buildFeatureResponse(
        SObject recordItem,
        String configuredGeometryType,
        String coordinatesFieldPath,
        String latitudeFieldPath,
        String longitudeFieldPath,
        List<ResolvedFilterFieldDescriptor> filterFieldDescriptors,
        String styleFieldPath,
        List<PopupFieldConfig> popupFields,
        String objectApiName
    ) {
        FeatureResponse feature = new FeatureResponse();
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

    private static List<FeatureFilterValue> buildFeatureFilterValues(
        SObject recordItem,
        List<ResolvedFilterFieldDescriptor> filterFieldDescriptors
    ) {
        List<FeatureFilterValue> filterValues = new List<FeatureFilterValue>();

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

                FeatureFilterValue filterValue = new FeatureFilterValue();
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
        List<FeatureFilterValue> featureFilterValues
    ) {
        if (targetOptionsByFieldPath == null || featureFilterValues == null) {
            return;
        }

        for (FeatureFilterValue featureFilterValue : featureFilterValues) {
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

    private static List<FilterFieldConfig> buildFilterFieldConfigs(
        List<ResolvedFilterFieldDescriptor> descriptors,
        Map<String, Set<String>> optionsByPath
    ) {
        List<FilterFieldConfig> filterFields = new List<FilterFieldConfig>();

        if (descriptors == null || descriptors.isEmpty()) {
            return filterFields;
        }

        for (ResolvedFilterFieldDescriptor descriptor : descriptors) {
            FilterFieldConfig filterField = new FilterFieldConfig();
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

    private static WorkLogLaunchResponse buildBulkWorkLogContextForSite(
        sitetracker__Site__c siteRecord,
        Id requestedProjectId
    ) {
        WorkLogLaunchResponse response = new WorkLogLaunchResponse();
        response.featureRecordId = siteRecord.Id;
        response.featureObjectApiName = SITE_OBJECT_API;
        response.featureName = siteRecord.Name;
        response.siteId = siteRecord.Id;
        response.statusValue = WORK_LOG_STATUS_DRAFT;
        response.startDateIso = String.valueOf(Date.today());
        response.endDateIso = String.valueOf(Date.today());
        response.defaultValues = new Map<String, String>();
        response.targetDetailFields = new List<RecordDetailField>();
        response.formFields = new List<WorkLogFormField>();
        response.warnings = new List<String>();

        populateWorkLogDefaultsFromFeature(
            response,
            requestedProjectId,
            siteRecord.Project__c,
            siteRecord.Project__r == null ? null : siteRecord.Project__r.Name,
            siteRecord.Production_Line_Allocation__c,
            siteRecord.Production_Line_Allocation__r
        );
        applyObjectSpecificWorkLogDefaults(response, SITE_OBJECT_API);

        return response;
    }

    private static WorkLogLaunchResponse buildBulkWorkLogContextForSegment(
        sitetracker__Segment__c segmentRecord,
        Id requestedProjectId
    ) {
        WorkLogLaunchResponse response = new WorkLogLaunchResponse();
        response.featureRecordId = segmentRecord.Id;
        response.featureObjectApiName = SEGMENT_OBJECT_API;
        response.featureName = segmentRecord.Name;
        response.segmentId = segmentRecord.Id;
        response.segmentGeometryRaw = segmentRecord.sitetracker__Gis_Segment_Path__c;
        response.segmentTotalLength = segmentRecord.sitetracker__st_Total_Length__c;
        response.statusValue = WORK_LOG_STATUS_DRAFT;
        response.startDateIso = String.valueOf(Date.today());
        response.endDateIso = String.valueOf(Date.today());
        response.defaultValues = new Map<String, String>();
        response.targetDetailFields = new List<RecordDetailField>();
        response.formFields = new List<WorkLogFormField>();
        response.warnings = new List<String>();

        populateWorkLogDefaultsFromFeature(
            response,
            requestedProjectId,
            segmentRecord.Project__c,
            segmentRecord.Project__r == null ? null : segmentRecord.Project__r.Name,
            segmentRecord.Production_Line_Allocation__c,
            segmentRecord.Production_Line_Allocation__r
        );
        applyObjectSpecificWorkLogDefaults(response, SEGMENT_OBJECT_API);

        return response;
    }

    private static SObject buildBulkWorkLogRecord(
        WorkLogLaunchResponse context,
        Date workLogDate,
        Id actualResourceId,
        String comments
    ) {
        if (context == null) {
            throw handledException('A Work Log context could not be built.');
        }

        SObject workLogRecord = getObjectDescribe(WORK_LOG_OBJECT_API).getSObjectType().newSObject();

        workLogRecord.put(WORK_LOG_PROJECT_FIELD, context.projectId);
        workLogRecord.put(WORK_LOG_PLA_FIELD, context.productionLineAllocationId);
        workLogRecord.put(WORK_LOG_PPL_FIELD, context.productionPlanLineId);
        workLogRecord.put(WORK_LOG_SERVICE_FIELD, context.serviceId);
        workLogRecord.put(WORK_LOG_STATUS_FIELD, firstNonBlank(context.statusValue, WORK_LOG_STATUS_DRAFT));
        workLogRecord.put(WORK_LOG_START_DATE_FIELD, workLogDate);
        workLogRecord.put(WORK_LOG_END_DATE_FIELD, workLogDate);
        workLogRecord.put(WORK_LOG_BULK_CREATED_FIELD, true);

        if (context.jobId != null) {
            workLogRecord.put(WORK_LOG_JOB_FIELD, context.jobId);
        }
        if (context.activityId != null) {
            workLogRecord.put(WORK_LOG_ACTIVITY_FIELD, context.activityId);
        }
        if (actualResourceId != null) {
            workLogRecord.put(WORK_LOG_ACTUAL_RESOURCE_FIELD, actualResourceId);
        }
        if (String.isNotBlank(comments)) {
            workLogRecord.put(WORK_LOG_COMMENTS_FIELD, comments);
        }

        if (context.siteId != null) {
            workLogRecord.put(WORK_LOG_SITE_FIELD, context.siteId);

            if (String.isNotBlank(context.quantityFieldApiName)) {
                workLogRecord.put(context.quantityFieldApiName, Decimal.valueOf('1'));
            }
        }

        if (context.segmentId != null) {
            workLogRecord.put(WORK_LOG_SEGMENT_FIELD, context.segmentId);

            if (String.isNotBlank(context.segmentGeometryRaw)) {
                workLogRecord.put(WORK_LOG_GIS_PATH_FIELD, context.segmentGeometryRaw);
            }

            if (String.isNotBlank(context.quantityFieldApiName) && context.segmentTotalLength != null) {
                workLogRecord.put(
                    context.quantityFieldApiName,
                    roundQuantityToTwoDecimalPlaces(context.segmentTotalLength)
                );
            }
        }

        return workLogRecord;
    }

    private static Decimal roundQuantityToTwoDecimalPlaces(Decimal value) {
        return value == null ? null : value.setScale(2);
    }

    private static String buildWorkLogSourceLabel(
        String objectApiName,
        String recordName,
        Id recordId
    ) {
        String typeLabel = objectApiName == SITE_OBJECT_API
            ? 'Site'
            : (objectApiName == SEGMENT_OBJECT_API ? 'Segment' : 'Record');

        return typeLabel + ' ' + firstNonBlank(recordName, recordId == null ? null : String.valueOf(recordId));
    }

    private static String reduceSaveErrors(Database.Error[] errors) {
        if (errors == null || errors.isEmpty()) {
            return 'Unknown error.';
        }

        List<String> messages = new List<String>();

        for (Database.Error errorItem : errors) {
            if (errorItem != null && String.isNotBlank(errorItem.getMessage())) {
                messages.add(errorItem.getMessage());
            }
        }

        return messages.isEmpty() ? 'Unknown error.' : String.join(messages, '; ');
    }

    private static void populateWorkLogDefaultsFromFeature(
        WorkLogLaunchResponse response,
        Id requestedProjectId,
        Id featureProjectId,
        String featureProjectName,
        Id productionLineAllocationId,
        sitetracker__Production_Line_Allocation__c productionLineAllocation
    ) {
        if (productionLineAllocationId == null || productionLineAllocation == null) {
            throw handledException('The selected record does not have a related Production Line Allocation.');
        }

        response.productionLineAllocationId = productionLineAllocationId;
        response.productionLineAllocationName = productionLineAllocation.Name;
        response.productionPlanLineId = productionLineAllocation.sitetracker__Production_Plan_Line__c;
        response.serviceId = productionLineAllocation.sitetracker__Production_Plan_Line__r == null
            ? null
            : productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Item__c;
        response.serviceName = productionLineAllocation.sitetracker__Production_Plan_Line__r == null ||
            productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Item__r == null
            ? null
            : productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Item__r.Name;
        response.jobId = productionLineAllocation.sitetracker__Job__c;
        response.activityId = productionLineAllocation.sitetracker__Activity__c;

        Id planLineProjectId = productionLineAllocation.sitetracker__Production_Plan_Line__r == null
            ? null
            : productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Project__c;
        String planLineProjectName = productionLineAllocation.sitetracker__Production_Plan_Line__r == null ||
            productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Project__r == null
            ? null
            : productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Project__r.Name;

        if (requestedProjectId != null &&
            planLineProjectId != null &&
            requestedProjectId != planLineProjectId) {
            response.warnings.add(
                'The selected record is tied to a different Project than the current page. ' +
                'The Work Log will use the Project from the Production Plan Line.'
            );
        }

        response.projectId = planLineProjectId != null
            ? planLineProjectId
            : (requestedProjectId != null ? requestedProjectId : featureProjectId);
        response.projectName = planLineProjectName != null
            ? planLineProjectName
            : featureProjectName;

        if (response.projectId == null) {
            throw handledException(
                'A Project could not be determined for the new Work Log.'
            );
        }

        if (response.productionPlanLineId == null) {
            throw handledException(
                'The related Production Line Allocation does not have a Production Plan Line.'
            );
        }

        if (response.serviceId == null) {
            throw handledException(
                'The related Production Plan Line does not have a Service.'
            );
        }
    }

    private static void applyObjectSpecificWorkLogDefaults(
        WorkLogLaunchResponse response,
        String featureObjectApiName
    ) {
        if (response == null) {
            return;
        }

        if (response.defaultValues == null) {
            response.defaultValues = new Map<String, String>();
        }

        response.quantityFieldApiName = firstExistingFieldApiName(
            WORK_LOG_OBJECT_API,
            WORK_LOG_QUANTITY_FIELD_CANDIDATES
        );

        if (featureObjectApiName == SITE_OBJECT_API) {
            if (String.isNotBlank(response.quantityFieldApiName)) {
                response.defaultValues.put(response.quantityFieldApiName, '1');
            }
        }

        if (featureObjectApiName == SEGMENT_OBJECT_API &&
            String.isNotBlank(response.segmentGeometryRaw)) {
            response.defaultValues.put(WORK_LOG_GIS_PATH_FIELD, response.segmentGeometryRaw);
        }
    }

    private static List<RecordDetailField> getRecordDetailFields(
        Id recordId,
        String objectApiName,
        String fieldSetApiName,
        List<String> warnings
    ) {
        if (recordId == null || String.isBlank(fieldSetApiName)) {
            return new List<RecordDetailField>();
        }

        List<WorkLogFormField> readableFields = getReadableFieldSetFields(
            objectApiName,
            fieldSetApiName,
            warnings
        );
        if (readableFields.isEmpty()) {
            return new List<RecordDetailField>();
        }

        List<String> selectFields = new List<String>{ 'Id', 'Name' };
        Set<String> seenFieldApiNames = new Set<String>{ 'Id', 'Name' };

        for (WorkLogFormField readableField : readableFields) {
            if (String.isBlank(readableField.apiName) ||
                seenFieldApiNames.contains(readableField.apiName)) {
                continue;
            }

            seenFieldApiNames.add(readableField.apiName);
            selectFields.add(readableField.apiName);
        }

        String soql =
            'SELECT ' + String.join(selectFields, ', ') +
            ' FROM ' + objectApiName +
            ' WHERE Id = :recordId' +
            ' LIMIT 1';

        SObject recordItem = Database.query(soql);
        List<RecordDetailField> detailFields = new List<RecordDetailField>();

        for (WorkLogFormField readableField : readableFields) {
            RecordDetailField detailField = new RecordDetailField();
            detailField.apiName = readableField.apiName;
            detailField.label = readableField.label;
            detailField.displayValue = toDisplayString(recordItem.get(readableField.apiName));
            detailFields.add(detailField);
        }

        return detailFields;
    }

    private static List<WorkLogFormField> getReadableFieldSetFields(
        String objectApiName,
        String fieldSetApiName,
        List<String> warnings
    ) {
        Schema.DescribeSObjectResult describeResult = getObjectDescribe(objectApiName);
        Map<String, Schema.FieldSet> fieldSetMap = describeResult.fieldSets.getMap();

        if (!fieldSetMap.containsKey(fieldSetApiName)) {
            warnings.add(
                'Field Set was not found on ' + objectApiName + ': ' + fieldSetApiName
            );
            return new List<WorkLogFormField>();
        }

        List<WorkLogFormField> formFields = new List<WorkLogFormField>();
        Set<String> seenFieldApiNames = new Set<String>();
        Map<String, Schema.SObjectField> fieldMap = describeResult.fields.getMap();

        for (Schema.FieldSetMember member : fieldSetMap.get(fieldSetApiName).getFields()) {
            String fieldApiName = normalizeString(member.getFieldPath());

            if (String.isBlank(fieldApiName) || seenFieldApiNames.contains(fieldApiName)) {
                continue;
            }

            if (fieldApiName.contains('.')) {
                warnings.add(
                    'Skipped field set entry "' + fieldApiName +
                    '" because relationship paths are not supported in the summary display.'
                );
                continue;
            }

            if (!fieldMap.containsKey(fieldApiName)) {
                warnings.add(
                    'Skipped field set entry "' + fieldApiName +
                    '" because the field was not found on ' + objectApiName + '.'
                );
                continue;
            }

            Schema.DescribeFieldResult fieldDescribe = fieldMap.get(fieldApiName).getDescribe();
            if (!fieldDescribe.isAccessible()) {
                warnings.add(
                    'Skipped field "' + fieldDescribe.getLabel() + '" because it is not accessible.'
                );
                continue;
            }

            seenFieldApiNames.add(fieldApiName);

            WorkLogFormField formField = new WorkLogFormField();
            formField.apiName = fieldApiName;
            formField.label = fieldDescribe.getLabel();
            formFields.add(formField);
        }

        return formFields;
    }

    private static List<WorkLogFormField> getCreateableFieldSetFields(
        String objectApiName,
        String fieldSetApiName,
        List<String> warnings
    ) {
        Schema.DescribeSObjectResult describeResult = getObjectDescribe(objectApiName);
        Map<String, Schema.FieldSet> fieldSetMap = describeResult.fieldSets.getMap();

        if (!fieldSetMap.containsKey(fieldSetApiName)) {
            throw handledException(
                'Field Set was not found on ' + objectApiName + ': ' + fieldSetApiName
            );
        }

        List<WorkLogFormField> formFields = new List<WorkLogFormField>();
        Set<String> seenFieldApiNames = new Set<String>();
        Map<String, Schema.SObjectField> fieldMap = describeResult.fields.getMap();

        for (Schema.FieldSetMember member : fieldSetMap.get(fieldSetApiName).getFields()) {
            String fieldApiName = normalizeString(member.getFieldPath());

            if (String.isBlank(fieldApiName) || seenFieldApiNames.contains(fieldApiName)) {
                continue;
            }

            if (fieldApiName.contains('.')) {
                warnings.add(
                    'Skipped field set entry "' + fieldApiName +
                    '" because relationship paths are not supported in the create form.'
                );
                continue;
            }

            if (!fieldMap.containsKey(fieldApiName)) {
                warnings.add(
                    'Skipped field set entry "' + fieldApiName +
                    '" because the field was not found on ' + objectApiName + '.'
                );
                continue;
            }

            Schema.DescribeFieldResult fieldDescribe = fieldMap.get(fieldApiName).getDescribe();
            if (!fieldDescribe.isCreateable()) {
                warnings.add(
                    'Skipped field "' + fieldDescribe.getLabel() + '" because it is not createable.'
                );
                continue;
            }

            seenFieldApiNames.add(fieldApiName);

            WorkLogFormField formField = new WorkLogFormField();
            formField.apiName = fieldApiName;
            formField.label = fieldDescribe.getLabel();
            formFields.add(formField);
        }

        return formFields;
    }

    private static String firstExistingFieldApiName(
        String objectApiName,
        List<String> candidateFieldApiNames
    ) {
        if (String.isBlank(objectApiName) || candidateFieldApiNames == null ||
            candidateFieldApiNames.isEmpty()) {
            return null;
        }

        Map<String, Schema.SObjectField> fieldMap = getObjectDescribe(objectApiName).fields.getMap();

        for (String candidateFieldApiName : candidateFieldApiNames) {
            if (String.isNotBlank(candidateFieldApiName) &&
                fieldMap.containsKey(candidateFieldApiName)) {
                return candidateFieldApiName;
            }
        }

        return null;
    }

    private static Boolean isSupportedWorkLogSourceObject(String objectApiName) {
        return objectApiName == SITE_OBJECT_API || objectApiName == SEGMENT_OBJECT_API;
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
        response.isDefaultSelected = false;
        response.filterOptions = new List<String>();
        response.filterFields = new List<FilterFieldConfig>();
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

    private static String buildContentVersionTitle(String fileName) {
        String safeFileName = normalizeString(fileName);
        if (String.isBlank(safeFileName)) {
            return 'File';
        }

        Integer lastDotIndex = safeFileName.lastIndexOf('.');
        return lastDotIndex > 0
            ? safeFileName.substring(0, lastDotIndex)
            : safeFileName;
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
