import { App, ButtonComponent, Modal, Notice, TFile } from "obsidian";
import { DiffMatchPatch } from "diff-match-patch-ts";
import HistoryService from "../history";
import { VersionRecord, FileRecord } from "../db";

type PreviewMode = "view" | "diff";

export default class HistoryModal extends Modal {
  private history: HistoryService;
  private file: TFile;
  private fileRecord: FileRecord | null = null;
  private versions: VersionRecord[] = [];
  private selectedVersion: VersionRecord | null = null;
  private previewMode: PreviewMode = "view";
  private dmp: DiffMatchPatch;

  private listEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private diffToggle!: HTMLInputElement;
  private restoreButton!: ButtonComponent;
  private previewRequestId = 0;

  constructor(app: App, history: HistoryService, file: TFile) {
    super(app);
    this.history = history;
    this.file = file;
    this.dmp = new DiffMatchPatch();
  }

  onOpen(): void {
    this.modalEl.addClass("obsync-history-modal");
    this.contentEl.empty();

    const headerEl = this.contentEl.createDiv({ cls: "obsync-history-header" });
    headerEl.createEl("h3", {
      text: `Version history: ${this.file.name}`,
      cls: "obsync-history-title",
    });

    const actionsEl = headerEl.createDiv({ cls: "obsync-history-actions" });

    const toggleContainer = actionsEl.createDiv({ cls: "obsync-toggle-container" });
    toggleContainer.createSpan({ text: "Show changes", cls: "obsync-toggle-label" });

    const toggleLabel = toggleContainer.createEl("label", { cls: "obsync-toggle-wrapper" });
    this.diffToggle = toggleLabel.createEl("input", {
      type: "checkbox",
      cls: "obsync-toggle-input"
    });
    toggleLabel.createDiv({ cls: "obsync-toggle-slider" });

    this.diffToggle.addEventListener("change", () => {
      this.previewMode = this.diffToggle.checked ? "diff" : "view";
      void this.renderPreview();
    });

    this.restoreButton = new ButtonComponent(actionsEl)
      .setButtonText("Restore")
      .setCta()
      .onClick(() => void this.restoreSelected());

    const bodyEl = this.contentEl.createDiv({ cls: "obsync-history-body" });
    const listContainer = bodyEl.createDiv({ cls: "obsync-history-list" });
    this.listEl = listContainer.createDiv({ cls: "obsync-history-list-items" });
    this.previewEl = bodyEl.createDiv({ cls: "obsync-history-preview" });

    void this.loadVersions();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadVersions(): Promise<void> {
    this.fileRecord = this.history.getFile(this.file.path);
    if (!this.fileRecord) {
      this.renderEmptyState("No history found for this file.");
      return;
    }

    const versions = this.history.getVersions(this.file.path);
    if (versions.length === 0) {
      this.renderEmptyState("No versions available yet.");
      return;
    }

    this.versions = versions.sort((a, b) => b.version_num - a.version_num);
    this.selectedVersion = this.versions[0] ?? null;
    this.renderVersionList();
    this.diffToggle.disabled = false;
    this.restoreButton.setDisabled(!this.selectedVersion);
    await this.renderPreview();
  }

  private renderEmptyState(message: string): void {
    this.listEl.empty();
    this.previewEl.empty();
    this.listEl.createDiv({ text: message, cls: "obsync-history-empty" });
    this.previewEl.createDiv({ text: message, cls: "obsync-history-empty" });
    this.diffToggle.disabled = true;
    this.restoreButton.setDisabled(true);
  }

  private renderVersionList(): void {
    this.listEl.empty();
    for (const version of this.versions) {
      const item = this.listEl.createDiv({
        cls: "obsync-history-version-item",
        text: this.formatTimestamp(version.created_at),
      });
      if (this.selectedVersion?.id === version.id) {
        item.addClass("is-selected");
      }
      item.addEventListener("click", () => {
        this.selectedVersion = version;
        this.renderVersionList();
        void this.renderPreview();
      });
    }
  }

  private async renderPreview(): Promise<void> {
    if (!this.selectedVersion || !this.fileRecord) {
      return;
    }

    const requestId = ++this.previewRequestId;
    this.previewEl.empty();
    this.previewEl.createDiv({ text: "Loading…", cls: "obsync-history-loading" });

    const content = await this.history.reconstructVersion(
      this.fileRecord.id,
      this.selectedVersion.version_num
    );

    if (requestId !== this.previewRequestId) {
      return;
    }

    this.previewEl.empty();
    const pre = this.previewEl.createEl("pre", {
      cls: "obsync-history-preview-text",
    });

    if (this.previewMode === "view") {
      pre.textContent = content;
      return;
    }

    const previousContent = await this.getPreviousContent();
    if (requestId !== this.previewRequestId) {
      return;
    }

    const diffs = this.dmp.diff_main(previousContent, content);
    this.dmp.diff_cleanupSemantic(diffs);
    for (const [op, text] of diffs) {
      const span = document.createElement("span");
      if (op === 1) {
        span.classList.add("obsync-history-diff-add");
      } else if (op === -1) {
        span.classList.add("obsync-history-diff-del");
      }
      span.textContent = text;
      pre.appendChild(span);
    }
  }

  private async getPreviousContent(): Promise<string> {
    if (!this.selectedVersion || !this.fileRecord) {
      return "";
    }
    if (this.selectedVersion.version_num <= 1) {
      return "";
    }
    return this.history.reconstructVersion(
      this.fileRecord.id,
      this.selectedVersion.version_num - 1
    );
  }

  private async restoreSelected(): Promise<void> {
    if (!this.selectedVersion) {
      return;
    }

    const label = this.formatTimestamp(this.selectedVersion.created_at);
    const confirmed = window.confirm(
      `Restore ${this.file.name} to version from ${label}?`
    );
    if (!confirmed) {
      return;
    }

    await this.history.restore(this.file.path, this.selectedVersion.version_num);
    new Notice(`Restored ${this.file.name} to ${label}`);
    this.close();
  }

  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate();

    const timeText = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    if (sameDay) {
      return `Today ${timeText}`;
    }

    if (isYesterday) {
      return `Yesterday ${timeText}`;
    }

    const dateText = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== now.getFullYear()
        ? { year: "numeric" }
        : {}),
    });

    return `${dateText}, ${timeText}`;
  }
}
