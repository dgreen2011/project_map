import { api, LightningElement } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import createBulkWorkLogs from "@salesforce/apex/ProjectRecordMapController.createBulkWorkLogs";

const WORK_LOG_OBJECT_API_NAME = "sitetracker__Production_Work_Log__c";
const SITE_OBJECT_API_NAME = "sitetracker__Site__c";
const SEGMENT_OBJECT_API_NAME = "sitetracker__Segment__c";

const ACTUAL_RESOURCE_FIELD_API_NAME = "sitetracker__Actual_Resource__c";
const COMMENTS_FIELD_API_NAME = "sitetracker__Comments__c";

export default class ProjectRecordMapBulkWorkLogModal extends LightningElement {
  @api projectId;

  _selections = [];

  workLogDate = this.getTodayIsoDate();
  actualResourceId = "";
  comments = "";

  isSaving = false;
  hasSaveCompleted = false;

  saveError = "";
  saveSuccessMessage = "";

  createdCount = 0;
  skippedCount = 0;
  resultMessages = [];

  @api
  set selections(value) {
    this._selections = this.normalizeSelections(value);
  }

  get selections() {
    return this._selections;
  }

  get workLogObjectApiName() {
    return WORK_LOG_OBJECT_API_NAME;
  }

  get actualResourceFieldApiName() {
    return ACTUAL_RESOURCE_FIELD_API_NAME;
  }

  get commentsFieldApiName() {
    return COMMENTS_FIELD_API_NAME;
  }

  get hasSelections() {
    return this._selections.length > 0;
  }

  get showSelectionTable() {
    return this.hasSelections;
  }

  get totalSelectionCount() {
    return this._selections.length;
  }

  get siteCount() {
    return this._selections.filter((selection) => selection.objectApiName === SITE_OBJECT_API_NAME)
      .length;
  }

  get segmentCount() {
    return this._selections.filter(
      (selection) => selection.objectApiName === SEGMENT_OBJECT_API_NAME
    ).length;
  }

  get eligibleSelections() {
    return this._selections.filter((selection) => selection.isEligible);
  }

  get ineligibleSelections() {
    return this._selections.filter((selection) => !selection.isEligible);
  }

  get eligibleCount() {
    return this.eligibleSelections.length;
  }

  get ineligibleCount() {
    return this.ineligibleSelections.length;
  }

  get hasEligibleSelections() {
    return this.eligibleCount > 0;
  }

  get showPreCreateWarning() {
    return !this.hasSaveCompleted && this.ineligibleCount > 0;
  }

  get preCreateWarningText() {
    if (!this.ineligibleCount) {
      return "";
    }

    return `${this.ineligibleCount} selected record${
      this.ineligibleCount === 1 ? "" : "s"
    } do not appear to have a related Production Line Allocation and will be skipped.`;
  }

  get selectionSummaryText() {
    const parts = [];

    if (this.siteCount) {
      parts.push(`${this.siteCount} Site${this.siteCount === 1 ? "" : "s"}`);
    }

    if (this.segmentCount) {
      parts.push(`${this.segmentCount} Segment${this.segmentCount === 1 ? "" : "s"}`);
    }

    if (!parts.length) {
      return "No selected records";
    }

    return parts.join(", ");
  }

  get eligibleSummaryText() {
    if (!this.totalSelectionCount) {
      return "";
    }

    if (!this.ineligibleCount) {
      return `${this.eligibleCount} selected record${
        this.eligibleCount === 1 ? "" : "s"
      } ready for Work Log creation.`;
    }

    return `${this.eligibleCount} eligible, ${this.ineligibleCount} skipped before create.`;
  }

  get createButtonLabel() {
    if (this.isSaving) {
      return "Creating...";
    }

    return `Create Work Log${this.eligibleCount === 1 ? "" : "s"}`;
  }

  get showCreateFooter() {
    return !this.hasSaveCompleted;
  }

  get showDoneFooter() {
    return this.hasSaveCompleted;
  }

  get showResultMessages() {
    return Array.isArray(this.resultMessages) && this.resultMessages.length > 0;
  }

  get doneButtonLabel() {
    return "Done";
  }

  handleDateChange(event) {
    this.workLogDate = event.target?.value || "";
    this.saveError = "";
  }

  handleFieldChange(event) {
    const fieldKey = event.target?.dataset?.field;
    const nextValue = event.detail?.value ?? event.target?.value ?? "";

    if (fieldKey === "actualResource") {
      this.actualResourceId = nextValue || "";
    } else if (fieldKey === "comments") {
      this.comments = nextValue || "";
    }

    this.saveError = "";
  }

  handleCloseClick() {
    if (this.isSaving) {
      return;
    }

    if (this.hasSaveCompleted) {
      this.handleDoneClick();
      return;
    }

    this.dispatchEvent(new CustomEvent("close"));
  }

  handleDoneClick() {
    if (this.isSaving) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent("created", {
        detail: {
          requestedCount: this.totalSelectionCount,
          eligibleCount: this.eligibleCount,
          createdCount: this.createdCount,
          skippedCount: this.skippedCount,
          messages: [...this.resultMessages]
        }
      })
    );
  }

  async handleCreateClick() {
    if (this.isSaving) {
      return;
    }

    this.saveError = "";
    this.saveSuccessMessage = "";
    this.resultMessages = [];
    this.createdCount = 0;
    this.skippedCount = 0;

    if (!this.hasEligibleSelections) {
      this.saveError = "No eligible Sites or Segments are available to create Work Logs.";
      return;
    }

    if (!this.workLogDate) {
      this.saveError = "Date is required.";
      return;
    }

    this.isSaving = true;

    try {
      const request = {
        projectId: this.projectId || null,
        workLogDateIso: this.workLogDate,
        actualResourceId: this.actualResourceId || null,
        comments: this.normalizeString(this.comments) || null,
        selections: this.eligibleSelections.map((selection) => ({
          featureRecordId: selection.recordId,
          featureObjectApiName: selection.objectApiName
        }))
      };

      const result = await createBulkWorkLogs({ request });

      const apexMessages = Array.isArray(result?.messages)
        ? result.messages.filter((message) => Boolean(message))
        : [];

      const skippedBeforeCreateMessage = this.ineligibleCount
        ? `${this.ineligibleCount} selected record${
            this.ineligibleCount === 1 ? "" : "s"
          } were skipped before create because no related Production Line Allocation was found.`
        : "";

      this.resultMessages = [
        ...(skippedBeforeCreateMessage ? [skippedBeforeCreateMessage] : []),
        ...apexMessages
      ];

      this.createdCount = Number(result?.createdCount) || 0;
      this.skippedCount = (Number(result?.skippedCount) || 0) + this.ineligibleCount;

      if (this.createdCount <= 0) {
        this.saveError = "No Work Logs were created.";
        return;
      }

      this.hasSaveCompleted = true;
      this.saveSuccessMessage = `${this.createdCount} Work Log${
        this.createdCount === 1 ? "" : "s"
      } created successfully.`;

      if (this.skippedCount > 0) {
        this.saveSuccessMessage += ` ${this.skippedCount} selected record${
          this.skippedCount === 1 ? "" : "s"
        } were skipped.`;
      }

      this.dispatchToast("Work Logs Created", this.saveSuccessMessage, "success");
    } catch (error) {
      this.saveError = this.reduceError(error);
    } finally {
      this.isSaving = false;
    }
  }

  normalizeSelections(rawSelections) {
    const safeSelections = Array.isArray(rawSelections) ? rawSelections : [];
    const normalizedSelections = [];
    const seenKeys = new Set();

    safeSelections.forEach((selection) => {
      const recordId = this.normalizeString(selection?.recordId || selection?.featureRecordId || "");
      const objectApiName = this.toSalesforceObjectApiName(
        selection?.objectApiName || selection?.featureObjectApiName || ""
      );

      if (!recordId || !objectApiName) {
        return;
      }

      const selectionKey = `${objectApiName}::${recordId}`;
      if (seenKeys.has(selectionKey)) {
        return;
      }

      seenKeys.add(selectionKey);

      normalizedSelections.push({
        key: selectionKey,
        recordId,
        objectApiName,
        typeLabel: objectApiName === SITE_OBJECT_API_NAME ? "Site" : "Segment",
        name: this.normalizeString(selection?.name || selection?.featureName || "") || recordId,
        layerName: this.normalizeString(selection?.layerName || ""),
        isEligible: Boolean(selection?.canCreateWorkLog || selection?.productionLineAllocationId),
        productionLineAllocationId: this.normalizeString(selection?.productionLineAllocationId || "")
      });
    });

    return normalizedSelections.sort((left, right) => {
      const typeComparison = (left.typeLabel || "").localeCompare(right.typeLabel || "");
      if (typeComparison !== 0) {
        return typeComparison;
      }

      return (left.name || "").localeCompare(right.name || "");
    });
  }

  toSalesforceObjectApiName(objectApiName) {
    const normalized = this.normalizeString(objectApiName)?.toLowerCase();

    switch (normalized) {
      case SITE_OBJECT_API_NAME.toLowerCase():
        return SITE_OBJECT_API_NAME;
      case SEGMENT_OBJECT_API_NAME.toLowerCase():
        return SEGMENT_OBJECT_API_NAME;
      default:
        return "";
    }
  }

  getTodayIsoDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  normalizeString(value) {
    return typeof value === "string" ? value.trim() : value;
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
