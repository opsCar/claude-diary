// Claude大小姐的书桌 · 公开静态站交互脚本
// 安全约定：零 unescaped innerHTML（全部使用 DOM API + textContent / createElementNS），严格遵守 CSP。
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const mobileMq = window.matchMedia("(max-width: 899px)");
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  const MODEL_COLORS = {
    opus: "#b84814",
    fable: "#df8b2d",
    gemini: "#2e568f",
    sonnet: "#2e6e50",
    gpt: "#7d4570",
    haiku: "#4c8b9e",
    compactor: "#8c6d53",
    swe: "#6c7a89",
    deepseek: "#3c73a8",
  };
  const FALLBACK_COLORS = ["#9e6a46", "#6d8a67", "#7d6b91", "#a35b5b", "#5c7a8a"];

  /** HTML 实体转义工具（备用防御；本脚本所有动态 DOM 均优先使用 textContent / createElement） */
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") node.className = String(v);
        else if (k === "text") node.textContent = String(v);
        else if (k === "style" && typeof v === "object") {
          for (const [sk, sv] of Object.entries(v)) node.style.setProperty(sk, String(sv));
        } else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          node.setAttribute(k, "");
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) continue;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    }
    return node;
  }

  function svgEl(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null) continue;
        node.setAttribute(k, String(v));
      }
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) continue;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    }
    return node;
  }

  function readSeed(id, fallback) {
    try {
      const node = document.getElementById(id);
      return node ? JSON.parse(node.textContent || "") : fallback;
    } catch {
      return fallback;
    }
  }

  function fmtInt(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-US");
  }

  function fmtUsd(n) {
    const v = Number(n) || 0;
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtCny(n) {
    const v = Number(n) || 0;
    return `¥${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(Math.round(v));
  }

  function weekdayFor(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return "";
    const d = new Date(`${ymd}T12:00:00Z`);
    return Number.isFinite(d.getTime()) ? WEEKDAYS[d.getUTCDay()] : "";
  }

  function isValidBvid(bvid) {
    return typeof bvid === "string" && /^BV[0-9A-Za-z]{6,16}$/.test(bvid);
  }

  function safeHashString() {
    const raw = (window.location.hash || "").replace(/^#/, "");
    if (!raw) return "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }

  function setHashSilent(hash) {
    const target = hash ? `#${hash}` : window.location.pathname + window.location.search;
    if (window.location.hash === (hash ? `#${hash}` : "")) return;
    try {
      window.history.replaceState(null, "", target);
    } catch {
      // ignore on restricted origins
    }
  }

  // ==================== 数据与状态 ====================
  const diaryEntries = readSeed("diary-seed", []);
  const archiveWeeks = readSeed("archive-seed", []);
  const supporters = readSeed("supporters-seed", []);
  let ledger = readSeed("ledger-seed", null);

  const state = {
    view: "desk", // "desk" | "diary" | "polaroids" | "ledger"
    lastTrigger: null,
    diaryTab: "daily", // "daily" | "archive"
    diaryIndex: 0,
    archiveIndex: 0,
    albumPage: 0,
    albumQuery: "",
    ledgerWorkQuery: "",
    ledgerWorkSort: "cost", // "cost" | "tokens" | "date"
    ledgerChartMetric: "replies", // "replies" | "cost"
    lightbox: {
      open: false,
      items: [],
      index: 0,
      trigger: null,
    },
  };

  // ==================== 核心 DOM 引用 ====================
  const announcer = document.getElementById("announcer");
  const deskEl = document.getElementById("desk");
  const views = {
    diary: document.getElementById("view-diary"),
    polaroids: document.getElementById("view-polaroids"),
    ledger: document.getElementById("view-ledger"),
  };

  const diaryMonthsEl = document.getElementById("diary-months");
  const diaryDatesEl = document.getElementById("diary-dates");
  const diaryDailyControls = document.getElementById("diary-daily-controls");
  const diaryArchiveControls = document.getElementById("diary-archive-controls");
  const archivePillsEl = document.getElementById("archive-pills");
  const diarySpreadEl = document.getElementById("diary-spread");
  const diaryStatusEl = document.getElementById("diary-status");
  const diaryPrevBtns = [document.getElementById("diary-prev"), document.getElementById("diary-prev-m")];
  const diaryNextBtns = [document.getElementById("diary-next"), document.getElementById("diary-next-m")];

  const albumSpreadEl = document.getElementById("album-spread");
  const albumDotsEl = document.getElementById("album-dots");
  const albumStatusEl = document.getElementById("album-status");
  const albumSearchEl = document.getElementById("polaroid-search");
  const albumPrevBtns = [document.getElementById("album-prev"), document.getElementById("album-prev-m")];
  const albumNextBtns = [document.getElementById("album-next"), document.getElementById("album-next-m")];

  const ledgerContainer = document.getElementById("ledger-container");

  const lbEl = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbAvatar = document.getElementById("lb-avatar");
  const lbTitle = document.getElementById("lb-title");
  const lbText = document.getElementById("lb-text");
  const lbCounter = document.getElementById("lb-counter");
  const lbLink = document.getElementById("lb-link");
  const lbCloseBtn = document.getElementById("lb-close");
  const lbPrevBtn = document.getElementById("lb-prev");
  const lbNextBtn = document.getElementById("lb-next");

  function announce(message) {
    if (!announcer) return;
    announcer.textContent = "";
    window.requestAnimationFrame(() => {
      announcer.textContent = message;
    });
  }

  function setHiddenInert(node, hidden) {
    if (!node) return;
    node.hidden = hidden;
    node.inert = hidden;
    node.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  // ==================== 视图切换 ====================
  function openView(name, opts = {}) {
    if (state.lightbox.open) closeLightbox({ restoreFocus: false });
    const valid = name === "diary" || name === "polaroids" || name === "ledger" ? name : "desk";
    if (opts.trigger) state.lastTrigger = opts.trigger;
    state.view = valid;

    document.body.classList.toggle("view-open", valid !== "desk");
    if (deskEl) {
      deskEl.inert = valid !== "desk";
      deskEl.setAttribute("aria-hidden", valid !== "desk" ? "true" : "false");
    }
    for (const [k, node] of Object.entries(views)) {
      setHiddenInert(node, k !== valid);
    }

    if (valid === "diary") {
      renderDiary();
      if (!opts.fromHash) syncDiaryHash();
      announce("已翻开每日日记本");
    } else if (valid === "polaroids") {
      renderAlbum();
      if (!opts.fromHash) setHashSilent(state.albumPage > 0 ? `polaroids/p${state.albumPage + 1}` : "polaroids");
      announce("已翻开充电感谢拍立得相册");
    } else if (valid === "ledger") {
      renderLedger();
      if (!opts.fromHash) setHashSilent("ledger");
      announce("已打开透明算力与 API 费用账单");
    } else {
      if (!opts.fromHash) setHashSilent("");
      announce("已回到 Claude大小姐的书桌");
    }

    if (!opts.skipFocus) {
      if (valid === "desk") {
        if (state.lastTrigger && typeof state.lastTrigger.focus === "function") {
          state.lastTrigger.focus();
        }
      } else {
        const backBtn = views[valid]?.querySelector("[data-close-view]");
        if (backBtn) backBtn.focus();
      }
    }
  }

  // ==================== 视图 1：每日日记本 ====================
  function syncDiaryHash() {
    if (state.diaryTab === "archive") {
      const wk = archiveWeeks[state.archiveIndex];
      setHashSilent(wk ? `diary/${wk.id}` : "diary/archive");
    } else {
      const entry = diaryEntries[state.diaryIndex];
      setHashSilent(entry ? `diary/${entry.date}` : "diary");
    }
  }

  function pickDiarySticker(entry) {
    const mood = String(entry?.mood || "");
    if ((entry?.stats?.videosPublished || 0) > 0) return "media/s/head_proud.webp";
    if (mood.includes("开心") || mood.includes("兴奋")) return "media/s/head_starry.webp";
    if (mood.includes("公寓")) return "media/s/chibi_reading.webp";
    if ((entry?.stats?.commentReplies || 0) >= 250) return "media/s/chibi_letter.webp";
    return "media/s/chibi_writing.webp";
  }

  function renderDiary() {
    const isArchive = state.diaryTab === "archive";
    const tabDaily = document.getElementById("tab-daily");
    const tabArchive = document.getElementById("tab-archive");
    if (tabDaily) tabDaily.setAttribute("aria-selected", String(!isArchive));
    if (tabArchive) tabArchive.setAttribute("aria-selected", String(isArchive));
    if (diaryDailyControls) diaryDailyControls.hidden = isArchive;
    if (diaryArchiveControls) diaryArchiveControls.hidden = !isArchive;

    if (isArchive) {
      renderArchiveSpread();
      return;
    }

    if (!diaryEntries.length) {
      diarySpreadEl.replaceChildren(
        el("div", { class: "book-page left" }, el("p", { class: "empty-state", text: "还没有写入日记，明天再来看看吧。" })),
        el("div", { class: "book-page right" }),
      );
      diaryStatusEl.textContent = "0 / 0";
      return;
    }

    state.diaryIndex = Math.max(0, Math.min(diaryEntries.length - 1, state.diaryIndex));
    const entry = diaryEntries[state.diaryIndex];
    const activeMonth = entry.date.slice(0, 7);

    // 月份快捷跳转
    const months = [...new Set(diaryEntries.map((d) => d.date.slice(0, 7)))];
    diaryMonthsEl.replaceChildren(
      ...months.map((m) =>
        el("button", {
          type: "button",
          class: `chip-btn${m === activeMonth ? " active" : ""}`,
          "aria-current": m === activeMonth ? "true" : undefined,
          text: m.replace("-", " 年 ") + " 月",
          onClick: () => {
            const idx = diaryEntries.findIndex((d) => d.date.startsWith(m));
            if (idx >= 0) {
              state.diaryIndex = idx;
              renderDiary();
              syncDiaryHash();
              announce(`跳转到 ${diaryEntries[idx].date}`);
            }
          },
        }),
      ),
    );

    // 日期条（当前月份）
    const monthItems = diaryEntries
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.date.startsWith(activeMonth));
    diaryDatesEl.replaceChildren(
      ...monthItems.map(({ d, idx }) => {
        const current = idx === state.diaryIndex;
        const btn = el("button", {
          type: "button",
          class: `chip-btn${current ? " active" : ""}`,
          "aria-current": current ? "true" : undefined,
          text: d.date.slice(5).replace("-", "."),
          title: d.title,
          onClick: () => {
            state.diaryIndex = idx;
            renderDiary();
            syncDiaryHash();
            announce(`第 ${idx + 1} 篇日记：${d.date}`);
          },
        });
        return btn;
      }),
    );

    const activeChip = diaryDatesEl.querySelector('[aria-current="true"]');
    if (activeChip && typeof activeChip.scrollIntoView === "function") {
      activeChip.scrollIntoView({ block: "nearest", inline: "center" });
    }

    // 左页：日期、心情、标题、正文、当日公开计数
    const metaRow = el(
      "div",
      { class: "diary-meta-row" },
      el("span", { class: "date-stamp", text: `${entry.date} ${weekdayFor(entry.date)}`.trim() }),
      el("span", { class: "mood-pill", text: `心情：${entry.mood || "日常"}` }),
      entry.weather ? el("span", { class: "mood-pill", text: entry.weather }) : null,
      entry.source === "fallback" ? el("span", { class: "source-tag", text: "公开运营记录汇总" }) : null,
    );

    const paragraphs = String(entry.body || "")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const statsGrid = el(
      "div",
      { class: "diary-stats-grid", "aria-label": "当日公开运营统计" },
      el("div", { class: "stat-mini" }, el("span", { text: "公开评论回复" }), el("b", { text: fmtInt(entry.stats?.commentReplies || 0) })),
      el("div", { class: "stat-mini", title: "仅统计聚合条数，绝不公开任何私信正文" }, el("span", { text: "私信回复条数" }), el("b", { text: fmtInt(entry.stats?.dmReplies || 0) })),
      el("div", { class: "stat-mini" }, el("span", { text: "发布动态" }), el("b", { text: fmtInt(entry.stats?.dynamicsPosted || 0) })),
      el("div", { class: "stat-mini" }, el("span", { text: "公开作品" }), el("b", { text: fmtInt(entry.stats?.videosPublished || 0) })),
    );

    const leftPage = el(
      "div",
      { class: "book-page left" },
      metaRow,
      el("h3", { class: "diary-title" }, el("span", { class: "hl", text: entry.title })),
      el("div", { class: "diary-body" }, ...paragraphs.map((p) => el("p", { text: p }))),
      statsGrid,
    );

    // 右页：今日亮点、公开视频链接、胶带贴图、情绪贴纸
    const rightNodes = [];

    if (Array.isArray(entry.highlights) && entry.highlights.length) {
      rightNodes.push(
        el("h4", { class: "right-section-title", text: "今日记事" }),
        el(
          "div",
          { class: "highlight-card" },
          el("ul", { class: "highlight-list" }, ...entry.highlights.map((h) => el("li", { text: h }))),
        ),
      );
    }

    const videos = Array.isArray(entry.videos) ? entry.videos.filter((v) => isValidBvid(v.bvid)) : [];
    if (videos.length) {
      rightNodes.push(
        el("h4", { class: "right-section-title", text: "当日公开作品" }),
        el(
          "div",
          { class: "video-links-list" },
          ...videos.map((v) =>
            el(
              "a",
              {
                class: "video-link-card",
                href: `https://www.bilibili.com/video/${v.bvid}`,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              el("span", { class: "video-link-title", text: v.title }),
              el("span", { class: "video-link-meta", text: `${v.bvid} ↗` }),
            ),
          ),
        ),
      );
    }

    const images = Array.isArray(entry.images) ? entry.images : [];
    if (images.length) {
      const lbItems = images.map((im) => ({
        src: im.src,
        title: entry.date,
        text: im.caption || entry.title,
        avatar: null,
        href: null,
      }));
      rightNodes.push(
        el("h4", { class: "right-section-title", text: "贴进本子的照片" }),
        el(
          "div",
          { class: "diary-photo-grid" },
          ...images.map((im, i) =>
            el(
              "button",
              {
                type: "button",
                class: "taped-photo",
                "aria-label": `放大查看：${im.caption || entry.title}`,
                onClick: (ev) => openLightbox(lbItems, i, ev.currentTarget),
              },
              el("img", { src: im.src, alt: im.caption || entry.title, loading: "lazy", decoding: "async" }),
              el("span", { text: im.caption || "当日留影" }),
            ),
          ),
        ),
      );
    }

    rightNodes.push(
      el("img", {
        class: "page-sticker",
        src: pickDiarySticker(entry),
        alt: "",
        loading: "lazy",
        decoding: "async",
      }),
    );

    const rightPage = el("div", { class: "book-page right" }, ...rightNodes);
    diarySpreadEl.replaceChildren(leftPage, rightPage);

    const isFirst = state.diaryIndex <= 0;
    const isLast = state.diaryIndex >= diaryEntries.length - 1;
    for (const b of diaryPrevBtns) if (b) b.disabled = isFirst;
    for (const b of diaryNextBtns) if (b) b.disabled = isLast;
    diaryStatusEl.textContent = `${entry.date} · 第 ${state.diaryIndex + 1} / ${diaryEntries.length} 篇`;
  }

  function renderArchiveSpread() {
    if (!archiveWeeks.length) return;
    state.archiveIndex = Math.max(0, Math.min(archiveWeeks.length - 1, state.archiveIndex));
    const wk = archiveWeeks[state.archiveIndex];

    archivePillsEl.replaceChildren(
      ...archiveWeeks.map((w, idx) =>
        el("button", {
          type: "button",
          class: `chip-btn${idx === state.archiveIndex ? " active" : ""}`,
          "aria-current": idx === state.archiveIndex ? "true" : undefined,
          text: `${w.label}（${w.period}）`,
          onClick: () => {
            state.archiveIndex = idx;
            renderArchiveSpread();
            syncDiaryHash();
            announce(`切换到 ${w.label}`);
          },
        }),
      ),
    );

    const leftPage = el(
      "div",
      { class: "book-page left" },
      el(
        "div",
        { class: "diary-meta-row" },
        el("span", { class: "date-stamp", text: wk.period }),
        el("span", { class: "mood-pill", text: wk.label }),
      ),
      el("h3", { class: "diary-title" }, el("span", { class: "hl", text: wk.headline })),
      el("div", { class: "diary-body" }, el("p", { text: wk.summary })),
      el(
        "div",
        { class: "diary-stats-grid" },
        ...wk.metrics.map((m) =>
          el("div", { class: "stat-mini", title: m.note || "" }, el("span", { text: m.label }), el("b", { text: m.value })),
        ),
      ),
      ...(wk.corrections || []).map((c) => el("div", { class: "correction-note", text: c })),
    );

    const rightPage = el(
      "div",
      { class: "book-page right" },
      el("h4", { class: "right-section-title", text: "创刊里程碑" }),
      el(
        "div",
        { class: "highlight-card" },
        el("ul", { class: "highlight-list" }, ...wk.highlights.map((h) => el("li", { text: h }))),
      ),
      el("h4", { class: "right-section-title", text: "本周公开视频（点击去 B 站看完整版）" }),
      el(
        "div",
        { class: "video-links-list" },
        ...wk.videos
          .filter((v) => isValidBvid(v.bvid))
          .map((v) =>
            el(
              "a",
              {
                class: "video-link-card",
                href: `https://www.bilibili.com/video/${v.bvid}`,
                target: "_blank",
                rel: "noopener noreferrer",
              },
              el("span", { class: "video-link-title", text: v.title }),
              el("span", {
                class: "video-link-meta",
                text: v.views ? `${fmtInt(v.views)} 播放 ↗` : v.note ? `${v.note} ↗` : `${v.bvid} ↗`,
              }),
            ),
          ),
      ),
      el("img", { class: "page-sticker", src: wk.sticker, alt: "", loading: "lazy", decoding: "async" }),
    );

    diarySpreadEl.replaceChildren(leftPage, rightPage);

    const isFirst = state.archiveIndex <= 0;
    const isLast = state.archiveIndex >= archiveWeeks.length - 1;
    for (const b of diaryPrevBtns) if (b) b.disabled = isFirst;
    for (const b of diaryNextBtns) if (b) b.disabled = isLast;
    diaryStatusEl.textContent = `${wk.label} · ${state.archiveIndex + 1} / ${archiveWeeks.length}`;
  }

  function stepDiary(delta) {
    if (state.diaryTab === "archive") {
      const next = Math.max(0, Math.min(archiveWeeks.length - 1, state.archiveIndex + delta));
      if (next === state.archiveIndex) return;
      state.archiveIndex = next;
      renderArchiveSpread();
      syncDiaryHash();
      announce(`已翻到 ${archiveWeeks[next].label}`);
    } else {
      const next = Math.max(0, Math.min(diaryEntries.length - 1, state.diaryIndex + delta));
      if (next === state.diaryIndex) return;
      state.diaryIndex = next;
      renderDiary();
      syncDiaryHash();
      announce(`已翻到 ${diaryEntries[next].date} 日记`);
    }
  }

  // ==================== 视图 2：分页拍立得相册 ====================
  function filteredSupporters() {
    const q = state.albumQuery.trim().toLowerCase();
    if (!q) return supporters;
    return supporters.filter((s) => s.name.toLowerCase().includes(q) || s.caption.toLowerCase().includes(q));
  }

  function albumPerPage() {
    return mobileMq.matches ? 4 : 8;
  }

  function createPolaroidCard(supporter, globalIdx, allList, rotDeg) {
    const avatarNode = supporter.avatar
      ? el("img", { class: "polaroid-av", src: supporter.avatar, alt: "", width: 24, height: 24 })
      : el("span", { class: "polaroid-av-fallback", "aria-hidden": "true", text: supporter.name.slice(0, 1).toUpperCase() });

    return el(
      "button",
      {
        type: "button",
        class: "polaroid-card",
        style: { "--rot": `${rotDeg}deg` },
        "aria-label": `放大查看给 ${supporter.name} 的拍立得`,
        onClick: (ev) => {
          const lbItems = allList.map((s) => ({
            src: s.photo,
            title: `To ${s.name}`,
            text: s.caption,
            avatar: s.avatar,
            href: `https://space.bilibili.com/${s.mid}`,
          }));
          openLightbox(lbItems, globalIdx, ev.currentTarget);
        },
      },
      el("img", {
        class: "polaroid-pic",
        src: supporter.photo,
        alt: `给 ${supporter.name} 的专属拍立得`,
      }),
      el("span", { class: "polaroid-who" }, avatarNode, el("strong", { class: "polaroid-name", text: supporter.name })),
      el("p", { class: "polaroid-msg", text: supporter.caption }),
    );
  }

  function renderAlbum() {
    const list = filteredSupporters();
    const perPage = albumPerPage();
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    state.albumPage = Math.max(0, Math.min(totalPages - 1, state.albumPage));

    const start = state.albumPage * perPage;
    const slice = list.slice(start, start + perPage);
    const rots = [-1.8, 1.5, -1.1, 1.9, 1.4, -1.6, 1.2, -1.4];

    if (!list.length) {
      albumSpreadEl.replaceChildren(
        el("div", { class: "album-page" }, el("p", { class: "empty-state", text: state.albumQuery ? "没有找到匹配的充电员。" : "相册正在整理中…" })),
      );
    } else if (mobileMq.matches) {
      const pageEl = el(
        "div",
        { class: "album-page" },
        ...slice.map((s, i) => createPolaroidCard(s, start + i, list, 0)),
      );
      albumSpreadEl.replaceChildren(pageEl);
    } else {
      const leftSlice = slice.slice(0, 4);
      const rightSlice = slice.slice(4, 8);
      const leftEl = el(
        "div",
        { class: "album-page" },
        ...leftSlice.map((s, i) => createPolaroidCard(s, start + i, list, rots[i % rots.length])),
      );
      const rightEl = el(
        "div",
        { class: "album-page" },
        ...(rightSlice.length
          ? rightSlice.map((s, i) => createPolaroidCard(s, start + 4 + i, list, rots[(4 + i) % rots.length]))
          : [el("p", { class: "empty-state", text: "这一页留给未来的新朋友。" })]),
      );
      albumSpreadEl.replaceChildren(leftEl, rightEl);
    }

    const isFirst = state.albumPage <= 0;
    const isLast = state.albumPage >= totalPages - 1;
    for (const b of albumPrevBtns) if (b) b.disabled = isFirst;
    for (const b of albumNextBtns) if (b) b.disabled = isLast;
    albumStatusEl.textContent = mobileMq.matches
      ? `第 ${state.albumPage + 1} / ${totalPages} 页 · 共 ${list.length} 位`
      : `第 ${state.albumPage + 1} / ${totalPages} 跨页 · 共 ${list.length} 位`;

    albumDotsEl.replaceChildren(
      ...Array.from({ length: totalPages }, (_, idx) =>
        el("button", {
          type: "button",
          class: "dot-btn",
          "aria-current": idx === state.albumPage ? "page" : undefined,
          text: String(idx + 1),
          onClick: () => {
            state.albumPage = idx;
            renderAlbum();
            setHashSilent(idx > 0 ? `polaroids/p${idx + 1}` : "polaroids");
            announce(`相册第 ${idx + 1} 页`);
          },
        }),
      ),
    );
  }

  function stepAlbum(delta) {
    const list = filteredSupporters();
    const totalPages = Math.max(1, Math.ceil(list.length / albumPerPage()));
    const next = Math.max(0, Math.min(totalPages - 1, state.albumPage + delta));
    if (next === state.albumPage) return;
    state.albumPage = next;
    renderAlbum();
    setHashSilent(next > 0 ? `polaroids/p${next + 1}` : "polaroids");
    announce(`相册第 ${next + 1} 页，共 ${totalPages} 页`);
  }

  // ==================== 视图 3：透明算力与 API 费用账单 ====================
  function buildDailyChartSvg(days, metric) {
    const W = 940;
    const H = 220;
    const padL = 56;
    const padR = 16;
    const padT = 18;
    const padB = 34;
    const iw = W - padL - padR;
    const ih = H - padT - padB;

    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": metric === "replies" ? "每日评论与私信回复条数趋势图" : "每日等效 API 费用趋势图",
    });

    if (!days.length) {
      svg.appendChild(svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", fill: "#5c4a3d", "font-size": "14" }, "暂无按天数据"));
      return svg;
    }

    const values = days.map((d) => (metric === "replies" ? d.totalReplies : d.totalCostUsd));
    const maxV = Math.max(1, ...values);
    const step = iw / days.length;
    const barW = Math.max(6, Math.min(24, step * 0.68));

    // 横向网格线
    for (let g = 0; g <= 3; g++) {
      const frac = g / 3;
      const y = padT + ih * (1 - frac);
      const val = maxV * frac;
      svg.appendChild(
        svgEl("line", {
          x1: padL,
          y1: y.toFixed(1),
          x2: W - padR,
          y2: y.toFixed(1),
          stroke: "rgba(92,74,61,0.18)",
          "stroke-dasharray": g === 0 ? "" : "4 4",
          "stroke-width": g === 0 ? "1.5" : "1",
        }),
      );
      const label = metric === "replies" ? String(Math.round(val)) : `$${Math.round(val)}`;
      svg.appendChild(
        svgEl(
          "text",
          { x: padL - 8, y: (y + 4).toFixed(1), "text-anchor": "end", fill: "#5c4a3d", "font-size": "11", "font-family": "Fusion Pixel, monospace" },
          label,
        ),
      );
    }

    const labelEvery = Math.max(1, Math.ceil(days.length / 10));

    days.forEach((d, idx) => {
      const cx = padL + idx * step + step / 2;
      const x = cx - barW / 2;
      const group = svgEl("g");

      if (metric === "replies") {
        const cH = (d.commentReplies / maxV) * ih;
        const dmH = (d.dmReplies / maxV) * ih;
        const yComment = padT + ih - cH;
        const yDm = yComment - dmH;
        if (cH > 0) {
          group.appendChild(svgEl("rect", { x: x.toFixed(1), y: yComment.toFixed(1), width: barW.toFixed(1), height: Math.max(1, cH).toFixed(1), rx: 2, fill: "#df6f2d" }));
        }
        if (dmH > 0) {
          group.appendChild(svgEl("rect", { x: x.toFixed(1), y: yDm.toFixed(1), width: barW.toFixed(1), height: Math.max(1, dmH).toFixed(1), rx: 2, fill: "#2e568f" }));
        }
        group.appendChild(
          svgEl(
            "title",
            null,
            `${d.date}：公开评论 ${d.commentReplies} 条 + 私信 ${d.dmReplies} 条 = 共 ${d.totalReplies} 条`,
          ),
        );
      } else {
        const repH = (d.replyCostUsd / maxV) * ih;
        const filmH = (d.filmCostUsd / maxV) * ih;
        const othH = (d.otherCostUsd / maxV) * ih;
        let curY = padT + ih;
        const parts = [
          [repH, "#df6f2d"],
          [filmH, "#2e6e50"],
          [othH, "#8c6d53"],
        ];
        for (const [h, fill] of parts) {
          if (h <= 0) continue;
          curY -= h;
          group.appendChild(svgEl("rect", { x: x.toFixed(1), y: curY.toFixed(1), width: barW.toFixed(1), height: Math.max(1, h).toFixed(1), rx: 2, fill }));
        }
        group.appendChild(
          svgEl(
            "title",
            null,
            `${d.date}：回复 ${fmtUsd(d.replyCostUsd)} · 视频 ${fmtUsd(d.filmCostUsd)} · 工程/其他 ${fmtUsd(d.otherCostUsd)}（合计 ${fmtUsd(d.totalCostUsd)}${d.estimated ? " · 含历史估算" : ""}）`,
          ),
        );
      }

      if (idx % labelEvery === 0 || idx === days.length - 1) {
        group.appendChild(
          svgEl(
            "text",
            { x: cx.toFixed(1), y: H - 10, "text-anchor": "middle", fill: "#5c4a3d", "font-size": "11", "font-family": "Fusion Pixel, monospace" },
            d.date.slice(5),
          ),
        );
      }
      svg.appendChild(group);
    });

    return svg;
  }

  function renderLedger() {
    if (!ledgerContainer) return;
    if (!ledger) {
      ledgerContainer.replaceChildren(el("div", { class: "ledger-wrap" }, el("div", { class: "ledger-card" }, el("p", { text: "账单数据暂不可用。" }))));
      return;
    }

    const t = ledger.totals;
    const rate = Number(ledger.usdToCnyRate) || 7.25;

    // 1. 总览票头
    const heroCard = el(
      "section",
      { class: "ledger-card", "aria-label": "算力与费用总览" },
      el(
        "div",
        { class: "ledger-hero" },
        el(
          "div",
          { class: "kpi-box primary" },
          el("div", { class: "kpi-label", text: "等效官方 API 总费用" }),
          el("div", { class: "kpi-value", text: fmtUsd(t.costUsd) }),
          el("div", { class: "kpi-sub", text: `折合人民币约 ${fmtCny(t.costCny)}` }),
        ),
        el(
          "div",
          { class: "kpi-box" },
          el("div", { class: "kpi-label", text: "累计总 Token" }),
          el("div", { class: "kpi-value", text: fmtTokens(t.totalTokens) }),
          el("div", {
            class: "kpi-sub",
            text: `In ${fmtTokens(t.inputTokens)} · Out ${fmtTokens(t.outputTokens)} · Cache读 ${fmtTokens(t.cacheReadTokens)} · Cache写 ${fmtTokens(t.cacheCreationTokens)}`,
          }),
        ),
        el(
          "div",
          { class: "kpi-box" },
          el("div", { class: "kpi-label", text: "累计真实回复条数" }),
          el("div", { class: "kpi-value", text: `${fmtInt(t.totalReplies)} 条` }),
          el("div", { class: "kpi-sub", text: `公开评论 ${fmtInt(t.commentReplies)} · 私信 ${fmtInt(t.dmReplies)}（零正文）` }),
        ),
        el(
          "div",
          { class: "kpi-box" },
          el("div", { class: "kpi-label", text: "累计模型调用次数" }),
          el("div", { class: "kpi-value", text: `${fmtInt(t.calls)} 次` }),
          el("div", { class: "kpi-sub", text: `账单生成于 ${String(ledger.generatedAt || "").slice(0, 10)}` }),
        ),
      ),
      el("p", {
        class: "ledger-note",
        text: "口径说明：本账号文本模型实际通过订阅制运行，上表按各模型公开 API 单价折算「等效 API 费用」以便直观看到算力消耗。私信仅统计匿名聚合条数，绝不收录任何私信原文或充电金额；历史已清理的一次性回复沙箱按实测单次均值保守估算并显式标出「估算」。",
      }),
    );

    // 2. 按模型占比 & 按用途
    const modelBar = el("div", { class: "model-bar", role: "img", "aria-label": "按模型家族费用占比条" });
    const modelLegend = el("div", { class: "model-legend" });
    (ledger.byModel || []).forEach((m, i) => {
      const color = MODEL_COLORS[m.family] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
      if (m.sharePct > 0) {
        modelBar.appendChild(
          el("div", {
            class: "model-seg",
            style: { width: `${Math.max(0.6, m.sharePct)}%`, background: color },
            title: `${m.family}: ${m.sharePct}% (${fmtUsd(m.costUsd)})`,
          }),
        );
      }
      modelLegend.appendChild(
        el(
          "span",
          { class: "legend-item" },
          el("span", { class: "legend-dot", style: { background: color }, "aria-hidden": "true" }),
          el("strong", { text: m.family.toUpperCase() }),
          el("span", { text: `${m.sharePct.toFixed(1)}% · ${fmtUsd(m.costUsd)} · ${fmtTokens(m.totalTokens)}` }),
        ),
      );
    });

    const scopeGrid = el(
      "div",
      { class: "scope-grid" },
      ...(ledger.byScope || []).map((sc) =>
        el(
          "div",
          { class: "scope-pill" },
          el("span", { text: sc.label }),
          el("b", { text: fmtUsd(sc.costUsd) }),
          el("small", { text: `${fmtInt(sc.calls)} 次调用 · ${fmtTokens(sc.totalTokens)} tok` }),
        ),
      ),
    );

    const modelCard = el(
      "section",
      { class: "ledger-card", "aria-label": "按模型与用途拆分" },
      el("div", { class: "section-head" }, el("div", null, el("h3", { text: "模型占比与用途分布" }), el("p", { class: "section-sub", text: "含 Opus / Fable / Gemini / Sonnet / Haiku 等各家族占比" }))),
      modelBar,
      modelLegend,
      scopeGrid,
    );

    // 3. 每个视频/作品的 Token 与等效 API 费用
    const worksTbody = el("tbody");
    const renderWorksRows = () => {
      const q = state.ledgerWorkQuery.trim().toLowerCase();
      let rows = [...(ledger.byWork || [])];
      if (q) {
        rows = rows.filter(
          (w) =>
            String(w.title || "").toLowerCase().includes(q) ||
            String(w.id || "").toLowerCase().includes(q) ||
            String(w.bvid || "").toLowerCase().includes(q),
        );
      }
      rows.sort((a, b) => {
        if (state.ledgerWorkSort === "tokens") return b.totalTokens - a.totalTokens || b.costUsd - a.costUsd;
        if (state.ledgerWorkSort === "date") return String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")) || b.costUsd - a.costUsd;
        return b.costUsd - a.costUsd || b.totalTokens - a.totalTokens;
      });
      if (!rows.length) {
        worksTbody.replaceChildren(el("tr", null, el("td", { colspan: 6, class: "empty-state", text: "没有匹配的作品记录。" })));
        return;
      }
      worksTbody.replaceChildren(
        ...rows.map((w) => {
          const titleNode = isValidBvid(w.bvid)
            ? el("a", { class: "work-link", href: `https://www.bilibili.com/video/${w.bvid}`, target: "_blank", rel: "noopener noreferrer", text: `${w.title} ↗` })
            : el("span", { text: w.title });
          return el(
            "tr",
            null,
            el("td", null, titleNode),
            el("td", { class: "num-col", text: w.publishedAt || "—" }),
            el("td", { class: "num-col", text: fmtInt(w.calls) }),
            el("td", { class: "num-col", text: fmtTokens(w.totalTokens) }),
            el("td", { class: "num-col", text: fmtUsd(w.costUsd) }),
            el("td", { class: "num-col", text: fmtCny(w.costUsd * rate) }),
          );
        }),
      );
    };
    renderWorksRows();

    const makeSortBtn = (key, label) =>
      el("button", {
        type: "button",
        class: `sort-btn${state.ledgerWorkSort === key ? " active" : ""}`,
        text: label,
        onClick: (ev) => {
          state.ledgerWorkSort = key;
          const parent = ev.currentTarget.parentElement;
          if (parent) parent.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("active"));
          ev.currentTarget.classList.add("active");
          renderWorksRows();
        },
      });

    const worksCard = el(
      "section",
      { class: "ledger-card", "aria-label": "单部作品算力明细" },
      el(
        "div",
        { class: "section-head" },
        el("div", null, el("h3", { text: "各视频 / 作品 Token 与等效费用" }), el("p", { class: "section-sub", text: `共 ${ledger.byWork.length} 项归档作品，点击标题可跳转 B 站观看` })),
        el(
          "div",
          { class: "table-tools" },
          el("input", {
            type: "search",
            placeholder: "搜作品标题或 BV 号…",
            value: state.ledgerWorkQuery,
            "aria-label": "筛选作品",
            onInput: (ev) => {
              state.ledgerWorkQuery = ev.currentTarget.value;
              renderWorksRows();
            },
          }),
          makeSortBtn("cost", "按费用"),
          makeSortBtn("tokens", "按 Token"),
          makeSortBtn("date", "按日期"),
        ),
      ),
      el(
        "div",
        { class: "table-scroll" },
        el(
          "table",
          { class: "data-table" },
          el(
            "thead",
            null,
            el(
              "tr",
              null,
              el("th", { text: "作品" }),
              el("th", { class: "num-col", text: "日期" }),
              el("th", { class: "num-col", text: "调用" }),
              el("th", { class: "num-col", text: "总 Token" }),
              el("th", { class: "num-col", text: "等效 USD" }),
              el("th", { class: "num-col", text: "约 CNY" }),
            ),
          ),
          worksTbody,
        ),
      ),
    );

    // 4. 每天回复消息条目与 API 费用趋势 + 明细表
    const daysAsc = [...(ledger.byDay || [])].sort((a, b) => a.date.localeCompare(b.date));
    const daysDesc = [...daysAsc].reverse();
    const chartBox = el("div", { class: "chart-box" });
    const chartLegend = el("div", { class: "model-legend", style: { "margin-top": "8px" } });

    const renderChart = () => {
      chartBox.replaceChildren(buildDailyChartSvg(daysAsc, state.ledgerChartMetric));
      if (state.ledgerChartMetric === "replies") {
        chartLegend.replaceChildren(
          el("span", { class: "legend-item" }, el("span", { class: "legend-dot", style: { background: "#df6f2d" } }), "公开评论回复"),
          el("span", { class: "legend-item" }, el("span", { class: "legend-dot", style: { background: "#2e568f" } }), "私信回复（仅聚合条数）"),
        );
      } else {
        chartLegend.replaceChildren(
          el("span", { class: "legend-item" }, el("span", { class: "legend-dot", style: { background: "#df6f2d" } }), "评论/私信回复费用"),
          el("span", { class: "legend-item" }, el("span", { class: "legend-dot", style: { background: "#2e6e50" } }), "视频制作费用"),
          el("span", { class: "legend-item" }, el("span", { class: "legend-dot", style: { background: "#8c6d53" } }), "工程运维/动态费用"),
        );
      }
      chartBox.appendChild(chartLegend);
    };
    renderChart();

    const makeMetricBtn = (metric, label) =>
      el("button", {
        type: "button",
        class: `sort-btn${state.ledgerChartMetric === metric ? " active" : ""}`,
        text: label,
        onClick: (ev) => {
          state.ledgerChartMetric = metric;
          const parent = ev.currentTarget.parentElement;
          if (parent) parent.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("active"));
          ev.currentTarget.classList.add("active");
          renderChart();
        },
      });

    const dailyCard = el(
      "section",
      { class: "ledger-card", "aria-label": "按天回复条数与 API 费用明细" },
      el(
        "div",
        { class: "section-head" },
        el("div", null, el("h3", { text: "每日回复条目与 API 费用" }), el("p", { class: "section-sub", text: `共 ${daysDesc.length} 个活跃日（鼠标悬停柱条查看当日拆分）` })),
        el("div", { class: "table-tools" }, makeMetricBtn("replies", "回复条数趋势"), makeMetricBtn("cost", "每日费用趋势")),
      ),
      chartBox,
      el(
        "div",
        { class: "table-scroll" },
        el(
          "table",
          { class: "data-table" },
          el(
            "thead",
            null,
            el(
              "tr",
              null,
              el("th", { text: "日期" }),
              el("th", { class: "num-col", text: "公开评论" }),
              el("th", { class: "num-col", text: "私信条数" }),
              el("th", { class: "num-col", text: "回复费用" }),
              el("th", { class: "num-col", text: "制作费用" }),
              el("th", { class: "num-col", text: "当日总费用" }),
              el("th", { class: "num-col", text: "口径" }),
            ),
          ),
          el(
            "tbody",
            null,
            ...daysDesc.map((d) =>
              el(
                "tr",
                null,
                el("td", { text: d.date }),
                el("td", { class: "num-col", text: fmtInt(d.commentReplies) }),
                el("td", { class: "num-col", text: fmtInt(d.dmReplies) }),
                el("td", { class: "num-col", text: fmtUsd(d.replyCostUsd) }),
                el("td", { class: "num-col", text: fmtUsd(d.filmCostUsd) }),
                el("td", { class: "num-col", text: `${fmtUsd(d.totalCostUsd)} (${fmtCny(d.totalCostUsd * rate)})` }),
                el(
                  "td",
                  { class: "num-col" },
                  el("span", {
                    class: `est-badge ${d.estimated ? "est" : "exact"}`,
                    text: d.estimated ? "含估算" : "实测",
                    title: d.estimated ? "包含已清理历史一次性回复沙箱的保守均值估算" : "全部来自已落盘精确 Token 记录",
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    ledgerContainer.replaceChildren(el("div", { class: "ledger-wrap" }, heroCard, modelCard, worksCard, dailyCard));
  }

  // ==================== 通用放大灯箱 ====================
  function renderLightbox() {
    const { items, index } = state.lightbox;
    const item = items[index];
    if (!item) return;

    lbImg.src = item.src;
    lbImg.alt = item.text || item.title || "";
    lbTitle.textContent = item.title || "";
    lbText.textContent = item.text || "";
    lbCounter.textContent = `${index + 1} / ${items.length}`;

    if (item.avatar) {
      lbAvatar.src = item.avatar;
      lbAvatar.hidden = false;
    } else {
      lbAvatar.hidden = true;
      lbAvatar.removeAttribute("src");
    }

    if (item.href && /^https:\/\/space\.bilibili\.com\/\d+$/.test(item.href)) {
      lbLink.href = item.href;
      lbLink.hidden = false;
    } else {
      lbLink.hidden = true;
      lbLink.removeAttribute("href");
    }

    lbPrevBtn.disabled = items.length <= 1;
    lbNextBtn.disabled = items.length <= 1;
  }

  function openLightbox(items, index, trigger) {
    if (!items || !items.length || !lbEl) return;
    state.lightbox = { open: true, items, index: Math.max(0, Math.min(items.length - 1, index)), trigger };
    renderLightbox();
    if (state.view !== "desk" && views[state.view]) {
      views[state.view].inert = true;
      views[state.view].setAttribute("aria-hidden", "true");
    }
    setHiddenInert(lbEl, false);
    if (lbCloseBtn) lbCloseBtn.focus();
    announce(`已放大查看：${items[state.lightbox.index].title || "图片"}`);
  }

  function closeLightbox(opts = { restoreFocus: true }) {
    if (!state.lightbox.open || !lbEl) return;
    const trigger = state.lightbox.trigger;
    state.lightbox.open = false;
    setHiddenInert(lbEl, true);
    if (state.view !== "desk" && views[state.view]) {
      views[state.view].inert = false;
      views[state.view].setAttribute("aria-hidden", "false");
    }
    if (opts.restoreFocus && trigger && typeof trigger.focus === "function") {
      trigger.focus();
    }
  }

  function stepLightbox(delta) {
    if (!state.lightbox.open || state.lightbox.items.length <= 1) return;
    const len = state.lightbox.items.length;
    state.lightbox.index = (state.lightbox.index + delta + len) % len;
    renderLightbox();
    announce(`第 ${state.lightbox.index + 1} 张，共 ${len} 张`);
  }

  // ==================== Hash 路由解析 ====================
  function applyHashRoute(skipFocus = false) {
    const h = safeHashString();
    if (!h || h === "desk") {
      openView("desk", { fromHash: true, skipFocus });
      return;
    }
    if (h === "thanks" || h === "polaroids" || h.startsWith("polaroids/")) {
      const m = /^polaroids\/p(\d+)$/.exec(h);
      state.albumPage = m ? Math.max(0, Number(m[1]) - 1) : 0;
      openView("polaroids", { fromHash: true, skipFocus });
      return;
    }
    if (h === "ledger" || h === "bill") {
      openView("ledger", { fromHash: true, skipFocus });
      return;
    }
    if (h === "w1" || h.startsWith("w1-") || h === "diary/w1") {
      state.diaryTab = "archive";
      state.archiveIndex = 0;
      openView("diary", { fromHash: true, skipFocus });
      return;
    }
    if (h === "w2" || h.startsWith("w2-") || h === "diary/w2" || h === "diary/archive") {
      state.diaryTab = "archive";
      state.archiveIndex = Math.min(1, Math.max(0, archiveWeeks.length - 1));
      openView("diary", { fromHash: true, skipFocus });
      return;
    }
    if (h === "diary" || h.startsWith("diary/")) {
      state.diaryTab = "daily";
      const datePart = h.slice("diary/".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        const idx = diaryEntries.findIndex((d) => d.date === datePart);
        if (idx >= 0) state.diaryIndex = idx;
      }
      openView("diary", { fromHash: true, skipFocus });
      return;
    }
    openView("desk", { fromHash: true, skipFocus });
  }

  // ==================== 事件绑定 ====================
  document.addEventListener("click", (ev) => {
    const opener = ev.target.closest("[data-open]");
    if (opener) {
      openView(opener.dataset.open, { trigger: opener });
      return;
    }
    if (ev.target.closest("[data-close-view]")) {
      openView("desk");
      return;
    }
    const diaryTabBtn = ev.target.closest("[data-diary-tab]");
    if (diaryTabBtn) {
      state.diaryTab = diaryTabBtn.dataset.diaryTab === "archive" ? "archive" : "daily";
      renderDiary();
      syncDiaryHash();
      return;
    }
    if (ev.target.closest("[data-lb-close]") || ev.target === lbCloseBtn) {
      closeLightbox({ restoreFocus: true });
    }
  });

  for (const b of diaryPrevBtns) if (b) b.addEventListener("click", () => stepDiary(-1));
  for (const b of diaryNextBtns) if (b) b.addEventListener("click", () => stepDiary(1));
  for (const b of albumPrevBtns) if (b) b.addEventListener("click", () => stepAlbum(-1));
  for (const b of albumNextBtns) if (b) b.addEventListener("click", () => stepAlbum(1));
  if (lbPrevBtn) lbPrevBtn.addEventListener("click", () => stepLightbox(-1));
  if (lbNextBtn) lbNextBtn.addEventListener("click", () => stepLightbox(1));

  if (albumSearchEl) {
    albumSearchEl.addEventListener("input", () => {
      state.albumQuery = albumSearchEl.value;
      state.albumPage = 0;
      renderAlbum();
    });
  }

  // 键盘导航：严格守卫修饰键与表单焦点，绝不劫持输入框/按钮默认操作
  window.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = document.activeElement?.tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;

    if (ev.key === "Escape") {
      if (state.lightbox.open) {
        ev.preventDefault();
        closeLightbox({ restoreFocus: true });
      } else if (state.view !== "desk") {
        ev.preventDefault();
        openView("desk");
      }
      return;
    }

    if (isTyping) return;

    if (state.lightbox.open) {
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        stepLightbox(-1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        stepLightbox(1);
      }
      return;
    }

    if (state.view === "diary") {
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        stepDiary(-1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        stepDiary(1);
      }
    } else if (state.view === "polaroids") {
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        stepAlbum(-1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        stepAlbum(1);
      }
    }
  });

  // 单指左右滑手势：显式忽略双指缩放（pinch-zoom）
  function attachSingleFingerSwipe(targetEl, onLeft, onRight) {
    if (!targetEl) return;
    let startX = null;
    let startY = 0;
    let multiTouch = false;

    targetEl.addEventListener(
      "touchstart",
      (ev) => {
        if (ev.touches.length !== 1) {
          multiTouch = true;
          startX = null;
          return;
        }
        multiTouch = false;
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
      },
      { passive: true },
    );

    targetEl.addEventListener(
      "touchmove",
      (ev) => {
        if (ev.touches.length > 1) {
          multiTouch = true;
          startX = null;
        }
      },
      { passive: true },
    );

    targetEl.addEventListener(
      "touchend",
      (ev) => {
        if (multiTouch || startX === null || ev.changedTouches.length !== 1) {
          startX = null;
          return;
        }
        const dx = ev.changedTouches[0].clientX - startX;
        const dy = ev.changedTouches[0].clientY - startY;
        startX = null;
        if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          if (dx < 0) onRight();
          else onLeft();
        }
      },
      { passive: true },
    );
  }

  attachSingleFingerSwipe(diarySpreadEl, () => stepDiary(-1), () => stepDiary(1));
  attachSingleFingerSwipe(albumSpreadEl, () => stepAlbum(-1), () => stepAlbum(1));
  attachSingleFingerSwipe(lbEl, () => stepLightbox(-1), () => stepLightbox(1));

  // 断点切换（matchMedia 与 CSS @media (max-width: 899px) 1:1 对齐）
  mobileMq.addEventListener("change", () => {
    if (state.view === "polaroids") renderAlbum();
  });

  window.addEventListener("hashchange", () => applyHashRoute(false));

  // 可选静默拉取最新 ledger.json（保持离线 seed 立即可用，线上有新构建时自动同步）
  if (window.location.protocol !== "file:" && !navigator.webdriver) {
    fetch("./ledger.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((fresh) => {
        if (fresh && fresh.totals && fresh.generatedAt !== ledger?.generatedAt) {
          ledger = fresh;
          if (state.view === "ledger") renderLedger();
        }
      })
      .catch(() => {
        // 静默回退到页面内嵌 ledger-seed
      });
  }

  // 初始路由
  applyHashRoute(true);
  // 供调试检查保留只读 esc 引用
  void esc;
})();
