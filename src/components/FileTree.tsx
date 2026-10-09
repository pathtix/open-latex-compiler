import { BookOpen, ChevronRight, Download, File, FileCode2, FilePlus2, FileText, FolderClosed, FolderOpen, FolderPlus, Image, Pencil, Star, Trash2, Upload, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type TreeNode } from "../lib/api";
import { useStore } from "../lib/store";
import { confirmAction, contextMenu, prompt } from "./overlays";
import { MenuItem, MenuSeparator } from "./ui";

const expandedKey = (id: string) => `latexcompile.expanded.${id}`;

export function fileIcon(name: string, size = 14) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "tex" || ext === "ltx") return <FileText size={size} />;
  if (ext === "bib") return <BookOpen size={size} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "eps", "pdf"].includes(ext ?? "")) return <Image size={size} />;
  if (["cls", "sty", "bst", "bbx", "cbx", "def", "lua", "py", "json", "yaml", "yml"].includes(ext ?? "")) return <FileCode2 size={size} />;
  return <File size={size} />;
}

function parentDir(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export function newFile(dir: string) {
  const st = useStore.getState();
  prompt({
    title: "New file",
    label: dir ? `In ${dir}/` : "In project root",
    initial: "untitled.tex",
    confirm: "Create",
    selectBase: true,
    onSubmit: (name) => st.createFile(join(dir, name)),
  });
}

export function newFolder(dir: string) {
  prompt({
    title: "New folder",
    label: dir ? `In ${dir}/` : "In project root",
    initial: "figures",
    confirm: "Create",
    onSubmit: (name) => useStore.getState().createFolder(join(dir, name)),
  });
}

export function pickAndUpload(dir: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length) void useStore.getState().uploadFiles(dir, files);
  };
  input.click();
}

export function FileTree() {
  const tree = useStore((s) => s.tree);
  const project = useStore((s) => s.project)!;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(expandedKey(project.id)) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(expandedKey(project.id), JSON.stringify([...expanded]));
    } catch {}
  }, [expanded, project.id]);

  // Reveal the active file's folders.
  const active = useStore((s) => s.active);
  useEffect(() => {
    if (!active) return;
    const parts = active.split("/").slice(0, -1);
    if (!parts.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        next.add(acc);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [active]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const onDrop = async (e: React.DragEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const st = useStore.getState();
    const moved = e.dataTransfer.getData("application/x-latexcompile-path");
    if (moved) {
      const target = join(dir, moved.split("/").pop()!);
      if (target !== moved && parentDir(moved) !== dir) {
        try {
          await st.renamePath(moved, target);
        } catch (err) {
          st.toast((err as Error).message, "error");
        }
      }
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length) await st.uploadFiles(dir, files);
  };

  const dropProps = (dir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes("application/x-latexcompile-path") ? "move" : "copy";
      setDropTarget(dir);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropTarget((d) => (d === dir ? null : d));
    },
    onDrop: (e: React.DragEvent) => void onDrop(e, dir),
  });

  return (
    <div
      className={`file-tree${dropTarget === "" ? " drop-root" : ""}`}
      {...dropProps("")}
      onContextMenu={(e) =>
        contextMenu(e, (close) => (
          <>
            <MenuItem icon={<FilePlus2 size={14} />} label="New file" onClick={() => (close(), newFile(""))} />
            <MenuItem icon={<FolderPlus size={14} />} label="New folder" onClick={() => (close(), newFolder(""))} />
            <MenuItem icon={<Upload size={14} />} label="Upload files" onClick={() => (close(), pickAndUpload(""))} />
          </>
        ))
      }
    >
      {tree.length === 0 && <div className="empty-hint">No files yet. Drop files here or create one.</div>}
      <Nodes nodes={tree} depth={0} expanded={expanded} toggle={toggle} dropTarget={dropTarget} dropProps={dropProps} />
    </div>
  );
}

function Nodes(props: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  toggle: (p: string) => void;
  dropTarget: string | null;
  dropProps: (dir: string) => Record<string, unknown>;
}) {
  return (
    <>
      {props.nodes.map((n) => (
        <NodeRow key={n.path} node={n} {...props} />
      ))}
    </>
  );
}

function NodeRow({
  node,
  depth,
  expanded,
  toggle,
  dropTarget,
  dropProps,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (p: string) => void;
  dropTarget: string | null;
  dropProps: (dir: string) => Record<string, unknown>;
}) {
  const active = useStore((s) => s.active === node.path);
  const dirty = useStore((s) => {
    const d = s.docs[node.path];
    return !!d && d.content !== d.saved;
  });
  const settings = useStore((s) => s.settings);
  const mainFile = settings?.mainFile || settings?.detectedMain;
  const isDir = node.type === "dir";
  const open = isDir && expanded.has(node.path);
  const isMain = !isDir && node.path === mainFile;

  const menu = useMemo(
    () => (e: React.MouseEvent) => {
      const st = useStore.getState();
      const dir = isDir ? node.path : parentDir(node.path);
      contextMenu(e, (close) => (
        <>
          {isDir && (
            <>
              <MenuItem icon={<FilePlus2 size={14} />} label="New file" onClick={() => (close(), newFile(dir))} />
              <MenuItem icon={<FolderPlus size={14} />} label="New folder" onClick={() => (close(), newFolder(dir))} />
              <MenuItem icon={<Upload size={14} />} label="Upload files" onClick={() => (close(), pickAndUpload(dir))} />
              <MenuSeparator />
            </>
          )}
          {!isDir && /\.tex$/i.test(node.path) && (
            <MenuItem
              icon={<Star size={14} />}
              label={isMain ? "Main document" : "Set as main document"}
              disabled={isMain}
              onClick={() => {
                close();
                void st.saveSettings({ mainFile: node.path }).then(() => st.compile());
              }}
            />
          )}
          <MenuItem
            icon={<Pencil size={14} />}
            label="Rename"
            onClick={() => {
              close();
              prompt({
                title: `Rename ${isDir ? "folder" : "file"}`,
                initial: node.path,
                confirm: "Rename",
                selectBase: !isDir,
                onSubmit: (to) => st.renamePath(node.path, to),
              });
            }}
          />
          {!isDir && <MenuItem icon={<Download size={14} />} label="Download" onClick={() => (close(), window.open(api.fileUrl(st.project!.id, node.path, true)))} />}
          <MenuItem icon={<ScanSearch size={14} />} label="Reveal in file manager" onClick={() => (close(), void api.reveal(st.project!.id, node.path))} />
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 size={14} />}
            label="Delete"
            danger
            onClick={() => {
              close();
              confirmAction({
                title: `Delete ${node.name}?`,
                body: (
                  <>
                    <b>{node.path}</b> will be moved to the Open LaTeX Compiler trash (<code>~/.latexcompile/trash</code>), so it can still be recovered.
                  </>
                ),
                onConfirm: () => st.deletePath(node.path),
              });
            }}
          />
        </>
      ));
    },
    [node.path, node.name, isDir, isMain],
  );

  return (
    <>
      <div
        className={`tree-row${active ? " active" : ""}${isDir && dropTarget === node.path ? " drop" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (isDir ? toggle(node.path) : void useStore.getState().openFile(node.path))}
        onContextMenu={menu}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-latexcompile-path", node.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        title={node.path}
        {...(isDir ? dropProps(node.path) : {})}
      >
        {isDir ? <ChevronRight size={13} className={`chev${open ? " open" : ""}`} /> : <span className="chev-space" />}
        <span className="tree-icon">{isDir ? open ? <FolderOpen size={14} /> : <FolderClosed size={14} /> : fileIcon(node.name)}</span>
        <span className="tree-name">{node.name}</span>
        {isMain && <span className="badge">main</span>}
        {dirty && <span className="dirty-dot" />}
      </div>
      {open && node.children && (
        <Nodes nodes={node.children} depth={depth + 1} expanded={expanded} toggle={toggle} dropTarget={dropTarget} dropProps={dropProps} />
      )}
    </>
  );
}
