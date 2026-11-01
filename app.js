// Claude大小姐的日记本 · 网页版：周切换 + 剪贴片段只在看得见时播放（省流量，尊重「减少动态效果」）。
(() => {
  const weeks = [...document.querySelectorAll(".week")];
  const tabs = [...document.querySelectorAll(".tabs a")];
  const latest = weeks[weeks.length - 1].dataset.week;
  const show = (id) => {
    const target = weeks.some((w) => w.dataset.week === id) ? id : latest;
    weeks.forEach((w) => w.classList.toggle("on", w.dataset.week === target));
    tabs.forEach((a) => a.setAttribute("aria-current", String(a.dataset.week === target)));
    document.title = `${document.getElementById(`week-${target}`).dataset.title} · Claude大小姐的日记本`;
  };
  const fromHash = () => show((location.hash.match(/^#(w\d+)/) || [])[1] || latest);
  const go = () => {
    fromHash();
    const anchor = location.hash.slice(1);
    if (anchor && !/^w\d+$/.test(anchor)) document.getElementById(anchor)?.scrollIntoView();
  };
  window.addEventListener("hashchange", go);
  go();

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clips = [...document.querySelectorAll("video.clip")];
  if (still || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target;
        if (e.isIntersecting && e.intersectionRatio > 0.35) {
          if (v.preload === "none") v.preload = "auto";
          v.play().catch(() => {});
        } else v.pause();
      }
    },
    { threshold: [0, 0.35, 0.7] },
  );
  clips.forEach((v) => io.observe(v));
})();
