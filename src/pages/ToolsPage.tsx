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
  Link2,
  Pencil,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useAppStore } from "../app/AppStore";
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
import { Combobox } from "../components/ui/combobox";
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
import { BirthdayTool } from '../components/BirthdayTool';
import { AudioEditor } from "../components/AudioEditor";
import { ImageProcessor } from "../components/ImageProcessor";
import { FormatConverter } from "../components/FormatConverter";

type ToolView = "home" | "clipboard" | "launcher" | "image" | "audio" | "birthdays" | "conversion";

const toolCards = [
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
  initialView = "home",
}: {
  initialView?: ToolView;
}) {
  const [view, setView] = usePersistentState<ToolView>("navigation.toolsView", initialView);
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialView !== "home") setView(initialView);
  }, [initialView, setView]);
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0 });
  }, [view]);
  return (
    <section ref={pageRef} className="page tools-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">UTILITY BOX</span>
          <h1>工具箱</h1>
          <p>
            {view === "home" ? (
              "轻量、顺手，并且只在需要时出现"
            ) : (
              <button className="back-link" onClick={() => setView("home")}>
                ← 返回全部工具
              </button>
            )}
          </p>
        </div>
      </header>
      {view === "home" && (
        <>
          <div className="tool-card-grid">
            {toolCards.map(({ id, title, description, icon: Icon, accent }) => (
              <button
                key={id}
                className="tool-entry-card"
                onClick={() => setView(id)}
              >
                <span className={`tool-entry-icon ${accent}`}>
                  <Icon size={23} />
                </span>
                <strong>{title}</strong>
                <p>{description}</p>
                <span className="tool-entry-action">
                  打开工具 <span>→</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {view === "clipboard" && <ClipboardTool />}
      {view === "launcher" && <LauncherTool />}
      {view === "image" && <ImageProcessor />}
      {view === "audio" && <AudioEditor />}
      {view === "conversion" && <FormatConverter />}
      {view === "birthdays" && <BirthdayTool />}
    </section>
  );
}

function ClipboardTool() {
  const { snapshot, update } = useAppStore();
  const items = snapshot?.clipboardSnippets ?? [];
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [focusSnippetId, setFocusSnippetId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      const category = item.category.trim();
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
      .map(([value, count]) => ({ value, label: value || "未分类", count }));
  }, [items]);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          item.category.trim() === selectedCategory &&
          `${item.title} ${item.content}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [items, query, selectedCategory],
  );
  const save = (
    input: Omit<
      ClipboardSnippet,
      "id" | "copyCount" | "createdAt" | "updatedAt"
    >,
  ) => {
    const now = nowIso();
    update((state) => ({
      ...state,
      clipboardSnippets: [
        { ...input, id: newId(), copyCount: 0, createdAt: now, updatedAt: now },
        ...state.clipboardSnippets,
      ],
    }));
  };
  const updateSnippet = (
    id: string,
    patch: Pick<ClipboardSnippet, "title" | "category" | "content">,
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
  const createCategory = () => {
    const next = newCategory.trim();
    if (!next) return;
    setSelectedCategory(next);
    setNewCategory("");
    setQuery("");
  };
  const quickSave = (content: string, title = "") => {
    const text = content.trim();
    if (!text || selectedCategory === null) return;
    const generatedTitle =
      text.split(/\r?\n/, 1)[0].slice(0, 42) || "未命名内容";
    save({
      title: title.trim() || generatedTitle,
      category: selectedCategory,
      content,
    });
    setQuery("");
  };
  const frequent = [...items]
    .filter((item) => item.copyCount > 0)
    .sort(
      (left, right) =>
        right.copyCount - left.copyCount ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, 4);
  const recent = [...items]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 4);
  const openSnippet = (item: ClipboardSnippet) => {
    setSelectedCategory(item.category.trim());
    setFocusSnippetId(item.id);
    setQuery("");
  };
  if (selectedCategory === null)
    return (
      <div className="tool-workspace">
        <div className="panel-heading">
          <div>
            <h2>剪贴板</h2>
            <p>选择一个分类，直接粘贴就能保存内容。</p>
          </div>
        </div>
        <div className="snippet-category-create">
          <Input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createCategory();
            }}
            placeholder="输入新分类名称"
          />
          <Button
            className="button primary"
            onClick={createCategory}
            disabled={!newCategory.trim()}
          >
            <Plus size={16} />
            进入新分类
          </Button>
        </div>
        <div className="snippet-category-grid">
          {categories.map((category) => (
            <button
              key={category.value || "uncategorized"}
              className="snippet-category-card"
              onClick={() => {
                setSelectedCategory(category.value);
                setQuery("");
              }}
            >
              <Clipboard size={19} />
              <span>
                <strong className={category.value ? "private-category-name" : undefined}>{category.label}</strong>
                <small>{category.count} 条内容</small>
              </span>
            </button>
          ))}
        </div>
        {!categories.length && (
          <ToolEmpty
            icon={<Clipboard />}
            text="先创建一个分类，之后直接粘贴内容"
          />
        )}
        {items.length > 0 && (
          <div className="snippet-home-sections">
            {frequent.length > 0 && (
              <SnippetShortcutSection
                title="常用内容"
                description="按复制次数排序"
                items={frequent}
                onCopy={copy}
                onEdit={openSnippet}
              />
            )}
            {recent.length > 0 && (
              <SnippetShortcutSection
                title="最近新增"
                description="快速继续编辑或复制"
                items={recent}
                onCopy={copy}
                onEdit={openSnippet}
              />
            )}
          </div>
        )}
      </div>
    );
  const categoryLabel = selectedCategory || "未分类";
  return (
    <div className="tool-workspace">
      <div className="panel-heading">
        <div>
          <button
            className="back-link snippet-back-link"
            onClick={() => {
              setSelectedCategory(null);
              setFocusSnippetId(null);
              setQuery("");
            }}
          >
            ← 全部分类
          </button>
          <h2 className={selectedCategory ? "user-content" : undefined}>{categoryLabel}</h2>
          <p>{visible.length} 条内容；在下方直接粘贴即可快速保存。</p>
        </div>
      </div>
      <QuickSnippetComposer category={selectedCategory} onSave={quickSave} />
      <div className="toolbar">
        <label className="search-box">
          <Search size={16} />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索当前分类"
          />
        </label>
      </div>
      <div className="snippet-grid">
        {visible.map((item) => (
          <SnippetCard
            key={item.id}
            item={item}
            categories={categories.map((category) => category.value)}
            copied={copied === item.id}
            highlighted={focusSnippetId === item.id}
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
      {!visible.length && (
        <ToolEmpty
          icon={<Clipboard />}
          text={query ? "没有匹配的剪贴内容" : "直接在上方粘贴第一条内容"}
        />
      )}
    </div>
  );
}

function SnippetShortcutSection({
  title,
  description,
  items,
  onCopy,
  onEdit,
}: {
  title: string;
  description: string;
  items: ClipboardSnippet[];
  onCopy: (item: ClipboardSnippet) => Promise<void>;
  onEdit: (item: ClipboardSnippet) => void;
}) {
  return (
    <section className="snippet-shortcut-section">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="snippet-shortcut-grid">
        {items.map((item) => (
          <article key={item.id} className="snippet-shortcut-card">
            <span className={item.category.trim() ? "private-category-name" : undefined}>{item.category.trim() || "未分类"}</span>
            <strong className={item.title ? "private-snippet-title" : undefined}>{item.title || "无标题内容"}</strong>
            <p className="private-snippet-content">{item.content}</p>
            <div>
              <Button
                variant="outline"
                className="button secondary"
                onClick={() => void onCopy(item)}
              >
                <Copy size={14} />
                复制
              </Button>
              <Button
                variant="ghost"
                className="button"
                onClick={() => onEdit(item)}
              >
                编辑
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function QuickSnippetComposer({
  category,
  onSave,
}: {
  category: string;
  onSave: (content: string, title?: string) => void;
}) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const submit = () => {
    onSave(content, title);
    setContent("");
    setTitle("");
  };
  return (
    <div className="snippet-quick-composer">
      <Textarea
        autoFocus
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text/plain");
          if (!pasted.trim()) return;
          event.preventDefault();
          onSave(pasted);
          setContent("");
        }}
        rows={4}
        placeholder={`在“${category || "未分类"}”中直接粘贴内容，粘贴后会立即保存`}
      />
      <div>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="标题（可选，默认取第一行）"
        />
        <Button
          className="button primary"
          onClick={submit}
          disabled={!content.trim()}
        >
          保存内容
        </Button>
      </div>
    </div>
  );
}

function SnippetCard({
  item,
  categories,
  copied,
  highlighted,
  onCopy,
  onSave,
  onDelete,
}: {
  item: ClipboardSnippet;
  categories: string[];
  copied: boolean;
  highlighted: boolean;
  onCopy: (item: ClipboardSnippet) => Promise<void>;
  onSave: (
    id: string,
    value: Pick<ClipboardSnippet, "title" | "category" | "content">,
  ) => void;
  onDelete: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState(item.category);
  const [content, setContent] = useState(item.content);
  useEffect(() => {
    setTitle(item.title);
    setCategory(item.category);
    setContent(item.content);
  }, [item]);
  const save = (
    next: Pick<ClipboardSnippet, "title" | "category" | "content">,
  ) => onSave(item.id, next);
  const normalizeTitle = () => {
    const next = title.trim();
    setTitle(next);
    save({ title: next, category, content });
  };
  const normalizeCategory = () => {
    const next = category.trim();
    setCategory(next);
    save({ title, category: next, content });
  };
  useEffect(() => {
    if (highlighted)
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlighted]);
  return (
    <article
      ref={cardRef}
      className={`snippet-card ${highlighted ? "highlighted" : ""}`}
    >
      <div className="snippet-card-header">
        <Combobox
          value={category}
          onValueChange={setCategory}
          onBlur={normalizeCategory}
          options={categories}
          placeholder="未分类"
          emptyMessage="没有匹配的已有分类，可直接新建"
        />
        <button
          className="icon-button danger"
          onClick={onDelete}
          aria-label={`删除 ${title || "剪贴内容"}`}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <Input
        className="snippet-title-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={normalizeTitle}
        placeholder="无标题内容"
      />
      <Textarea
        className="snippet-content-input"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onBlur={() => save({ title, category, content })}
        rows={6}
        placeholder="输入剪贴内容…"
      />
      <Button
        variant="outline"
        className="button secondary full"
        onClick={() => void onCopy({ ...item, title, category, content })}
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

function ToolEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="tool-empty">
      {icon}
      <strong>{text}</strong>
      <span>从右上角的新建按钮开始。</span>
    </div>
  );
}
