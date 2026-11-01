// Claude大小姐的日记本 · 网页版：桌上一本会翻页的手帐。
// 桌面：两页摊开，一张一张翻（每张纸正面是右页、背面是下一个左页）；手机：一次一页。
// 剪贴片段只在当前看得见的页上播放；书签 W1 / W2 和 #链接 直接翻到对应页。
(() => {
  const stage = document.getElementById("stage");
  const book = document.getElementById("book");
  const hint = document.getElementById("hint");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const tabs = [...document.querySelectorAll(".tabs a")];
  const SRC = [...document.getElementById("pages").content.querySelectorAll("section.pg")];
  const tplNode = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TURN = reduced ? 10 : 900;

  let single = false;
  let leaves = [];
  let cur = 0;
  let busyUntil = 0;

  const blank = () => Object.assign(document.createElement("section"), { className: "pg blank" });
  const face = (side, node, isCover) => {
    const f = document.createElement("div");
    f.className = `face ${side}${isCover ? " cover-face" : ""}`;
    if (node) f.appendChild(node);
    return f;
  };

  /** inner page index → leaf state that shows it */
  const stateFor = (j) => (single ? j + 1 : j % 2 ? (j + 1) / 2 : j / 2 + 1);
  /** first inner page visible in a state (for keeping the place across a layout switch) */
  const pageFor = (c) => (single ? c - 1 : 2 * c - 2);

  function build() {
    single = innerWidth < 900;
    stage.classList.toggle("single", single);
    book.innerHTML = '<div class="board left"></div><div class="board right"></div>';
    const pages = SRC.map((p) => p.cloneNode(true));
    const pairs = [];
    if (single) {
      pairs.push([tplNode("cover"), null, true]);
      pages.forEach((p) => pairs.push([p, null]));
      pairs.push([tplNode("backcover"), null, true]);
    } else {
      pairs.push([tplNode("cover"), pages[0], true]);
      for (let i = 1; i < pages.length; i += 2) pairs.push([pages[i], pages[i + 1] ?? tplNode("backcover")]);
      if (pages.length % 2 === 1) pairs.push([blank(), tplNode("backcover")]);
    }
    leaves = pairs.map(([front, back, isCover], i) => {
      const leaf = document.createElement("div");
      leaf.className = "leaf";
      leaf.dataset.i = i;
      leaf.append(face("front", front, isCover), face("back", back ?? blank(), back && back.classList.contains("cover")));
      book.appendChild(leaf);
      return leaf;
    });
    layout();
    place(false);
  }

  function layout() {
    let pw;
    let ph;
    if (single) {
      pw = Math.min(innerWidth - 28, 560);
      ph = pw / 0.75;
      if (ph > innerHeight - 110) {
        ph = innerHeight - 110;
        pw = ph * 0.75;
      }
    } else {
      ph = Math.min(innerHeight - 120, 980);
      pw = ph * 0.75;
      if (pw * 2 > innerWidth - 150) {
        pw = (innerWidth - 150) / 2;
        ph = pw / 0.75;
      }
    }
    const bw = single ? pw : pw * 2;
    stage.style.setProperty("--bw", `${bw}px`);
    stage.style.setProperty("--bh", `${ph}px`);
    document.documentElement.style.setProperty("--s", String(pw / 600));
    fit();
  }

  /** pages written longer than 600×800 are scaled down to fit their page */
  function fit() {
    for (const inner of book.querySelectorAll(".inner")) {
      inner.style.setProperty("--f", "1");
      const h = inner.scrollHeight;
      if (h > 801) inner.style.setProperty("--f", String(Math.max(0.6, 800 / h)));
    }
  }

  function zFor(i) {
    return i < cur ? i + 1 : leaves.length - i;
  }

  /** apply `cur` to every leaf; `animate` lets moving leaves turn on top of the stacks */
  function place(animate, moving = []) {
    leaves.forEach((leaf, i) => {
      leaf.classList.toggle("flipped", i < cur);
      if (!moving.includes(i)) leaf.style.zIndex = String(zFor(i));
    });
    const n = leaves.length;
    const bw = parseFloat(stage.style.getPropertyValue("--bw")) || 0;
    const shift = single ? 0 : cur === 0 ? -bw / 4 : cur === n ? bw / 4 : 0;
    book.style.setProperty("--shift", `${shift}px`);
    stage.classList.toggle("closed-front", cur === 0);
    stage.classList.toggle("closed-back", cur === n);
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur >= (single ? n - 1 : n);
    // week bookmark + hint
    const j = Math.max(0, Math.min(SRC.length - 1, pageFor(cur) + (single ? 0 : 1)));
    const week = cur === 0 ? null : SRC[j]?.dataset.week ?? SRC[Math.max(0, j - 1)]?.dataset.week;
    tabs.forEach((a) => a.setAttribute("aria-current", String(a.dataset.week === week)));
    hint.textContent = cur === 0 ? "点封面翻开 · ← → 也能翻" : single ? "左右滑动翻页" : "点右页往后翻，点左页往回翻";
    media();
    if (!animate) return;
  }

  function media() {
    const visible = new Set();
    if (single) visible.add(leaves[cur]?.querySelector(".face.front"));
    else {
      visible.add(leaves[cur - 1]?.querySelector(".face.back"));
      visible.add(leaves[cur]?.querySelector(".face.front"));
    }
    for (const v of book.querySelectorAll("video.clip")) {
      const on = !reduced && visible.has(v.closest(".face"));
      if (on) {
        v.preload = "auto";
        v.play().catch(() => {});
      } else v.pause();
    }
  }

  /** turn to state `target`, one leaf after another (a riffle for long jumps) */
  function go(target) {
    const n = leaves.length;
    target = Math.max(0, Math.min(single ? n - 1 : n, target));
    if (target === cur) return;
    const forward = target > cur;
    const order = [];
    for (let i = cur; i !== target; i += forward ? 1 : -1) order.push(forward ? i : i - 1);
    const gap = order.length > 1 ? Math.min(120, 700 / order.length) : 0;
    order.forEach((leafIndex, k) => {
      setTimeout(() => {
        const leaf = leaves[leafIndex];
        leaf.style.zIndex = String(n + 10 + k);
        leaf.classList.add("turning");
        cur = forward ? leafIndex + 1 : leafIndex;
        place(true, [leafIndex]);
        setTimeout(() => {
          leaf.classList.remove("turning");
          leaf.style.zIndex = String(zFor(leafIndex));
        }, TURN);
      }, k * gap);
    });
    busyUntil = Date.now() + order.length * gap + 250;
  }
  const next = () => Date.now() >= busyUntil && go(cur + 1);
  const prev = () => Date.now() >= busyUntil && go(cur - 1);

  function fromHash() {
    const anchor = decodeURIComponent(location.hash.slice(1));
    if (!anchor) return false;
    const j = SRC.findIndex((p) => p.dataset.anchor === anchor);
    if (j < 0) return false;
    go(stateFor(j));
    return true;
  }

  // ---------- input ----------
  book.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    if (e.target.closest(".bubbles.whiteout")) {
      e.target.closest(".bubbles").classList.toggle("peel");
      return;
    }
    if (single) {
      const r = stage.getBoundingClientRect();
      return e.clientX < r.left + r.width * 0.3 ? prev() : next();
    }
    const f = e.target.closest(".face");
    if (!f) return;
    if (f.classList.contains("back")) prev();
    else next();
  });
  book.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, "", a.getAttribute("href"));
    fromHash();
  });
  tabs.forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      history.replaceState(null, "", a.getAttribute("href"));
      fromHash();
    }),
  );
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      prev();
    }
  });
  let tx = null;
  let ty = 0;
  stage.addEventListener("touchstart", (e) => {
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    tx = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
      if (dx < 0) next();
      else prev();
    }
  });
  addEventListener("hashchange", fromHash);
  let wasSingle = innerWidth < 900;
  let rt = 0;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const nowSingle = innerWidth < 900;
      if (nowSingle !== wasSingle) {
        const j = Math.max(0, pageFor(cur));
        const wasOpen = cur > 0;
        wasSingle = nowSingle;
        build();
        cur = wasOpen ? stateFor(j) : 0;
        place(false);
      } else {
        layout();
        place(false);
      }
    }, 150);
  });

  build();
  if (document.fonts) document.fonts.ready.then(fit);
  addEventListener("load", fit);
  if (location.hash) setTimeout(fromHash, 350);
})();
