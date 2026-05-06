import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  FolderSearch,
  FolderClosed,
  FolderOpen,
  FileText,
  Check,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button, Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useUploadStore } from "@/stores/upload-store";
import { useLibraryStore } from "@/stores/library-store";
import { StorageUsageBar } from "./StorageUsageBar";

interface DeviceBookScanModalProps {
  open: boolean;
  onClose: () => void;
}

type FileStatus = "pending" | "uploading" | "done" | "skipped" | "error";

interface FileNode {
  kind: "file";
  id: string;
  name: string;
  path: string;
  file: File;
  size: number;
  status: FileStatus;
  message?: string;
}

interface FolderNode {
  kind: "folder";
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
}

type TreeNode = FileNode | FolderNode;

const PDF_EXT = /\.pdf$/i;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

/**
 * Scans a folder selected by the user for book files (PDFs) and lets
 * the user pick which to upload. Renders the folder structure as a
 * checkable tree — toggling a folder cascades to all its descendants.
 *
 * Uses the non-standard but widely supported `webkitdirectory`
 * attribute so we don't need a native bridge — works in browsers and
 * Tauri's webview.
 */
export function DeviceBookScanModal({ open, onClose }: DeviceBookScanModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  // File-level selection. Folder checked-state is derived (all children
  // selected = checked, some = indeterminate, none = unchecked).
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const uploadPdf = useUploadStore((s) => s.uploadPdf);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);

  useEffect(() => {
    if (open) {
      fetchStorageUsage();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local state when the modal opens
      setTree([]);
      setSelectedFileIds(new Set());
      setExpandedFolders(new Set());
      setIsScanning(false);
      setImporting(false);
      setImportDone(false);
      setScanError(null);
    }
  }, [open, fetchStorageUsage]);

  const triggerScan = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = ""; // reset so re-scanning the same dir fires change
    if (!files || files.length === 0) return;

    setIsScanning(true);
    setScanError(null);

    // Walk the FileList building a tree keyed by path segments.
    const root: TreeNode[] = [];
    const folderMap = new Map<string, FolderNode>();
    const allFileIds: string[] = [];
    const allFolderIds: string[] = [];

    function getOrCreateFolder(segments: string[]): TreeNode[] {
      // Returns the children array of the folder denoted by `segments`.
      // Creates intermediate folders as needed.
      let parentList = root;
      let runningPath = "";
      for (const seg of segments) {
        runningPath = runningPath ? `${runningPath}/${seg}` : seg;
        let folder = folderMap.get(runningPath);
        if (!folder) {
          folder = {
            kind: "folder",
            id: `dir:${runningPath}`,
            name: seg,
            path: runningPath,
            children: [],
          };
          folderMap.set(runningPath, folder);
          allFolderIds.push(folder.id);
          parentList.push(folder);
        }
        parentList = folder.children;
      }
      return parentList;
    }

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!PDF_EXT.test(f.name)) continue;
      const rel =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name;
      const segments = rel.split("/");
      const fileName = segments.pop() ?? f.name;
      const childList = getOrCreateFolder(segments);
      const id = `file:${rel}::${f.size}::${f.lastModified}`;
      childList.push({
        kind: "file",
        id,
        name: fileName,
        path: rel,
        file: f,
        size: f.size,
        status: "pending",
      });
      allFileIds.push(id);
    }

    // Sort each folder's children: folders first, then files, both alpha.
    function sortChildren(list: TreeNode[]) {
      list.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const node of list) {
        if (node.kind === "folder") sortChildren(node.children);
      }
    }
    sortChildren(root);

    setTree(root);
    // Default: everything selected, every folder expanded.
    setSelectedFileIds(new Set(allFileIds));
    setExpandedFolders(new Set(allFolderIds));
    setIsScanning(false);

    if (allFileIds.length === 0) {
      setScanError("No PDF files were found in that folder.");
    }
  }, []);

  // Flatten helpers — used both to derive folder check-state and to
  // walk all file nodes during import.
  const allFiles: FileNode[] = useMemo(() => {
    const out: FileNode[] = [];
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.kind === "file") out.push(n);
        else walk(n.children);
      }
    }
    walk(tree);
    return out;
  }, [tree]);

  const collectDescendantFileIds = useCallback(
    (node: TreeNode): string[] => {
      const out: string[] = [];
      function walk(n: TreeNode) {
        if (n.kind === "file") out.push(n.id);
        else for (const c of n.children) walk(c);
      }
      walk(node);
      return out;
    },
    [],
  );

  const folderState = useCallback(
    (node: FolderNode): "all" | "some" | "none" => {
      const ids = collectDescendantFileIds(node);
      if (ids.length === 0) return "none";
      let selected = 0;
      for (const id of ids) if (selectedFileIds.has(id)) selected++;
      if (selected === 0) return "none";
      if (selected === ids.length) return "all";
      return "some";
    },
    [collectDescendantFileIds, selectedFileIds],
  );

  const toggleFile = useCallback((id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFolder = useCallback(
    (folder: FolderNode) => {
      const ids = collectDescendantFileIds(folder);
      const state = folderState(folder);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (state === "all") {
          for (const id of ids) next.delete(id);
        } else {
          // any partial → check all
          for (const id of ids) next.add(id);
        }
        return next;
      });
    },
    [collectDescendantFileIds, folderState],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const ids: string[] = [];
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.kind === "folder") {
          ids.push(n.id);
          walk(n.children);
        }
      }
    }
    walk(tree);
    setExpandedFolders(new Set(ids));
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFileIds(new Set(allFiles.map((f) => f.id)));
  }, [allFiles]);

  const selectNone = useCallback(() => {
    setSelectedFileIds(new Set());
  }, []);

  const selectedFiles = allFiles.filter((f) => selectedFileIds.has(f.id));
  const selectedBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0);
  const remainingBytes = storageUsage
    ? storageUsage.limitBytes - storageUsage.usedBytes
    : Infinity;
  const wouldExceed = selectedBytes > remainingBytes;

  // Update a single file's status — used during the import loop.
  const updateFileStatus = useCallback(
    (id: string, patch: Partial<Pick<FileNode, "status" | "message">>) => {
      setTree((prev) => {
        function walk(nodes: TreeNode[]): TreeNode[] {
          return nodes.map((n) => {
            if (n.kind === "file") {
              return n.id === id ? { ...n, ...patch } : n;
            }
            return { ...n, children: walk(n.children) };
          });
        }
        return walk(prev);
      });
    },
    [],
  );

  const startImport = useCallback(async () => {
    if (selectedFiles.length === 0 || wouldExceed) return;
    setImporting(true);

    for (const item of selectedFiles) {
      updateFileStatus(item.id, { status: "uploading" });
      try {
        const { bookId, error } = await uploadPdf(item.file);
        if (bookId) {
          updateFileStatus(item.id, { status: "done" });
        } else {
          updateFileStatus(item.id, {
            status: error?.toLowerCase().includes("already")
              ? "skipped"
              : "error",
            message: error ?? "Upload failed",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        updateFileStatus(item.id, { status: "error", message: msg });
      }
    }

    await fetchLibrary(true);
    await fetchStorageUsage();
    setImporting(false);
    setImportDone(true);
  }, [
    selectedFiles,
    wouldExceed,
    uploadPdf,
    updateFileStatus,
    fetchLibrary,
    fetchStorageUsage,
  ]);

  const handleClose = useCallback(() => {
    if (importing) return;
    onClose();
  }, [importing, onClose]);

  if (!open) return null;

  const successCount = allFiles.filter((s) => s.status === "done").length;
  const skippedCount = allFiles.filter((s) => s.status === "skipped").length;
  const errorCount = allFiles.filter((s) => s.status === "error").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-glass-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Scan folder for books
          </h2>
          <button
            onClick={handleClose}
            disabled={importing}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tree.length === 0 ? (
            <div
              onClick={isScanning ? undefined : triggerScan}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-glass-border p-10 transition-colors hover:border-accent-purple/50",
                isScanning && "cursor-wait",
              )}
            >
              <FolderSearch size={32} className="text-text-muted" />
              <p className="text-sm text-text-primary">
                Pick a folder to scan for PDFs
              </p>
              <p className="text-center text-xs text-text-muted">
                Every PDF inside the folder (and its subfolders) is shown as
                a tree. Everything is ticked by default — uncheck the ones
                you don't want, then click Import.
              </p>
              {scanError && (
                <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
                  {scanError}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Selection summary + bulk actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
                <div>
                  Found <strong>{allFiles.length}</strong>{" "}
                  {allFiles.length === 1 ? "file" : "files"} ·{" "}
                  <strong>{selectedFileIds.size}</strong> selected (
                  {formatBytes(selectedBytes)})
                </div>
                {!importing && !importDone && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={selectAll}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Select all
                    </button>
                    <button
                      onClick={selectNone}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Select none
                    </button>
                    <button
                      onClick={expandAll}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Expand all
                    </button>
                    <button
                      onClick={collapseAll}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Collapse all
                    </button>
                    <button
                      onClick={triggerScan}
                      className="rounded border border-glass-border px-2 py-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      Rescan
                    </button>
                  </div>
                )}
              </div>

              {/* Storage warning */}
              {wouldExceed && !importing && !importDone && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
                  <p className="text-xs text-red-400">
                    The selected files exceed your remaining storage (
                    {storageUsage ? formatBytes(remainingBytes) : "—"} left).
                    Uncheck some files or upgrade to Premium.
                  </p>
                </div>
              )}

              {storageUsage && (
                <StorageUsageBar
                  usedBytes={storageUsage.usedBytes}
                  limitBytes={storageUsage.limitBytes}
                  tier={storageUsage.tier}
                />
              )}

              {/* Tree */}
              <div className="overflow-hidden rounded-lg border border-glass-border">
                <ul>
                  {tree.map((node) => (
                    <TreeRow
                      key={node.id}
                      node={node}
                      depth={0}
                      expanded={expandedFolders}
                      onToggleExpanded={toggleExpanded}
                      onToggleFile={toggleFile}
                      onToggleFolder={toggleFolder}
                      selectedFileIds={selectedFileIds}
                      folderState={folderState}
                      readOnly={importing || importDone}
                    />
                  ))}
                </ul>
              </div>

              {/* Import summary after run */}
              {importDone && (
                <div className="rounded-lg border border-glass-border bg-glass-bg/50 p-3 text-sm">
                  <p className="text-text-primary">
                    Imported <strong>{successCount}</strong>, skipped{" "}
                    <strong>{skippedCount}</strong> (already in library),
                    failed <strong>{errorCount}</strong>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-glass-border p-4">
          {importDone ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={handleClose}
                disabled={importing}
              >
                Cancel
              </Button>
              {tree.length > 0 && (
                <Button
                  onClick={startImport}
                  disabled={importing || selectedFileIds.size === 0 || wouldExceed}
                >
                  {importing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Import {selectedFileIds.size}{" "}
                      {selectedFileIds.size === 1 ? "file" : "files"}
                    </>
                  )}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Hidden directory input */}
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error: `webkitdirectory` is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onToggleFile: (id: string) => void;
  onToggleFolder: (node: FolderNode) => void;
  selectedFileIds: Set<string>;
  folderState: (node: FolderNode) => "all" | "some" | "none";
  readOnly: boolean;
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggleExpanded,
  onToggleFile,
  onToggleFolder,
  selectedFileIds,
  folderState,
  readOnly,
}: TreeRowProps) {
  const indent = depth * 16;

  if (node.kind === "file") {
    const isSelected = selectedFileIds.has(node.id);
    return (
      <li
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 text-sm transition-colors hover:bg-glass-hover",
          node.status === "done" && "bg-green-500/5",
          node.status === "error" && "bg-red-500/5",
          node.status === "skipped" && "bg-amber-500/5",
        )}
        style={{ paddingLeft: 8 + indent }}
      >
        {!readOnly && (
          <Checkbox
            checked={isSelected}
            onChange={() => onToggleFile(node.id)}
          />
        )}
        {/* spacer matching folder chevron */}
        <span className="inline-block w-4" />
        <FileText size={14} className="shrink-0 text-accent-purple" />
        <span className="min-w-0 flex-1 truncate text-text-primary">
          {node.name}
        </span>
        <span className="shrink-0 text-xs text-text-muted">
          {formatBytes(node.size)}
        </span>
        <FileStatusBadge node={node} />
      </li>
    );
  }

  const isExpanded = expanded.has(node.id);
  const state = folderState(node);

  return (
    <>
      <li
        className="flex items-center gap-2 px-2 py-1.5 text-sm transition-colors hover:bg-glass-hover"
        style={{ paddingLeft: 8 + indent }}
      >
        {!readOnly && (
          <Checkbox
            checked={state === "all"}
            indeterminate={state === "some"}
            onChange={() => onToggleFolder(node)}
          />
        )}
        <button
          onClick={() => onToggleExpanded(node.id)}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <ChevronRight
            size={12}
            className={cn(
              "transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        {isExpanded ? (
          <FolderOpen size={14} className="shrink-0 text-accent-purple/70" />
        ) : (
          <FolderClosed size={14} className="shrink-0 text-accent-purple/70" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
          {node.name}
        </span>
        <span className="shrink-0 text-xs text-text-muted">
          {countFiles(node)} {countFiles(node) === 1 ? "file" : "files"}
        </span>
      </li>
      {isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            onToggleFile={onToggleFile}
            onToggleFolder={onToggleFolder}
            selectedFileIds={selectedFileIds}
            folderState={folderState}
            readOnly={readOnly}
          />
        ))}
    </>
  );
}

function countFiles(node: TreeNode): number {
  if (node.kind === "file") return 1;
  let n = 0;
  for (const c of node.children) n += countFiles(c);
  return n;
}

function FileStatusBadge({ node }: { node: FileNode }) {
  switch (node.status) {
    case "uploading":
      return (
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" />
          Uploading
        </span>
      );
    case "done":
      return (
        <span className="flex items-center gap-1 text-xs text-green-400">
          <Check size={12} />
          Imported
        </span>
      );
    case "skipped":
      return (
        <span className="text-xs text-amber-400" title={node.message}>
          Skipped
        </span>
      );
    case "error":
      return (
        <span
          className="flex items-center gap-1 text-xs text-red-400"
          title={node.message}
        >
          <AlertTriangle size={12} />
          Failed
        </span>
      );
    default:
      return null;
  }
}
