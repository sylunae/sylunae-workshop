import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Cake,
  Check,
  Archive,
  ArchiveRestore,
  Clipboard,
  Copy,
  ExternalLink,
  FileImage,
  AudioLines,
  ArrowLeftRight,
  ArrowUpDown,
  Link2,
  Music,
  Pencil,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useAppStore } from "../app/AppStore";
import { workspaceHref, type WorkspaceView } from "../app/workspaceRoutes";
import { WorkspaceLink } from "../components/WorkspaceLink";
import type { ClipboardSnippet, LauncherLink } from "../shared/types";
import { newId, nowIso } from "../utils";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { usePersistentState } from "../lib/usePersistentState";
import { isAndroid } from "../platform/environment";
import { BirthdayTool } from '../components/BirthdayTool';
import { AudioEditor } from "../components/AudioEditor";
import { ImageProcessor } from "../components/ImageProcessor";
import { FormatConverter } from "../components/FormatConverter";

type ToolView = WorkspaceView<"tools">;
type ClipboardSort = "recent" | "frequent";

const tempoAnalyzerUrl = "https://tuanziai.com/audio-tools/tempo-analyze";

const toolCards = [
  { id: "music-toolbox" as const, title: "音乐工具箱", description: "在工坊内使用团子 AI 的节拍分析与校准工具。", icon: Music, accent: "blue" },
  { id: "conversion" as const, title: "格式转换", description: "识别图片、视频、音频与文档格式，批量转换或提取音轨。", icon: ArrowLeftRight, accent: "blue" },
  { id: "birthdays" as const, title: "生日通知", description: "记住重要的日子，提前送来生日提醒与祝福。", icon: Cake, accent: "rose" },
  {
    id: "clipboard" as const,
    title: "剪贴板",
    description: "保存常用文本、代码、颜文字和 Prompt，需要时一键复制。",
    icon: Clipboard,
    accent: "lilac",
  },
  {
    id: "launcher" as const,
    title: "链接启动器",
    description: "集中常用网站和页面，让重要链接不再散落各处。",
    icon: Link2,
    accent: "blue",
  },
  {
    id: "image" as const,
    title: "图片处理",
    description: "裁剪、旋转图片，批量转换格式与压缩。",
    icon: FileImage,
    accent: "green",
  },
  {
    id: "audio" as const,
    title: "音频剪辑器",
    description: "裁剪音频片段，调整音量与淡入淡出，并在本地导出 WAV。",
    icon: AudioLines,
    accent: "rose",
  },
];

export function ToolsPage({
  view,
  onViewChange,
}: {
  view: ToolView;
  onViewChange: (view: ToolView) => void;
}) {
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0 });
  }, [view]);
  const showMusicToolbox = view === "music-toolbox";
  return (
    <section ref={pageRef} className={showMusicToolbox ? "page tools-page music-toolbox-page" : "page tools-page"}>
      <header className="page-header">
        <div>
          <span className="eyebrow">UTILITY BOX</span>
          <h1>{showMusicToolbox ? "音乐工具箱" : "工具箱"}</h1>
          <p>
            {view === "home" ? (
              "轻量、顺手，并且只在需要时出现"
            ) : (
              <WorkspaceLink className="back-link" href={workspaceHref("tools", "home")} onNavigate={() => onViewChange("home")}>
                ← 返回全部工具
              </WorkspaceLink>
            )}
          </p>
        </div>
        {showMusicToolbox && (
          <Button
            variant="outline"
            onClick={() => {
              void (window.sylunae?.system.openExternal(tempoAnalyzerUrl) ??
                window.open(tempoAnalyzerUrl, "_blank", "noopener,noreferrer"));
            }}
          >
            <ExternalLink />
            在浏览器中打开
          </Button>
        )}
      </header>
      {view === "home" && (
        <>
          <div className="tool-card-grid">
            {toolCards.map(({ id, title, description, icon: Icon, accent }) => (
              <WorkspaceLink
                key={id}
                className="tool-entry-card"
                href={workspaceHref("tools", id)}
                onNavigate={() => onViewChange(id)}
              >
                <span className={`tool-entry-icon ${accent}`}>
                  <Icon size={23} />
                </span>
                <strong>{title}</strong>
                <p>{description}</p>
                <span className="tool-entry-action">
                  打开工具 <span>→</span>
                </span>
              </WorkspaceLink>
            ))}
          </div>
        </>
      )}
      {view === "clipboard" && <ClipboardTool />}
      {view === "launcher" && <LauncherTool />}
      {view === "image" && <ImageProcessor />}
      {view === "audio" && <AudioEditor />}
      {showMusicToolbox && (
        isAndroid ? (
          <p>在浏览器中打开团子 AI，使用节拍分析与校准工具。</p>
        ) : (
          <iframe
            className="music-toolbox-frame"
            title="团子 AI 节拍分析校准"
            src={tempoAnalyzerUrl}
            sandbox="allow-scripts allow-same-origin allow-downloads"
            referrerPolicy="no-referrer"
          />
        )
      )}
      {view === "conversion" && <FormatConverter />}
      {view === "birthdays" && <BirthdayTool />}
    </section>
  );
}

function ClipboardTool() {
  const { snapshot, update } = useAppStore();
  const items = snapshot?.clipboardSnippets ?? [];
  const [query, setQuery] = useState("");
  const [sort, setSort] = usePersistentState<ClipboardSort>("clipboard.shortcutSort", "recent");
  const [copied, setCopied] = useState<string | null>(null);
  const visible = useMemo(() => {
    const search = query.toLowerCase();
    return items.filter((item) =>
      `${item.title} ${item.content}`.toLowerCase().includes(search),
    ).sort((left, right) => {
      const newestFirst = right.createdAt.localeCompare(left.createdAt);
      return sort === "frequent" ? right.copyCount - left.copyCount || newestFirst : newestFirst;
    });
  }, [items, query, sort]);
  const quickSave = (content: string, title: string) => {
    const now = nowIso();
    const item = {
      title, content,
      id: newId(), copyCount: 0, createdAt: now, updatedAt: now,
    };
    update((state) => ({
      ...state,
      clipboardSnippets: [item, ...state.clipboardSnippets],
    }));
    setQuery("");
  };
  const updateSnippet = (
    id: string,
    patch: Pick<ClipboardSnippet, "title" | "content">,
  ) =>
    update((state) => ({
      ...state,
      clipboardSnippets: state.clipboardSnippets.map((item) =>
        item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item,
      ),
    }));
  const copy = async (item: ClipboardSnippet) => {
    await navigator.clipboard.writeText(item.content);
    update((state) => ({
      ...state,
      clipboardSnippets: state.clipboardSnippets.map((value) =>
        value.id === item.id
          ? { ...value, copyCount: value.copyCount + 1, updatedAt: nowIso() }
          : value,
      ),
    }));
    setCopied(item.id);
    window.setTimeout(() => setCopied(null), 1400);
  };
  return (
    <div className="tool-workspace">
      <div className="panel-heading">
        <h2>剪贴板</h2>
      </div>
      <QuickSnippetComposer onSave={quickSave} />
      <div className="toolbar snippet-toolbar">
        <label className="search-box">
          <Search size={16} />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索剪贴内容"
            placeholder="搜索标题或内容"
          />
        </label>
        <Select value={sort} onValueChange={(value) => setSort(value as ClipboardSort)}>
          <SelectTrigger aria-label="剪贴内容排序">
            <ArrowUpDown aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value="recent">按最近新增</SelectItem>
            <SelectItem value="frequent">按复制次数</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="snippet-grid">
        {visible.map((item) => (
          <SnippetCard
            key={item.id}
            item={item}
            copied={copied === item.id}
            onCopy={copy}
            onSave={updateSnippet}
            onDelete={() =>
              update((state) => ({
                ...state,
                clipboardSnippets: state.clipboardSnippets.filter(
                  (value) => value.id !== item.id,
                ),
              }))
            }
          />
        ))}
      </div>
      {!visible.length && query && (
        <ToolEmpty icon={<Clipboard />} text="没有匹配的剪贴内容" hint="" />
      )}
    </div>
  );
}

function QuickSnippetComposer({
  onSave,
}: {
  onSave: (content: string, title: string) => void;
}) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  return (
    <form
      className="snippet-quick-composer"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedTitle = title.trim();
        if (!trimmedTitle || !content.trim()) return;
        onSave(content, trimmedTitle);
        setContent("");
        setTitle("");
      }}
    >
      <Textarea
        autoFocus
        required
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={1}
        aria-label="粘贴内容"
        placeholder="粘贴内容"
      />
      <Input
        required
        type="text"
        enterKeyHint="done"
        aria-label="标题"
        aria-keyshortcuts="Enter"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="标题（必填）"
      />
    </form>
  );
}

function SnippetCard({
  item,
  copied,
  onCopy,
  onSave,
  onDelete,
}: {
  item: ClipboardSnippet;
  copied: boolean;
  onCopy: (item: ClipboardSnippet) => Promise<void>;
  onSave: (
    id: string,
    value: Pick<ClipboardSnippet, "title" | "content">,
  ) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  useEffect(() => {
    setTitle(item.title);
    setContent(item.content);
  }, [item.title, item.content]);
  const save = () => {
    const nextTitle = title.trim();
    setTitle(nextTitle);
    if (nextTitle !== item.title || content !== item.content) {
      onSave(item.id, { title: nextTitle, content });
    }
  };
  return (
    <article className="snippet-card">
      <div className="snippet-card-header">
        <Input
          className="snippet-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={save}
          aria-label="剪贴内容标题"
          placeholder="无标题内容"
        />
        <button
          className="icon-button danger"
          onClick={onDelete}
          aria-label={`删除 ${title || "剪贴内容"}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <Textarea
        className="snippet-content-input"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onBlur={save}
        aria-label="剪贴内容正文"
        rows={6}
        placeholder="输入剪贴内容…"
      />
      <Button
        variant="outline"
        className="button secondary self-start"
        onClick={() => void onCopy({ ...item, content })}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? "已复制" : "复制内容"}
      </Button>
    </article>
  );
}

function LauncherTool() {
  const { snapshot, update } = useAppStore();
  const links = snapshot?.launcherLinks ?? [];
  const [creating, setCreating] = useState(false);
  const [editingLink, setEditingLink] = useState<LauncherLink | null>(null);
  const [view, setView] = usePersistentState<"active" | "archived">("navigation.launcherView", "active");
  const activeLinks = links.filter((link) => !link.archived);
  const archivedLinks = links.filter((link) => link.archived);
  const visibleLinks = view === "active" ? activeLinks : archivedLinks;
  const open = (url: string) =>
    window.sylunae?.system.openExternal(url) ??
    window.open(url, "_blank", "noopener,noreferrer");
  const save = (
    input: Omit<LauncherLink, "id" | "createdAt" | "updatedAt">,
  ) => {
    const now = nowIso();
    update((state) => ({
      ...state,
      launcherLinks: [
        { ...input, archived: false, id: newId(), createdAt: now, updatedAt: now },
        ...state.launcherLinks,
      ],
    }));
    setCreating(false);
  };
  return (
    <div className="tool-workspace">
      <div className="panel-heading">
        <div>
          <h2>链接启动器</h2>
          <p>把常去的地方放在触手可及的位置</p>
        </div>
        <Button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={17} />
          添加链接
        </Button>
      </div>
      <Tabs value={view} onValueChange={(value) => setView(value as "active" | "archived")} className="launcher-view-tabs">
        <TabsList>
          <TabsTrigger value="active"><Link2 size={15} />常用 <span>{activeLinks.length}</span></TabsTrigger>
          <TabsTrigger value="archived"><Archive size={15} />归档 <span>{archivedLinks.length}</span></TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="launcher-grid">
        {visibleLinks.map((link) => {
          let host = "";
          try {
            host = new URL(link.url).hostname.replace(/^www\./, "");
          } catch {
            host = link.url;
          }
          return (
            <article
              className="launcher-card"
              key={link.id}
              role="link"
              tabIndex={0}
              aria-label={`打开 ${link.title}`}
              onClick={() => open(link.url)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  open(link.url);
                }
              }}
            >
              <div className="launcher-open">
                <SiteFavicon link={link} />
                <div>
                  <strong className="private-launcher-title">{link.title}</strong>
                  <small className="private-launcher-host">{host}</small>
                </div>
                <ExternalLink size={16} />
              </div>
              <p className={link.description ? "private-launcher-description" : undefined}>{link.description || "未添加说明"}</p>
              <div className="launcher-actions">
                <div className="launcher-actions-primary">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="launcher-edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingLink(link);
                    }}
                  >
                    <Pencil size={14} />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="launcher-archive"
                    onClick={(event) => {
                      event.stopPropagation();
                      update((state) => ({
                        ...state,
                        launcherLinks: state.launcherLinks.map((item) => item.id === link.id ? { ...item, archived: !link.archived, updatedAt: nowIso() } : item),
                      }));
                    }}
                  >
                    {link.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    {link.archived ? "恢复" : "归档"}
                  </Button>
                </div>
                <button
                  className="launcher-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    update((state) => ({
                      ...state,
                      launcherLinks: state.launcherLinks.filter(
                        (item) => item.id !== link.id,
                      ),
                    }));
                  }}
                >
                  <Trash2 size={14} />
                  移除
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!visibleLinks.length && <ToolEmpty icon={view === "active" ? <Link2 /> : <Archive />} text={view === "active" ? "添加一个常用链接，下一次打开会更快" : "归档链接会安静地保留在这里"} />}
      {creating && (
        <LinkDialog onClose={() => setCreating(false)} onSave={save} />
      )}
      {editingLink && (
        <LinkDialog
          link={editingLink}
          onClose={() => setEditingLink(null)}
          onSave={(input) => {
            const now = nowIso();
            update((state) => ({
              ...state,
              launcherLinks: state.launcherLinks.map((item) =>
                item.id === editingLink.id ? { ...item, ...input, updatedAt: now } : item,
              ),
            }));
            setEditingLink(null);
          }}
        />
      )}
    </div>
  );
}

function SiteFavicon({ link }: { link: LauncherLink }) {
  const [failed, setFailed] = useState(false);
  const fallback = link.title.slice(0, 1).toUpperCase();
  const faviconUrl = link.faviconUrl || faviconFallback(link.url);
  return (
    <span className="site-favicon" aria-label={`${link.title} 图标`}>
      {!failed && faviconUrl ? <img src={faviconUrl} alt="" onError={() => setFailed(true)} /> : fallback}
    </span>
  );
}

function faviconFallback(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return `${origin}/favicon.ico`;
  } catch {
    return null;
  }
}

function LinkDialog({
  link,
  onClose,
  onSave,
}: {
  link?: LauncherLink;
  onClose: () => void;
  onSave: (value: Omit<LauncherLink, "id" | "createdAt" | "updatedAt">) => void;
}) {
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [description, setDescription] = useState(link?.description ?? "");
  const [saving, setSaving] = useState(false);
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const submit = async () => {
    if (!title.trim() || !url.trim() || saving) return;
    setSaving(true);
    let faviconUrl: string | undefined;
    try {
      faviconUrl = link?.url === normalized
        ? link.faviconUrl
        : (await window.sylunae?.system.findFavicon(normalized)) ?? faviconFallback(normalized) ?? undefined;
    } finally {
      setSaving(false);
    }
    onSave({ title: title.trim(), url: normalized, description: description.trim(), faviconUrl });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="modal-card">
        <DialogHeader className="modal-title">
          <div>
            <span className="eyebrow">{link ? "EDIT LINK" : "NEW LINK"}</span>
            <DialogTitle>{link ? "编辑链接" : "添加链接"}</DialogTitle>
            <DialogDescription>
              会尽可能获取网站图标；获取失败时使用名称首字母。
            </DialogDescription>
          </div>
        </DialogHeader>
        <label>
          名称
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：个人博客"
          />
        </label>
        <label>
          网址
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com"
          />
        </label>
        <label>
          说明
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="这个链接是做什么的？"
          />
        </label>
        <DialogFooter className="modal-actions">
          <Button
            variant="outline"
            className="button secondary"
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            className="button primary"
            disabled={!title.trim() || !url.trim() || saving}
            onClick={() => void submit()}
          >
            {saving ? "正在获取图标…" : link ? "保存修改" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolEmpty({ icon, text, hint = "从右上角的新建按钮开始。" }: {
  icon: ReactNode;
  text: string;
  hint?: string;
}) {
  return (
    <div className="tool-empty">
      {icon}
      <strong>{text}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}
