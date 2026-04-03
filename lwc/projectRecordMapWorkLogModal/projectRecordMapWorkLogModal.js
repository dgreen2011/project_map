import { api, LightningElement } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getWorkLogLaunchConfig from "@salesforce/apex/ProjectRecordMapController.getWorkLogLaunchConfig";
import linkUploadedFilesToRecord from "@salesforce/apex/ProjectRecordMapController.linkUploadedFilesToRecord";

const WORK_LOG_OBJECT_API_NAME = "sitetracker__Production_Work_Log__c";
const WORK_LOG_STATUS_FIELD = "sitetracker__Status__c";
const WORK_LOG_PROJECT_FIELD = "sitetracker__Project__c";
const WORK_LOG_PLA_FIELD = "sitetracker__Production_Line_Allocation__c";
const WORK_LOG_PPL_FIELD = "sitetracker__st_Production_Plan_Line__c";
const WORK_LOG_SERVICE_FIELD = "sitetracker__Item__c";
const WORK_LOG_SITE_FIELD = "sitetracker__Site__c";
const WORK_LOG_SEGMENT_FIELD = "sitetracker__Segment__c";
const WORK_LOG_START_DATE_FIELD = "sitetracker__Start_Date__c";
const WORK_LOG_END_DATE_FIELD = "sitetracker__End_Date__c";
const WORK_LOG_LAT_FIELD = "sitetracker__Location__Latitude__s";
const WORK_LOG_LNG_FIELD = "sitetracker__Location__Longitude__s";
const WORK_LOG_JOB_FIELD = "sitetracker__Job__c";
const WORK_LOG_ACTIVITY_FIELD = "sitetracker__Activity__c";
const WORK_LOG_ATTACHMENT_FIELD = "sitetracker__Attachment__c";
const WORK_LOG_GIS_PATH_FIELD = "sitetracker__st_GIS_Path__c";

const AUTO_HIDDEN_WORK_LOG_FIELDS = new Set([
  WORK_LOG_PROJECT_FIELD,
  WORK_LOG_PLA_FIELD,
  WORK_LOG_PPL_FIELD,
  WORK_LOG_SERVICE_FIELD,
  WORK_LOG_SITE_FIELD,
  WORK_LOG_SEGMENT_FIELD,
  WORK_LOG_START_DATE_FIELD,
  WORK_LOG_END_DATE_FIELD,
  WORK_LOG_STATUS_FIELD,
  WORK_LOG_LAT_FIELD,
  WORK_LOG_LNG_FIELD,
  WORK_LOG_JOB_FIELD,
  WORK_LOG_ACTIVITY_FIELD,
  WORK_LOG_ATTACHMENT_FIELD,
  WORK_LOG_GIS_PATH_FIELD
]);

export default class ProjectRecordMapWorkLogModal extends LightningElement {
  @api projectId;
  @api targetRecordId;
  @api targetObjectApiName;
  @api featureName;
  @api fieldSetApiName;
  @api siteDetailFieldSetApiName;
  @api segmentDetailFieldSetApiName;

  hasInitialized = false;

  isPreparingWorkLog = false;
  isSavingWorkLog = false;
  isLinkingUploadedFiles = false;

  workLogContextError = "";
  workLogSaveError = "";
  workLogSuccessMessage = "";
  workLogUploadMessage = "";
  createdWorkLogId = "";

  workLogContext = null;
  workLogWarnings = [];
  workLogVisibleFields = [];
  workLogHiddenFields = [];

  segmentPathValue = "";
  segmentPathValid = false;
  segmentSelectionMode = "";

  renderedCallback() {
    if (this.hasInitialized) {
      return;
    }

    if (!this.targetRecordId || !this.targetObjectApiName) {
      return;
    }

    this.hasInitialized = true;
    this.loadWorkLogContext();
  }

  get isSiteTarget() {
    return this.normalizeString(this.targetObjectApiName)?.toLowerCase() === "sitetracker__site__c";
  }

  get isSegmentTarget() {
    return this.normalizeString(this.targetObjectApiName)?.toLowerCase() === "sitetracker__segment__c";
  }

  get targetDetailFieldSetApiName() {
    if (this.isSiteTarget) {
      return this.normalizeString(this.siteDetailFieldSetApiName);
    }

    if (this.isSegmentTarget) {
      return this.normalizeString(this.segmentDetailFieldSetApiName);
    }

    return "";
  }

  get workLogTargetName() {
    return this.workLogContext?.targetName || this.featureName || "";
  }

  get workLogTargetTypeLabel() {
    return (
      this.workLogContext?.targetTypeLabel ||
      this.getObjectTypeLabel(this.workLogContext?.targetObjectApiName || this.targetObjectApiName)
    );
  }

  get workLogTargetTypeLabelLower() {
    const label = this.workLogTargetTypeLabel || "record";
    return label.toLowerCase();
  }

  get workLogTargetRecordUrl() {
    const recordId = this.workLogContext?.targetRecordId || this.targetRecordId;
    const objectApiName = this.workLogContext?.targetObjectApiName || this.targetObjectApiName;

    if (!recordId) {
      return "";
    }

    if (objectApiName) {
      return `/lightning/r/${encodeURIComponent(objectApiName)}/${encodeURIComponent(recordId)}/view`;
    }

    return `/${encodeURIComponent(recordId)}`;
  }

  get showWorkLogTargetLink() {
    return Boolean(this.workLogTargetName && this.workLogTargetRecordUrl);
  }

  get showWorkLogWarnings() {
    return Array.isArray(this.workLogWarnings) && this.workLogWarnings.length > 0;
  }

  get showWorkLogForm() {
    return (
      !this.createdWorkLogId &&
      !this.isPreparingWorkLog &&
      !this.workLogContextError &&
      Array.isArray(this.workLogVisibleFields) &&
      Array.isArray(this.workLogHiddenFields)
    );
  }

  get showWorkLogUploadStep() {
    return Boolean(this.createdWorkLogId);
  }

  get showCloseOnlyFooter() {
    return !this.showWorkLogForm && !this.showWorkLogUploadStep;
  }

  get workLogSaveButtonLabel() {
    return this.isSavingWorkLog ? "Creating..." : "Create Work Log";
  }

  get targetDetailFields() {
    return Array.isArray(this.workLogContext?.targetDetailFields)
      ? this.workLogContext.targetDetailFields
      : [];
  }

  get showTargetDetailFields() {
    return this.targetDetailFields.length > 0;
  }

  get segmentGeometryRaw() {
    return this.workLogContext?.segmentGeometryRaw || "";
  }

  get showSegmentPathEditor() {
    return this.isSegmentTarget && this.showWorkLogForm && Boolean(this.segmentGeometryRaw);
  }

  get showSegmentGeometryWarning() {
    return this.isSegmentTarget && this.showWorkLogForm && !this.segmentGeometryRaw;
  }

  async loadWorkLogContext() {
    this.resetTransientState();

    if (!this.targetRecordId || !this.targetObjectApiName) {
      this.workLogContextError = "Unable to determine which record should be used for the Work Log.";
      return;
    }

    this.isPreparingWorkLog = true;
    this.workLogContext = {
      targetRecordId: this.targetRecordId,
      targetObjectApiName: this.targetObjectApiName,
      targetName: this.featureName || "",
      targetDetailFields: []
    };

    try {
      const response = await getWorkLogLaunchConfig({
        featureRecordId: this.targetRecordId,
        featureObjectApiName: this.targetObjectApiName,
        projectId: this.projectId,
        fieldSetApiName: this.normalizeString(this.fieldSetApiName),
        targetDetailFieldSetApiName: this.targetDetailFieldSetApiName
      });

      this.applyWorkLogContext(response);
    } catch (error) {
      this.workLogContextError = this.reduceError(error);
    } finally {
      this.isPreparingWorkLog = false;
    }
  }

  applyWorkLogContext(context) {
    if (!context) {
      this.workLogContextError = "No Work Log context was returned.";
      return;
    }

    const defaultValues = this.normalizeWorkLogDefaultValues(context.defaultValues, context);
    const fieldModels = this.buildWorkLogFieldModels(context, defaultValues);
    const targetDetailFields = Array.isArray(context.targetDetailFields)
      ? context.targetDetailFields.map((fieldItem) => ({
          apiName: fieldItem?.apiName || "",
          label: fieldItem?.label || fieldItem?.apiName || "Field",
          displayValue: fieldItem?.displayValue || "—"
        }))
      : [];

    this.workLogContext = {
      ...context,
      targetRecordId: context.targetRecordId || context.featureRecordId || this.targetRecordId,
      targetObjectApiName:
        context.targetObjectApiName || context.featureObjectApiName || this.targetObjectApiName,
      targetName: context.targetName || context.featureName || this.featureName || "",
      targetTypeLabel: this.getObjectTypeLabel(
        context.targetObjectApiName || context.featureObjectApiName || this.targetObjectApiName
      ),
      targetDetailFields,
      defaultValues
    };
    this.workLogWarnings = Array.isArray(context.warnings) ? context.warnings : [];
    this.workLogVisibleFields = fieldModels.visibleFields;
    this.workLogHiddenFields = fieldModels.hiddenFields;

    const initialSegmentPathValue = defaultValues[WORK_LOG_GIS_PATH_FIELD] || "";
    this.segmentPathValue = initialSegmentPathValue;
    this.segmentPathValid = !this.isSegmentTarget || !this.segmentGeometryRaw || Boolean(initialSegmentPathValue);
    this.segmentSelectionMode = initialSegmentPathValue ? "full" : "";
  }

  normalizeWorkLogDefaultValues(defaultValues, context = {}) {
    const safeDefaults = defaultValues && typeof defaultValues === "object" ? defaultValues : {};
    const normalizedDefaults = { ...safeDefaults };

    if (context.projectId) {
      normalizedDefaults[WORK_LOG_PROJECT_FIELD] = context.projectId;
    }
    if (context.productionLineAllocationId) {
      normalizedDefaults[WORK_LOG_PLA_FIELD] = context.productionLineAllocationId;
    }
    if (context.productionPlanLineId) {
      normalizedDefaults[WORK_LOG_PPL_FIELD] = context.productionPlanLineId;
    }
    if (context.serviceId) {
      normalizedDefaults[WORK_LOG_SERVICE_FIELD] = context.serviceId;
    }
    if (context.jobId) {
      normalizedDefaults[WORK_LOG_JOB_FIELD] = context.jobId;
    }
    if (context.activityId) {
      normalizedDefaults[WORK_LOG_ACTIVITY_FIELD] = context.activityId;
    }
    if (context.siteId) {
      normalizedDefaults[WORK_LOG_SITE_FIELD] = context.siteId;
    }
    if (context.segmentId) {
      normalizedDefaults[WORK_LOG_SEGMENT_FIELD] = context.segmentId;
    }
    if (context.startDateIso) {
      normalizedDefaults[WORK_LOG_START_DATE_FIELD] = context.startDateIso;
    }
    if (context.endDateIso) {
      normalizedDefaults[WORK_LOG_END_DATE_FIELD] = context.endDateIso;
    }

    normalizedDefaults[WORK_LOG_STATUS_FIELD] =
      context.statusValue || normalizedDefaults[WORK_LOG_STATUS_FIELD] || "Draft";

    return normalizedDefaults;
  }

  buildWorkLogFieldModels(context, defaultValues) {
    const rawFieldSetFields = Array.isArray(context?.fieldSetFields)
      ? context.fieldSetFields
      : Array.isArray(context?.formFields)
        ? context.formFields
        : [];

    const orderedFieldApiNames = rawFieldSetFields
      .map((fieldItem) => fieldItem?.apiName || fieldItem?.fieldApiName || fieldItem?.fullName)
      .filter((apiName) => Boolean(apiName));

    const visibleFields = [];
    const hiddenFields = [];
    const seenFieldNames = new Set();

    orderedFieldApiNames.forEach((apiName) => {
      if (seenFieldNames.has(apiName)) {
        return;
      }

      seenFieldNames.add(apiName);

      const fieldModel = this.createFieldModel(apiName, this.getDefaultFieldValue(defaultValues, apiName));

      if (this.shouldHideWorkLogField(apiName)) {
        hiddenFields.push(fieldModel);
      } else {
        visibleFields.push(fieldModel);
      }
    });

    Object.keys(defaultValues).forEach((apiName) => {
      if (!apiName || seenFieldNames.has(apiName)) {
        return;
      }

      seenFieldNames.add(apiName);
      hiddenFields.push(this.createFieldModel(apiName, this.getDefaultFieldValue(defaultValues, apiName)));
    });

    return {
      visibleFields,
      hiddenFields
    };
  }

  createFieldModel(apiName, value) {
    return {
      key: `${apiName}::${value ?? ""}`,
      apiName,
      value
    };
  }

  getDefaultFieldValue(defaultValues, apiName) {
    if (!defaultValues || !apiName) {
      return null;
    }

    return Object.prototype.hasOwnProperty.call(defaultValues, apiName) ? defaultValues[apiName] : null;
  }

  shouldHideWorkLogField(apiName) {
    if (!apiName) {
      return false;
    }

    return AUTO_HIDDEN_WORK_LOG_FIELDS.has(apiName);
  }

  handleSegmentPathSelectionChange(event) {
    const detail = event.detail || {};
    this.segmentPathValue = detail.pathValue || "";
    this.segmentPathValid = Boolean(detail.isValid);
    this.segmentSelectionMode = detail.selectionMode ?? this.segmentSelectionMode;
    this.upsertHiddenFieldValue(WORK_LOG_GIS_PATH_FIELD, this.segmentPathValue || null);
  }

  upsertHiddenFieldValue(apiName, value) {
    if (!apiName) {
      return;
    }

    const normalizedValue = value ?? null;
    const visibleFieldIndex = this.workLogVisibleFields.findIndex((fieldItem) => fieldItem.apiName === apiName);
    if (visibleFieldIndex >= 0) {
      const nextVisibleFields = [...this.workLogVisibleFields];
      nextVisibleFields[visibleFieldIndex] = this.createFieldModel(apiName, normalizedValue);
      this.workLogVisibleFields = nextVisibleFields;
      return;
    }

    const hiddenFieldIndex = this.workLogHiddenFields.findIndex((fieldItem) => fieldItem.apiName === apiName);
    if (hiddenFieldIndex >= 0) {
      const nextHiddenFields = [...this.workLogHiddenFields];
      nextHiddenFields[hiddenFieldIndex] = this.createFieldModel(apiName, normalizedValue);
      this.workLogHiddenFields = nextHiddenFields;
      return;
    }

    this.workLogHiddenFields = [...this.workLogHiddenFields, this.createFieldModel(apiName, normalizedValue)];
  }

  handleCloseClick() {
    if (this.isSavingWorkLog) {
      return;
    }

    this.dispatchEvent(new CustomEvent("close"));
  }

  handleSubmitWorkLog() {
    if (this.isSavingWorkLog) {
      return;
    }

    if (this.showSegmentPathEditor && !this.segmentPathValid) {
      this.workLogSaveError =
        this.segmentSelectionMode === "partial"
          ? "Choose the completed start point and end point on the Segment before creating the Work Log."
          : this.segmentSelectionMode === "full"
            ? "Select the completed Segment path before creating the Work Log."
            : "Choose Full Segment or Partial Segment before creating the Work Log.";
      return;
    }

    const form = this.template.querySelector("lightning-record-edit-form");
    if (!form) {
      this.workLogSaveError = "The Work Log form could not be found.";
      return;
    }

    this.isSavingWorkLog = true;
    this.workLogSaveError = "";

    try {
      form.submit(this.buildSubmitFieldValues());
    } catch (error) {
      this.isSavingWorkLog = false;
      this.workLogSaveError = this.reduceError(error);
    }
  }

  buildSubmitFieldValues() {
    const fields = {};
    const inputFields = this.template.querySelectorAll("lightning-input-field");

    inputFields.forEach((inputField) => {
      if (!inputField?.fieldName) {
        return;
      }
      fields[inputField.fieldName] = inputField.value;
    });

    if (this.showSegmentPathEditor && this.segmentPathValue) {
      fields[WORK_LOG_GIS_PATH_FIELD] = this.segmentPathValue;
    }

    return fields;
  }

  handleWorkLogFormSuccess(event) {
    this.isSavingWorkLog = false;
    this.workLogSaveError = "";
    this.createdWorkLogId = event.detail?.id || "";
    this.workLogSuccessMessage = this.createdWorkLogId
      ? "The Work Log was created. You can upload files below."
      : "The Work Log was created.";

    this.dispatchToast("Work Log Created", "The Work Log was created successfully.", "success");
  }

  handleWorkLogFormError(event) {
    this.isSavingWorkLog = false;
    this.workLogSaveError =
      this.reduceRecordEditError(event.detail) || "Unable to create the Work Log.";
  }

  async handleWorkLogUploadFinished(event) {
    const uploadedFiles = Array.isArray(event.detail?.files) ? event.detail.files : [];
    if (!uploadedFiles.length || !this.createdWorkLogId) {
      return;
    }

    const contentDocumentIds = uploadedFiles
      .map((fileItem) => fileItem?.documentId)
      .filter((documentId) => Boolean(documentId));

    if (!contentDocumentIds.length) {
      return;
    }

    this.isLinkingUploadedFiles = true;
    this.workLogUploadMessage = "Linking uploaded files...";

    try {
      await linkUploadedFilesToRecord({
        contentDocumentIds,
        linkedRecordId: this.workLogContext?.targetRecordId || this.targetRecordId
      });

      const fileLabel = uploadedFiles.length === 1 ? "file was" : "files were";
      this.workLogUploadMessage = `${uploadedFiles.length} ${fileLabel} uploaded and linked successfully.`;
      this.dispatchToast("Files Linked", "Uploaded files were linked successfully.", "success");
    } catch (error) {
      this.workLogUploadMessage = this.reduceError(error);
      this.dispatchToast("File Link Error", this.workLogUploadMessage, "error");
    } finally {
      this.isLinkingUploadedFiles = false;
    }
  }

  handleOpenCreatedWorkLog() {
    if (!this.createdWorkLogId) {
      return;
    }

    const url = `/lightning/r/${encodeURIComponent(WORK_LOG_OBJECT_API_NAME)}/${encodeURIComponent(
      this.createdWorkLogId
    )}/view`;
    window.open(url, "_blank", "noopener");
  }

  resetTransientState() {
    this.isPreparingWorkLog = false;
    this.isSavingWorkLog = false;
    this.isLinkingUploadedFiles = false;
    this.workLogContextError = "";
    this.workLogSaveError = "";
    this.workLogSuccessMessage = "";
    this.workLogUploadMessage = "";
    this.createdWorkLogId = "";
    this.workLogWarnings = [];
    this.workLogVisibleFields = [];
    this.workLogHiddenFields = [];
    this.segmentPathValue = "";
    this.segmentPathValid = false;
    this.segmentSelectionMode = "";
  }

  getObjectTypeLabel(objectApiName) {
    const normalized = this.normalizeString(objectApiName)?.toLowerCase();

    switch (normalized) {
      case "sitetracker__site__c":
        return "Site";
      case "sitetracker__segment__c":
        return "Segment";
      case "sitetracker__area__c":
        return "Area";
      case WORK_LOG_OBJECT_API_NAME.toLowerCase():
        return "Work Log";
      default:
        return "Record";
    }
  }

  dispatchToast(title, message, variant) {
    this.dispatchEvent(
      new ShowToastEvent({
        title,
        message,
        variant
      })
    );
  }

  normalizeString(value) {
    return typeof value === "string" ? value.trim() : value;
  }

  reduceRecordEditError(detail) {
    if (!detail) {
      return "";
    }

    const fieldErrors = detail.output?.fieldErrors || {};
    const fieldMessages = Object.values(fieldErrors)
      .flat()
      .map((item) => item?.message)
      .filter((message) => Boolean(message));

    const pageErrors = Array.isArray(detail.output?.errors)
      ? detail.output.errors.map((item) => item?.message).filter((message) => Boolean(message))
      : [];

    if (fieldMessages.length || pageErrors.length) {
      return [...fieldMessages, ...pageErrors].join("; ");
    }

    if (typeof detail.message === "string") {
      return detail.message;
    }

    return "";
  }

  reduceError(error) {
    if (!error) {
      return "Unknown error.";
    }

    if (Array.isArray(error?.body)) {
      return error.body.map((item) => item.message).join(", ");
    }

    if (typeof error?.body?.message === "string") {
      return error.body.message;
    }

    if (typeof error?.message === "string") {
      return error.message;
    }

    return "Unknown error.";
  }
}
