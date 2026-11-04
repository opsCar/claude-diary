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
    const chartTab = e.target.closest("[data-chart-mode]");
    if (chartTab) {
      e.stopPropagation();
      const pageEl = chartTab.closest("[data-live-market]");
      const mkt = pageEl?.dataset.liveMarket;
      if (mkt) {
        chartModes[mkt] = chartTab.dataset.chartMode;
        renderLiveTradingInBook();
      }
      return;
    }
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

  // ---------- live paper-trading (zero AI tokens, real-time EastMoney quotes & trends) ----------
  const chartModes = { CN: "intraday", US: "intraday" };
  let tradingSnap = (() => {
    try {
      const el = document.getElementById("trading-seed");
      return el ? JSON.parse(el.textContent) : null;
    } catch {
      return null;
    }
  })();
  const liveMarketState = { CN: null, US: null };

  function calcLiveFee(mkt, side, qty, price, isEtf) {
    const gross = qty * price;
    if (gross <= 0 || qty <= 0) return 0;
    if (mkt === "CN") {
      if (isEtf) return Math.max(0.2, gross * 0.00015);
      const comm = Math.max(5, gross * 0.00025);
      const transfer = gross * 0.00001;
      const stamp = side === "SELL" ? gross * 0.0005 : 0;
      return comm + transfer + stamp;
    }
    return Math.min(Math.max(1.0, qty * 0.005), Math.max(1.0, gross * 0.005));
  }

  function secidToGtimgCodes(secid) {
    const [mkt, sym] = String(secid).split(".");
    if (mkt === "1") return { isUs: false, codes: [`sh${sym}`] };
    if (mkt === "0") return { isUs: false, codes: [`sz${sym}`] };
    return { isUs: true, codes: [`us${sym}.OQ`, `us${sym}.AM`, `us${sym}.N`] };
  }

  function etHmToBjHm(hmStr) {
    const h = Number(hmStr.slice(0, 2));
    const m = hmStr.slice(2, 4);
    // 11月美东为冬令时 EST (UTC-5)，北京时间 UTC+8，相差 +13 小时
    const bjH = (h + 13) % 24;
    return { hm: `${String(bjH).padStart(2, "0")}:${m}`, crossedMidnight: h + 13 >= 24 };
  }

  function addOneDay(ymd) {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  async function fetchTrendsForSecid(secid) {
    const { isUs, codes } = secidToGtimgCodes(secid);
    for (const code of codes) {
      try {
        const endpoint = isUs
          ? `https://web.ifzq.gtimg.cn/appstock/app/UsMinute/query?code=${encodeURIComponent(code)}`
          : `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${encodeURIComponent(code)}`;
        const r = await fetch(endpoint, { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json();
        const node = j?.data?.[code];
        const rawList = node?.data?.data;
        if (!Array.isArray(rawList) || rawList.length < 2) continue;
        const rawDate = String(node?.data?.date || "");
        const sessionDate =
          rawDate.length === 8
            ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
            : new Date().toISOString().slice(0, 10);
        const nextDate = addOneDay(sessionDate);
        const qt = node?.qt?.[code] || [];
        const dayOpen = Number(qt[5]) || 0;
        const dayHigh = Number(qt[33]) || 0;
        const dayLow = Number(qt[34]) || 0;
        const preClose = Number(qt[4]) || dayOpen;

        const bars = [];
        for (let i = 0; i < rawList.length; i++) {
          const parts = String(rawList[i]).trim().split(/\s+/);
          if (parts.length < 2) continue;
          const hmRaw = parts[0];
          const close = Number(parts[1]);
          if (!Number.isFinite(close) || close <= 0) continue;
          let barDate = sessionDate;
          let hm = `${hmRaw.slice(0, 2)}:${hmRaw.slice(2, 4)}`;
          if (isUs) {
            const conv = etHmToBjHm(hmRaw);
            hm = conv.hm;
            if (conv.crossedMidnight) barDate = nextDate;
          }
          const open = i === 0 && dayOpen > 0 ? dayOpen : (bars[bars.length - 1]?.close ?? close);
          bars.push({
            time: `${barDate} ${hm}`,
            open,
            close,
            high: Math.max(open, close),
            low: Math.min(open, close),
          });
        }
        if (!bars.length) continue;
        // 将日内真实最低/最高价校准到极值分钟上，确保盘中瞬间插针触发限价单不漏算
        if (dayLow > 0) {
          let minBar = bars[0];
          for (const b of bars) if (b.low < minBar.low) minBar = b;
          if (dayLow < minBar.low) minBar.low = dayLow;
        }
        if (dayHigh > 0) {
          let maxBar = bars[0];
          for (const b of bars) if (b.high > maxBar.high) maxBar = b;
          if (dayHigh > maxBar.high) maxBar.high = dayHigh;
        }
        return {
          secid,
          code,
          name: qt[1] || secid,
          preClose,
          bars,
        };
      } catch {
        // try next code
      }
    }
    return null;
  }

  function simulateMarketIntraday(mSnap, trendsMap) {
    const mkt = mSnap.market;
    const benchSecid = mkt === "CN" ? "1.000300" : "105.QQQ";
    const anyTrend = trendsMap.get(benchSecid) || [...trendsMap.values()][0];
    const refBars = anyTrend?.bars || [];
    const sessionDate = refBars[0]?.time?.slice(0, 10) || mSnap.lastSettledDate || "";

    let cash = Number(mSnap.cash || 0);
    const holdings = new Map();
    for (const p of mSnap.positions || []) {
      holdings.set(p.secid, {
        symbol: p.symbol,
        name: p.name,
        secid: p.secid,
        isEtf: Boolean(p.isEtf),
        qty: p.qty,
        avgCost: p.avgCost,
        lastPrice: p.lastPrice,
      });
    }

    // 只有当行情所属的交易日 > 挂单创建时的收盘日（即已进入下一交易日盘中或收盘），挂单才会在该交易日触发
    const pending = (mSnap.pendingOrders || []).map((o, idx) => ({
      ...o,
      _idx: idx,
      activeToday: Boolean(sessionDate && o.createdAfterDate && sessionDate > o.createdAfterDate),
      triggered: false,
      fillPrice: null,
      fillTime: null,
    }));

    const points = [];
    const markers = [];

    for (let k = 0; k < refBars.length; k++) {
      const timeStr = refBars[k].time;
      const hm = timeStr.slice(11, 16);

      for (const ord of pending) {
        if (!ord.activeToday || ord.triggered) continue;
        const t = trendsMap.get(ord.secid);
        const bar = t?.bars?.[Math.min(k, (t.bars.length || 1) - 1)];
        const dayOpen = t?.bars?.[0]?.open;
        if (!bar || !dayOpen) continue;

        let fill = null;
        if (ord.orderType === "MOO" && k === 0) {
          fill = dayOpen;
        } else if (ord.orderType === "LIMIT") {
          if (ord.side === "BUY" && bar.low <= ord.limitPrice + 1e-6) {
            fill = Math.min(dayOpen, ord.limitPrice);
          } else if (ord.side === "SELL" && bar.high >= ord.limitPrice - 1e-6) {
            fill = Math.max(dayOpen, ord.limitPrice);
          }
        } else if (ord.orderType === "STOP") {
          if (ord.side === "SELL" && bar.low <= ord.stopPrice + 1e-6) {
            fill = Math.min(dayOpen, ord.stopPrice);
          } else if (ord.side === "BUY" && bar.high >= ord.stopPrice - 1e-6) {
            fill = Math.max(dayOpen, ord.stopPrice);
          }
        }

        if (fill !== null && fill > 0) {
          const fee = calcLiveFee(mkt, ord.side, ord.qty, fill, ord.isEtf);
          if (ord.side === "BUY") {
            const totalCost = ord.qty * fill + fee;
            if (totalCost <= cash + 1e-4) {
              cash -= totalCost;
              const prev = holdings.get(ord.secid);
              const prevQty = prev ? prev.qty : 0;
              const prevCost = prev ? prev.qty * prev.avgCost : 0;
              const nextQty = prevQty + ord.qty;
              holdings.set(ord.secid, {
                symbol: ord.symbol,
                name: ord.name,
                secid: ord.secid,
                isEtf: Boolean(ord.isEtf),
                qty: nextQty,
                avgCost: (prevCost + totalCost) / nextQty,
                lastPrice: fill,
              });
              ord.triggered = true;
              ord.fillPrice = fill;
              ord.fillTime = hm;
              markers.push({ idx: k, hm, symbol: ord.symbol, side: "BUY", price: fill });
            }
          } else {
            const prev = holdings.get(ord.secid);
            if (prev && prev.qty > 0) {
              const sellQty = Math.min(prev.qty, ord.qty);
              cash += sellQty * fill - fee;
              prev.qty -= sellQty;
              if (prev.qty <= 0) holdings.delete(ord.secid);
              ord.triggered = true;
              ord.fillPrice = fill;
              ord.fillTime = hm;
              markers.push({ idx: k, hm, symbol: ord.symbol, side: "SELL", price: fill });
            }
          }
        }
      }

      let mv = 0;
      for (const h of holdings.values()) {
        const t = trendsMap.get(h.secid);
        const bar = t?.bars?.[Math.min(k, (t.bars.length || 1) - 1)];
        if (bar) h.lastPrice = bar.close;
        mv += h.qty * h.lastPrice;
      }
      points.push({ time: hm, equity: cash + mv, cash, mv });
    }

    const lastPt = points[points.length - 1] || {
      time: "—",
      equity: cash + [...holdings.values()].reduce((s, h) => s + h.qty * h.lastPrice, 0),
      cash,
      mv: [...holdings.values()].reduce((s, h) => s + h.qty * h.lastPrice, 0),
    };

    return {
      sessionDate,
      lastTime: refBars[refBars.length - 1]?.time || "",
      cash: lastPt.cash,
      mv: lastPt.mv,
      equity: lastPt.equity,
      returnPct: mSnap.initialCash ? ((lastPt.equity - mSnap.initialCash) / mSnap.initialCash) * 100 : 0,
      holdings: [...holdings.values()],
      pending,
      points,
      markers,
      trendsMap,
    };
  }

  function renderTradingChartSvg(mSnap, sim, mode) {
    const isCn = mSnap.market === "CN";
    const cur = isCn ? "¥" : "$";
    const stroke = isCn ? "#e8782f" : "#3b7dd8";
    const fillId = `grad-${mSnap.market}-${mode}`;
    const W = 490;
    const H = 175;
    const L = 48;
    const R = 14;
    const T = 18;
    const B = 24;
    const iw = W - L - R;
    const ih = H - T - B;

    if (mode === "daily") {
      const curve = [...(mSnap.equityCurve || [])];
      if (sim?.sessionDate && (!curve.length || curve[curve.length - 1].date < sim.sessionDate)) {
        curve.push({ date: sim.sessionDate, equity: sim.equity, returnPct: sim.returnPct });
      }
      if (!curve.length) {
        curve.push({ date: "初始", equity: mSnap.initialCash, returnPct: 0 });
      }
      const vals = curve.map((c) => c.equity);
      const minV = Math.min(mSnap.initialCash * 0.995, ...vals);
      const maxV = Math.max(mSnap.initialCash * 1.005, ...vals);
      const span = Math.max(1, maxV - minV);
      const X = (i) => L + (curve.length <= 1 ? iw / 2 : (i / (curve.length - 1)) * iw);
      const Y = (v) => T + ih - ((v - minV) / span) * ih;
      const baseY = Y(mSnap.initialCash);
      const pathD = curve.map((c, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Y(c.equity).toFixed(1)}`).join(" ");
      return `<svg viewBox="0 0 ${W} ${H}" role="img">
        <line x1="${L}" y1="${baseY.toFixed(1)}" x2="${W - R}" y2="${baseY.toFixed(1)}" stroke="#8a7768" stroke-dasharray="4 4" stroke-width="1.2"/>
        <text x="${L - 4}" y="${(baseY + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#8a7768" font-family="Fusion Pixel">${(mSnap.initialCash / 1000).toFixed(0)}k</text>
        <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
        ${curve.map((c, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(c.equity).toFixed(1)}" r="4.5" fill="#fffdf8" stroke="${stroke}" stroke-width="2.5"/><text x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="11.5" fill="#8a7768" font-family="LXGW WenKai">${c.date.slice(5)}</text><text x="${X(i).toFixed(1)}" y="${(Y(c.equity) - 9).toFixed(1)}" text-anchor="middle" font-size="12" fill="#3a2e29" font-family="Fusion Pixel">${cur}${Math.round(c.equity).toLocaleString()}</text>`).join("")}
      </svg>`;
    }

    // Intraday minute-by-minute portfolio value curve
    const pts = sim?.points || [];
    if (!pts.length) {
      return `<svg viewBox="0 0 ${W} ${H}" role="img"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="14" fill="#8a7768">等待分时行情数据…</text></svg>`;
    }
    const vals = pts.map((p) => p.equity);
    const baseVal = mSnap.initialCash;
    const minRaw = Math.min(baseVal, ...vals);
    const maxRaw = Math.max(baseVal, ...vals);
    const pad = Math.max(baseVal * 0.0015, (maxRaw - minRaw) * 0.18);
    const minV = minRaw - pad;
    const maxV = maxRaw + pad;
    const span = Math.max(1, maxV - minV);
    const totalSlots = Math.max(pts.length, isCn ? 240 : 390);
    const X = (i) => L + (i / Math.max(1, totalSlots - 1)) * iw;
    const Y = (v) => T + ih - ((v - minV) / span) * ih;
    const baseY = Y(baseVal);
    const dLine = pts.map((p, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Y(p.equity).toFixed(1)}`).join(" ");
    const lastIdx = pts.length - 1;
    const dArea = `${dLine} L ${X(lastIdx).toFixed(1)} ${(T + ih).toFixed(1)} L ${X(0).toFixed(1)} ${(T + ih).toFixed(1)} Z`;

    const markerNodes = (sim.markers || []).map((m) => {
      const mx = X(m.idx);
      const my = Y(pts[m.idx]?.equity ?? baseVal);
      const onLeft = mx < L + iw * 0.55;
      const tx = onLeft ? mx + 8 : mx - 8;
      const anchor = onLeft ? "start" : "end";
      const ty = my >= baseY - 6 ? Math.min(T + ih - 4, my + 16) : Math.max(T + 12, my - 10);
      return `<g>
        <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4.5" fill="#c8372d" stroke="#fffdf8" stroke-width="2"/>
        <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" font-size="11.5" fill="#c8372d" font-family="LXGW WenKai" font-weight="bold">⚡${m.hm} ${m.side === "BUY" ? "买入" : "卖出"}${m.symbol} @${cur}${m.price}</text>
      </g>`;
    }).join("");

    const lastPt = pts[lastIdx];
    const endX = X(lastIdx);
    const endY = Y(lastPt.equity);

    return `<svg viewBox="0 0 ${W} ${H}" role="img">
      <defs>
        <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line x1="${L}" y1="${T}" x2="${L}" y2="${T + ih}" stroke="rgba(90,70,55,0.25)" stroke-width="1"/>
      <line x1="${L}" y1="${T + ih}" x2="${W - R}" y2="${T + ih}" stroke="rgba(90,70,55,0.25)" stroke-width="1"/>
      <line x1="${L}" y1="${baseY.toFixed(1)}" x2="${W - R}" y2="${baseY.toFixed(1)}" stroke="#8a7768" stroke-dasharray="4 4" stroke-width="1.2"/>
      <text x="${L - 5}" y="${(T + 9).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8a7768" font-family="Fusion Pixel">${Math.round(maxV).toLocaleString()}</text>
      <text x="${L - 5}" y="${(baseY + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8a7768" font-family="Fusion Pixel">${Math.round(baseVal).toLocaleString()}</text>
      <text x="${L - 5}" y="${(T + ih).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#8a7768" font-family="Fusion Pixel">${Math.round(minV).toLocaleString()}</text>
      <path d="${dArea}" fill="url(#${fillId})"/>
      <path d="${dLine}" fill="none" stroke="${stroke}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
      ${markerNodes}
      <circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4.5" fill="${stroke}" stroke="#fffdf8" stroke-width="2"/>
      <text x="${L}" y="${H - 5}" font-size="11" fill="#8a7768" font-family="Fusion Pixel">${pts[0].time}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" font-size="11" fill="#8a7768" font-family="Fusion Pixel">${lastPt.time} (${sim.sessionDate.slice(5)})</text>
    </svg>`;
  }

  function renderLiveTradingInBook() {
    if (!tradingSnap) return;
    for (const mkt of ["CN", "US"]) {
      const mSnap = tradingSnap[mkt];
      const sim = liveMarketState[mkt];
      const cur = mkt === "CN" ? "¥" : "$";
      const mode = chartModes[mkt] || "intraday";

      for (const pageEl of book.querySelectorAll(`[data-live-market="${mkt}"]`)) {
        const q = (role) => pageEl.querySelector(`[data-role="${role}"]`);
        pageEl.querySelectorAll("[data-chart-mode]").forEach((btn) => {
          btn.classList.toggle("on", btn.dataset.chartMode === mode);
        });
        const titleEl = q("chart-title");
        if (titleEl) {
          titleEl.textContent = mode === "daily" ? "累计日线净值走势" : `当日实时净值分时图${sim?.sessionDate ? `（${sim.sessionDate}）` : ""}`;
        }

        if (!sim) continue;
        const eq = sim.equity;
        const ret = sim.returnPct;
        const sign = ret >= 0 ? "+" : "";
        if (q("equity")) q("equity").textContent = `${cur}${eq.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const retEl = q("ret");
        if (retEl) {
          retEl.textContent = `${sign}${ret.toFixed(2)}%`;
          retEl.className = `tr-ret ${ret >= 0 ? "up" : "down"}`;
        }
        if (q("cash")) q("cash").textContent = `${cur}${Math.round(sim.cash).toLocaleString("en-US")}`;
        if (q("mv")) q("mv").textContent = `${cur}${Math.round(sim.mv).toLocaleString("en-US")}`;

        const pill = q("live-pill");
        if (pill) {
          const isActiveSession = sim.pending.some((o) => o.activeToday);
          pill.className = `tr-live-pill ${isActiveSession || sim.holdings.length ? "live" : ""}`;
          pill.innerHTML = `<span class="dot"></span>${sim.lastTime ? `实时行情 ${sim.lastTime.slice(5, 16)}` : "已同步"}`;
        }

        const chartBox = q("chart-svg");
        if (chartBox) {
          chartBox.innerHTML = renderTradingChartSvg(mSnap, sim, mode);
        }

        const listEl = q("orders-list");
        if (listEl) {
          const rows = [];
          for (const h of sim.holdings) {
            const pnl = h.qty * (h.lastPrice - h.avgCost);
            const pnlPct = h.avgCost > 0 ? ((h.lastPrice - h.avgCost) / h.avgCost) * 100 : 0;
            rows.push(
              `<div class="tr-row"><span class="tr-tag hold">持仓</span><b>${h.name}</b><span class="soft">${h.symbol} · ${h.qty}股</span><span class="tr-price">${cur}${h.lastPrice.toFixed(2)}</span><span class="tr-pnl ${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%</span></div>`,
            );
          }
          for (const o of sim.pending) {
            if (o.triggered) continue;
            const t = sim.trendsMap.get(o.secid);
            const curPrice = t?.bars?.[t.bars.length - 1]?.close;
            const target = o.orderType === "MOO" ? "开盘市价" : o.orderType === "LIMIT" ? `限价${cur}${o.limitPrice}` : `止损${cur}${o.stopPrice}`;
            const statusText = o.activeToday
              ? curPrice
                ? `现价${cur}${curPrice.toFixed(2)}·监控中`
                : "盘中监控中"
              : curPrice
                ? `现价${cur}${curPrice.toFixed(2)}·待次日`
                : "待次日开盘";
            rows.push(
              `<div class="tr-row"><span class="tr-tag pend">${o.side === "BUY" ? "预买" : "预卖"}</span><b>${o.name}</b><span class="soft">${o.symbol} · ${o.qty}股</span><span class="tr-price">${target}</span><span class="tr-status">${statusText}</span></div>`,
            );
          }
          listEl.innerHTML = rows.join("") || `<div class="tr-empty">当前 100% 现金空仓</div>`;
        }
      }
    }
    fit();
  }

  function seedTrendsMap(mSnap) {
    const map = new Map();
    if (mSnap?.intradaySeed && typeof mSnap.intradaySeed === "object") {
      for (const [k, v] of Object.entries(mSnap.intradaySeed)) {
        if (v && Array.isArray(v.bars) && v.bars.length) map.set(k, v);
      }
    }
    return map;
  }

  function initSeedSimulation() {
    if (!tradingSnap) return;
    for (const mkt of ["CN", "US"]) {
      const mSnap = tradingSnap[mkt];
      if (!mSnap) continue;
      liveMarketState[mkt] = simulateMarketIntraday(mSnap, seedTrendsMap(mSnap));
    }
  }

  async function updateQuotesFromSnap() {
    if (!tradingSnap) return;
    for (const mkt of ["CN", "US"]) {
      const mSnap = tradingSnap[mkt];
      if (!mSnap) continue;
      const benchSecid = mkt === "CN" ? "1.000300" : "105.QQQ";
      const secids = [
        ...new Set([
          benchSecid,
          ...(mSnap.positions || []).map((p) => p.secid),
          ...(mSnap.pendingOrders || []).map((o) => o.secid),
        ]),
      ];
      const trendsMap = seedTrendsMap(mSnap);
      // 串行逐个拉取分时，避免并发触发东财网关连接重置
      for (const s of secids) {
        try {
          const item = await fetchTrendsForSecid(s);
          if (item && item.bars.length) trendsMap.set(item.secid, item);
        } catch {
          // keep seed fallback
        }
      }
      liveMarketState[mkt] = simulateMarketIntraday(mSnap, trendsMap);
      renderLiveTradingInBook();
    }
  }

  async function refreshLiveTrading(fetchRemoteJson = false) {
    if (fetchRemoteJson) {
      try {
        const r = await fetch(`trading.json?t=${Date.now()}`, { cache: "no-store" });
        if (r.ok) {
          tradingSnap = await r.json();
          initSeedSimulation();
          renderLiveTradingInBook();
        }
      } catch {
        // fallback to embedded seed
      }
    }
    await updateQuotesFromSnap();
  }

  build();
  initSeedSimulation();
  renderLiveTradingInBook();
  refreshLiveTrading(false);
  if (!navigator.webdriver) {
    setInterval(() => refreshLiveTrading(true), 15000);
  }
  if (document.fonts) document.fonts.ready.then(fit);
  addEventListener("load", fit);
  if (location.hash) setTimeout(fromHash, 350);
})();
