public with sharing class ProjectRecordMapController {
    public static final Integer MAX_LAYER_RECORDS = 5000;
    public static final String SUPPORTED_LAYER_TYPE = 'Sitetracker Layer';
    public static final String WORK_LOG_OBJECT_API = 'sitetracker__Production_Work_Log__c';
    public static final String SITE_OBJECT_API = 'sitetracker__Site__c';
    public static final String SEGMENT_OBJECT_API = 'sitetracker__Segment__c';
    public static final String FEATURE_PLA_FIELD = 'Production_Line_Allocation__c';
    public static final String DEFAULT_WORK_LOG_FIELD_SET = 'sitetracker__Create_Work_Logs_Form_GIS';
    public static final String WORK_LOG_GIS_PATH_FIELD = 'sitetracker__st_GIS_Path__c';
    public static final String SEGMENT_GEOMETRY_FIELD_API = 'sitetracker__Gis_Segment_Path__c';
    public static final String SEGMENT_TOTAL_LENGTH_FIELD_API = 'sitetracker__st_Total_Length__c';
    public static final String WORK_LOG_FALLBACK_LAT_FIELD = 'sitetracker__Location__Latitude__s';
    public static final String WORK_LOG_FALLBACK_LNG_FIELD = 'sitetracker__Location__Longitude__s';

    public class MapRequest {
        @AuraEnabled public Id projectId { get; set; }
        @AuraEnabled public String layerFilterFieldSetApiName { get; set; }

        // Deprecated legacy inputs retained because in-use Lightning page properties cannot be removed.
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
        @AuraEnabled public Boolean isRequired { get; set; }
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

    @AuraEnabled(cacheable=true)
    public static MapResponse getProjectMapData(MapRequest request) {
        return ProjectRecordMapLayerService.getProjectMapData(request);
    }

    @AuraEnabled
    public static WorkLogLaunchResponse getWorkLogLaunchConfig(
        Id featureRecordId,
        String featureObjectApiName,
        Id projectId,
        String fieldSetApiName,
        String targetDetailFieldSetApiName
    ) {
        return ProjectRecordMapWorkLogService.getWorkLogLaunchConfig(
            featureRecordId,
            featureObjectApiName,
            projectId,
            fieldSetApiName,
            targetDetailFieldSetApiName
        );
    }

    @AuraEnabled
    public static BulkWorkLogCreateResult createBulkWorkLogs(BulkWorkLogCreateRequest request) {
        return ProjectRecordMapWorkLogService.createBulkWorkLogs(request);
    }

    @AuraEnabled
    public static void linkUploadedFilesToRecord(List<Id> contentDocumentIds, Id linkedRecordId) {
        ProjectRecordMapWorkLogService.linkUploadedFilesToRecord(contentDocumentIds, linkedRecordId);
    }

    @AuraEnabled
    public static List<WorkLogFileUploadResult> uploadFilesToWorkLog(
        List<WorkLogFileUploadRequest> uploadRequests,
        Id workLogId
    ) {
        return ProjectRecordMapWorkLogService.uploadFilesToWorkLog(uploadRequests, workLogId);
    }
}
