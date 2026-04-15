public with sharing class ProjectRecordMapWorkLogService {
    private static final String WORK_LOG_OBJECT_API = 'sitetracker__Production_Work_Log__c';
    private static final String SITE_OBJECT_API = 'sitetracker__Site__c';
    private static final String SEGMENT_OBJECT_API = 'sitetracker__Segment__c';

    private static final String DEFAULT_WORK_LOG_FIELD_SET = 'sitetracker__Create_Work_Logs_Form_GIS';
    private static final String WORK_LOG_GIS_PATH_FIELD = 'sitetracker__st_GIS_Path__c';
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

    public static ProjectRecordMapController.WorkLogLaunchResponse getWorkLogLaunchConfig(
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

        ProjectRecordMapController.WorkLogLaunchResponse response =
            new ProjectRecordMapController.WorkLogLaunchResponse();
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
        response.targetDetailFields = new List<ProjectRecordMapController.RecordDetailField>();
        response.formFields = new List<ProjectRecordMapController.WorkLogFormField>();
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

    public static ProjectRecordMapController.BulkWorkLogCreateResult createBulkWorkLogs(
        ProjectRecordMapController.BulkWorkLogCreateRequest request
    ) {
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

        List<ProjectRecordMapController.BulkWorkLogSelectionRequest> incomingSelections =
            request.selections == null
                ? new List<ProjectRecordMapController.BulkWorkLogSelectionRequest>()
                : request.selections;

        if (incomingSelections.isEmpty()) {
            throw handledException('Select at least one Site or Segment before creating Work Logs.');
        }

        ProjectRecordMapController.BulkWorkLogCreateResult result =
            new ProjectRecordMapController.BulkWorkLogCreateResult();
        result.requestedCount = 0;
        result.eligibleCount = 0;
        result.createdCount = 0;
        result.skippedCount = 0;
        result.messages = new List<String>();
        result.createdWorkLogIds = new List<String>();

        Set<String> seenSelectionKeys = new Set<String>();
        List<ProjectRecordMapController.BulkWorkLogSelectionRequest> orderedSelections =
            new List<ProjectRecordMapController.BulkWorkLogSelectionRequest>();
        Set<Id> siteIds = new Set<Id>();
        Set<Id> segmentIds = new Set<Id>();

        for (ProjectRecordMapController.BulkWorkLogSelectionRequest incomingSelection : incomingSelections) {
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

            String selectionKey =
                normalizedObjectApiName + '::' + String.valueOf(incomingSelection.featureRecordId);
            if (seenSelectionKeys.contains(selectionKey)) {
                continue;
            }

            seenSelectionKeys.add(selectionKey);

            ProjectRecordMapController.BulkWorkLogSelectionRequest normalizedSelection =
                new ProjectRecordMapController.BulkWorkLogSelectionRequest();
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

        for (ProjectRecordMapController.BulkWorkLogSelectionRequest selection : orderedSelections) {
            String sourceLabel = buildWorkLogSourceLabel(
                selection.featureObjectApiName,
                null,
                selection.featureRecordId
            );

            try {
                ProjectRecordMapController.WorkLogLaunchResponse workLogContext;

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

                    sourceLabel = buildWorkLogSourceLabel(
                        SEGMENT_OBJECT_API,
                        segmentRecord.Name,
                        segmentRecord.Id
                    );
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

    public static List<ProjectRecordMapController.WorkLogFileUploadResult> uploadFilesToWorkLog(
        List<ProjectRecordMapController.WorkLogFileUploadRequest> uploadRequests,
        Id workLogId
    ) {
        if (workLogId == null) {
            throw handledException('Work Log Id is required for file upload.');
        }

        List<ProjectRecordMapController.WorkLogFileUploadResult> results =
            new List<ProjectRecordMapController.WorkLogFileUploadResult>();
        if (uploadRequests == null || uploadRequests.isEmpty()) {
            return results;
        }

        for (ProjectRecordMapController.WorkLogFileUploadRequest uploadRequest : uploadRequests) {
            ProjectRecordMapController.WorkLogFileUploadResult result =
                new ProjectRecordMapController.WorkLogFileUploadResult();
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

    private static ProjectRecordMapController.WorkLogLaunchResponse buildBulkWorkLogContextForSite(
        sitetracker__Site__c siteRecord,
        Id requestedProjectId
    ) {
        ProjectRecordMapController.WorkLogLaunchResponse response =
            new ProjectRecordMapController.WorkLogLaunchResponse();
        response.featureRecordId = siteRecord.Id;
        response.featureObjectApiName = SITE_OBJECT_API;
        response.featureName = siteRecord.Name;
        response.siteId = siteRecord.Id;
        response.statusValue = WORK_LOG_STATUS_DRAFT;
        response.startDateIso = String.valueOf(Date.today());
        response.endDateIso = String.valueOf(Date.today());
        response.defaultValues = new Map<String, String>();
        response.targetDetailFields = new List<ProjectRecordMapController.RecordDetailField>();
        response.formFields = new List<ProjectRecordMapController.WorkLogFormField>();
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

    private static ProjectRecordMapController.WorkLogLaunchResponse buildBulkWorkLogContextForSegment(
        sitetracker__Segment__c segmentRecord,
        Id requestedProjectId
    ) {
        ProjectRecordMapController.WorkLogLaunchResponse response =
            new ProjectRecordMapController.WorkLogLaunchResponse();
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
        response.targetDetailFields = new List<ProjectRecordMapController.RecordDetailField>();
        response.formFields = new List<ProjectRecordMapController.WorkLogFormField>();
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
        ProjectRecordMapController.WorkLogLaunchResponse context,
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

        return typeLabel + ' ' + firstNonBlank(
            recordName,
            recordId == null ? null : String.valueOf(recordId)
        );
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
        ProjectRecordMapController.WorkLogLaunchResponse response,
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
        response.serviceName =
            productionLineAllocation.sitetracker__Production_Plan_Line__r == null ||
            productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Item__r == null
                ? null
                : productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Item__r.Name;
        response.jobId = productionLineAllocation.sitetracker__Job__c;
        response.activityId = productionLineAllocation.sitetracker__Activity__c;

        Id planLineProjectId = productionLineAllocation.sitetracker__Production_Plan_Line__r == null
            ? null
            : productionLineAllocation.sitetracker__Production_Plan_Line__r.sitetracker__Project__c;
        String planLineProjectName =
            productionLineAllocation.sitetracker__Production_Plan_Line__r == null ||
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
            throw handledException('A Project could not be determined for the new Work Log.');
        }

        if (response.productionPlanLineId == null) {
            throw handledException(
                'The related Production Line Allocation does not have a Production Plan Line.'
            );
        }

        if (response.serviceId == null) {
            throw handledException('The related Production Plan Line does not have a Service.');
        }
    }

    private static void applyObjectSpecificWorkLogDefaults(
        ProjectRecordMapController.WorkLogLaunchResponse response,
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

    private static List<ProjectRecordMapController.RecordDetailField> getRecordDetailFields(
        Id recordId,
        String objectApiName,
        String fieldSetApiName,
        List<String> warnings
    ) {
        if (recordId == null || String.isBlank(fieldSetApiName)) {
            return new List<ProjectRecordMapController.RecordDetailField>();
        }

        List<ProjectRecordMapController.WorkLogFormField> readableFields = getReadableFieldSetFields(
            objectApiName,
            fieldSetApiName,
            warnings
        );
        if (readableFields.isEmpty()) {
            return new List<ProjectRecordMapController.RecordDetailField>();
        }

        List<String> selectFields = new List<String>{ 'Id', 'Name' };
        Set<String> seenFieldApiNames = new Set<String>{ 'Id', 'Name' };

        for (ProjectRecordMapController.WorkLogFormField readableField : readableFields) {
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
        List<ProjectRecordMapController.RecordDetailField> detailFields =
            new List<ProjectRecordMapController.RecordDetailField>();

        for (ProjectRecordMapController.WorkLogFormField readableField : readableFields) {
            ProjectRecordMapController.RecordDetailField detailField =
                new ProjectRecordMapController.RecordDetailField();
            detailField.apiName = readableField.apiName;
            detailField.label = readableField.label;
            detailField.displayValue = toDisplayString(recordItem.get(readableField.apiName));
            detailFields.add(detailField);
        }

        return detailFields;
    }

    private static List<ProjectRecordMapController.WorkLogFormField> getReadableFieldSetFields(
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
            return new List<ProjectRecordMapController.WorkLogFormField>();
        }

        List<ProjectRecordMapController.WorkLogFormField> formFields =
            new List<ProjectRecordMapController.WorkLogFormField>();
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
                    'Skipped field "' + fieldDescribe.getLabel() +
                    '" because it is not accessible.'
                );
                continue;
            }

            seenFieldApiNames.add(fieldApiName);

            ProjectRecordMapController.WorkLogFormField formField =
                new ProjectRecordMapController.WorkLogFormField();
            formField.apiName = fieldApiName;
            formField.label = fieldDescribe.getLabel();
            formField.isRequired = false;
            formFields.add(formField);
        }

        return formFields;
    }

    private static List<ProjectRecordMapController.WorkLogFormField> getCreateableFieldSetFields(
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

        List<ProjectRecordMapController.WorkLogFormField> formFields =
            new List<ProjectRecordMapController.WorkLogFormField>();
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
                    'Skipped field "' + fieldDescribe.getLabel() +
                    '" because it is not createable.'
                );
                continue;
            }

            seenFieldApiNames.add(fieldApiName);

            ProjectRecordMapController.WorkLogFormField formField =
                new ProjectRecordMapController.WorkLogFormField();
            formField.apiName = fieldApiName;
            formField.label = fieldDescribe.getLabel();
            formField.isRequired = member.getRequired() || member.getDbRequired();
            formFields.add(formField);
        }

        return formFields;
    }

    private static String firstExistingFieldApiName(
        String objectApiName,
        List<String> candidateFieldApiNames
    ) {
        if (String.isBlank(objectApiName) ||
            candidateFieldApiNames == null ||
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

    private static Schema.DescribeSObjectResult getObjectDescribe(String objectApiName) {
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();

        if (!globalDescribe.containsKey(objectApiName)) {
            throw handledException('Object was not found: ' + objectApiName);
        }

        return globalDescribe.get(objectApiName).getDescribe();
    }

    private static String normalizeString(String value) {
        return value == null ? null : value.trim();
    }

    private static String firstNonBlank(String firstValue, String secondValue) {
        return String.isNotBlank(firstValue) ? firstValue : secondValue;
    }

    private static String toDisplayString(Object value) {
        if (value == null) {
            return null;
        }

        String stringValue = String.valueOf(value);
        return String.isBlank(stringValue) ? null : stringValue;
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
